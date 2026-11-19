"""JSON API.

/api/...        public: catalogue, seller directory, orders, reviews, sign-ups, view tracking
/api/dash/...   signed-in: each seller sees and edits only their own store; the
                platform manager sees everything, approves sellers and splits ad revenue.
"""
from __future__ import annotations

import json
import re
import secrets
from datetime import date

from flask import Blueprint, current_app, jsonify, request

from . import accounts, analytics, lifecycle, receipts, reports
from .accounts import current_user, is_manager, login_required, manager_required, own_seller_id
from .db import (DAYS, get_db, loads, now_iso, order_out, product_out, seller_out, set_setting,
                 custom_slots_used, today, unique_slug, usd_to_lrd)
from .notify import notify_order
from .uploads import save_image
from .validation import (COUNTS_STOCK, ValidationError, clean_order, clean_order_changes, clean_product,
                         clean_registration, clean_review, clean_store, number, phone_digits, slug, ORDER_ID)

bp = Blueprint("api", __name__, url_prefix="/api")


def body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("Bad request")
    return data


@bp.errorhandler(ValidationError)
def _validation_error(e):
    return jsonify(ok=False, error=str(e)), 400


@bp.before_request
def _same_origin_writes():
    """Reject cross-site write requests (CSRF). Browsers always send Origin on POST."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("Origin")
        if origin and origin.rstrip("/") != request.host_url.rstrip("/"):
            return jsonify(ok=False, error="Cross-site request blocked"), 403
        if not request.is_json:
            return jsonify(ok=False, error="Expected JSON"), 415


def _active_seller(slug_or_id) -> dict | None:
    db = get_db()
    col = "id" if isinstance(slug_or_id, int) else "slug"
    return db.execute(f"SELECT * FROM sellers WHERE {col} = ? AND status = 'active'", (slug_or_id,)).fetchone()


def _wa(number: str) -> str:
    d = phone_digits(number)
    if d.startswith("00"):
        d = d[2:]
    elif d.startswith("0"):
        d = current_app.config["SHOP"]["countryCode"] + d[1:]
    return d


# ===========================================================================
# Public: catalogue & directory
# ===========================================================================
@bp.get("/products")
def products():
    """Active products of active sellers. ?seller=<slug> limits it to one store."""
    db = get_db()
    args, where = [], "p.active = 1 AND s.status = 'active'"
    if request.args.get("seller"):
        where += " AND s.slug = ?"
        args.append(request.args["seller"])
    rows = db.execute(f"SELECT p.*, s.slug AS seller_slug FROM products p JOIN sellers s ON s.id = p.seller_id "
                      f"WHERE {where} ORDER BY p.position, p.created", args).fetchall()
    seller_ids = sorted({r["seller_id"] for r in rows})
    sellers = {}
    for sid in seller_ids:
        s = seller_out(db.execute("SELECT * FROM sellers WHERE id = ?", (sid,)).fetchone())
        sellers[s["slug"]] = s
    resp = jsonify(ok=True, products=[product_out(r, r["seller_slug"]) for r in rows], sellers=sellers, rate=usd_to_lrd())
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.get("/sellers")
def sellers():
    """Directory of makers, most active first."""
    rows = get_db().execute("SELECT * FROM sellers WHERE status = 'active' ORDER BY created").fetchall()
    out = [seller_out(r) for r in rows]
    out.sort(key=lambda s: (-(s["handoffs"] + s["reviews"] * 2), -s["products"]))
    return jsonify(ok=True, sellers=out)


@bp.get("/sellers/<slug_>")
def seller_profile(slug_):
    row = _active_seller(slug_)
    if not row:
        return jsonify(ok=False, error="Shop not found"), 404
    reviews = [dict(r) for r in get_db().execute(
        "SELECT rating, comment, buyer_name AS buyer, created FROM reviews WHERE seller_id = ? AND hidden = 0 "
        "ORDER BY created DESC LIMIT 30", (row["id"],))]
    return jsonify(ok=True, seller=seller_out(row), reviews=reviews)


@bp.post("/track")
def track():
    """Product pop-up opened (engagement, not an ad page view)."""
    pid = str(body().get("productId") or "")[:48]
    row = get_db().execute("SELECT seller_id FROM products WHERE id = ?", (pid,)).fetchone()
    if row:
        analytics.record("product_open", row["seller_id"], pid)
    return jsonify(ok=True)


# ===========================================================================
# Public: orders, reviews, seller sign-up
# ===========================================================================
@bp.post("/orders")
def create_order():
    order = clean_order(body())
    db = get_db()
    if db.execute("SELECT 1 FROM orders WHERE id = ?", (order["id"],)).fetchone():
        return jsonify(ok=True, id=order["id"], duplicate=True)   # customer pressed send twice

    total, seller = 0.0, None
    custom_work = order["type"] == "custom"
    if order["type"] == "cart":
        # Re-price from the database so customers can't change prices; one order = one seller.
        problems, priced, seller_ids = [], [], set()
        for it in order["items"]:
            p = db.execute("SELECT * FROM products WHERE id = ?", (it["id"],)).fetchone()
            if not p or not p["active"]:
                problems.append(f"{it['name']} is no longer available")
                continue
            seller_ids.add(p["seller_id"])
            if it["qty"] > p["stock"]:
                problems.append(f"Only {p['stock']} {p['name']} left" if p["stock"] else f"{p['name']} is sold out")
            line = {**it, "name": p["name"], "price": p["price"]}
            if p["custom_enabled"]:
                c = it.get("custom") or {}
                if not c.get("colors") or not c.get("deadline"):
                    problems.append(f"Pick your colours and deadline for {p['name']}")
                custom_work = True
            else:
                line.pop("custom", None)
            priced.append(line)
        if len(seller_ids) > 1:
            raise ValidationError("Please send one order per shop")
        if problems:
            return jsonify(ok=False, code="stock", error=". ".join(problems)), 409
        seller = _active_seller(next(iter(seller_ids))) if seller_ids else None
        order["items"] = priced
        total = round(sum(i["price"] * i["qty"] for i in priced), 2)
    else:
        seller = _active_seller(order["seller"]) if order["seller"] else None
        if seller and not seller["custom_enabled"]:
            raise ValidationError("This shop isn't taking custom requests right now")
    if not seller:
        raise ValidationError("This shop isn't taking orders right now")

    if custom_work and seller["custom_slots_week"] and custom_slots_used(seller["id"]) >= seller["custom_slots_week"]:
        return jsonify(ok=False, code="full", error=f"{seller['name']} has no custom slots left this week. "
                                                      "Please try again next week or choose another maker."), 409

    if order["delivery"] == "Pickup":
        spots = loads(seller["pickup_spots"], [])
        if spots and order["pickupSpot"] not in spots:
            raise ValidationError("Choose one of the seller's pickup spots")
        if order["pickupDay"] and order["pickupDay"] not in DAYS:
            raise ValidationError("Choose a pickup day")
    else:
        order["pickupSpot"] = order["pickupDay"] = ""

    # Delivery fee: looked up from the seller's own options (never trusted from the browser). Pickup is free.
    order["deliveryFee"], order["deliveryLabel"] = 0.0, ""
    if order["type"] == "cart" and order["delivery"] == "Delivery":
        if not seller["delivery_available"]:
            raise ValidationError("This maker doesn't deliver — please choose pickup")
        options = {o["id"]: o for o in loads(seller["delivery_options"], [])}
        if options:
            opt = options.get(order["deliveryOption"])
            if not opt:
                raise ValidationError("Choose one of the maker's delivery options")
            order["deliveryFee"] = float(opt["fee"])
            order["deliveryLabel"] = opt["name"] + (f" — {opt['details']}" if opt.get("details") else "")
    total = round(total + order["deliveryFee"], 2)

    order["total"] = total
    order["lrdRate"] = usd_to_lrd()
    # Customer style photos are private: stored under uploads/orders/ and only shown to the seller.
    order["photoLinks"] = [save_image(ph.get("data") if isinstance(ph, dict) else None, f"orders/{order['id']}", f"style-{i}")
                           for i, ph in enumerate(order.pop("photos"), 1)]

    c = order["customer"]
    key = receipts.new_key()
    needed_by = [i["custom"]["deadline"] for i in order["items"] if i.get("custom")] + \
                ([order["custom"]["date"]] if order["custom"] and order["custom"].get("date") else [])
    due = lifecycle.due_date(date.fromisoformat(today()), custom_work, needed_by)
    db.execute(
        "INSERT INTO orders (id, seller_id, type, created_at, customer_name, customer_phone, customer_location, items,"
        " custom, delivery, pickup_spot, pickup_day, note, total, status, photo_links, lrd_rate, is_custom_work, due_at,"
        " delivery_fee, delivery_option, receipt_key)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'New', ?,?,?,?,?,?,?)",
        (order["id"], seller["id"], order["type"], now_iso(), c["name"], c["phone"], c["location"],
         json.dumps(order["items"]), json.dumps(order["custom"]) if order["custom"] else None, order["delivery"],
         order["pickupSpot"], order["pickupDay"], order["note"], total, json.dumps(order["photoLinks"]),
         order["lrdRate"], int(custom_work), due, order["deliveryFee"], order["deliveryLabel"], key))
    db.commit()
    seller_email = db.execute("SELECT email FROM users WHERE seller_id = ? AND active = 1 ORDER BY id LIMIT 1",
                              (seller["id"],)).fetchone()
    notify_order(order, dict(seller), seller_email["email"] if seller_email else "")
    return jsonify(ok=True, id=order["id"], total=total, deliveryFee=order["deliveryFee"], seller=seller["slug"],
                   receiptKey=key, receiptUrl=receipts.receipt_path(order["id"], key)), 201


# ---------------------------------------------------------------- buyer receipts (no account)
@bp.post("/orders/mine")
def my_orders():
    """The orders this browser placed: [{id, key}] → their current receipts. Unknown or wrong keys are skipped."""
    wanted = body().get("orders")
    wanted = wanted if isinstance(wanted, list) else []
    out = []
    for w in wanted[:50]:
        if not isinstance(w, dict):
            continue
        oid = str(w.get("id") or "").strip().upper()
        if not ORDER_ID.match(oid):
            continue
        row, seller = receipts.load(oid)
        if receipts.key_matches(row, str(w.get("key") or "")):
            out.append(receipts.receipt(row, seller))
    out.sort(key=lambda r: r["createdAt"], reverse=True)
    return jsonify(ok=True, orders=out)


@bp.post("/orders/find")
def find_order():
    """Lost the link or using another phone? Order number + the phone used for the order."""
    d = body()
    oid = str(d.get("orderId") or "").strip().upper()
    phone = phone_digits(d.get("phone"))
    if not ORDER_ID.match(oid) or len(phone) < 7:
        raise ValidationError("Enter your order number (e.g. CM-261116-AB12) and the phone you ordered with")
    # Guessing is throttled like sign-in: too many misses from one address, or for one order number, locks it for a while.
    ip_key, oid_key = "find-ip:" + (request.remote_addr or "?"), "find-order:" + oid
    if accounts._recent_fails(ip_key) >= 10 or accounts._recent_fails(oid_key) >= 5:
        return jsonify(ok=False, error="Too many tries. Please wait 15 minutes, or ask the maker for your receipt link."), 429
    row, seller = receipts.load(oid)
    if not row or phone_digits(row["customer_phone"])[-7:] != phone[-7:]:
        accounts._note_fail(ip_key, oid_key)
        return jsonify(ok=False, error="We couldn't find an order with that number and phone"), 404
    r = receipts.receipt(row, seller)
    return jsonify(ok=True, id=row["id"], key=row["receipt_key"], url=r["path"], order=r)


@bp.post("/reviews")
def create_review():
    """Buyers review a seller after a completed (Delivered) order — that's what makes it a verified review."""
    r = clean_review(body())
    db = get_db()
    o = db.execute("SELECT * FROM orders WHERE id = ?", (r["order_id"],)).fetchone()
    if not o or phone_digits(o["customer_phone"])[-7:] != r["phone"][-7:]:
        return jsonify(ok=False, error="We couldn't find an order with that number and phone"), 404
    if o["status"] != "Delivered":
        return jsonify(ok=False, error="You can review once the seller marks your order as delivered"), 409
    if db.execute("SELECT 1 FROM reviews WHERE order_id = ?", (o["id"],)).fetchone():
        return jsonify(ok=False, error="This order has already been reviewed"), 409
    first_name = (o["customer_name"] or "Buyer").split()[0][:30]
    db.execute("INSERT INTO reviews (seller_id, order_id, rating, comment, buyer_name, created) VALUES (?,?,?,?,?,?)",
               (o["seller_id"], o["id"], r["rating"], r["comment"], first_name, now_iso()))
    db.commit()
    return jsonify(ok=True), 201


@bp.post("/sellers/register")
def register_seller():
    d = clean_registration(body())
    if accounts.email_taken(d["email"]):
        return jsonify(ok=False, error="That email already has an account — sign in instead"), 409
    status = "active" if current_app.config["AUTO_APPROVE_SELLERS"] else "pending"
    accounts.create_seller_account(shop_name=d["shop_name"], owner_name=d["owner_name"], email=d["email"],
                                   password=d["password"], whatsapp=_wa(d["whatsapp"]), location=d["location"],
                                   status=status)
    accounts.login(d["email"], d["password"], remember=True)
    return jsonify(ok=True, status=status), 201


# ===========================================================================
# Dashboard: sign-in
# ===========================================================================
@bp.post("/dash/login")
def dash_login():
    d = body()
    result, status = accounts.login(d.get("email"), d.get("password"), bool(d.get("remember")))
    return jsonify(result), status


@bp.post("/dash/logout")
def dash_logout():
    accounts.logout()
    return jsonify(ok=True)


@bp.get("/dash/me")
def dash_me():
    u = current_user()
    devhint = not current_app.config["APP_PRODUCTION"]
    if not u:
        return jsonify(ok=True, signedIn=False, devLogins=devhint)
    out = {"ok": True, "signedIn": True, "user": {"email": u["email"], "name": u["name"], "role": u["role"]}}
    if u["seller_id"]:
        out["seller"] = seller_out(get_db().execute("SELECT * FROM sellers WHERE id = ?", (u["seller_id"],)).fetchone(),
                                   private=True)
    return jsonify(out)


@bp.post("/dash/password")
@login_required
def change_password():
    d = body()
    u = current_user()
    from werkzeug.security import check_password_hash
    if not check_password_hash(u["password_hash"], str(d.get("current") or "")):
        raise ValidationError("Your current password is wrong")
    new = str(d.get("new") or "")
    if len(new) < accounts.MIN_PASSWORD:
        raise ValidationError(f"Choose a new password with at least {accounts.MIN_PASSWORD} characters")
    accounts.set_password(u["id"], new)
    accounts.logout()
    accounts.login(u["email"], new, remember=True)
    return jsonify(ok=True)


# ===========================================================================
# Dashboard: data (scoped to the signed-in seller; manager sees everything)
# ===========================================================================
def _scope_sql(alias: str = "") -> tuple[str, list]:
    sid = own_seller_id()
    col = f"{alias}seller_id" if alias else "seller_id"
    return (f"{col} = ?", [sid]) if sid else ("1 = 1", [])


def _shop_suspended():
    """A suspended seller can still sign in and resolve orders, but can't list or change pieces or the shop."""
    sid = own_seller_id()
    if sid:
        row = get_db().execute("SELECT status, suspend_reason FROM sellers WHERE id = ?", (sid,)).fetchone()
        if row and row["status"] == "suspended":
            return jsonify(ok=False, code="suspended",
                           error="Your shop is suspended. Mark your open orders Delivered (sold) or Cancelled, "
                                 "then contact us to reactivate it."), 403
    return None


def _owned_product(pid: str):
    where, args = _scope_sql()
    return get_db().execute(f"SELECT * FROM products WHERE id = ? AND {where}", (pid, *args)).fetchone()


@bp.get("/dash/data")
@login_required
def dash_data():
    db = get_db()
    where, args = _scope_sql("p.")
    slugs = {r["id"]: r["slug"] for r in db.execute("SELECT id, slug FROM sellers")}
    products = [product_out(r, slugs.get(r["seller_id"], "")) for r in db.execute(
        f"SELECT p.* FROM products p WHERE {where} ORDER BY p.position, p.created", args)]
    owhere, oargs = _scope_sql()
    orders = [order_out(r) for r in db.execute(f"SELECT * FROM orders WHERE {owhere} ORDER BY created_at DESC", oargs)]
    out = {"ok": True, "products": products, "orders": orders, "settings": {"usdToLrd": usd_to_lrd()},
           "rules": lifecycle.rules()}
    if own_seller_id():
        out["due"] = lifecycle.open_orders_due(own_seller_id())
        out["seller"] = seller_out(db.execute("SELECT * FROM sellers WHERE id = ?", (own_seller_id(),)).fetchone(), private=True)
    if is_manager():
        out["sellers"] = [seller_out(r, private=True) | {"email": _seller_email(r["id"])}
                          for r in db.execute("SELECT * FROM sellers ORDER BY status = 'pending' DESC, name")]
        views = analytics.views_by_seller(30)
        out["analytics"] = {"platform": analytics.seller_summary(None, 30),
                            "bySeller": {str(sid): analytics.seller_summary(sid, 30) for sid in views}}
    else:
        out["analytics"] = {"mine": analytics.seller_summary(own_seller_id(), 30)}
        out["reviews"] = [dict(r) for r in db.execute(
            "SELECT rating, comment, buyer_name AS buyer, created FROM reviews WHERE seller_id = ? AND hidden = 0 "
            "ORDER BY created DESC LIMIT 20", (own_seller_id(),))]
    return jsonify(out)


def _seller_email(seller_id: int) -> str:
    row = get_db().execute("SELECT email FROM users WHERE seller_id = ? ORDER BY id LIMIT 1", (seller_id,)).fetchone()
    return row["email"] if row else ""


@bp.post("/dash/products")
@login_required
def save_product():
    if (blocked := _shop_suspended()):
        return blocked
    data = body()
    p = clean_product(data.get("product"))
    db = get_db()
    now = now_iso()
    existing = _owned_product(p["id"]) if p["id"] else None
    if p["id"] and not existing and db.execute("SELECT 1 FROM products WHERE id = ?", (p["id"],)).fetchone():
        return jsonify(ok=False, error="You can only edit your own crochets"), 403
    seller_id = own_seller_id()
    if is_manager():
        seller_id = existing["seller_id"] if existing else int(number(data.get("sellerId"), low=1, high=1e9,
                                                                     message="Choose which seller this crochet belongs to"))
        if not db.execute("SELECT 1 FROM sellers WHERE id = ?", (seller_id,)).fetchone():
            raise ValidationError("Choose which seller this crochet belongs to")
    fields = (p["name"], p["category"], p["price"], p["stock"], json.dumps(p["sizes"]), json.dumps(p["colors"]),
              p["desc"], p["badge"], p["shape"], json.dumps(p["images"]), int(p["active"]),
              int(p["customEnabled"]), p["turnaroundDays"])
    if existing:
        db.execute("UPDATE products SET name=?, category=?, price=?, stock=?, sizes=?, colors=?, description=?, badge=?,"
                   " shape=?, images=?, active=?, custom_enabled=?, turnaround_days=?, updated=? WHERE id=?",
                   (*fields, now, p["id"]))
    else:
        p["id"] = f"{slug(p['name'])}-{secrets.token_hex(2)}"
        position = db.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM products").fetchone()[0]
        db.execute("INSERT INTO products (name, category, price, stock, sizes, colors, description, badge, shape, images,"
                   " active, custom_enabled, turnaround_days, id, seller_id, sold, position, created, updated)"
                   " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)",
                   (*fields, p["id"], seller_id, position, now, now))
    db.commit()
    row = db.execute("SELECT p.*, s.slug FROM products p JOIN sellers s ON s.id = p.seller_id WHERE p.id = ?",
                     (p["id"],)).fetchone()
    return jsonify(ok=True, product=product_out(row, row["slug"]))


@bp.delete("/dash/products/<pid>")
@login_required
def delete_product(pid):
    if not _owned_product(pid):
        return jsonify(ok=False, error="Crochet not found"), 404
    db = get_db()
    db.execute("DELETE FROM products WHERE id = ?", (pid,))
    db.commit()
    return jsonify(ok=True)


@bp.post("/dash/products/<pid>/stock")
@login_required
def adjust_stock(pid):
    try:
        delta = int(body().get("delta"))
    except (TypeError, ValueError):
        raise ValidationError("Invalid stock change") from None
    if abs(delta) > 1000:
        raise ValidationError("Invalid stock change")
    if (blocked := _shop_suspended()):
        return blocked
    if not _owned_product(pid):
        return jsonify(ok=False, error="Crochet not found"), 404
    db = get_db()
    db.execute("UPDATE products SET stock = MAX(0, stock + ?), updated = ? WHERE id = ?", (delta, now_iso(), pid))
    db.commit()
    return jsonify(ok=True, stock=db.execute("SELECT stock FROM products WHERE id = ?", (pid,)).fetchone()[0])


@bp.post("/dash/images")
@login_required
def upload_image():
    if (blocked := _shop_suspended()):
        return blocked
    image = body().get("image") or {}
    url = save_image(image.get("data"), "products", str(image.get("name") or "crochet").rsplit(".", 1)[0])
    return jsonify(ok=True, url=url)


@bp.patch("/dash/orders/<oid>")
@login_required
def update_order(oid):
    ch = clean_order_changes(body().get("changes"))
    db = get_db()
    where, args = _scope_sql()
    row = db.execute(f"SELECT * FROM orders WHERE id = ? AND {where}", (oid, *args)).fetchone()
    if not row:
        return jsonify(ok=False, error="Order not found"), 404

    status, deducted = row["status"], bool(row["stock_deducted"])
    # The buyer must hear from the seller (WhatsApp confirmation) before an order moves past "New".
    confirmed_at = now_iso() if ch.get("confirmSent") else row["confirmed_at"]   # last time the message was sent
    if ch.get("status", "New") not in ("New", "Cancelled") and row["status"] == "New" and not confirmed_at:
        raise ValidationError("Send the order confirmation to the buyer on WhatsApp first")

    # Delivery fee: the seller can set or correct it from the buyer's location (never for pickup).
    fee, total = row["delivery_fee"] or 0, row["total"]
    if "deliveryFee" in ch:
        if row["type"] != "cart" or row["delivery"] == "Pickup":
            raise ValidationError("Pickup orders have no delivery fee")
        fee = ch["deliveryFee"]
        total = round(sum(float(i.get("price") or 0) * int(i.get("qty") or 0)
                          for i in json.loads(row["items"] or "[]")) + fee, 2)

    if "status" in ch:
        status = ch["status"]
        if row["type"] == "cart":
            items = json.loads(row["items"] or "[]")
            if status in COUNTS_STOCK and not deducted:
                _move_stock(db, items, -1)
                deducted = True
            elif status == "Cancelled" and deducted:
                _move_stock(db, items, +1)
                deducted = False

    db.execute("UPDATE orders SET status=?, quote=?, admin_note=?, stock_deducted=?, delivery_fee=?, total=?,"
               " confirmed_at=?, seen_at=COALESCE(seen_at, ?) WHERE id=?",
               (status, ch.get("quote", row["quote"]), ch.get("adminNote", row["admin_note"]), int(deducted),
                fee, total, confirmed_at, now_iso() if own_seller_id() else None, oid))
    sold = lifecycle.after_status_change(db, row, status) if "status" in ch and status != row["status"] else []
    db.commit()
    return jsonify(ok=True, soldProducts=sold, total=total, deliveryFee=fee, confirmedAt=confirmed_at)


@bp.post("/dash/orders/<oid>/seen")
@login_required
def mark_order_seen(oid):
    """The seller opened the order: clear its alert. The manager looking at it doesn't count."""
    sid = own_seller_id()
    if sid:
        db = get_db()
        db.execute("UPDATE orders SET seen_at = ? WHERE id = ? AND seller_id = ? AND seen_at IS NULL", (now_iso(), oid, sid))
        db.commit()
    return jsonify(ok=True)


@bp.get("/dash/pulse")
@login_required
def dash_pulse():
    """Cheap poll for the dashboard: orders the seller hasn't opened yet (newest first)."""
    where, args = _scope_sql()       # the manager sees alerts across the whole marketplace
    rows = get_db().execute(
        f"SELECT id, seller_id, type, created_at, customer_name, total, quote, lrd_rate FROM orders"
        f" WHERE {where} AND seen_at IS NULL AND status = 'New' ORDER BY created_at DESC LIMIT 30", args).fetchall()
    return jsonify(ok=True, unseen=[{"id": r["id"], "sellerId": r["seller_id"], "type": r["type"], "createdAt": r["created_at"],
                                     "customer": r["customer_name"], "total": r["total"] if r["type"] == "cart" else r["quote"],
                                     "lrdRate": r["lrd_rate"]} for r in rows])


@bp.post("/dash/products/<pid>/sold")
@login_required
def mark_sold(pid):
    """Seller confirms a piece is sold: it leaves the shop and its photos are deleted for good."""
    if not _owned_product(pid):
        return jsonify(ok=False, error="Crochet not found"), 404
    db = get_db()
    lifecycle.mark_product_sold(db, pid)
    db.commit()
    return jsonify(ok=True)


def _move_stock(db, items: list, direction: int) -> None:
    """direction -1 = take pieces out of stock (sold), +1 = put them back."""
    now = now_iso()
    for it in items:
        qty = max(0, int(it.get("qty") or 0))
        db.execute("UPDATE products SET stock = MAX(0, stock + ?), sold = MAX(0, sold - ?), updated = ? WHERE id = ?",
                   (direction * qty, direction * qty, now, it.get("id")))


# ---------------------------------------------------------------- store settings
@bp.post("/dash/store")
@login_required
def save_store():
    if (blocked := _shop_suspended()):
        return blocked
    data = body()
    sid = own_seller_id()
    if is_manager():
        sid = int(number(data.get("sellerId"), low=1, high=1e9, message="Choose a seller"))
    fields = clean_store(data.get("store"))
    if "whatsapp" in fields:
        fields["whatsapp"] = _wa(fields["whatsapp"])
    db = get_db()
    row = db.execute("SELECT * FROM sellers WHERE id = ?", (sid,)).fetchone()
    if not row:
        return jsonify(ok=False, error="Shop not found"), 404
    if "name" in fields and fields["name"] != row["name"] and row["status"] != "active":
        db.execute("UPDATE sellers SET slug = ? WHERE id = ?", (unique_slug(fields["name"], sid), sid))
    for k in ("pickup_spots", "pickup_days", "delivery_options"):
        if k in fields:
            fields[k] = json.dumps(fields[k])
    if fields:
        db.execute(f"UPDATE sellers SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?", (*fields.values(), sid))
    db.commit()
    return jsonify(ok=True, seller=seller_out(db.execute("SELECT * FROM sellers WHERE id = ?", (sid,)).fetchone(), private=True))


# ===========================================================================
# Platform manager only
# ===========================================================================
@bp.post("/dash/sellers")
@manager_required
def manager_create_seller():
    d = body()
    temp = str(d.get("password") or "") or accounts.temporary_password()
    reg = clean_registration({**d, "password": temp, "agree": True})
    if accounts.email_taken(reg["email"]):
        raise ValidationError("That email already has an account")
    sid = accounts.create_seller_account(shop_name=reg["shop_name"], owner_name=reg["owner_name"], email=reg["email"],
                                         password=temp, whatsapp=_wa(reg["whatsapp"]), location=reg["location"],
                                         status="active")
    return jsonify(ok=True, sellerId=sid, tempPassword=temp), 201


@bp.patch("/dash/sellers/<int:sid>")
@manager_required
def manager_update_seller(sid):
    d = body()
    db = get_db()
    if not db.execute("SELECT 1 FROM sellers WHERE id = ?", (sid,)).fetchone():
        return jsonify(ok=False, error="Seller not found"), 404
    if "status" in d:
        if d["status"] not in ("pending", "active", "suspended"):
            raise ValidationError("Unknown status")
        db.execute("UPDATE sellers SET status = ? WHERE id = ?", (d["status"], sid))
        db.execute("UPDATE users SET active = ? WHERE seller_id = ?", (int(d["status"] != "suspended"), sid))
        if d["status"] == "suspended":
            db.execute("UPDATE sellers SET auto_suspended = 0, suspend_reason = ?, suspended_at = ? WHERE id = ?",
                       (str(d.get("reason") or "Suspended by the platform manager.")[:300], now_iso(), sid))
        elif d["status"] == "active":
            lifecycle.reactivate(db, sid)
    if "phoneVerified" in d:
        db.execute("UPDATE sellers SET phone_verified = ? WHERE id = ?", (int(bool(d["phoneVerified"])), sid))
    db.commit()
    return jsonify(ok=True, seller=seller_out(db.execute("SELECT * FROM sellers WHERE id = ?", (sid,)).fetchone(), private=True))


@bp.delete("/dash/sellers/<int:sid>")
@manager_required
def manager_delete_seller(sid):
    """Permanently delete a shop + seller account. The manager must type the shop's link name to confirm."""
    db = get_db()
    row = db.execute("SELECT slug FROM sellers WHERE id = ?", (sid,)).fetchone()
    if not row:
        return jsonify(ok=False, error="Seller not found"), 404
    if str(body().get("confirm") or "").strip().lower() != row["slug"]:
        raise ValidationError(f"Type {row['slug']} to confirm")
    return jsonify(ok=True, deleted=lifecycle.delete_seller(db, sid))


@bp.post("/dash/sellers/<int:sid>/reset-password")
@manager_required
def manager_reset_password(sid):
    row = get_db().execute("SELECT id FROM users WHERE seller_id = ? ORDER BY id LIMIT 1", (sid,)).fetchone()
    if not row:
        return jsonify(ok=False, error="Seller not found"), 404
    temp = accounts.temporary_password()
    accounts.set_password(row["id"], temp)
    return jsonify(ok=True, tempPassword=temp)


@bp.get("/dash/sellers/<int:sid>/reviews")
@manager_required
def manager_reviews(sid):
    rows = get_db().execute("SELECT id, order_id AS orderId, rating, comment, buyer_name AS buyer, hidden, created "
                            "FROM reviews WHERE seller_id = ? ORDER BY created DESC", (sid,)).fetchall()
    return jsonify(ok=True, reviews=[dict(r) for r in rows])


@bp.patch("/dash/reviews/<int:rid>")
@manager_required
def manager_hide_review(rid):
    db = get_db()
    db.execute("UPDATE reviews SET hidden = ? WHERE id = ?", (int(bool(body().get("hidden"))), rid))
    db.commit()
    return jsonify(ok=True)


@bp.post("/dash/settings")
@manager_required
def save_settings():
    data = body()
    if "usdToLrd" in data:
        rate = number(data["usdToLrd"], low=1, high=100000, message="Enter a valid exchange rate")
        set_setting("usd_to_lrd", f"{round(rate, 4):g}")
    return jsonify(ok=True, settings={"usdToLrd": usd_to_lrd()})


# ---------------------------------------------------------------- downloadable reports
@bp.get("/dash/report.<fmt>")
@login_required
def download_report(fmt):
    """Excel or PDF of the dashboard. Sellers always get their own shop; the manager picks ?seller=<id> or all."""
    if fmt not in ("xlsx", "pdf"):
        return jsonify(ok=False, error="Unknown format"), 404
    sid = own_seller_id()
    if is_manager():
        raw = request.args.get("seller", "all")
        sid = None if raw in ("", "all") else int(number(raw, low=1, high=1e9, message="Unknown seller"))
        if sid and not get_db().execute("SELECT 1 FROM sellers WHERE id = ?", (sid,)).fetchone():
            return jsonify(ok=False, error="Seller not found"), 404
    rep = reports.build_report(sid, request.args.get("period", "30d"))
    data = reports.to_xlsx(rep) if fmt == "xlsx" else reports.to_pdf(rep)
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if fmt == "xlsx" else "application/pdf"
    resp = current_app.response_class(data, mimetype=mime)
    resp.headers["Content-Disposition"] = f'attachment; filename="{reports.filename(rep, fmt)}"'
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@bp.get("/dash/ads")
@manager_required
def ad_report():
    month = request.args.get("month") or date.today().strftime("%Y-%m")
    if not MONTH.match(month):
        raise ValidationError("Choose a month")
    return jsonify(ok=True, report=analytics.month_allocation(month),
                   adsense={"client": current_app.config["ADSENSE_CLIENT"], "slot": current_app.config["ADSENSE_SLOT"]})


@bp.post("/dash/ads")
@manager_required
def save_ad_revenue():
    d = body()
    month = str(d.get("month") or "")
    if not MONTH.match(month):
        raise ValidationError("Choose a month")
    amount = round(number(d.get("amount"), low=0, high=1e9, message="Enter the AdSense earnings in US$"), 2)
    db = get_db()
    db.execute("INSERT INTO ad_revenue (month, amount, note) VALUES (?,?,?) ON CONFLICT (month) DO UPDATE SET "
               "amount = excluded.amount, note = excluded.note", (month, amount, str(d.get("note") or "")[:200]))
    db.commit()
    return jsonify(ok=True, report=analytics.month_allocation(month))


@bp.app_errorhandler(413)
def _too_large(_e):
    return jsonify(ok=False, error="Those photos are too large — try fewer or smaller ones."), 413
