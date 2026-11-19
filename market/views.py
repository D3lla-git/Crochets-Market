"""Pages, app files that must live at the site root, and uploaded photos.

Every public page load is counted for the seller it belongs to (see analytics.py),
which is how advertising revenue is split between sellers.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from flask import Blueprint, Response, abort, current_app, render_template, request, send_from_directory

from . import analytics, lifecycle, receipts
from .accounts import current_user, is_manager, own_seller_id
from .db import get_db, product_out, seller_out, usd_to_lrd

bp = Blueprint("views", __name__)

LEGAL_PAGES = {
    "terms": "Terms of Use",
    "privacy": "Privacy Policy",
    "cookies": "Cookie Policy",
    "sellers": "Seller Policy",
    "safety": "Meetup Safety Guide",
}


def page_context(**extra) -> dict:
    cfg = current_app.config
    return {"shop": cfg["SHOP"], "ads": {"client": cfg["ADSENSE_CLIENT"], "slot": cfg["ADSENSE_SLOT"]},
            "parent": cfg["PARENT_COMPANY"],
            "legal_pages": LEGAL_PAGES, "year": date.today().year, "site_url": site_url(), **extra}


def site_url() -> str:
    return current_app.config["SITE_URL"] or request.host_url.rstrip("/")


def _seller_visible(row) -> bool:
    """Active stores are public; a pending one is visible to its owner and the manager (preview)."""
    return bool(row) and (row["status"] == "active" or is_manager() or own_seller_id() == row["id"])


# ---------------------------------------------------------------- shop pages
@bp.get("/")
def home():
    analytics.record("home")
    return render_template("index.html", page="home", **page_context())


@bp.get("/s/<slug>")
def store(slug):
    row = get_db().execute("SELECT * FROM sellers WHERE slug = ?", (slug,)).fetchone()
    if not _seller_visible(row):
        abort(404)
    analytics.record("store_page", row["id"])
    return render_template("index.html", page="store", seller=seller_out(row), **page_context())


@bp.get("/p/<pid>")
def product_page(pid):
    db = get_db()
    p = db.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    row = db.execute("SELECT * FROM sellers WHERE id = ?", (p["seller_id"],)).fetchone() if p else None
    if not p or not _seller_visible(row) or not (p["active"] or is_manager() or own_seller_id() == row["id"]):
        abort(404)
    analytics.record("product_page", row["id"], pid)
    return render_template("index.html", page="product", seller=seller_out(row), product=product_out(p, row["slug"]),
                           **page_context())


@bp.get("/sell")
def sell():
    analytics.record("info_page")
    return render_template("sell.html", **page_context())


@bp.get("/legal/<doc>")
def legal(doc):
    if doc not in LEGAL_PAGES:
        abort(404)
    analytics.record("info_page")
    cfg = current_app.config
    return render_template(f"legal/{doc}.html", title=LEGAL_PAGES[doc], entity=cfg["PARENT_COMPANY"], rules=lifecycle.rules(),
                           updated=cfg["LEGAL_UPDATED"], doc=doc, **page_context())


# ---------------------------------------------------------------- buyer receipts (no account needed)
def _private(resp):
    """Receipts hold the buyer's name and phone: never indexed, cached or leaked through the Referer header."""
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


@bp.get("/r/<oid>/<key>")
def receipt(oid, key):
    row, seller = receipts.load(oid.upper())
    if not receipts.key_matches(row, key):
        abort(404)
    r = receipts.receipt(row, seller)
    return _private(current_app.make_response(render_template("receipt.html", r=r, **page_context())))


@bp.get("/orders")
def my_orders():
    """The buyer's orders saved on this device, plus a lookup by order number + phone."""
    return _private(current_app.make_response(render_template("orders.html", **page_context())))


@bp.get("/admin")
@bp.get("/dashboard")
def admin():
    resp = current_app.make_response(render_template("admin.html", **page_context()))
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/config.js")
def config_js():
    """Shop settings for the browser scripts. Contains nothing secret."""
    cfg = current_app.config
    shop = {**cfg["SHOP"], "rate": usd_to_lrd(), "siteUrl": site_url(),
            "ads": {"client": cfg["ADSENSE_CLIENT"], "slot": cfg["ADSENSE_SLOT"]}}
    js = f"window.SHOP = Object.freeze({json.dumps(shop, ensure_ascii=False)});\n"
    return Response(js, mimetype="text/javascript", headers={"Cache-Control": "no-cache"})


@bp.get("/about/developer")
def about_developer():
    analytics.record("info_page")
    return render_template("about_developer.html", developer=DEVELOPER, **page_context())


# Content for the "About the developer" page.
DEVELOPER = {
    "name": "Mandella Luke Wleh-Sam",
    "short_name": "Mandella L. Wleh-Sam",
    "headline": "IT Professional · Systems Administrator · Data Analyst",
    "location": "Monrovia, Liberia",
    "degree": "BSc Information Technology",
    "photo": "img/developer.jpg",
    "email": "wehsammand3lla@gmail.com",
    "linkedin": "https://www.linkedin.com/in/mandella-l-wleh-sam-711372301",
    "experience": [
        {"period": "2025 – Present", "role": "Warehouse & Operations Data Entry Analyst", "org": "IPT PowerTech Liberia"},
        {"period": "2025", "role": "Intern Network Administrator", "org": "Elevation Institute of Technology"},
        {"period": "2023 – 2025", "role": "ICDL Instructor",
         "org": "Elevation Institute of Technology & Liberia Vocational Institute",
         "detail": "Taught digital skills to students."},
    ],
    "education": {"degree": "BSc in Information Technology (System Administration)", "school": "Starz University"},
    "certifications": [
        {"year": "2026", "title": "Ethical Hacker", "issuer": "Cisco Networking Academy"},
        {"year": "2026", "title": "Cybercrime", "issuer": "United Nations Office on Drugs & Crime (UNODC-SPARK)"},
        {"year": "2025", "title": "Data Science & Analytics", "issuer": "HP LIFE · HP Foundation"},
    ],
    "skills": ["Python", "Flask", "C#", "Web & Systems Development", "Microsoft Windows Server", "Kali Linux",
               "Computer Networking", "Data Analysis (Excel)", "Microsoft Office Suite", "VS Code"],
    "projects": [
        {"name": "D.A.R.T", "url": "https://athlete-tracker-omega.vercel.app/",
         "summary": "A secure, coach-verified records platform for athletes in Liberia — football, basketball and "
                    "kickball — that presents verified performances to scouts, schools and clubs.",
         "role": "Founder & Lead Developer",
         "quote": "Talent is everywhere. Verified opportunity should be too."},
    ],
}


# The service worker and manifest must be served from the root so they cover the whole site.
@bp.get("/sw.js")
def service_worker():
    resp = send_from_directory(current_app.static_folder, "sw.js", mimetype="text/javascript", max_age=0)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@bp.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(current_app.static_folder, "manifest.webmanifest", mimetype="application/manifest+json")


@bp.get("/robots.txt")
def robots():
    return Response("User-agent: *\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /api/\nDisallow: /r/\nDisallow: /orders\n\n"
                    f"Sitemap: {site_url()}/sitemap.xml\n", mimetype="text/plain")


@bp.get("/sitemap.xml")
def sitemap():
    """Every active store and product page — helps search engines (and AdSense review) find them."""
    db, base = get_db(), site_url()
    urls = [f"{base}/", f"{base}/sell"] + [f"{base}/legal/{d}" for d in LEGAL_PAGES]
    urls += [f"{base}/s/{r['slug']}" for r in db.execute("SELECT slug FROM sellers WHERE status = 'active'")]
    urls += [f"{base}/p/{r['id']}" for r in db.execute(
        "SELECT p.id FROM products p JOIN sellers s ON s.id = p.seller_id WHERE p.active = 1 AND s.status = 'active'")]
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + "".join(f"  <url><loc>{xml_escape(u)}</loc></url>\n" for u in urls) + "</urlset>\n")
    return Response(xml, mimetype="application/xml")


@bp.get("/ads.txt")
def ads_txt():
    """Authorises Google to sell ads on this site (required by AdSense once ADSENSE_CLIENT is set)."""
    client = current_app.config["ADSENSE_CLIENT"]
    if not client:
        abort(404)
    pub = client.replace("ca-", "", 1)
    return Response(f"google.com, {pub}, DIRECT, f08c47fec0942fa0\n", mimetype="text/plain")


@bp.get("/uploads/products/<path:filename>")
def product_photo(filename):
    folder = Path(current_app.config["UPLOAD_FOLDER"]) / "products"
    return send_from_directory(folder, filename, max_age=7 * 24 * 3600)


@bp.get("/uploads/orders/<path:filename>")
def order_photo(filename):
    """Customers' style photos — only the seller who received the order (or the manager) can see them."""
    u = current_user()
    if not u:
        abort(404)
    if not is_manager():
        order_id = filename.split("/", 1)[0]
        row = get_db().execute("SELECT seller_id FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not row or row["seller_id"] != own_seller_id():
            abort(404)
    resp = send_from_directory(Path(current_app.config["UPLOAD_FOLDER"]) / "orders", filename, max_age=0)
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


# Old static-site links keep working.
@bp.get("/index.html")
def old_index():
    return current_app.redirect("/", 301)


@bp.get("/admin.html")
def old_admin():
    return current_app.redirect("/admin", 301)


# cdnjs.cloudflare.com serves Font Awesome (its stylesheet + icon font files).
CSP = ("default-src 'self'; script-src 'self'; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
       "font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; connect-src 'self'; "
       "manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")

# Google AdSense loads scripts, frames and beacons from many Google domains, so public pages
# get a wider policy once ADSENSE_CLIENT is set. The dashboard keeps the strict one.
CSP_WITH_ADS = ("default-src 'self'; "
                "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://*.googlesyndication.com "
                "https://*.google.com https://*.gstatic.com https://*.doubleclick.net https://*.adtrafficquality.google "
                "https://www.googletagservices.com; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; "
                "font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: blob: https:; "
                "connect-src 'self' https:; frame-src https:; fenced-frame-src https:; "
                "manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


def security_headers(resp):
    h = resp.headers
    ads_page = current_app.config["ADSENSE_CLIENT"] and not request.path.startswith(("/admin", "/dashboard", "/api/", "/r/", "/orders"))
    h.setdefault("Content-Security-Policy", CSP_WITH_ADS if ads_page else CSP)
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    if current_app.config["SESSION_COOKIE_SECURE"]:
        h.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp
