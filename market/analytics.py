"""Page-view tracking, used to split advertising revenue between sellers.

How it works
------------
* Every time a public page is *loaded* (home, a seller's store, a product page) the
  server adds 1 to a daily counter for that seller (seller 0 = the platform itself).
  These page loads are what show adverts, so they are the basis for revenue sharing.
* Opening a product inside a page (the pop-up) is counted separately as
  "product_open" — useful engagement data, but it doesn't show a new advert.
* Unique visitors are counted with a salted hash of IP + browser that changes every
  day, so no cookie is needed and no one can be followed from day to day.
* Bots, crawlers and signed-in sellers/managers previewing pages are not counted.

AdSense does not report earnings per seller, so the monthly allocation is:
    seller share = seller's ad-page views ÷ all ad-page views that month
    seller revenue = AdSense earnings for the month × seller share
"""
from __future__ import annotations

import hashlib
import random
import re
from datetime import date, timedelta

from flask import current_app, request

from .accounts import current_user
from .db import get_db, today

AD_KINDS = ("home", "store_page", "product_page", "info_page")   # page loads that can show an advert
KINDS = AD_KINDS + ("product_open",)
VISITOR_DAYS = 90

BOTS = re.compile(r"bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python-|"
                  r"headless|lighthouse|pingdom|monitor|scan", re.I)


def _counts_this_request() -> bool:
    ua = request.headers.get("User-Agent", "")
    if not ua or BOTS.search(ua):
        return False
    if request.headers.get("Purpose") == "prefetch" or request.headers.get("Sec-Purpose", "").startswith("prefetch"):
        return False
    return current_user() is None          # sellers/managers checking their own pages don't count


def _visitor_key(day: str) -> str:
    raw = f"{current_app.config['SECRET_KEY']}|{day}|{request.remote_addr}|{request.headers.get('User-Agent', '')}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def record(kind: str, seller_id: int = 0, product_id: str = "") -> None:
    if kind not in KINDS or not _counts_this_request():
        return
    db, day = get_db(), today()
    db.execute("INSERT INTO page_views (day, seller_id, product_id, kind, views) VALUES (?,?,?,?,1) "
               "ON CONFLICT (day, seller_id, product_id, kind) DO UPDATE SET views = views + 1",
               (day, seller_id or 0, product_id or "", kind))
    db.execute("INSERT OR IGNORE INTO page_visitors (day, seller_id, visitor) VALUES (?,?,?)",
               (day, seller_id or 0, _visitor_key(day)))
    if random.random() < 0.02:   # now and then, drop visitor hashes older than the 90 days the Privacy Policy promises
        db.execute("DELETE FROM page_visitors WHERE day < ?", ((date.fromisoformat(day) - timedelta(days=VISITOR_DAYS)).isoformat(),))
    db.commit()


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
def _range(days: int) -> tuple[str, str]:
    end = date.fromisoformat(today())
    return (end - timedelta(days=days - 1)).isoformat(), end.isoformat()


def seller_summary(seller_id: int | None, days: int = 30) -> dict:
    """Views for one seller (or the whole platform when seller_id is None) over the last `days` days."""
    db = get_db()
    start, end = _range(days)
    where, args = ("day BETWEEN ? AND ?", [start, end])
    if seller_id is not None:
        where += " AND seller_id = ?"
        args.append(seller_id)
    by_kind = {k: 0 for k in KINDS}
    for r in db.execute(f"SELECT kind, SUM(views) v FROM page_views WHERE {where} GROUP BY kind", args):
        by_kind[r["kind"]] = r["v"]
    uniques = db.execute(f"SELECT COUNT(*) FROM page_visitors WHERE {where}", args).fetchone()[0]
    daily = {r["day"]: r["v"] for r in db.execute(
        f"SELECT day, SUM(views) v FROM page_views WHERE {where} AND kind IN ({','.join('?' * len(AD_KINDS))}) GROUP BY day",
        args + list(AD_KINDS))}
    series = []
    d = date.fromisoformat(start)
    while d.isoformat() <= end:
        series.append({"day": d.isoformat(), "views": daily.get(d.isoformat(), 0)})
        d += timedelta(days=1)
    top = [dict(r) for r in db.execute(
        f"SELECT product_id AS id, SUM(views) AS views FROM page_views WHERE {where} AND product_id != '' "
        f"GROUP BY product_id ORDER BY views DESC LIMIT 5", args)]
    return {
        "days": days,
        "storeViews": by_kind["store_page"], "productPageViews": by_kind["product_page"],
        "productOpens": by_kind["product_open"], "homeViews": by_kind["home"], "infoViews": by_kind["info_page"],
        "adPageViews": sum(by_kind[k] for k in AD_KINDS), "uniqueVisitors": uniques,
        "series": series, "topProducts": top,
    }


def views_by_seller(days: int = 30) -> dict[int, dict]:
    db = get_db()
    start, end = _range(days)
    out: dict[int, dict] = {}
    for r in db.execute("SELECT seller_id, kind, SUM(views) v FROM page_views WHERE day BETWEEN ? AND ? "
                        "GROUP BY seller_id, kind", (start, end)):
        out.setdefault(r["seller_id"], {k: 0 for k in KINDS})[r["kind"]] = r["v"]
    return out


def month_allocation(month: str) -> dict:
    """Split one month's AdSense earnings between sellers by their share of ad-page views."""
    db = get_db()
    y, m = (int(x) for x in month.split("-"))
    start = date(y, m, 1)
    end = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1))
    rev = db.execute("SELECT amount, note FROM ad_revenue WHERE month = ?", (month,)).fetchone()
    amount = rev["amount"] if rev else 0.0
    rows = db.execute(
        f"SELECT seller_id, SUM(CASE WHEN kind = 'store_page' THEN views ELSE 0 END) store, "
        f"SUM(CASE WHEN kind = 'product_page' THEN views ELSE 0 END) product, "
        f"SUM(CASE WHEN kind IN ({','.join('?' * len(AD_KINDS))}) THEN views ELSE 0 END) ad "
        f"FROM page_views WHERE day BETWEEN ? AND ? GROUP BY seller_id",
        (*AD_KINDS, start.isoformat(), end.isoformat())).fetchall()
    total = sum(r["ad"] for r in rows) or 0
    names = {r["id"]: (r["name"], r["slug"]) for r in db.execute("SELECT id, name, slug FROM sellers")}
    lines = []
    for r in rows:
        share = (r["ad"] / total) if total else 0
        name, slug = names.get(r["seller_id"], (f"Deleted shop #{r['seller_id']}", "")) if r["seller_id"] else \
            ("Platform pages (home, legal, info)", "")
        lines.append({"sellerId": r["seller_id"], "name": name, "slug": slug, "storeViews": r["store"],
                      "productPageViews": r["product"], "adPageViews": r["ad"],
                      "share": round(share, 6), "revenue": round(amount * share, 2)})
    lines.sort(key=lambda x: (x["sellerId"] == 0, -x["adPageViews"]))
    return {"month": month, "amount": amount, "note": rev["note"] if rev else "", "totalAdPageViews": total,
            "from": start.isoformat(), "to": end.isoformat(), "lines": lines}
