"""Optional e-mail to the seller for each new order (needs SMTP settings in .env)."""
from __future__ import annotations

import smtplib
import ssl
import threading
from email.message import EmailMessage

from flask import current_app


def dual(amount: float, shop: dict, rate: float) -> str:
    """US$25 (≈ L$4,275)"""
    usd = f"{amount:,.2f}".removesuffix(".00")
    return f"{shop['currency']}{usd} (≈ {shop['altCurrency']}{round(amount * rate):,})"


def order_summary(order: dict, shop: dict) -> str:
    rate = order.get("lrdRate") or 0
    c = order["customer"]
    lines = [f"{'Order' if order['type'] == 'cart' else 'Custom request'} {order['id']}",
             f"Name: {c['name']}", f"Phone: {c['phone']}"]
    if c.get("location"):
        lines.append(f"Location: {c['location']}")
    lines.append("")
    if order["type"] == "cart":
        for i, it in enumerate(order["items"], 1):
            lines.append(f"{i}. {it['name']} — {it['size']}, {it['color']} × {it['qty']}")
            if it.get("custom"):
                c2 = it["custom"]
                lines.append(f"   Custom: colours {c2.get('colors')}, needed by {c2.get('deadline')}"
                             + (f", {c2['notes']}" if c2.get("notes") else ""))
        if order.get("deliveryFee"):
            lines.append(f"\nDelivery: {order.get('deliveryLabel', '')} — {dual(order['deliveryFee'], shop, rate)}")
        lines.append(f"\nTotal: {dual(order['total'], shop, rate)}")
        lines.append(f"Rate used: {shop['currency']}1 = {shop['altCurrency']}{rate:g}")
        if order.get("delivery"):
            lines.append(f"Delivery: {order['delivery']}")
        if order.get("pickupSpot"):
            lines.append(f"Pickup: {order['pickupSpot']}" + (f" on {order['pickupDay']}" if order.get("pickupDay") else ""))
        if order.get("note"):
            lines.append(f"Note: {order['note']}")
    else:
        k = order["custom"]
        lines.append(f"CUSTOM: {k['type']} (for {k['forWho']})")
        for label, key in (("Based on", "basedOn"), ("Colours", "colors"), ("Usual size", "usualSize"),
                           ("Needed by", "date"), ("Budget", "budget"), ("Notes", "notes")):
            if k.get(key):
                lines.append(f"{label}: {k[key]}")
        if k["measurements"]:
            lines.append("\nMeasurements:")
            lines += [f"{m['label']}: {m['value']}{'' if m['unitless'] else ' ' + k['unit']}" for m in k["measurements"]]
        if order.get("photoLinks"):
            lines.append(f"\n{len(order['photoLinks'])} style photo(s) — see the dashboard.")
    lines.append("\nOpen your seller dashboard to manage this order.")
    return "\n".join(lines)


def _send(cfg: dict, msg: EmailMessage, logger) -> None:
    try:
        with smtplib.SMTP(cfg["SMTP_HOST"], cfg["SMTP_PORT"], timeout=20) as s:
            s.starttls(context=ssl.create_default_context())
            if cfg["SMTP_USER"]:
                s.login(cfg["SMTP_USER"], cfg["SMTP_PASSWORD"])
            s.send_message(msg)
    except Exception:   # never let e-mail problems break an order
        logger.exception("Order e-mail failed")


def send_text(to: str, subject: str, text: str) -> None:
    """Send a short plain-text e-mail in the background (no-op without SMTP settings)."""
    cfg = current_app.config
    if not (cfg["SMTP_HOST"] and to and "@" in to and not to.endswith(".local")):
        return
    msg = EmailMessage()
    msg["Subject"] = f"{cfg['SHOP']['name']}: {subject}"
    msg["From"] = cfg["SMTP_FROM"] or cfg["SMTP_USER"] or cfg["SHOP"]["email"]
    msg["To"] = to
    msg.set_content(text)
    threading.Thread(target=_send, args=(dict(cfg), msg, current_app.logger), daemon=True).start()


def notify_order(order: dict, seller: dict, seller_email: str = "") -> None:
    """E-mail the seller (and the platform copy address, if set) about a new order."""
    cfg = current_app.config
    recipients = [e for e in (seller_email, cfg["SELLER_EMAIL"]) if e and "@" in e and not e.endswith(".local")]
    if not (cfg["SMTP_HOST"] and recipients):
        return
    shop = cfg["SHOP"]
    msg = EmailMessage()
    msg["Subject"] = (f"🧶 {'New order' if order['type'] == 'cart' else 'New custom request'} {order['id']} "
                      f"for {seller['name']} — {order['customer']['name']}")
    msg["From"] = cfg["SMTP_FROM"] or cfg["SMTP_USER"] or recipients[-1]
    msg["To"] = recipients[0]
    if len(recipients) > 1:
        msg["Bcc"] = ", ".join(recipients[1:])
    msg.set_content(f"Shop: {seller['name']}\n" + order_summary(order, shop))
    # Send in the background so the customer isn't kept waiting.
    threading.Thread(target=_send, args=(dict(cfg), msg, current_app.logger), daemon=True).start()
