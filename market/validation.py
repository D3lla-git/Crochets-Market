"""Clean and validate everything that arrives from a browser.

Every function returns either a clean dict, or raises ValidationError with a
message that's safe to show the customer/seller.
"""
from __future__ import annotations

import math
import re
import secrets

STATUSES = ["New", "Confirmed", "Paid", "Delivered", "Cancelled"]
COUNTS_STOCK = {"Confirmed", "Paid", "Delivered"}   # statuses that take pieces out of stock
SHAPES = {"top", "halter", "dress", "maxi", "cardigan", "skirt", "set", "hat", "bag", "romper"}

ORDER_ID = re.compile(r"^(?:CM|AC)-\d{6}-[A-Z0-9]{4}$")   # CM- new, AC- from the old name
PRODUCT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
IMAGE_URL = re.compile(r"^(?:/uploads/[\w./-]{1,200}|https://[^\s\"'<>]{1,500})$")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

MAX_ITEMS = 30
MAX_QTY = 99
MAX_PHOTOS = 6
MAX_PRODUCT_IMAGES = 6


class ValidationError(ValueError):
    pass


def text(value, max_len: int) -> str:
    """Trimmed string without control characters, capped in length."""
    if value is None:
        return ""
    return CONTROL_CHARS.sub("", str(value)).strip()[:max_len]


def items_of(value, max_items: int) -> list:
    return list(value[:max_items]) if isinstance(value, list) else []


def number(value, *, low: float, high: float, message: str) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ValidationError(message) from None
    if not math.isfinite(n) or n < low or n > high:
        raise ValidationError(message)
    return n


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:30] or "item"


# ---------------------------------------------------------------------------
def clean_product(p) -> dict:
    if not isinstance(p, dict):
        raise ValidationError("Missing product")
    name = text(p.get("name"), 100)
    if len(name) < 2:
        raise ValidationError("Product name is required")
    pid = str(p.get("id") or "")
    if pid and not PRODUCT_ID.match(pid):
        raise ValidationError("Invalid product id")

    colors = []
    for c in items_of(p.get("colors"), 20):
        c = c if isinstance(c, dict) else {}
        h = str(c.get("h") or "")
        colors.append({"n": text(c.get("n"), 40) or "Colour", "h": h if HEX.match(h) else "#F28DB8"})

    return {
        "id": pid,
        "name": name,
        "category": text(p.get("category"), 40) or "Other",
        "price": round(number(p.get("price"), low=0, high=1e7, message="Enter a valid price"), 2),
        "stock": int(round(number(p.get("stock"), low=0, high=99999, message="Enter a valid quantity"))),
        "sizes": [s for s in (text(s, 20) for s in items_of(p.get("sizes"), 30)) if s] or ["One size"],
        "colors": colors or [{"n": "As pictured", "h": "#F28DB8"}],
        "desc": text(p.get("desc"), 2000),
        "badge": text(p.get("badge"), 20),
        "shape": p.get("shape") if p.get("shape") in SHAPES else "top",
        "images": [u for u in (str(u) for u in items_of(p.get("images"), MAX_PRODUCT_IMAGES)) if IMAGE_URL.match(u)],
        "active": p.get("active") is not False,
        "customEnabled": bool(p.get("customEnabled")),
        "turnaroundDays": int(round(number(p.get("turnaroundDays") or 0, low=0, high=365, message="Enter turnaround in days"))),
    }


# ---------------------------------------------------------------------------
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[a-zA-Z]{2,}$")
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SOCIAL = re.compile(r"^https://[^\s\"'<>]{3,300}$")


def phone_digits(v) -> str:
    """Digits for a wa.me link. Local numbers like 0770… get the country code added by the caller."""
    return re.sub(r"\D", "", str(v or ""))[:15]


def clean_registration(d) -> dict:
    d = d if isinstance(d, dict) else {}
    out = {
        "shop_name": text(d.get("shopName"), 60), "owner_name": text(d.get("ownerName"), 80),
        "email": text(d.get("email"), 254).lower(), "password": str(d.get("password") or ""),
        "whatsapp": phone_digits(d.get("whatsapp")), "location": text(d.get("location"), 120),
    }
    if len(out["shop_name"]) < 3:
        raise ValidationError("Enter your shop name (at least 3 characters)")
    if len(out["owner_name"]) < 2:
        raise ValidationError("Enter your name")
    if not EMAIL.match(out["email"]):
        raise ValidationError("Enter a valid email address")
    if len(out["password"]) < 8 or len(out["password"]) > 200:
        raise ValidationError("Choose a password with at least 8 characters")
    if len(out["whatsapp"]) < 7:
        raise ValidationError("Enter your WhatsApp number")
    if d.get("agree") is not True:
        raise ValidationError("Please accept the Terms of Use and Seller Policy")
    return out


def clean_store(d) -> dict:
    """Store-profile settings a seller can edit. Only keys that were sent are returned."""
    d = d if isinstance(d, dict) else {}
    out = {}
    if "name" in d:
        out["name"] = text(d["name"], 60)
        if len(out["name"]) < 3:
            raise ValidationError("Shop name needs at least 3 characters")
    for key, col, n in (("ownerName", "owner_name", 80), ("bio", "bio", 600), ("location", "location", 120),
                        ("depositNote", "deposit_note", 300)):
        if key in d:
            out[col] = text(d[key], n)
    for key, col in (("whatsapp", "whatsapp"), ("momoNumber", "momo_number"), ("orangeNumber", "orange_number")):
        if key in d:
            out[col] = phone_digits(d[key])
    if "whatsapp" in out and len(out["whatsapp"]) < 7:
        raise ValidationError("Enter a WhatsApp number buyers can reach")
    for key, col in (("instagram", "instagram"), ("facebook", "facebook"), ("tiktok", "tiktok")):
        if key in d:
            v = str(d[key] or "").strip()
            if v and not SOCIAL.match(v):
                raise ValidationError(f"{key.title()} link must start with https://")
            out[col] = v
    if "avatar" in d:
        v = str(d["avatar"] or "")
        out["avatar"] = v if (not v or IMAGE_URL.match(v)) else ""
    for key, col in (("customEnabled", "custom_enabled"), ("depositRequired", "deposit_required"),
                     ("deliveryAvailable", "delivery_available")):
        if key in d:
            out[col] = int(bool(d[key]))
    if "customSlotsWeek" in d:
        out["custom_slots_week"] = int(number(d["customSlotsWeek"] or 0, low=0, high=500, message="Enter a number of slots"))
    if "depositPercent" in d:
        out["deposit_percent"] = int(number(d["depositPercent"] or 0, low=0, high=100, message="Deposit must be 0–100%"))
    if "pickupSpots" in d:
        spots = [s for s in (text(s, 120) for s in items_of(d["pickupSpots"], 10)) if s]
        out["pickup_spots"] = spots
    if "pickupDays" in d:
        out["pickup_days"] = [x for x in DAYS if x in (d["pickupDays"] or [])]
    if "deliveryOptions" in d:
        opts, seen = [], set()
        for o in items_of(d["deliveryOptions"], 15):
            o = o if isinstance(o, dict) else {}
            name = text(o.get("name"), 60)
            if not name:
                continue
            oid = re.sub(r"[^a-z0-9]", "", str(o.get("id") or "").lower())[:12] or secrets.token_hex(3)
            while oid in seen:
                oid = secrets.token_hex(3)
            seen.add(oid)
            fee = round(number(o.get("fee") if o.get("fee") not in (None, "") else 0, low=0, high=1000,
                               message=f"Enter a valid fee for {name}"), 2)
            opts.append({"id": oid, "name": name, "fee": fee, "details": text(o.get("details"), 200)})
        out["delivery_options"] = opts
    return out


def clean_review(d) -> dict:
    d = d if isinstance(d, dict) else {}
    oid = str(d.get("orderId") or "").strip().upper()
    if not ORDER_ID.match(oid):
        raise ValidationError("Enter your order number, e.g. CM-261116-AB12")
    try:
        rating = int(d.get("rating"))
    except (TypeError, ValueError):
        rating = 0
    if not 1 <= rating <= 5:
        raise ValidationError("Choose a rating from 1 to 5 stars")
    phone = phone_digits(d.get("phone"))
    if len(phone) < 7:
        raise ValidationError("Enter the phone number you ordered with")
    return {"order_id": oid, "rating": rating, "phone": phone, "comment": text(d.get("comment"), 600)}


# ---------------------------------------------------------------------------
def clean_order(o) -> dict:
    if not isinstance(o, dict):
        raise ValidationError("Bad request")
    oid = str(o.get("id") or "")
    if not ORDER_ID.match(oid):
        raise ValidationError("Invalid order number")
    kind = o.get("type")
    if kind not in ("cart", "custom"):
        raise ValidationError("Invalid order type")

    c = o.get("customer") if isinstance(o.get("customer"), dict) else {}
    customer = {"name": text(c.get("name"), 80), "phone": text(c.get("phone"), 30), "location": text(c.get("location"), 120)}
    if len(customer["name"]) < 2 or len(re.sub(r"\D", "", customer["phone"])) < 7:
        raise ValidationError("Please enter your name and phone number")

    order = {"id": oid, "type": kind, "customer": customer, "items": [], "custom": None, "delivery": "", "note": ""}

    if kind == "cart":
        raw = o.get("items") if isinstance(o.get("items"), list) else []
        if not raw:
            raise ValidationError("Your cart is empty")
        if len(raw) > MAX_ITEMS:
            raise ValidationError("Too many items in one order")
        for it in raw:
            it = it if isinstance(it, dict) else {}
            try:
                qty = int(round(float(it.get("qty") or 1)))
            except (TypeError, ValueError):
                qty = 1
            line = {
                "id": str(it.get("id") or "")[:48], "name": text(it.get("name"), 100),
                "size": text(it.get("size"), 20), "color": text(it.get("color"), 40),
                "qty": min(MAX_QTY, max(1, qty)),
            }
            c = it.get("custom") if isinstance(it.get("custom"), dict) else None
            if c:   # made-to-order options picked on a "Custom order" item
                line["custom"] = {"colors": text(c.get("colors"), 120), "deadline": text(c.get("deadline"), 10),
                                  "notes": text(c.get("notes"), 300)}
            order["items"].append(line)
        order["delivery"] = text(o.get("delivery"), 40)
        order["note"] = text(o.get("note"), 1000)
    else:
        k = o.get("custom") if isinstance(o.get("custom"), dict) else {}
        measurements = []
        for m in items_of(k.get("measurements"), 20):
            m = m if isinstance(m, dict) else {}
            measurements.append({"key": text(m.get("key"), 30), "label": text(m.get("label"), 40),
                                 "value": text(m.get("value"), 20), "unitless": bool(m.get("unitless"))})
        order["custom"] = {
            "type": text(k.get("type"), 60), "forWho": text(k.get("forWho"), 30),
            "unit": "cm" if k.get("unit") == "cm" else "in", "measurements": measurements,
            "usualSize": text(k.get("usualSize"), 10), "colors": text(k.get("colors"), 200),
            "budget": text(k.get("budget"), 20), "date": text(k.get("date"), 10),
            "notes": text(k.get("notes"), 2000), "basedOn": text(k.get("basedOn"), 100),
        }
        if not order["custom"]["type"]:
            raise ValidationError("Choose the type of clothing")

    order["seller"] = text(o.get("seller"), 60)
    order["pickupSpot"] = text(o.get("pickupSpot"), 120)
    order["pickupDay"] = text(o.get("pickupDay"), 3)
    order["deliveryOption"] = re.sub(r"[^a-z0-9]", "", str(o.get("deliveryOption") or "").lower())[:12]
    order["photos"] = items_of(o.get("photos"), MAX_PHOTOS)
    return order


def clean_order_changes(ch) -> dict:
    ch = ch if isinstance(ch, dict) else {}
    out = {}
    if "status" in ch:
        if ch["status"] not in STATUSES:
            raise ValidationError("Unknown status")
        out["status"] = ch["status"]
    if "quote" in ch:
        q = ch["quote"]
        out["quote"] = None if q in (None, "") else round(number(q, low=0, high=1e7, message="Enter a valid price"), 2)
    if "adminNote" in ch:
        out["adminNote"] = text(ch["adminNote"], 2000)
    if "deliveryFee" in ch:
        out["deliveryFee"] = round(number(ch["deliveryFee"] or 0, low=0, high=1000,
                                          message="Delivery fee must be between 0 and 1,000"), 2)
    if ch.get("confirmSent"):
        out["confirmSent"] = True
    return out
