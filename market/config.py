"""Settings, read from environment variables (or a `.env` file next to app.py).

Copy `.env.example` to `.env` and fill it in. Anything not set falls back to
the defaults below, which are fine for trying the app on your own computer.
"""
from __future__ import annotations

import os
import secrets
from datetime import timedelta
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_bool(name: str, default: bool = False) -> bool:
    v = _env(name)
    return default if not v else v.lower() in {"1", "true", "yes", "on"}


def _secret_key(instance: Path) -> str:
    """Use SECRET_KEY from the environment, or create one once and keep it in instance/."""
    key = _env("SECRET_KEY")
    if key:
        return key
    path = instance / "secret_key"
    if path.exists():
        return path.read_text().strip()
    key = secrets.token_hex(32)
    path.write_text(key)
    return key


def load(instance_path: str) -> dict:
    instance = Path(instance_path)
    instance.mkdir(parents=True, exist_ok=True)
    production = (_env("APP_ENV") or _env("AUGS_ENV", "development")).lower() == "production"

    return {
        # ---- shop details shown to customers ----
        "SHOP": {
            "name": _env("SHOP_NAME", "Crochets Market"),
            "whatsapp": _env("SHOP_WHATSAPP", "231770000000"),   # country code + number, digits only
            "countryCode": _env("SHOP_COUNTRY_CODE", "231"),
            "email": _env("SHOP_EMAIL", "luketrustcrochetsmarket@gmail.com"),
            "location": _env("SHOP_LOCATION", "Monrovia, Liberia"),
            "currency": "US$",        # prices are set in US dollars…
            "altCurrency": "L$",      # …and always shown with the Liberian-dollar equivalent
            "instagram": _env("SHOP_INSTAGRAM"),
            "facebook": _env("SHOP_FACEBOOK"),
            "tiktok": _env("SHOP_TIKTOK"),
            "lowStockAt": int(_env("SHOP_LOW_STOCK_AT", "2") or 2),
        },

        # ---- money ----
        # Starting exchange rate (L$ per US$). The seller can change it any time in the dashboard.
        "USD_TO_LRD": float(_env("USD_TO_LRD", "171") or 171),

        # ---- platform-manager login (created on first start) ----
        # MANAGER_EMAIL + either ADMIN_PASSWORD_HASH (from `flask --app app hash-password`) or ADMIN_PASSWORD.
        "MANAGER_EMAIL": _env("MANAGER_EMAIL"),
        "ADMIN_PASSWORD_HASH": _env("ADMIN_PASSWORD_HASH"),
        "ADMIN_PASSWORD": _env("ADMIN_PASSWORD"),
        "LOGIN_MAX_FAILS": 10,
        "LOGIN_WINDOW_SECONDS": 15 * 60,
        # New seller sign-ups wait for the manager's approval unless this is "true".
        "AUTO_APPROVE_SELLERS": _env_bool("AUTO_APPROVE_SELLERS", False),

        # ---- reporting sales (see lifecycle.py) ----
        # Sellers must mark each order Delivered (sold) or Cancelled within this many days,
        # or their shop is suspended SUSPEND_GRACE_DAYS after the due date.
        "ORDER_RESOLVE_DAYS": int(_env("ORDER_RESOLVE_DAYS", "14") or 14),
        "CUSTOM_RESOLVE_DAYS": int(_env("CUSTOM_RESOLVE_DAYS", "30") or 30),
        "WARN_DAYS": int(_env("WARN_DAYS", "3") or 3),
        "SUSPEND_GRACE_DAYS": int(_env("SUSPEND_GRACE_DAYS", "3") or 3),

        # ---- public site ----
        "SITE_URL": _env("SITE_URL").rstrip("/"),          # e.g. https://crochetsmarket.com (for sitemap & flyers)
        # Crochets Market is a subsidiary of this parent company (shown in the legal pages, footer and reports).
        "PARENT_COMPANY": _env("PARENT_COMPANY") or _env("LEGAL_ENTITY", "LukeTrust LLC"),
        "LEGAL_UPDATED": _env("LEGAL_UPDATED", "16 November 2026"),

        # ---- Google AdSense (optional; ads only show to visitors who accept advertising cookies) ----
        "ADSENSE_CLIENT": _env("ADSENSE_CLIENT"),          # ca-pub-XXXXXXXXXXXXXXXX
        "ADSENSE_SLOT": _env("ADSENSE_SLOT"),              # a responsive display ad-unit id

        # ---- order emails (optional) ----
        "SELLER_EMAIL": _env("SELLER_EMAIL"),              # platform copy of every new order
        "SMTP_HOST": _env("SMTP_HOST"),
        "SMTP_PORT": int(_env("SMTP_PORT", "587") or 587),
        "SMTP_USER": _env("SMTP_USER"),
        "SMTP_PASSWORD": _env("SMTP_PASSWORD"),
        "SMTP_FROM": _env("SMTP_FROM"),

        # ---- storage ----
        "DATABASE": _env("DATABASE_PATH") or str(instance / "augs.sqlite3"),
        "UPLOAD_FOLDER": _env("UPLOAD_FOLDER") or str(instance / "uploads"),
        "MAX_CONTENT_LENGTH": 48 * 1024 * 1024,   # an order with 6 photos fits comfortably

        # ---- Flask / security ----
        "APP_PRODUCTION": production,
        "SECRET_KEY": _secret_key(instance),
        "SESSION_COOKIE_NAME": "cm_session",
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SAMESITE": "Lax",
        "SESSION_COOKIE_SECURE": _env_bool("SESSION_COOKIE_SECURE", production),
        "PERMANENT_SESSION_LIFETIME": timedelta(days=30),   # "Keep me signed in"
        "JSON_SORT_KEYS": False,
    }
