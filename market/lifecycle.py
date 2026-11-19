"""What happens after something sells.

Photo clean-up
--------------
* A buyer's style photos are deleted as soon as their order is marked Delivered
  (sold/bought) or Cancelled.
* A seller's product photos are deleted when the piece is marked *sold*: either by
  the seller ("Mark as sold"), or automatically when a delivered order takes the
  last one in stock. The listing then leaves the shop.

Reporting sales
---------------
Every order has a due date (ORDER_RESOLVE_DAYS after it arrives; custom work gets
CUSTOM_RESOLVE_DAYS or the buyer's "needed by" date + 7 days). By then the seller
must mark it Delivered (= sold) or Cancelled. Sellers are warned in the dashboard
(and by e-mail, if set up) from WARN_DAYS before. If an order is still open
SUSPEND_GRACE_DAYS after its due date, the shop is suspended automatically: it
disappears from the marketplace and can't list or edit pieces until the platform
manager reactivates it. The seller can still sign in to resolve the orders.
"""
from __future__ import annotations

import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import click
from flask import Flask, current_app

from .db import get_db, get_setting, loads, now_iso, set_setting, today

OPEN = ("New", "Confirmed", "Paid")
ENFORCE_EVERY_MINUTES = 30


def rules() -> dict:
    cfg = current_app.config
    return {"resolveDays": cfg["ORDER_RESOLVE_DAYS"], "customResolveDays": cfg["CUSTOM_RESOLVE_DAYS"],
            "warnDays": cfg["WARN_DAYS"], "graceDays": cfg["SUSPEND_GRACE_DAYS"]}


# ---------------------------------------------------------------------------
# Due dates
# ---------------------------------------------------------------------------
def due_date(created: date, custom_work: bool, needed_by: list[str] | None = None) -> str:
    cfg = current_app.config
    if not custom_work:
        return (created + timedelta(days=cfg["ORDER_RESOLVE_DAYS"])).isoformat()
    due = created + timedelta(days=cfg["CUSTOM_RESOLVE_DAYS"])
    for d in needed_by or []:
        try:
            due = max(due, date.fromisoformat(d) + timedelta(days=7))
        except (TypeError, ValueError):
            pass
    return min(due, created + timedelta(days=180)).isoformat()   # never more than ~6 months away


def days_left(due: str | None) -> int | None:
    if not due:
        return None
    return (date.fromisoformat(due[:10]) - date.fromisoformat(today())).days


# ---------------------------------------------------------------------------
# Photo clean-up
# ---------------------------------------------------------------------------
def _upload_root() -> Path:
    return Path(current_app.config["UPLOAD_FOLDER"]).resolve()


def delete_order_photos(db, order_id: str) -> int:
    """Remove a buyer's style photos for one order. Returns how many links were cleared."""
    row = db.execute("SELECT photo_links FROM orders WHERE id = ?", (order_id,)).fetchone()
    links = loads(row["photo_links"], []) if row else []
    folder = (_upload_root() / "orders" / order_id).resolve()
    if folder.is_dir() and _upload_root() in folder.parents:
        shutil.rmtree(folder, ignore_errors=True)
    db.execute("UPDATE orders SET photo_links = '[]', photos_deleted = 1 WHERE id = ?", (order_id,))
    return len(links)


def _delete_product_file(db, url: str) -> None:
    """Delete an uploaded product photo unless another listing or a shop logo still uses it."""
    if not url.startswith("/uploads/products/"):
        return
    still_used = db.execute("SELECT 1 FROM products WHERE images LIKE ? LIMIT 1", (f'%"{url}"%',)).fetchone() \
        or db.execute("SELECT 1 FROM sellers WHERE avatar = ? LIMIT 1", (url,)).fetchone()
    if still_used:
        return
    path = (_upload_root() / "products" / url.rsplit("/", 1)[-1]).resolve()
    if path.is_file() and _upload_root() in path.parents:
        path.unlink(missing_ok=True)


def mark_product_sold(db, product_id: str) -> bool:
    """Take a sold piece out of the shop and delete its photos. Returns False if it wasn't found."""
    row = db.execute("SELECT images FROM products WHERE id = ?", (product_id,)).fetchone()
    if not row:
        return False
    images = loads(row["images"], [])
    db.execute("UPDATE products SET images = '[]', active = 0, stock = 0, sold_at = ?, updated = ? WHERE id = ?",
               (now_iso(), now_iso(), product_id))
    for url in images:
        _delete_product_file(db, url)
    return True


def after_status_change(db, order, new_status: str) -> list[str]:
    """Run the clean-up for an order that just changed status. Returns ids of products marked sold."""
    sold = []
    if new_status in ("Delivered", "Cancelled"):
        delete_order_photos(db, order["id"])
    if new_status == "Delivered" and order["type"] == "cart":
        for it in loads(order["items"], []):
            p = db.execute("SELECT stock, sold_at FROM products WHERE id = ?", (it.get("id"),)).fetchone()
            if p and p["stock"] <= 0 and not p["sold_at"]:
                mark_product_sold(db, it["id"])
                sold.append(it["id"])
    return sold


# ---------------------------------------------------------------------------
# Enforcement
# ---------------------------------------------------------------------------
def open_orders_due(seller_id: int) -> list[dict]:
    """Open orders with their days left (negative = overdue), most urgent first."""
    rows = get_db().execute(
        f"SELECT id, customer_name, status, due_at FROM orders WHERE seller_id = ? AND status IN ({','.join('?' * len(OPEN))}) "
        "AND due_at IS NOT NULL ORDER BY due_at", (seller_id, *OPEN)).fetchall()
    return [{"id": r["id"], "customer": r["customer_name"], "status": r["status"], "dueAt": r["due_at"],
             "daysLeft": days_left(r["due_at"])} for r in rows]


def enforce(force: bool = False) -> list[int]:
    """Warn sellers about orders coming due and suspend shops with overdue ones. Returns suspended seller ids."""
    db = get_db()
    now = datetime.now(timezone.utc)
    last = get_setting("enforce_last")
    if not force and last and now - datetime.fromisoformat(last) < timedelta(minutes=ENFORCE_EVERY_MINUTES):
        return []
    set_setting("enforce_last", now.isoformat())

    cfg = current_app.config
    t = date.fromisoformat(today())
    placeholders = ",".join("?" * len(OPEN))

    # 1. warnings (once per order)
    warn_until = (t + timedelta(days=cfg["WARN_DAYS"])).isoformat()
    for r in db.execute(
            f"SELECT o.id, o.due_at, o.seller_id, s.name FROM orders o JOIN sellers s ON s.id = o.seller_id "
            f"WHERE o.status IN ({placeholders}) AND o.warned = 0 AND o.due_at <= ? AND s.status = 'active'",
            (*OPEN, warn_until)).fetchall():
        db.execute("UPDATE orders SET warned = 1 WHERE id = ?", (r["id"],))
        _email_seller(r["seller_id"], f"Action needed: order {r['id']} is due {r['due_at']}",
                      f"Hi {r['name']},\n\nOrder {r['id']} is still open. Please mark it Delivered (sold) or Cancelled "
                      f"in your dashboard by {r['due_at']}.\n\nOrders that stay open {cfg['SUSPEND_GRACE_DAYS']} days after "
                      "their due date lead to an automatic suspension of your shop.")

    # 2. suspensions
    cutoff = (t - timedelta(days=cfg["SUSPEND_GRACE_DAYS"])).isoformat()
    overdue: dict[int, list[str]] = {}
    for r in db.execute(
            f"SELECT o.id, o.seller_id FROM orders o JOIN sellers s ON s.id = o.seller_id "
            f"WHERE o.status IN ({placeholders}) AND o.due_at < ? AND s.status = 'active'", (*OPEN, cutoff)).fetchall():
        overdue.setdefault(r["seller_id"], []).append(r["id"])
    for sid, ids in overdue.items():
        reason = (f"Sales not reported: {len(ids)} order{'s' if len(ids) > 1 else ''} not marked Delivered or Cancelled "
                  f"after the due date ({', '.join(ids[:5])}{'…' if len(ids) > 5 else ''}).")
        db.execute("UPDATE sellers SET status = 'suspended', auto_suspended = 1, suspend_reason = ?, suspended_at = ? "
                   "WHERE id = ?", (reason, now_iso(), sid))
        name = db.execute("SELECT name FROM sellers WHERE id = ?", (sid,)).fetchone()["name"]
        _email_seller(sid, "Your shop has been suspended",
                      f"Hi {name},\n\n{reason}\n\nYour shop is hidden from the marketplace. Sign in to your dashboard, "
                      "mark each order Delivered (sold) or Cancelled, then contact us to reactivate your shop.")
        current_app.logger.warning("Auto-suspended seller %s: %s", sid, reason)
    db.commit()
    return list(overdue)


def reactivate(db, seller_id: int) -> None:
    """Manager reactivates a shop. Still-open overdue orders get a fresh grace period so they're not re-suspended at once."""
    cfg = current_app.config
    fresh = (date.fromisoformat(today()) + timedelta(days=cfg["WARN_DAYS"])).isoformat()
    db.execute(f"UPDATE orders SET due_at = ?, warned = 0 WHERE seller_id = ? AND status IN ({','.join('?' * len(OPEN))}) "
               "AND due_at < ?", (fresh, seller_id, *OPEN, fresh))
    db.execute("UPDATE sellers SET auto_suspended = 0, suspend_reason = '', suspended_at = NULL WHERE id = ?", (seller_id,))


def delete_seller(db, seller_id: int) -> dict:
    """Permanently delete a shop and its seller account(s), listings, photos, orders and reviews.

    Anonymous page-view counts are kept (shown as "Deleted shop") so past ad-revenue reports still add up.
    Returns what was removed."""
    seller = db.execute("SELECT * FROM sellers WHERE id = ?", (seller_id,)).fetchone()
    if not seller:
        return {}
    images = [u for r in db.execute("SELECT images FROM products WHERE seller_id = ?", (seller_id,)) for u in loads(r["images"], [])]
    order_ids = [r["id"] for r in db.execute("SELECT id FROM orders WHERE seller_id = ?", (seller_id,))]
    counts = {
        "products": db.execute("DELETE FROM products WHERE seller_id = ?", (seller_id,)).rowcount,
        "orders": len(order_ids),
        "reviews": db.execute("DELETE FROM reviews WHERE seller_id = ?", (seller_id,)).rowcount,
        "logins": db.execute("DELETE FROM users WHERE seller_id = ?", (seller_id,)).rowcount,
    }
    for oid in order_ids:
        delete_order_photos(db, oid)
    db.execute("DELETE FROM orders WHERE seller_id = ?", (seller_id,))
    db.execute("DELETE FROM page_visitors WHERE seller_id = ?", (seller_id,))
    db.execute("DELETE FROM sellers WHERE id = ?", (seller_id,))
    for url in images + ([seller["avatar"]] if seller["avatar"] else []):
        _delete_product_file(db, url)          # only removed if nothing else still uses the file
    db.commit()
    current_app.logger.warning("Deleted shop %s (%s): %s", seller_id, seller["slug"], counts)
    return {"name": seller["name"], "slug": seller["slug"], **counts}


def _email_seller(seller_id: int, subject: str, text: str) -> None:
    from .notify import send_text
    row = get_db().execute("SELECT email FROM users WHERE seller_id = ? AND active = 1 ORDER BY id LIMIT 1", (seller_id,)).fetchone()
    if row:
        send_text(row["email"], subject, text)


def init_app(app: Flask) -> None:
    @app.before_request
    def _maybe_enforce():
        # Runs at most every 30 minutes, piggy-backing on normal traffic — no separate scheduler needed.
        if not app.config.get("TESTING"):
            try:
                enforce()
            except Exception:   # never break a page because of housekeeping
                app.logger.exception("Sale enforcement failed")

    @app.cli.command("enforce-sales")
    def enforce_command():
        """Warn sellers and suspend shops with unreported sales (also runs automatically)."""
        ids = enforce(force=True)
        click.echo(f"Suspended {len(ids)} shop(s)." if ids else "No shops needed suspending.")
