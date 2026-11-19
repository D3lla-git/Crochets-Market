"""Run with:  python -m pytest"""
from __future__ import annotations

import base64
import os
import sqlite3

import pytest

from market import accounts, create_app
from market.db import DEMO_PASSWORD, get_db, init_db, seed_demo

PNG_1PX = "data:image/png;base64," + base64.b64encode(
    bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                  "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")).decode()
MANAGER = ("boss@example.com", "a-strong-manager-password")
SINKOR = ("sinkor@demo.local", DEMO_PASSWORD)
PAYNES = ("paynesville@demo.local", DEMO_PASSWORD)
BROWSER = {"User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile"}


@pytest.fixture
def app(tmp_path):
    accounts.reset_throttle()
    app = create_app({
        "TESTING": True,
        "DATABASE": str(tmp_path / "test.sqlite3"),
        "UPLOAD_FOLDER": str(tmp_path / "uploads"),
        "MANAGER_EMAIL": MANAGER[0], "ADMIN_PASSWORD": MANAGER[1], "ADMIN_PASSWORD_HASH": "",
        "SMTP_HOST": "", "ADSENSE_CLIENT": "", "SITE_URL": "",
    })
    with app.app_context():
        init_db()
        accounts.ensure_manager(app)
        seed_demo()
    return app


def login(app, who):
    c = app.test_client()
    r = c.post("/api/dash/login", json={"email": who[0], "password": who[1]})
    assert r.status_code == 200, r.get_json()
    return c


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def manager(app):
    return login(app, MANAGER)


@pytest.fixture
def sinkor(app):
    return login(app, SINKOR)


def cart_order(**over):
    o = {"id": "CM-261116-7KQ2", "type": "cart", "customer": {"name": "Ama", "phone": "0770 123 456", "location": "Sinkor"},
         "items": [{"id": "blossom-top", "name": "x", "size": "M", "color": "Candy Pink", "qty": 2, "price": 0.01}],
         "delivery": "Arrange with maker", "note": ""}
    o.update(over)
    return o


def seller_id(app, slug):
    with app.app_context():
        return get_db().execute("SELECT id FROM sellers WHERE slug = ?", (slug,)).fetchone()["id"]


# ================================================================ pages & config
def test_public_pages_render(client):
    for url, text in [("/", b"Find a crochet maker"), ("/s/sinkor-stitches", b"Sinkor Stitches"),
                      ("/p/blossom-top", b"Blossom Crop Top by Sinkor Stitches"), ("/sell", b"Open your shop"),
                      ("/admin", b"Dashboard"), ("/about/developer", b"Mandella Luke Wleh-Sam")]:
        r = client.get(url)
        assert r.status_code == 200 and text in r.data, url
        assert "Content-Security-Policy" in r.headers
    assert b"Crochets Market" in client.get("/").data and b"Augs" not in client.get("/").data


@pytest.mark.parametrize("doc,text", [("terms", b"Terms of Use"), ("privacy", b"Privacy Policy"), ("cookies", b"Cookie Policy"),
                                      ("sellers", b"Seller Policy"), ("safety", b"Meetup Safety")])
def test_legal_pages(client, doc, text):
    r = client.get(f"/legal/{doc}")
    assert r.status_code == 200 and text in r.data
    assert b"luketrustcrochetsmarket@gmail.com" in r.data


def test_sitemap_lists_stores_and_products(client):
    xml = client.get("/sitemap.xml").data
    assert b"/s/sinkor-stitches" in xml and b"/p/blossom-top" in xml and b"/legal/terms" in xml


def test_config_js_is_public_safe(client):
    body = client.get("/config.js").data
    assert b'"rate": 171' in body and b'"altCurrency": "L$"' in body
    assert MANAGER[1].encode() not in body and b"SECRET" not in body


def test_adsense_off_by_default(client):
    assert client.get("/ads.txt").status_code == 404
    assert b"googlesyndication" not in client.get("/").headers["Content-Security-Policy"].encode()


def test_adsense_on(app):
    app.config["ADSENSE_CLIENT"] = "ca-pub-1234567890123456"
    c = app.test_client()
    assert c.get("/ads.txt").data == b"google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n"
    assert "googlesyndication" in c.get("/").headers["Content-Security-Policy"]
    assert "googlesyndication" not in c.get("/admin").headers["Content-Security-Policy"]   # dashboard stays strict
    assert b'class="ad-slot"' in c.get("/s/sinkor-stitches").data


# ================================================================ catalogue & directory
def test_catalogue_and_directory(client):
    data = client.get("/api/products").get_json()
    assert len(data["products"]) == 10 and set(data["sellers"]) == {"sinkor-stitches", "paynesville-purls", "bushrod-yarn-co"}
    one = client.get("/api/products?seller=paynesville-purls").get_json()
    assert {p["seller"] for p in one["products"]} == {"paynesville-purls"}
    makers = client.get("/api/sellers").get_json()["sellers"]
    assert len(makers) == 3 and all("whatsapp" in m for m in makers)
    sinkor = next(m for m in makers if m["slug"] == "sinkor-stitches")
    assert sinkor["customSlotsOpen"] == 4 and sinkor["depositRequired"] and sinkor["momoNumber"]


def test_pending_and_suspended_shops_are_hidden(app, client, manager):
    sid = seller_id(app, "paynesville-purls")
    manager.patch(f"/api/dash/sellers/{sid}", json={"status": "suspended"})
    assert client.get("/s/paynesville-purls").status_code == 404
    assert all(p["seller"] != "paynesville-purls" for p in client.get("/api/products").get_json()["products"])
    assert manager.get("/s/paynesville-purls").status_code == 200        # manager can still preview
    assert app.test_client().post("/api/dash/login", json={"email": PAYNES[0], "password": PAYNES[1]}).status_code == 403


# ================================================================ orders
def test_order_is_repriced_and_assigned_to_seller(app, client):
    r = client.post("/api/orders", json=cart_order())
    assert r.status_code == 201 and r.get_json()["total"] == 50 and r.get_json()["seller"] == "sinkor-stitches"
    with app.app_context():
        row = get_db().execute("SELECT * FROM orders").fetchone()
        assert row["seller_id"] == seller_id(app, "sinkor-stitches") and row["lrd_rate"] == 171


def test_one_order_per_seller(client):
    o = cart_order(items=[{"id": "blossom-top", "name": "a", "size": "M", "color": "x", "qty": 1},
                          {"id": "lagoon-hat", "name": "b", "size": "One size", "color": "x", "qty": 1}])
    r = client.post("/api/orders", json=o)
    assert r.status_code == 400 and "one order per shop" in r.get_json()["error"]


def test_out_of_stock_and_duplicates(client):
    sold_out = cart_order(items=[{"id": "market-tote", "name": "Tote", "size": "One size", "color": "x", "qty": 1}])
    assert client.post("/api/orders", json=sold_out).status_code == 409
    client.post("/api/orders", json=cart_order())
    assert client.post("/api/orders", json=cart_order()).get_json()["duplicate"] is True


def test_pickup_must_be_a_listed_spot(client):
    bad = cart_order(delivery="Pickup", pickupSpot="My house", pickupDay="Sat")
    assert client.post("/api/orders", json=bad).status_code == 400
    good = cart_order(delivery="Pickup", pickupSpot="ELWA Junction (by the supermarket)", pickupDay="Sat")
    assert client.post("/api/orders", json=good).status_code == 201


def test_made_to_order_items_need_options_and_use_slots(app, client):
    item = {"id": "ocean-dress", "name": "x", "size": "M", "color": "Blush", "qty": 1}
    r = client.post("/api/orders", json=cart_order(items=[item]))
    assert r.status_code == 409 and "colours and deadline" in r.get_json()["error"]
    item["custom"] = {"colors": "navy", "deadline": "2026-12-20"}
    assert client.post("/api/orders", json=cart_order(items=[item])).status_code == 201
    slots = next(m for m in client.get("/api/sellers").get_json()["sellers"] if m["slug"] == "sinkor-stitches")
    assert slots["customSlotsOpen"] == 3


def test_custom_slots_full(app, client):
    with app.app_context():
        get_db().execute("UPDATE sellers SET custom_slots_week = 1 WHERE slug = 'paynesville-purls'")
        get_db().commit()
    req = {"id": "CM-261116-AAA1", "type": "custom", "seller": "paynesville-purls",
           "customer": {"name": "Kofi", "phone": "0886123456"}, "custom": {"type": "Dress", "forWho": "Woman", "measurements": []}}
    assert client.post("/api/orders", json=req).status_code == 201
    req["id"] = "CM-261116-AAA2"
    r = client.post("/api/orders", json=req)
    assert r.status_code == 409 and r.get_json()["code"] == "full"


def test_customer_photos_private_to_receiving_seller(app, client, manager):
    req = {"id": "CM-261116-PHO1", "type": "custom", "seller": "sinkor-stitches",
           "customer": {"name": "Ama", "phone": "0770123456"}, "custom": {"type": "Dress", "forWho": "Woman", "measurements": []},
           "photos": [{"name": "s.png", "data": PNG_1PX}]}
    assert client.post("/api/orders", json=req).status_code == 201
    link = manager.get("/api/dash/data").get_json()["orders"][0]["photoLinks"][0]
    assert manager.get(link).status_code == 200
    assert login(app, SINKOR).get(link).status_code == 200
    assert login(app, PAYNES).get(link).status_code == 404          # another seller can't see it
    assert client.get(link).status_code == 404                       # nor the public


def test_cross_site_post_blocked(client):
    assert client.post("/api/orders", json=cart_order(), headers={"Origin": "https://evil.example"}).status_code == 403


# ================================================================ accounts & isolation
def test_dashboard_requires_login(client):
    assert client.get("/api/dash/data").status_code == 401
    assert client.post("/api/dash/products", json={"product": {}}).status_code == 401


def test_seller_sees_only_own_data(app, client, sinkor):
    client.post("/api/orders", json=cart_order())
    paynes = login(app, PAYNES)
    s_data, p_data = sinkor.get("/api/dash/data").get_json(), paynes.get("/api/dash/data").get_json()
    assert {p["seller"] for p in s_data["products"]} == {"sinkor-stitches"} and len(s_data["orders"]) == 1
    assert {p["seller"] for p in p_data["products"]} == {"paynesville-purls"} and p_data["orders"] == []
    assert "sellers" not in s_data and "mine" in s_data["analytics"]


def test_seller_cannot_touch_other_sellers(app, client, sinkor):
    client.post("/api/orders", json=cart_order())
    paynes = login(app, PAYNES)
    assert paynes.post("/api/dash/products/blossom-top/stock", json={"delta": 5}).status_code == 404
    assert paynes.delete("/api/dash/products/blossom-top", json={}).status_code == 404
    assert paynes.patch("/api/dash/orders/CM-261116-7KQ2", json={"changes": {"status": "Paid", "confirmSent": True}}).status_code == 404
    r = paynes.post("/api/dash/products", json={"product": {"id": "blossom-top", "name": "Hijack", "price": 1, "stock": 1}})
    assert r.status_code == 403
    assert paynes.get("/api/dash/ads").status_code == 403 and paynes.patch("/api/dash/sellers/1", json={}).status_code == 403


def test_manager_sees_everything(manager, client):
    client.post("/api/orders", json=cart_order())
    d = manager.get("/api/dash/data").get_json()
    assert len(d["products"]) == 10 and len(d["orders"]) == 1 and len(d["sellers"]) == 3 and "platform" in d["analytics"]


def test_login_throttle_and_wrong_password(app, client):
    app.config["LOGIN_MAX_FAILS"] = 3
    for _ in range(3):
        assert client.post("/api/dash/login", json={"email": SINKOR[0], "password": "nope"}).status_code == 401
    assert client.post("/api/dash/login", json={"email": SINKOR[0], "password": SINKOR[1]}).status_code == 429


def test_dev_accounts_refused_in_production(app):
    app.config["APP_PRODUCTION"] = True
    r = app.test_client().post("/api/dash/login", json={"email": SINKOR[0], "password": SINKOR[1]})
    assert r.status_code == 401


def test_password_change_signs_out_old_sessions(app, sinkor):
    other = login(app, SINKOR)
    assert sinkor.post("/api/dash/password", json={"current": SINKOR[1], "new": "brand-new-pass"}).status_code == 200
    assert sinkor.get("/api/dash/data").status_code == 200          # this device re-signed in
    assert other.get("/api/dash/data").status_code == 401           # the other device is out


def test_seller_registration_and_approval(app, client, manager):
    r = client.post("/api/sellers/register", json={"shopName": "Gbarnga Loops", "ownerName": "Fatu", "email": "fatu@example.com",
                                                    "password": "loops-1234", "whatsapp": "0880 111 222", "location": "Gbarnga", "agree": True})
    assert r.status_code == 201 and r.get_json()["status"] == "pending"
    assert client.get("/s/gbarnga-loops").status_code == 200        # the new seller (signed in) can preview
    assert app.test_client().get("/s/gbarnga-loops").status_code == 404
    me = client.get("/api/dash/me").get_json()
    assert me["seller"]["whatsapp"] == "231880111222" and me["seller"]["status"] == "pending"
    manager.patch(f"/api/dash/sellers/{me['seller']['id']}", json={"status": "active", "phoneVerified": True})
    assert app.test_client().get("/s/gbarnga-loops").status_code == 200
    assert client.post("/api/sellers/register", json={"shopName": "Again", "ownerName": "Xavi", "email": "fatu@example.com",
                                                      "password": "loops-1234", "whatsapp": "0880111222", "agree": True}).status_code == 409


def test_manager_creates_seller_and_resets_password(app, manager):
    r = manager.post("/api/dash/sellers", json={"shopName": "Harper Hooks", "ownerName": "Mary", "email": "mary@example.com", "whatsapp": "0777000111"})
    temp = r.get_json()["tempPassword"]
    assert r.status_code == 201 and login(app, ("mary@example.com", temp))
    reset = manager.post(f"/api/dash/sellers/{r.get_json()['sellerId']}/reset-password", json={}).get_json()["tempPassword"]
    assert login(app, ("mary@example.com", reset))


def test_store_settings(app, sinkor):
    r = sinkor.post("/api/dash/store", json={"store": {"bio": "New bio", "pickupSpots": ["Capitol Hill gate", ""],
                                                        "pickupDays": ["Sat", "Xyz"], "customSlotsWeek": 6, "depositPercent": 40,
                                                        "instagram": "javascript:alert(1)"}})
    assert r.status_code == 400                                       # bad social link refused
    r = sinkor.post("/api/dash/store", json={"store": {"bio": "New bio", "pickupSpots": ["Capitol Hill gate", ""],
                                                        "pickupDays": ["Sat", "Xyz"], "customSlotsWeek": 6, "depositPercent": 40}})
    s = r.get_json()["seller"]
    assert s["bio"] == "New bio" and s["pickupSpots"] == ["Capitol Hill gate"] and s["pickupDays"] == ["Sat"] and s["customSlotsWeek"] == 6


def test_product_crud_with_custom_options(sinkor, manager, app):
    r = sinkor.post("/api/dash/products", json={"product": {"name": "Test Top", "category": "Tops", "price": "12.5", "stock": 3,
        "colors": [{"n": "Bad", "h": "red;x"}], "images": ["javascript:alert(1)"], "customEnabled": True, "turnaroundDays": 5}})
    p = r.get_json()["product"]
    assert p["seller"] == "sinkor-stitches" and p["customEnabled"] and p["turnaroundDays"] == 5
    assert p["colors"][0]["h"] == "#F28DB8" and p["images"] == []
    assert sinkor.post(f"/api/dash/products/{p['id']}/stock", json={"delta": -9}).get_json()["stock"] == 0
    assert manager.post("/api/dash/products", json={"product": {"name": "Orphan", "price": 1, "stock": 1}}).status_code == 400
    r = manager.post("/api/dash/products", json={"product": {"name": "For Bushrod", "price": 1, "stock": 1},
                                                  "sellerId": seller_id(app, "bushrod-yarn-co")})
    assert r.get_json()["product"]["seller"] == "bushrod-yarn-co"


def test_confirm_and_cancel_move_stock(client, sinkor):
    client.post("/api/orders", json=cart_order())
    stock = lambda: next(p for p in sinkor.get("/api/dash/data").get_json()["products"] if p["id"] == "blossom-top")
    sinkor.patch("/api/dash/orders/CM-261116-7KQ2", json={"changes": {"status": "Confirmed", "confirmSent": True}})
    assert (stock()["stock"], stock()["sold"]) == (6, 2)
    sinkor.patch("/api/dash/orders/CM-261116-7KQ2", json={"changes": {"status": "Paid", "confirmSent": True}})
    assert stock()["stock"] == 6
    sinkor.patch("/api/dash/orders/CM-261116-7KQ2", json={"changes": {"status": "Cancelled"}})
    assert (stock()["stock"], stock()["sold"]) == (8, 0)


# ================================================================ reviews & badges
def test_verified_reviews(client, sinkor):
    client.post("/api/orders", json=cart_order())
    review = {"orderId": "CM-261116-7KQ2", "phone": "0770123456", "rating": 5, "comment": "Lovely!"}
    assert client.post("/api/reviews", json=review).status_code == 409                    # not delivered yet
    sinkor.patch("/api/dash/orders/CM-261116-7KQ2", json={"changes": {"status": "Delivered", "confirmSent": True}})
    assert client.post("/api/reviews", json={**review, "phone": "0999999999"}).status_code == 404   # wrong phone
    assert client.post("/api/reviews", json=review).status_code == 201
    assert client.post("/api/reviews", json=review).status_code == 409                    # only once
    prof = client.get("/api/sellers/sinkor-stitches").get_json()
    assert prof["seller"]["rating"] == 5 and prof["seller"]["handoffs"] == 1 and prof["reviews"][0]["buyer"] == "Ama"


# ================================================================ analytics & ad revenue
def test_page_views_are_counted_per_seller(app, client, manager):
    for _ in range(3):
        client.get("/s/sinkor-stitches", headers=BROWSER)
    client.get("/p/lagoon-hat", headers=BROWSER)
    client.get("/", headers=BROWSER)
    client.get("/s/sinkor-stitches", headers={"User-Agent": "Googlebot/2.1"})              # bots don't count
    manager.get("/s/sinkor-stitches", headers=BROWSER)                                     # signed-in users don't count
    client.post("/api/track", json={"productId": "blossom-top"}, headers=BROWSER)
    a = manager.get("/api/dash/data").get_json()["analytics"]
    s = a["bySeller"][str(seller_id(app, "sinkor-stitches"))]
    b = a["bySeller"][str(seller_id(app, "bushrod-yarn-co"))]
    assert s["storeViews"] == 3 and s["productOpens"] == 1 and s["uniqueVisitors"] == 1
    assert b["productPageViews"] == 1 and a["platform"]["homeViews"] == 1


def test_ad_revenue_split(app, client, manager):
    for _ in range(6):
        client.get("/s/sinkor-stitches", headers=BROWSER)
    for _ in range(3):
        client.get("/p/lagoon-hat", headers=BROWSER)
    client.get("/", headers=BROWSER)
    from market.db import today
    month = today()[:7]
    rep = manager.post("/api/dash/ads", json={"month": month, "amount": 100}).get_json()["report"]
    lines = {l["slug"] or "platform": l for l in rep["lines"]}
    assert rep["totalAdPageViews"] == 10
    assert lines["sinkor-stitches"]["revenue"] == 60 and lines["bushrod-yarn-co"]["revenue"] == 30 and lines["platform"]["revenue"] == 10


# ================================================================ reports & company structure
def test_reports_excel_and_pdf(app, client, sinkor, manager):
    from io import BytesIO
    from openpyxl import load_workbook
    client.post("/api/orders", json=cart_order())
    sinkor.patch("/api/dash/orders/CM-261116-7KQ2", json={"changes": {"status": "Paid", "confirmSent": True}})
    r = sinkor.get("/api/dash/report.xlsx?period=90d")
    assert r.status_code == 200 and "sinkor-stitches-90d" in r.headers["Content-Disposition"]
    wb = load_workbook(BytesIO(r.data))
    assert {"Summary", "Monthly", "Orders", "Crochets", "Best sellers", "Page views"} <= set(wb.sheetnames)
    summary = {row[0]: row[1] for row in wb["Summary"].iter_rows(min_row=6, values_only=True) if row[0]}
    assert summary["Total sales (paid & delivered)"] == 50 and summary["Pieces sold"] == 2
    pdf = sinkor.get("/api/dash/report.pdf?period=all")
    assert pdf.status_code == 200 and pdf.data.startswith(b"%PDF")
    # a seller can't ask for someone else's report — the seller parameter is ignored
    other = sinkor.get(f"/api/dash/report.xlsx?seller={seller_id(app, 'paynesville-purls')}")
    assert "sinkor-stitches" in other.headers["Content-Disposition"]
    # the manager gets the whole marketplace (with a Sellers sheet) or any one seller
    assert "Sellers" in load_workbook(BytesIO(manager.get("/api/dash/report.xlsx?seller=all").data)).sheetnames
    one = manager.get(f"/api/dash/report.xlsx?seller={seller_id(app, 'bushrod-yarn-co')}")
    assert "bushrod-yarn-co" in one.headers["Content-Disposition"]
    assert client.get("/api/dash/report.pdf").status_code == 401


def test_customer_text_stays_text_in_excel(app, client, sinkor):
    from io import BytesIO
    from openpyxl import load_workbook
    client.post("/api/orders", json=cart_order(customer={"name": "=HYPERLINK(\"http://x\")", "phone": "0770123456", "location": "Sinkor"}))
    ws = load_workbook(BytesIO(sinkor.get("/api/dash/report.xlsx").data))["Orders"]
    cell = ws.cell(row=2, column=[c.value for c in ws[1]].index("Customer") + 1)
    assert cell.data_type == "s" and cell.value.startswith("=HYPERLINK")


def test_parent_company_in_legal_pages(client):
    for doc in ("terms", "privacy", "sellers", "cookies"):
        assert b"a subsidiary of LukeTrust LLC" in client.get(f"/legal/{doc}").data, doc
    assert b"Crochets Market, a subsidiary of LukeTrust LLC" in client.get("/").data   # footer


# ================================================================ sold → photos deleted; unreported sales → suspension
def _upload_product_photo(app, sinkor, pid="lagoon-hat"):
    url = sinkor.post("/api/dash/images", json={"image": {"name": "p.png", "data": PNG_1PX}}).get_json()["url"]
    with app.app_context():
        db = get_db()
        db.execute("UPDATE products SET images = ? WHERE id = ?", (f'["{url}"]', pid))
        db.commit()
    return url, os.path.join(app.config["UPLOAD_FOLDER"], "products", url.rsplit("/", 1)[-1])


def test_buyer_photos_deleted_when_delivered(app, client, sinkor):
    req = {"id": "CM-261117-PH01", "type": "custom", "seller": "sinkor-stitches", "customer": {"name": "Ama", "phone": "0770123456"},
           "custom": {"type": "Dress", "forWho": "Woman", "measurements": []}, "photos": [{"name": "s.png", "data": PNG_1PX}]}
    client.post("/api/orders", json=req)
    folder = os.path.join(app.config["UPLOAD_FOLDER"], "orders", "CM-261117-PH01")
    assert os.listdir(folder)
    sinkor.patch("/api/dash/orders/CM-261117-PH01", json={"changes": {"status": "Confirmed", "confirmSent": True}})
    assert os.path.isdir(folder)                                     # still needed while the piece is being made
    sinkor.patch("/api/dash/orders/CM-261117-PH01", json={"changes": {"status": "Delivered", "confirmSent": True}})
    assert not os.path.exists(folder)
    o = sinkor.get("/api/dash/data").get_json()["orders"][0]
    assert o["photoLinks"] == [] and o["photosDeleted"] is True


def test_buyer_photos_deleted_when_cancelled(app, client, sinkor):
    req = {"id": "CM-261117-PH02", "type": "custom", "seller": "sinkor-stitches", "customer": {"name": "Ama", "phone": "0770123456"},
           "custom": {"type": "Dress", "forWho": "Woman", "measurements": []}, "photos": [{"name": "s.png", "data": PNG_1PX}]}
    client.post("/api/orders", json=req)
    sinkor.patch("/api/dash/orders/CM-261117-PH02", json={"changes": {"status": "Cancelled"}})
    assert not os.path.exists(os.path.join(app.config["UPLOAD_FOLDER"], "orders", "CM-261117-PH02"))


def test_mark_as_sold_deletes_product_photos(app, client, sinkor, manager):
    bushrod = login(app, ("bushrod@demo.local", DEMO_PASSWORD))
    url, path = _upload_product_photo(app, bushrod, "lagoon-hat")
    assert os.path.isfile(path)
    assert sinkor.post("/api/dash/products/lagoon-hat/sold", json={}).status_code == 404     # not Sinkor's
    assert bushrod.post("/api/dash/products/lagoon-hat/sold", json={}).status_code == 200
    assert not os.path.exists(path)
    p = next(x for x in manager.get("/api/dash/data").get_json()["products"] if x["id"] == "lagoon-hat")
    assert p["images"] == [] and p["soldAt"] and not p["active"] and p["stock"] == 0
    assert all(x["id"] != "lagoon-hat" for x in client.get("/api/products").get_json()["products"])


def test_last_piece_delivered_marks_product_sold(app, client, manager):
    bushrod = login(app, ("bushrod@demo.local", DEMO_PASSWORD))
    url, path = _upload_product_photo(app, bushrod, "mist-halter")          # 2 in stock
    o = cart_order(id="CM-261117-LAST", items=[{"id": "mist-halter", "name": "x", "size": "S", "color": "Ice Blue", "qty": 2}])
    client.post("/api/orders", json=o)
    bushrod.patch("/api/dash/orders/CM-261117-LAST", json={"changes": {"status": "Confirmed", "confirmSent": True}})
    assert os.path.isfile(path)                                       # only confirmed, not handed over yet
    r = bushrod.patch("/api/dash/orders/CM-261117-LAST", json={"changes": {"status": "Delivered", "confirmSent": True}}).get_json()
    assert r["soldProducts"] == ["mist-halter"] and not os.path.exists(path)


def test_photo_shared_with_another_listing_is_kept(app, sinkor):
    url, path = _upload_product_photo(app, sinkor, "ocean-dress")
    with app.app_context():
        db = get_db()
        db.execute("UPDATE products SET images = ? WHERE id = 'sunset-set'", (f'["{url}"]',))
        db.commit()
    sinkor.post("/api/dash/products/ocean-dress/sold", json={})
    assert os.path.isfile(path)


def _age_order(app, oid, days_overdue):
    from datetime import date, timedelta
    with app.app_context():
        db = get_db()
        db.execute("UPDATE orders SET due_at = ? WHERE id = ?", ((date.today() - timedelta(days=days_overdue)).isoformat(), oid))
        db.commit()


def test_unreported_sale_suspends_shop(app, client, sinkor, manager):
    from market import lifecycle
    client.post("/api/orders", json=cart_order())
    due = sinkor.get("/api/dash/data").get_json()["due"]
    assert due[0]["id"] == "CM-261116-7KQ2" and due[0]["daysLeft"] == 14
    _age_order(app, "CM-261116-7KQ2", 2)                              # overdue but still in the grace period
    with app.app_context():
        assert lifecycle.enforce(force=True) == []
    _age_order(app, "CM-261116-7KQ2", 4)                              # past the 3-day grace period
    with app.app_context():
        assert lifecycle.enforce(force=True) == [seller_id(app, "sinkor-stitches")]
    assert client.get("/s/sinkor-stitches").status_code == 404        # gone from the marketplace
    me = sinkor.get("/api/dash/data").get_json()                      # can still sign in to resolve it…
    assert me["seller"]["status"] == "suspended" and me["seller"]["autoSuspended"] and "CM-261116-7KQ2" in me["seller"]["suspendReason"]
    r = sinkor.post("/api/dash/products", json={"product": {"name": "New", "price": 1, "stock": 1}})
    assert r.status_code == 403 and r.get_json()["code"] == "suspended"   # …but can't list pieces
    assert sinkor.patch("/api/dash/orders/CM-261116-7KQ2", json={"changes": {"status": "Delivered", "confirmSent": True}}).status_code == 200
    manager.patch(f"/api/dash/sellers/{seller_id(app, 'sinkor-stitches')}", json={"status": "active"})
    assert client.get("/s/sinkor-stitches").status_code == 200
    with app.app_context():
        assert lifecycle.enforce(force=True) == []


def test_reactivation_gives_fresh_grace(app, client, sinkor, manager):
    from market import lifecycle
    client.post("/api/orders", json=cart_order())
    _age_order(app, "CM-261116-7KQ2", 10)
    with app.app_context():
        lifecycle.enforce(force=True)
    manager.patch(f"/api/dash/sellers/{seller_id(app, 'sinkor-stitches')}", json={"status": "active"})
    with app.app_context():
        assert lifecycle.enforce(force=True) == []                    # not suspended again straight away
    assert sinkor.get("/api/dash/data").get_json()["due"][0]["daysLeft"] == 3


def test_custom_work_gets_longer_window(client, sinkor):
    item = {"id": "ocean-dress", "name": "x", "size": "M", "color": "Blush", "qty": 1, "custom": {"colors": "navy", "deadline": "2027-03-01"}}
    client.post("/api/orders", json=cart_order(items=[item]))
    assert sinkor.get("/api/dash/data").get_json()["orders"][0]["dueAt"] == "2027-03-08"   # needed-by + 7 days


# ================================================================ deleting shops
def test_manager_deletes_shop(app, client, manager):
    sid = seller_id(app, "bushrod-yarn-co")
    bushrod = login(app, ("bushrod@demo.local", DEMO_PASSWORD))
    url, path = _upload_product_photo(app, bushrod, "lagoon-hat")
    req = {"id": "CM-261117-DEL1", "type": "custom", "seller": "bushrod-yarn-co", "customer": {"name": "Ama", "phone": "0770123456"},
           "custom": {"type": "Hat / beanie", "forWho": "Woman", "measurements": []}, "photos": [{"name": "s.png", "data": PNG_1PX}]}
    client.post("/api/orders", json=req)
    for _ in range(2):
        client.get("/s/bushrod-yarn-co", headers=BROWSER)
    order_folder = os.path.join(app.config["UPLOAD_FOLDER"], "orders", "CM-261117-DEL1")
    assert os.path.isfile(path) and os.path.isdir(order_folder)

    assert bushrod.delete(f"/api/dash/sellers/{sid}", json={"confirm": "bushrod-yarn-co"}).status_code == 403   # sellers can't
    assert manager.delete(f"/api/dash/sellers/{sid}", json={"confirm": "wrong"}).status_code == 400           # must confirm
    r = manager.delete(f"/api/dash/sellers/{sid}", json={"confirm": "bushrod-yarn-co"})
    assert r.status_code == 200 and r.get_json()["deleted"]["products"] == 3 and r.get_json()["deleted"]["orders"] == 1

    assert client.get("/s/bushrod-yarn-co").status_code == 404
    assert not os.path.exists(path) and not os.path.exists(order_folder)            # photos gone from disk
    assert bushrod.get("/api/dash/data").status_code == 401                          # signed out for good
    assert app.test_client().post("/api/dash/login", json={"email": "bushrod@demo.local", "password": DEMO_PASSWORD}).status_code == 401
    d = manager.get("/api/dash/data").get_json()
    assert all(s["id"] != sid for s in d["sellers"]) and all(p["sellerId"] != sid for p in d["products"])
    from market.db import today
    rep = manager.get(f"/api/dash/ads?month={today()[:7]}").get_json()["report"]
    assert any(l["name"].startswith("Deleted shop") and l["adPageViews"] == 2 for l in rep["lines"])   # ad history kept


# ================================================================ migration from the single-shop version
def test_old_single_shop_database_is_adopted(tmp_path):
    path = tmp_path / "old.sqlite3"
    con = sqlite3.connect(path)
    con.executescript("""
      CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other', price REAL NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0, sold INTEGER NOT NULL DEFAULT 0, sizes TEXT NOT NULL DEFAULT '[]', colors TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '', badge TEXT NOT NULL DEFAULT '', shape TEXT NOT NULL DEFAULT 'top', images TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL);
      INSERT INTO products (id, name, created, updated) VALUES ('old-top', 'Old Top', 'x', 'x');
    """)
    con.commit()
    con.close()
    app = create_app({"TESTING": True, "DATABASE": str(path), "UPLOAD_FOLDER": str(tmp_path / "up")})
    data = app.test_client().get("/api/products").get_json()
    assert data["products"][0]["id"] == "old-top" and data["products"][0]["seller"] == "crochets-market"


# ================================================================ delivery fees
def test_delivery_fees(app, client, sinkor):
    opts = client.get("/api/sellers/sinkor-stitches").get_json()["seller"]["deliveryOptions"]
    assert [o["name"] for o in opts][:1] == ["Sinkor & Congo Town"] and opts[0]["fee"] == 2
    item = [{"id": "blossom-top", "name": "x", "size": "M", "color": "Candy Pink", "qty": 1}]
    # delivery needs one of the seller's options…
    r = client.post("/api/orders", json=cart_order(id="CM-261117-DF01", items=item, delivery="Delivery"))
    assert r.status_code == 400 and "delivery options" in r.get_json()["error"]
    # …and the fee comes from the seller's settings, not the browser
    o = cart_order(id="CM-261117-DF02", items=item, delivery="Delivery", deliveryOption=opts[2]["id"], deliveryFee=0.01)
    r = client.post("/api/orders", json=o).get_json()
    assert r["deliveryFee"] == 5 and r["total"] == 30                     # US$25 top + US$5 Paynesville
    saved = next(x for x in sinkor.get("/api/dash/data").get_json()["orders"] if x["id"] == "CM-261117-DF02")
    assert saved["deliveryFee"] == 5 and saved["deliveryOption"].startswith("Paynesville & ELWA")
    # pickup is always free, even if an option id is sent
    p = cart_order(id="CM-261117-DF03", items=item, delivery="Pickup", pickupSpot="ELWA Junction (by the supermarket)", deliveryOption=opts[2]["id"])
    r = client.post("/api/orders", json=p).get_json()
    assert r["deliveryFee"] == 0 and r["total"] == 25


def test_seller_edits_delivery_fees(client, sinkor):
    r = sinkor.post("/api/dash/store", json={"store": {"deliveryOptions": [
        {"name": "Sinkor", "fee": "2.5", "details": "Same day"}, {"name": "", "fee": 9}, {"name": "Far away", "fee": -1}]}})
    assert r.status_code == 400                                          # negative fee refused
    r = sinkor.post("/api/dash/store", json={"store": {"deliveryOptions": [
        {"name": "Sinkor", "fee": "2.5", "details": "Same day"}, {"name": "", "fee": 9}, {"name": "Gardnersville", "fee": ""}]}})
    opts = r.get_json()["seller"]["deliveryOptions"]
    assert [(o["name"], o["fee"]) for o in opts] == [("Sinkor", 2.5), ("Gardnersville", 0)] and all(o["id"] for o in opts)
    # switching delivery off hides the options from buyers but keeps them for the seller
    sinkor.post("/api/dash/store", json={"store": {"deliveryAvailable": False}})
    assert client.get("/api/sellers/sinkor-stitches").get_json()["seller"]["deliveryOptions"] == []
    assert len(sinkor.get("/api/dash/me").get_json()["seller"]["deliveryOptions"]) == 2
    bad = cart_order(id="CM-261117-DF04", delivery="Delivery")
    assert client.post("/api/orders", json=bad).status_code == 400       # this maker doesn't deliver now


# ================================================================ seller confirms on WhatsApp, sets delivery fee, gets alerts
def test_confirmation_required_before_moving_on(client, sinkor):
    client.post("/api/orders", json=cart_order())
    url = "/api/dash/orders/CM-261116-7KQ2"
    r = sinkor.patch(url, json={"changes": {"status": "Confirmed"}})
    assert r.status_code == 400 and "WhatsApp" in r.get_json()["error"]
    assert sinkor.patch(url, json={"changes": {"adminNote": "called her"}}).status_code == 200   # notes are fine
    r = sinkor.patch(url, json={"changes": {"status": "Confirmed", "confirmSent": True}}).get_json()
    assert r["ok"] and r["confirmedAt"]
    # once recorded, later status changes don't need it again
    assert sinkor.patch(url, json={"changes": {"status": "Paid"}}).status_code == 200
    # cancelling a brand-new order never needs it
    client.post("/api/orders", json=cart_order(id="CM-261118-CAN1"))
    assert sinkor.patch("/api/dash/orders/CM-261118-CAN1", json={"changes": {"status": "Cancelled"}}).status_code == 200


def test_seller_sets_delivery_fee(client, sinkor):
    item = [{"id": "blossom-top", "name": "x", "size": "M", "color": "Candy Pink", "qty": 1}]
    client.post("/api/orders", json=cart_order(id="CM-261118-FEE1", items=item))           # "Arrange with maker"
    r = sinkor.patch("/api/dash/orders/CM-261118-FEE1", json={"changes": {"deliveryFee": "3.5"}}).get_json()
    assert r["deliveryFee"] == 3.5 and r["total"] == 28.5
    saved = next(x for x in sinkor.get("/api/dash/data").get_json()["orders"] if x["id"] == "CM-261118-FEE1")
    assert saved["deliveryFee"] == 3.5 and saved["total"] == 28.5
    assert sinkor.patch("/api/dash/orders/CM-261118-FEE1", json={"changes": {"deliveryFee": -1}}).status_code == 400
    # pickup orders never get a fee
    client.post("/api/orders", json=cart_order(id="CM-261118-FEE2", items=item, delivery="Pickup",
                                               pickupSpot="ELWA Junction (by the supermarket)"))
    assert sinkor.patch("/api/dash/orders/CM-261118-FEE2", json={"changes": {"deliveryFee": 2}}).status_code == 400


def test_new_order_alerts(client, sinkor, manager, app):
    assert sinkor.get("/api/dash/pulse").get_json()["unseen"] == []
    client.post("/api/orders", json=cart_order(id="CM-261118-NEW1"))
    alerts = sinkor.get("/api/dash/pulse").get_json()["unseen"]
    assert [a["id"] for a in alerts] == ["CM-261118-NEW1"] and alerts[0]["customer"] == "Ama"
    assert [a["id"] for a in manager.get("/api/dash/pulse").get_json()["unseen"]] == ["CM-261118-NEW1"]
    manager.post("/api/dash/orders/CM-261118-NEW1/seen", json={})                   # the manager looking doesn't clear it
    assert len(sinkor.get("/api/dash/pulse").get_json()["unseen"]) == 1
    sinkor.post("/api/dash/orders/CM-261118-NEW1/seen", json={})
    assert sinkor.get("/api/dash/pulse").get_json()["unseen"] == []
    assert client.get("/api/dash/pulse").status_code == 401                 # sign-in required


# ================================================================ buyer receipts (no account)
def test_receipt_link_and_my_orders(client, sinkor):
    item = [{"id": "blossom-top", "name": "x", "size": "M", "color": "Candy Pink", "qty": 2}]
    r = client.post("/api/orders", json=cart_order(id="CM-261118-RC01", items=item)).get_json()
    key, url = r["receiptKey"], r["receiptUrl"]
    assert url == f"/r/CM-261118-RC01/{key}" and len(key) >= 16
    page = client.get(url)
    assert page.status_code == 200 and b"Order summary" in page.data and b"Pending" in page.data
    assert b"Blossom Crop Top" in page.data and b"US$50" in page.data
    assert "noindex" in page.headers["X-Robots-Tag"] and "no-store" in page.headers["Cache-Control"]
    assert client.get("/r/CM-261118-RC01/wrong-key").status_code == 404           # the key is required
    # status follows the order: once delivered it becomes a receipt
    sinkor.patch("/api/dash/orders/CM-261118-RC01", json={"changes": {"status": "Delivered", "confirmSent": True}})
    page = client.get(url)
    assert b"Receipt" in page.data and b"Delivered" in page.data and b"Leave a review" in page.data
    # the seller's dashboard knows the link (it goes in the WhatsApp confirmation)
    o = next(x for x in sinkor.get("/api/dash/data").get_json()["orders"] if x["id"] == "CM-261118-RC01")
    assert o["receiptUrl"] == url
    # "My orders": only orders with the right key come back; private notes never do
    sinkor.patch("/api/dash/orders/CM-261118-RC01", json={"changes": {"adminNote": "secret seller note"}})
    mine = client.post("/api/orders/mine", json={"orders": [{"id": "CM-261118-RC01", "key": key},
                                                            {"id": "CM-261118-RC01", "key": "nope"}, "junk"]}).get_json()
    assert [m["id"] for m in mine["orders"]] == ["CM-261118-RC01"] and mine["orders"][0]["statusLabel"] == "Delivered"
    assert b"secret seller note" not in client.post("/api/orders/mine", json={"orders": [{"id": "CM-261118-RC01", "key": key}]}).data
    assert client.get("/orders").status_code == 200


def test_find_order_by_phone(client, app):
    from market import accounts
    client.post("/api/orders", json=cart_order(id="CM-261118-RC02"))
    r = client.post("/api/orders/find", json={"orderId": "cm-261118-rc02", "phone": "+231 770 123 456"}).get_json()
    assert r["ok"] and r["url"].startswith("/r/CM-261118-RC02/")
    assert client.post("/api/orders/find", json={"orderId": "CM-261118-RC02", "phone": "0880 999 999"}).status_code == 404
    for _ in range(5):
        client.post("/api/orders/find", json={"orderId": "CM-261118-RC02", "phone": "0880 999 999"})
    assert client.post("/api/orders/find", json={"orderId": "CM-261118-RC02", "phone": "0770 123 456"}).status_code == 429
    with app.app_context():
        accounts.reset_throttle()


def test_old_orders_get_receipt_keys(app):
    from market.db import get_db, init_db
    with app.app_context():
        db = get_db()
        db.execute("UPDATE orders SET receipt_key = NULL")
        db.commit()
        init_db()
        assert db.execute("SELECT COUNT(*) FROM orders WHERE receipt_key IS NULL OR receipt_key = ''").fetchone()[0] == 0
