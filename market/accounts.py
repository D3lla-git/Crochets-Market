"""Accounts: one platform manager (or more) plus one login per seller.

Signing in sets an HttpOnly session cookie; passwords are stored only as hashes.
Changing a password signs that account out everywhere (the session carries a
fingerprint of the password hash).
"""
from __future__ import annotations

import hashlib
import secrets
import threading
import time
from functools import wraps

import click
from flask import Flask, current_app, g, jsonify, session
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db, now_iso, unique_slug

DEV_MANAGER_EMAIL = "admin@crochets.local"
DEV_MANAGER_PASSWORD = "admin"
MIN_PASSWORD = 8

_fails: dict[str, list[float]] = {}     # key → timestamps of recent wrong passwords (per process)
_fails_lock = threading.Lock()


def _fingerprint(password_hash: str) -> str:
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------
def current_user():
    """The signed-in user row (or None). Cached per request."""
    if "user" in g:
        return g.user
    user = None
    uid = session.get("uid")
    if uid:
        row = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if row and row["active"] and session.get("fp") == _fingerprint(row["password_hash"]) \
                and not (row["dev_account"] and current_app.config["APP_PRODUCTION"]):
            user = row
        else:
            session.clear()
    g.user = user
    return user


def is_manager() -> bool:
    u = current_user()
    return bool(u and u["role"] == "manager")


def own_seller_id() -> int | None:
    u = current_user()
    return u["seller_id"] if u and u["role"] == "seller" else None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify(ok=False, code="auth", error="Please sign in again"), 401
        return view(*args, **kwargs)
    return wrapper


def manager_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify(ok=False, code="auth", error="Please sign in again"), 401
        if not is_manager():
            return jsonify(ok=False, code="forbidden", error="Only the platform manager can do that"), 403
        return view(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# Sign in / out
# ---------------------------------------------------------------------------
def _recent_fails(key: str) -> int:
    cutoff = time.monotonic() - current_app.config["LOGIN_WINDOW_SECONDS"]
    with _fails_lock:
        stamps = [t for t in _fails.get(key, []) if t > cutoff]
        _fails[key] = stamps
        return len(stamps)


def _note_fail(*keys: str) -> None:
    with _fails_lock:
        for k in keys:
            _fails.setdefault(k, []).append(time.monotonic())


def reset_throttle() -> None:
    with _fails_lock:
        _fails.clear()


def login(email: str, password: str, remember: bool) -> tuple[dict, int]:
    email = str(email or "").strip().lower()
    cfg = current_app.config
    limit = cfg["LOGIN_MAX_FAILS"]
    if _recent_fails("acct:" + email) >= limit or _recent_fails("all") >= limit * 5:
        return {"ok": False, "code": "locked", "error": "Too many wrong passwords. Please wait 15 minutes and try again."}, 429

    row = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    ok = bool(row) and check_password_hash(row["password_hash"], str(password or ""))
    if ok and row["dev_account"] and cfg["APP_PRODUCTION"]:
        ok = False
    if not ok:
        _note_fail("acct:" + email, "all")
        time.sleep(0.4)   # slows down guessing
        return {"ok": False, "error": "Wrong email or password"}, 401
    if not row["active"]:
        return {"ok": False, "code": "disabled", "error": "This account is switched off. Please contact the platform manager."}, 403

    session.clear()
    session["uid"] = row["id"]
    session["fp"] = _fingerprint(row["password_hash"])
    session.permanent = bool(remember)
    db = get_db()
    db.execute("UPDATE users SET last_login = ? WHERE id = ?", (now_iso(), row["id"]))
    db.commit()
    g.pop("user", None)
    return {"ok": True}, 200


def logout() -> None:
    session.clear()
    g.pop("user", None)


def set_password(user_id: int, new_password: str) -> None:
    db = get_db()
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(new_password), user_id))
    db.commit()


def temporary_password() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3))


# ---------------------------------------------------------------------------
# Creating accounts
# ---------------------------------------------------------------------------
def email_taken(email: str) -> bool:
    return bool(get_db().execute("SELECT 1 FROM users WHERE email = ?", (email.lower(),)).fetchone())


def create_seller_account(*, shop_name: str, owner_name: str, email: str, password: str, whatsapp: str,
                          location: str, status: str = "pending") -> int:
    """Create a store + its seller login. Returns the seller id."""
    db = get_db()
    now = now_iso()
    seller_id = db.execute(
        "INSERT INTO sellers (slug, name, owner_name, whatsapp, location, status, created) VALUES (?,?,?,?,?,?,?)",
        (unique_slug(shop_name), shop_name, owner_name, whatsapp, location, status, now)).lastrowid
    db.execute("INSERT INTO users (email, password_hash, role, seller_id, name, created) VALUES (?,?, 'seller', ?,?,?)",
               (email.lower(), generate_password_hash(password), seller_id, owner_name, now))
    db.commit()
    return seller_id


def ensure_manager(app: Flask) -> None:
    """Make sure a platform-manager login exists.

    Production: created from MANAGER_EMAIL + ADMIN_PASSWORD(_HASH) in .env.
    Local development: falls back to admin@crochets.local / admin.
    """
    cfg = app.config
    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE role = 'manager' AND dev_account = 0").fetchone():
        return
    email = (cfg["MANAGER_EMAIL"] or cfg["SHOP"]["email"]).lower()
    pw_hash = cfg["ADMIN_PASSWORD_HASH"] or (generate_password_hash(cfg["ADMIN_PASSWORD"])
                                             if len(cfg["ADMIN_PASSWORD"]) >= 10 else "")
    now = now_iso()
    if pw_hash and not email_taken(email):
        db.execute("INSERT INTO users (email, password_hash, role, name, created) VALUES (?,?, 'manager', 'Platform manager', ?)",
                   (email, pw_hash, now))
    elif not cfg["APP_PRODUCTION"] and not email_taken(DEV_MANAGER_EMAIL):
        db.execute("INSERT INTO users (email, password_hash, role, name, dev_account, created)"
                   " VALUES (?,?, 'manager', 'Local manager', 1, ?)",
                   (DEV_MANAGER_EMAIL, generate_password_hash(DEV_MANAGER_PASSWORD), now))
    elif cfg["APP_PRODUCTION"]:
        app.logger.warning("No manager account: set MANAGER_EMAIL and ADMIN_PASSWORD in .env, "
                           "or run  flask --app app create-manager EMAIL")
    db.commit()


def init_app(app: Flask) -> None:
    with app.app_context():
        ensure_manager(app)

    @app.cli.command("create-manager")
    @click.argument("email")
    @click.password_option()
    def create_manager_command(email, password):
        """Create (or reset) a platform-manager login."""
        if len(password) < 10:
            raise click.ClickException("Use at least 10 characters.")
        db = get_db()
        row = db.execute("SELECT id, role FROM users WHERE email = ?", (email.lower(),)).fetchone()
        if row and row["role"] != "manager":
            raise click.ClickException("That email belongs to a seller account.")
        if row:
            set_password(row["id"], password)
            click.echo(f"Password reset for manager {email}.")
        else:
            db.execute("INSERT INTO users (email, password_hash, role, name, created) VALUES (?,?, 'manager', 'Platform manager', ?)",
                       (email.lower(), generate_password_hash(password), now_iso()))
            db.commit()
            click.echo(f"Manager {email} created.")

    @app.cli.command("hash-password")
    @click.password_option()
    def hash_password_command(password):
        """Print a hash to put in .env as ADMIN_PASSWORD_HASH."""
        if len(password) < 10:
            raise click.ClickException("Use at least 10 characters.")
        click.echo(f"ADMIN_PASSWORD_HASH={generate_password_hash(password)}")
