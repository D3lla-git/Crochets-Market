"""SQLite storage: one small file in instance/, no database server needed."""
from __future__ import annotations

import json
import secrets
import re
import sqlite3
from datetime import datetime, timedelta, timezone

import click
from flask import Flask, current_app, g
from werkzeug.security import generate_password_hash

SCHEMA = """
CREATE TABLE IF NOT EXISTS sellers (
    id                 INTEGER PRIMARY KEY,
    slug               TEXT NOT NULL UNIQUE,          -- public store link: /s/<slug>
    name               TEXT NOT NULL,                 -- shop name
    owner_name         TEXT NOT NULL DEFAULT '',
    bio                TEXT NOT NULL DEFAULT '',
    whatsapp           TEXT NOT NULL DEFAULT '',      -- digits incl. country code
    phone_verified     INTEGER NOT NULL DEFAULT 0,    -- set by the platform manager
    location           TEXT NOT NULL DEFAULT '',
    avatar             TEXT NOT NULL DEFAULT '',
    instagram          TEXT NOT NULL DEFAULT '',
    facebook           TEXT NOT NULL DEFAULT '',
    tiktok             TEXT NOT NULL DEFAULT '',
    momo_number        TEXT NOT NULL DEFAULT '',      -- MTN MoMo
    orange_number      TEXT NOT NULL DEFAULT '',      -- Orange Money
    custom_enabled     INTEGER NOT NULL DEFAULT 1,    -- accepts custom-style requests
    custom_slots_week  INTEGER NOT NULL DEFAULT 0,    -- 0 = no weekly limit
    deposit_required   INTEGER NOT NULL DEFAULT 0,
    deposit_percent    INTEGER NOT NULL DEFAULT 0,
    deposit_note       TEXT NOT NULL DEFAULT '',
    delivery_available INTEGER NOT NULL DEFAULT 1,
    pickup_spots       TEXT NOT NULL DEFAULT '[]',    -- JSON list of safe public meetup spots
    pickup_days        TEXT NOT NULL DEFAULT '[]',    -- JSON list, e.g. ["Sat", "Sun"]
    status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
    created            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('manager', 'seller')),
    seller_id     INTEGER REFERENCES sellers (id) ON DELETE CASCADE,
    name          TEXT NOT NULL DEFAULT '',
    active        INTEGER NOT NULL DEFAULT 1,
    dev_account   INTEGER NOT NULL DEFAULT 0,          -- local demo logins; refused in production
    created       TEXT NOT NULL,
    last_login    TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id              TEXT PRIMARY KEY,
    seller_id       INTEGER REFERENCES sellers (id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'Other',
    price           REAL NOT NULL DEFAULT 0,
    stock           INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    sold            INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),
    sizes           TEXT NOT NULL DEFAULT '[]',
    colors          TEXT NOT NULL DEFAULT '[]',
    description     TEXT NOT NULL DEFAULT '',
    badge           TEXT NOT NULL DEFAULT '',
    shape           TEXT NOT NULL DEFAULT 'top',
    images          TEXT NOT NULL DEFAULT '[]',
    active          INTEGER NOT NULL DEFAULT 1,
    custom_enabled  INTEGER NOT NULL DEFAULT 0,          -- buyer must pick colours + deadline
    turnaround_days INTEGER NOT NULL DEFAULT 0,
    position        INTEGER NOT NULL DEFAULT 0,
    created         TEXT NOT NULL,
    updated         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id                TEXT PRIMARY KEY,
    seller_id         INTEGER REFERENCES sellers (id) ON DELETE SET NULL,
    type              TEXT NOT NULL CHECK (type IN ('cart', 'custom')),
    created_at        TEXT NOT NULL,
    customer_name     TEXT NOT NULL,
    customer_phone    TEXT NOT NULL,
    customer_location TEXT NOT NULL DEFAULT '',
    items             TEXT NOT NULL DEFAULT '[]',
    custom            TEXT,
    delivery          TEXT NOT NULL DEFAULT '',
    pickup_spot       TEXT NOT NULL DEFAULT '',
    pickup_day        TEXT NOT NULL DEFAULT '',
    note              TEXT NOT NULL DEFAULT '',
    total             REAL NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'New',
    quote             REAL,
    photo_links       TEXT NOT NULL DEFAULT '[]',
    admin_note        TEXT NOT NULL DEFAULT '',
    stock_deducted    INTEGER NOT NULL DEFAULT 0,
    lrd_rate          REAL,
    is_custom_work    INTEGER NOT NULL DEFAULT 0       -- uses one of the seller's weekly custom slots
);

CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY,
    seller_id  INTEGER NOT NULL REFERENCES sellers (id) ON DELETE CASCADE,
    order_id   TEXT NOT NULL UNIQUE,
    rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment    TEXT NOT NULL DEFAULT '',
    buyer_name TEXT NOT NULL DEFAULT '',
    hidden     INTEGER NOT NULL DEFAULT 0,
    created    TEXT NOT NULL
);

-- Daily page-view counters. seller_id 0 = platform pages (home, legal…).
CREATE TABLE IF NOT EXISTS page_views (
    day        TEXT NOT NULL,
    seller_id  INTEGER NOT NULL,
    product_id TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL,           -- home | store_page | product_page | product_open
    views      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, seller_id, product_id, kind)
);

-- Anonymous daily visitor keys (salted hash, rotated daily) to count unique visitors without cookies.
CREATE TABLE IF NOT EXISTS page_visitors (
    day       TEXT NOT NULL,
    seller_id INTEGER NOT NULL,
    visitor   TEXT NOT NULL,
    PRIMARY KEY (day, seller_id, visitor)
);

CREATE TABLE IF NOT EXISTS ad_revenue (
    month  TEXT PRIMARY KEY,            -- YYYY-MM
    amount REAL NOT NULL DEFAULT 0,     -- US$ reported by AdSense for that month
    note   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at DESC);
"""

# Indexes on columns that older databases only get through MIGRATIONS.
LATE_INDEXES = """
CREATE INDEX IF NOT EXISTS orders_seller ON orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS products_seller ON products (seller_id, position);
CREATE INDEX IF NOT EXISTS reviews_seller ON reviews (seller_id, created DESC);
"""

# Columns added after the first release: (table, column, definition)
MIGRATIONS = [
    ("orders", "lrd_rate", "REAL"),
    ("orders", "seller_id", "INTEGER"),
    ("orders", "pickup_spot", "TEXT NOT NULL DEFAULT ''"),
    ("orders", "pickup_day", "TEXT NOT NULL DEFAULT ''"),
    ("orders", "is_custom_work", "INTEGER NOT NULL DEFAULT 0"),
    ("products", "seller_id", "INTEGER"),
    ("products", "custom_enabled", "INTEGER NOT NULL DEFAULT 0"),
    ("products", "turnaround_days", "INTEGER NOT NULL DEFAULT 0"),
    ("products", "sold_at", "TEXT"),                                   # marked sold → photos deleted, listing retired
    ("orders", "due_at", "TEXT"),                                      # seller must mark Delivered/Cancelled by then
    ("orders", "warned", "INTEGER NOT NULL DEFAULT 0"),
    ("orders", "photos_deleted", "INTEGER NOT NULL DEFAULT 0"),
    ("sellers", "auto_suspended", "INTEGER NOT NULL DEFAULT 0"),
    ("sellers", "suspend_reason", "TEXT NOT NULL DEFAULT ''"),
    ("sellers", "suspended_at", "TEXT"),
    ("sellers", "delivery_options", "TEXT NOT NULL DEFAULT '[]'"),      # [{id, name, fee (US$), details}]
    ("orders", "delivery_fee", "REAL NOT NULL DEFAULT 0"),
    ("orders", "delivery_option", "TEXT NOT NULL DEFAULT ''"),           # "<area> — <details>" snapshot
    ("orders", "seen_at", "TEXT"),                                     # seller opened it (clears the alert)
    ("orders", "confirmed_at", "TEXT"),                                # seller sent the WhatsApp confirmation
    ("orders", "receipt_key", "TEXT"),                                 # secret part of the buyer's receipt link
]

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def week_start_iso() -> str:
    """Monday 00:00 UTC of the current week — custom slots reset then."""
    d = datetime.now(timezone.utc).date()
    return (d - timedelta(days=d.weekday())).isoformat()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(current_app.config["DATABASE"], timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        g.db = conn
    return g.db


def close_db(_exc=None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def slugify(s: str, max_len: int = 40) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:max_len].strip("-") or "shop"


def unique_slug(base: str, exclude_id: int | None = None) -> str:
    db, slug, n = get_db(), slugify(base), 2
    while True:
        row = db.execute("SELECT id FROM sellers WHERE slug = ?", (slug,)).fetchone()
        if not row or row["id"] == exclude_id:
            return slug
        slug = f"{slugify(base, 36)}-{n}"
        n += 1


def init_db() -> None:
    db = get_db()
    db.executescript(SCHEMA)
    for table, column, definition in MIGRATIONS:
        existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            if (table, column) == ("orders", "seen_at"):       # orders from before alerts existed aren't "new"
                db.execute("UPDATE orders SET seen_at = created_at")
            if (table, column) == ("orders", "confirmed_at"):  # …and anything already past New was confirmed
                db.execute("UPDATE orders SET confirmed_at = created_at WHERE status != 'New'")
    db.executescript(LATE_INDEXES)
    # Every order needs a receipt link (older orders get one here).
    for (oid,) in db.execute("SELECT id FROM orders WHERE receipt_key IS NULL OR receipt_key = ''").fetchall():
        db.execute("UPDATE orders SET receipt_key = ? WHERE id = ?", (secrets.token_urlsafe(12), oid))
    _adopt_unowned_data(db)
    # Orders from before due dates existed get the standard window from when they arrived.
    db.execute("UPDATE orders SET due_at = date(substr(created_at, 1, 10), ?) WHERE due_at IS NULL",
               (f"+{current_app.config['ORDER_RESOLVE_DAYS']} days",))
    db.commit()


def _adopt_unowned_data(db) -> None:
    """Databases from the single-shop version: give existing products/orders to a default seller."""
    orphans = db.execute("SELECT COUNT(*) FROM products WHERE seller_id IS NULL").fetchone()[0] \
        + db.execute("SELECT COUNT(*) FROM orders WHERE seller_id IS NULL").fetchone()[0]
    if not orphans:
        return
    shop = current_app.config["SHOP"]
    row = db.execute("SELECT id FROM sellers ORDER BY id LIMIT 1").fetchone()
    if row:
        seller_id = row["id"]
    else:
        seller_id = db.execute(
            "INSERT INTO sellers (slug, name, whatsapp, location, status, created) VALUES (?,?,?,?, 'active', ?)",
            (slugify(shop["name"]), shop["name"], shop["whatsapp"], shop["location"], now_iso())).lastrowid
    db.execute("UPDATE products SET seller_id = ? WHERE seller_id IS NULL", (seller_id,))
    db.execute("UPDATE orders SET seller_id = ? WHERE seller_id IS NULL", (seller_id,))


# ---------------------------------------------------------------------------
# Settings the manager can change from the dashboard
# ---------------------------------------------------------------------------
def get_setting(key: str, default: str | None = None) -> str | None:
    row = get_db().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    db = get_db()
    db.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
               (key, value))
    db.commit()


def usd_to_lrd() -> float:
    """Liberian dollars per US dollar — set in the dashboard, falling back to USD_TO_LRD in .env."""
    try:
        rate = float(get_setting("usd_to_lrd") or current_app.config["USD_TO_LRD"])
    except (TypeError, ValueError):
        rate = current_app.config["USD_TO_LRD"]
    return rate if rate > 0 else current_app.config["USD_TO_LRD"]


# ---------------------------------------------------------------------------
# Row <-> JSON shapes used by the frontend
# ---------------------------------------------------------------------------
def loads(text, fallback):
    try:
        return json.loads(text) if text else fallback
    except (TypeError, ValueError):
        return fallback


def product_out(row: sqlite3.Row, seller_slug: str = "") -> dict:
    return {
        "id": row["id"], "sellerId": row["seller_id"], "seller": seller_slug,
        "name": row["name"], "category": row["category"],
        "price": row["price"], "stock": row["stock"], "sold": row["sold"],
        "sizes": loads(row["sizes"], []), "colors": loads(row["colors"], []),
        "desc": row["description"], "badge": row["badge"], "shape": row["shape"],
        "images": loads(row["images"], []), "active": bool(row["active"]),
        "customEnabled": bool(row["custom_enabled"]), "turnaroundDays": row["turnaround_days"],
        "soldAt": row["sold_at"], "created": row["created"], "updated": row["updated"],
    }


def order_out(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "sellerId": row["seller_id"], "type": row["type"], "createdAt": row["created_at"],
        "customer": {"name": row["customer_name"], "phone": row["customer_phone"], "location": row["customer_location"]},
        "items": loads(row["items"], []), "custom": loads(row["custom"], None),
        "delivery": row["delivery"], "pickupSpot": row["pickup_spot"], "pickupDay": row["pickup_day"],
        "note": row["note"], "total": row["total"],
        "status": row["status"], "quote": row["quote"], "photoLinks": loads(row["photo_links"], []),
        "adminNote": row["admin_note"], "stockDeducted": bool(row["stock_deducted"]),
        "lrdRate": row["lrd_rate"], "customWork": bool(row["is_custom_work"]),
        "dueAt": row["due_at"], "photosDeleted": bool(row["photos_deleted"]),
        "deliveryFee": row["delivery_fee"] or 0, "deliveryOption": row["delivery_option"] or "",
        "seenAt": row["seen_at"], "confirmedAt": row["confirmed_at"],
        "receiptUrl": f"/r/{row['id']}/{row['receipt_key']}" if row["receipt_key"] else "",
    }


def custom_slots_used(seller_id: int) -> int:
    return get_db().execute(
        "SELECT COUNT(*) FROM orders WHERE seller_id = ? AND is_custom_work = 1 AND status != 'Cancelled' AND created_at >= ?",
        (seller_id, week_start_iso())).fetchone()[0]


def seller_stats(seller_id: int) -> dict:
    db = get_db()
    rating = db.execute("SELECT COUNT(*) n, AVG(rating) avg FROM reviews WHERE seller_id = ? AND hidden = 0",
                        (seller_id,)).fetchone()
    return {
        "products": db.execute("SELECT COUNT(*) FROM products WHERE seller_id = ? AND active = 1", (seller_id,)).fetchone()[0],
        "handoffs": db.execute("SELECT COUNT(*) FROM orders WHERE seller_id = ? AND status = 'Delivered'", (seller_id,)).fetchone()[0],
        "reviews": rating["n"],
        "rating": round(rating["avg"], 1) if rating["avg"] else None,
    }


def seller_out(row: sqlite3.Row, private: bool = False) -> dict:
    """Public store profile. `private` adds fields only the seller/manager should see."""
    slots = row["custom_slots_week"]
    used = custom_slots_used(row["id"]) if slots else 0
    out = {
        "id": row["id"], "slug": row["slug"], "name": row["name"], "ownerName": row["owner_name"],
        "bio": row["bio"], "whatsapp": row["whatsapp"], "phoneVerified": bool(row["phone_verified"]),
        "location": row["location"], "avatar": row["avatar"],
        "instagram": row["instagram"], "facebook": row["facebook"], "tiktok": row["tiktok"],
        "customEnabled": bool(row["custom_enabled"]),
        "customSlotsWeek": slots, "customSlotsOpen": max(0, slots - used) if slots else None,
        "depositRequired": bool(row["deposit_required"]), "depositPercent": row["deposit_percent"],
        "depositNote": row["deposit_note"],
        "momoNumber": row["momo_number"] if row["deposit_required"] or private else "",
        "orangeNumber": row["orange_number"] if row["deposit_required"] or private else "",
        "deliveryAvailable": bool(row["delivery_available"]),
        "deliveryOptions": loads(row["delivery_options"], []) if (row["delivery_available"] or private) else [],
        "pickupSpots": loads(row["pickup_spots"], []), "pickupDays": loads(row["pickup_days"], []),
        "status": row["status"], "created": row["created"],
        **seller_stats(row["id"]),
    }
    if private:
        out.update(autoSuspended=bool(row["auto_suspended"]), suspendReason=row["suspend_reason"], suspendedAt=row["suspended_at"])
    return out


# ---------------------------------------------------------------------------
# Sample marketplace (local development / `flask seed-demo`)
# ---------------------------------------------------------------------------
DEMO_PASSWORD = "demo-seller-123"

SAMPLE_SELLERS = [
    {"slug": "sinkor-stitches", "name": "Sinkor Stitches", "owner": "Ama K.", "email": "sinkor@demo.local",
     "location": "Sinkor, Monrovia", "whatsapp": "231770000001", "verified": 1,
     "bio": "Bright crochet tops, sets and summer dresses — made to your size in Sinkor.",
     "spots": ["ELWA Junction (by the supermarket)", "University of Liberia — Capitol Hill campus gate"],
     "days": ["Wed", "Sat"], "slots": 4, "deposit": 50, "momo": "0880000001",
     "delivery": [("Sinkor & Congo Town", 2, "Same day by motorbike, 2–4 hrs"),
                  ("Central Monrovia", 3, "Next morning, before 12 noon"),
                  ("Paynesville & ELWA", 5, "Within 48 hrs, call on arrival")]},
    {"slug": "paynesville-purls", "name": "Paynesville Purls", "owner": "Josephine T.", "email": "paynesville@demo.local",
     "location": "Paynesville, Monrovia", "whatsapp": "231770000002", "verified": 0,
     "bio": "Cosy cardigans, skirts and kidswear. Custom colours welcome.",
     "spots": ["Red Light Market — main entrance", "Paynesville City Hall"], "days": ["Fri", "Sat", "Sun"],
     "slots": 2, "deposit": 0, "momo": "",
     "delivery": [("Paynesville", 1.5, "Same day if ordered before 2pm"),
                  ("Anywhere else in Monrovia", 4, "1–2 days by keke")]},
    {"slug": "bushrod-yarn-co", "name": "Bushrod Yarn Co.", "owner": "Musa D.", "email": "bushrod@demo.local",
     "location": "Bushrod Island, Monrovia", "whatsapp": "231770000003", "verified": 1,
     "bio": "Hats, bags and accessories for everyone. Fast turnaround.",
     "spots": ["Freeport of Monrovia — main gate"], "days": ["Mon", "Thu", "Sat"], "slots": 0, "deposit": 30,
     "momo": "0880000003", "delivery": [("Bushrod Island", 2, "Same day, 9am–6pm")]},
]

SAMPLE_PRODUCTS = [
    ("sinkor-stitches", "blossom-top", "Blossom Crop Top", "Tops", 25, 8, "top", ["XS", "S", "M", "L", "XL"],
     [("Candy Pink", "#F28DB8"), ("Sky Blue", "#86AEF2"), ("Cloud White", "#F3F1F6")],
     "Fitted crop top with scalloped hem and adjustable straps. Breathable cotton yarn, perfect for warm days.", "Bestseller", 0),
    ("sinkor-stitches", "ocean-dress", "Ocean Wave Midi Dress", "Dresses", 65, 4, "dress", ["XS", "S", "M", "L", "XL", "2XL"],
     [("Ocean Blue", "#6F98EE"), ("Blush", "#F4A9C8"), ("Stone Grey", "#A7ABBB")],
     "Flowing midi dress in a wave-stitch pattern with a fitted waist. Comes with a soft inner lining.", "New", 10),
    ("sinkor-stitches", "sunset-set", "Sunset Two-Piece Set", "Sets", 45, 5, "set", ["XS", "S", "M", "L", "XL"],
     [("Sunset", "#F08BB4"), ("Lagoon", "#7FA4F2")],
     "Matching crop top and flared skirt. Wear together for the beach or split them up.", "Hot", 7),
    ("sinkor-stitches", "starlight-maxi", "Starlight Maxi Dress", "Dresses", 80, 1, "maxi", ["S", "M", "L", "XL", "2XL"],
     [("Dusk Rose", "#E57EAA"), ("Midnight Blue", "#5D7FD0")],
     "Statement floor-length dress with an open-stitch skirt. Made for weddings, parties and photoshoots.", "Premium", 14),
    ("paynesville-purls", "cloud-cardigan", "Cloud Granny Cardigan", "Cardigans", 55, 3, "cardigan", ["S", "M", "L", "XL", "2XL"],
     [("Misty Grey", "#B3B6C4"), ("Powder Blue", "#A9C2FA"), ("Forest", "#3F7D5C")],
     "Cosy granny-square cardigan with long sleeves and button front. Lovely over dresses and jeans.", "", 10),
    ("paynesville-purls", "petal-skirt", "Petal Mini Skirt", "Skirts", 28, 6, "skirt", ["XS", "S", "M", "L", "XL", "2XL"],
     [("Lilac Grey", "#B9B4CC"), ("Denim Blue", "#7895D6")],
     "A-line mini skirt with a petal-stitch texture and a comfy elastic waistband.", "", 0),
    ("paynesville-purls", "baby-romper", "Baby Bloom Romper", "Kids", 22, 7, "romper", ["0-6m", "6-12m", "1-2y", "2-3y", "3-4y"],
     [("Sunshine", "#F2C94C"), ("Baby Blue", "#9DBBF6"), ("Soft Grey", "#BFC2CE")],
     "Soft, stretchy romper with button straps — gentle on little skin.", "", 0),
    ("bushrod-yarn-co", "lagoon-hat", "Lagoon Bucket Hat", "Accessories", 15, 10, "hat", ["One size"],
     [("Lagoon Blue", "#7FA4F2"), ("Charcoal", "#4B5563"), ("Sand", "#D6C29A")],
     "Sturdy crochet bucket hat with a contrast band. Shade from the sun in style.", "", 0),
    ("bushrod-yarn-co", "market-tote", "Market Tote Bag", "Accessories", 20, 0, "bag", ["One size"],
     [("Natural", "#E8DCC2"), ("Cornflower", "#8AA8EE")],
     "Roomy market tote. Fits a laptop, a water bottle and more.", "", 3),
    ("bushrod-yarn-co", "mist-halter", "Mist Halter Top", "Tops", 22, 2, "halter", ["XS", "S", "M", "L"],
     [("Ice Blue", "#9DBBF6"), ("Silver", "#B8BBC8")],
     "Halter neck top that ties at the back. Light, airy and easy to style.", "", 0),
]


def seed_demo() -> int:
    """Add the sample sellers (demo logins) and their products if they aren't there yet.

    Existing products are never touched. Returns how many sample products were added."""
    db = get_db()
    if db.execute("SELECT 1 FROM sellers WHERE slug = ?", (SAMPLE_SELLERS[0]["slug"],)).fetchone():
        return 0
    now = now_iso()
    ids = {}
    for s in SAMPLE_SELLERS:
        row = db.execute("SELECT id FROM sellers WHERE slug = ?", (s["slug"],)).fetchone()
        if row:
            ids[s["slug"]] = row["id"]
            continue
        sid = db.execute(
            "INSERT INTO sellers (slug, name, owner_name, bio, whatsapp, phone_verified, location, momo_number,"
            " custom_slots_week, deposit_required, deposit_percent, pickup_spots, pickup_days, delivery_options, status, created)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?)",
            (s["slug"], s["name"], s["owner"], s["bio"], s["whatsapp"], s["verified"], s["location"], s["momo"],
             s["slots"], int(bool(s["deposit"])), s["deposit"], json.dumps(s["spots"]), json.dumps(s["days"]),
             json.dumps([{"id": f"d{i}", "name": n, "fee": f, "details": t} for i, (n, f, t) in enumerate(s.get("delivery", []), 1)]),
             now)).lastrowid
        ids[s["slug"]] = sid
        db.execute("INSERT OR IGNORE INTO users (email, password_hash, role, seller_id, name, dev_account, created)"
                   " VALUES (?,?, 'seller', ?,?, 1, ?)",
                   (s["email"], generate_password_hash(DEMO_PASSWORD), sid, s["owner"], now))
    added = 0
    for pos, (seller, pid, name, cat, price, stock, shape, sizes, colors, desc, badge, turnaround) in enumerate(SAMPLE_PRODUCTS):
        added += db.execute(
            "INSERT OR IGNORE INTO products (id, seller_id, name, category, price, stock, sold, sizes, colors, description, badge,"
            " shape, images, active, custom_enabled, turnaround_days, position, created, updated)"
            " VALUES (?,?,?,?,?,?,0,?,?,?,?,?,'[]',1,?,?,?,?,?)",
            (pid, ids[seller], name, cat, price, stock, json.dumps(sizes),
             json.dumps([{"n": n, "h": h} for n, h in colors]), desc, badge, shape,
             int(turnaround > 0), turnaround, pos, now, now)).rowcount
    db.commit()
    return added


# ---------------------------------------------------------------------------
# Wiring + CLI commands
# ---------------------------------------------------------------------------
def init_app(app: Flask) -> None:
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()

    @app.cli.command("seed-demo")
    def seed_demo_command():
        """Fill an empty marketplace with sample sellers and crochets."""
        added = seed_demo()
        click.echo(f"Added {len(SAMPLE_SELLERS)} demo sellers and {added} sample crochets "
                   f"(log in as e.g. {SAMPLE_SELLERS[0]['email']} / {DEMO_PASSWORD})." if added
                   else "The demo sellers are already there — nothing added.")
