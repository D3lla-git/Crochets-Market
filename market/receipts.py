"""Buyer receipts — no account needed.

Every order gets a private receipt key when it is placed. The link /r/<order id>/<key> shows the
buyer their receipt or order summary (status, items, delivery, totals) from any device; the browser
also remembers the buyer's own orders for the "My orders" page. Lost the link? The order number plus
the phone number used for the order finds it again.
"""
from __future__ import annotations

import secrets

from flask import current_app

from .db import get_db, loads

# What buyers see for each order status (the seller-side names stay as they are).
STATUS = {
    "New": ("Pending", "pending", "Waiting for {shop} to confirm your order."),
    "Confirmed": ("Confirmed", "confirmed", "{shop} has confirmed your order and is getting it ready."),
    "Paid": ("Paid", "paid", "Payment received — your handoff is coming up."),
    "Delivered": ("Delivered", "delivered", "Handed over. Enjoy your crochet!"),
    "Cancelled": ("Cancelled", "cancelled", "This order was cancelled. Nothing is owed."),
}
STEPS = ["New", "Confirmed", "Paid", "Delivered"]


def new_key() -> str:
    return secrets.token_urlsafe(12)


def receipt_path(order_id: str, key: str) -> str:
    return f"/r/{order_id}/{key}"


def key_matches(row, key: str) -> bool:
    return bool(row and row["receipt_key"] and key and secrets.compare_digest(str(row["receipt_key"]), str(key)))


def _dual(amount, rate) -> dict:
    """{usd: 7.5, lrd: 1283, text: "US$7.50", alt: "L$1,283"}"""
    shop = current_app.config["SHOP"]
    amount = round(float(amount or 0), 2)
    usd = f"{amount:,.0f}" if amount == int(amount) else f"{amount:,.2f}"
    lrd = round(amount * (rate or 0))
    return {"usd": amount, "lrd": lrd, "text": f"{shop['currency']}{usd}", "alt": f"{shop['altCurrency']}{lrd:,}"}


def receipt(row, seller) -> dict:
    """Everything the receipt page and the "My orders" list need — never the seller's private notes."""
    shop = current_app.config["SHOP"]
    rate = row["lrd_rate"] or 0
    items = loads(row["items"], [])
    custom = loads(row["custom"], None)
    label, tone, blurb = STATUS.get(row["status"], STATUS["New"])
    shop_name = seller["name"] if seller else "the maker"
    is_cart = row["type"] == "cart"
    items_total = round(sum(float(i.get("price") or 0) * int(i.get("qty") or 0) for i in items), 2)
    custom_items_total = round(sum(float(i.get("price") or 0) * int(i.get("qty") or 0) for i in items if i.get("custom")), 2)
    price = row["total"] if is_cart else row["quote"]          # a custom request is priced by the maker later

    deposit = None
    if seller and seller["deposit_required"] and seller["deposit_percent"] and row["status"] != "Cancelled":
        base = custom_items_total if is_cart else (row["quote"] or 0)
        if base or not is_cart:
            deposit = {"percent": seller["deposit_percent"], **(_dual(base * seller["deposit_percent"] / 100, rate) if base else {}),
                       "partial": is_cart and custom_items_total < items_total}

    status_idx = STEPS.index(row["status"]) if row["status"] in STEPS else -1
    return {
        "id": row["id"], "type": row["type"], "createdAt": row["created_at"], "status": row["status"],
        "statusLabel": label, "tone": tone, "statusText": blurb.format(shop=shop_name),
        "isReceipt": row["status"] in ("Paid", "Delivered"),
        "steps": [{"name": "Placed" if s == "New" else s, "done": status_idx >= i and row["status"] != "Cancelled"}
                  for i, s in enumerate(STEPS)],
        "customer": {"name": row["customer_name"], "phone": row["customer_phone"], "location": row["customer_location"]},
        "seller": {"name": shop_name, "slug": seller["slug"] if seller else "", "whatsapp": seller["whatsapp"] if seller else "",
                   "location": seller["location"] if seller else ""},
        "items": [{"name": i.get("name"), "size": i.get("size"), "color": i.get("color"), "qty": int(i.get("qty") or 0),
                   "price": _dual(i.get("price"), rate), "amount": _dual(float(i.get("price") or 0) * int(i.get("qty") or 0), rate),
                   "custom": i.get("custom")} for i in items],
        "custom": custom and {k: custom.get(k) for k in ("type", "forWho", "colors", "usualSize", "date", "budget", "notes")},
        "delivery": row["delivery"], "deliveryOption": row["delivery_option"] or "",
        "pickupSpot": row["pickup_spot"] or "", "pickupDay": row["pickup_day"] or "",
        "itemsTotal": _dual(items_total, rate), "deliveryFee": _dual(row["delivery_fee"] or 0, rate),
        "total": _dual(price, rate) if price is not None else None,
        "deposit": deposit, "rate": rate, "currency": shop["currency"], "altCurrency": shop["altCurrency"],
        "note": row["note"] or "", "path": receipt_path(row["id"], row["receipt_key"]),
    }


def load(order_id: str):
    db = get_db()
    row = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    seller = db.execute("SELECT * FROM sellers WHERE id = ?", (row["seller_id"],)).fetchone() if row else None
    return row, seller
