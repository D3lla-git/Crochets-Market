# Crochets Market — a marketplace for Liberia's crochet makers

Python + Flask. Every maker gets their own shop, their own dashboard and their own link; buyers order straight to the maker's WhatsApp and meet at safe public spots.

## What's inside

**Buyers** (no account needed)
- **Home (`/`)** — searchable directory of makers (verified phone, ratings, completed handoffs, open custom slots) and every piece that's available *right now*, priced in **US$ with the L$ equivalent**.
- **Shop pages (`/s/<shop>`)** — one clean link per maker for their Instagram/TikTok bio and WhatsApp Status: live stock, pickup spots &amp; days, deposit rules, reviews.
- **Product pages (`/p/<id>`)** — shareable, with proper previews on WhatsApp/Facebook.
- **Structured orders** — the cart is split per maker; each maker gets one tidy pre-filled WhatsApp message (items, sizes, colours, total US$/L$, pickup spot &amp; day, deposit instructions) and the order lands in their dashboard.
- **Made-to-order pieces** — buyers must choose colours and a "needed by" date before adding them; **custom-style requests** with photos and measurements go to a chosen maker.
- **Verified reviews** — only after the maker marks an order *Delivered*, using the order number + phone.
- Installable phone app, cookie-consent banner, legal pages and a meetup safety guide.

**Sellers** (`/sell` to sign up, `/admin` to sign in)
- Their own **dashboard**: total sales, crochets available, orders, pending payments, pieces sold, stock value, custom work, low stock — plus **page views, unique visitors and product opens** for their shop.
- **Download reports** as **Excel** (Summary, Monthly, Orders, Crochets, Best sellers, Page views — with US$ and L$ columns and a chart) or a branded **PDF** (key figures, monthly sales chart, best sellers, orders, stock) for the last 30 days, 90 days, 12 months or all time — from the Overview or *Settings & help*.
- Crochets (photos, sizes, colours, made-to-order + turnaround), orders (New → Confirmed → Paid → Delivered), shop settings (profile, WhatsApp, custom slots per week, MoMo/Orange Money deposit, pickup spots &amp; days, delivery), **one-tap status flyers** (1080×1920 image with price, "Available now" and the shop link), shop link sharing, CSV export.

**Platform manager** (`/admin` with the manager login)
- Everything across the marketplace, or **any one seller's dashboard** via the seller picker.
- Approve, suspend, verify sellers; edit their shops; reset passwords; moderate reviews; add sellers.
- **Ad revenue** — enter each month's AdSense earnings and see them split per seller by page views.
- Exchange rate (L$ per US$), CSV exports, and Excel/PDF reports for the whole marketplace (with a per-seller sheet) or any one seller.

**Company:** Crochets Market is a subsidiary of **LukeTrust LLC** (the parent company, set with `PARENT_COMPANY`). This appears in the legal pages, the site footer and every report.

## 1. Run it on your computer

Python 3.10+.

```powershell
cd Crochets-Market
python -m pip install -r requirements.txt
python app.py
```

- Marketplace: <http://localhost:5000>
- Dashboard: <http://localhost:5000/admin>
  - manager: `admin@crochets.local` / `admin`
  - sellers: `sinkor@demo.local`, `paynesville@demo.local`, `bushrod@demo.local` / `demo-seller-123`

These demo logins exist **only on your computer** — they're refused in production. Start with `python app.py --no-seed` to skip the demo sellers.

## 2. Settings — `.env`

Copy `.env.example` to `.env`. The important ones:

| Setting | What |
|---|---|
| `MANAGER_EMAIL`, `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`) | The platform-manager login, created on first start. Or run `flask --app app create-manager you@example.com`. |
| `SHOP_EMAIL`, `SHOP_WHATSAPP` | The platform's own contact details (footer, legal pages). Each seller sets their own WhatsApp in their dashboard. |
| `USD_TO_LRD` | Starting exchange rate; change it later in the dashboard. |
| `AUTO_APPROVE_SELLERS` | `false` = new sign-ups wait for your approval. |
| `SITE_URL` | Your real address, e.g. `https://crochetsmarket.com` (sitemap, flyers, share links). |
| `PARENT_COMPANY` | The parent company (default **LukeTrust LLC**); Crochets Market is described as its subsidiary in the legal pages, footer and reports. |
| `ADSENSE_CLIENT`, `ADSENSE_SLOT` | Turn on Google AdSense once approved. |
| `SMTP_*`, `SELLER_EMAIL` | Optional order e-mails to each seller (and a copy to you). |
| `APP_ENV=production` | On the real website: secure cookies, no demo logins. |

## 3. AdSense &amp; per-seller ad revenue

AdSense pays one total for the whole site; it can't tell you what each seller earned. Crochets Market measures it for you:

1. Every **page load** of a seller's shop page (`/s/…`) or product page (`/p/…`) is counted for that seller, per day. Home, legal and info pages count for the platform. Bots, crawlers and signed-in sellers/managers are not counted. Unique visitors are counted with a daily-rotating hash — **no cookies**.
2. In **Dashboard → Ad revenue**, pick the month, type the AdSense earnings, and you get each seller's share:
   `seller revenue = month's earnings × seller's ad-page views ÷ all ad-page views`.
   Download it as CSV for your records or payouts.
3. Each seller also sees their own views on their Overview.

**Going live with AdSense**
1. Deploy with a real domain and `SITE_URL`, apply for AdSense, add the site.
2. Put `ADSENSE_CLIENT=ca-pub-…` (and a responsive display `ADSENSE_SLOT`) in `.env`, restart. The app then serves `/ads.txt`, shows a cookie banner, and loads ads **only for visitors who tap "Accept all"**.
3. For visitors from the EEA/UK/Switzerland Google also requires a certified consent message — turn on Google's own in AdSense → *Privacy &amp; messaging*.
4. Optional: in AdSense you can add **URL channels** for your biggest shops (e.g. `crochetsmarket.com/s/sinkor-stitches`) to get Google's own per-shop earnings figures alongside ours.

## 4. Legal pages

`/legal/terms`, `/legal/privacy`, `/legal/cookies`, `/legal/sellers`, `/legal/safety` are written for how this platform actually works (independent sellers, WhatsApp orders, in-person handoffs, mobile-money deposits, cookie-free analytics, consent-based ads). They live in `market/templates/legal/`. They describe Crochets Market as a subsidiary of LukeTrust LLC (parent company), which may provide shared services, own the brand, receive advertising revenue and enforce the terms. **They are a solid starting draft, not legal advice — have a lawyer in Liberia review them before launch**, and update `LEGAL_UPDATED` whenever you change them.

## 5. Put it online

A Flask app needs a host that runs Python, e.g. **PythonAnywhere** (WSGI file: `from wsgi import app as application`) or **Render / Railway / Fly.io** (`waitress-serve --listen=0.0.0.0:$PORT wsgi:app`, with a persistent disk for `instance/`). Always set `APP_ENV=production`, `MANAGER_EMAIL` + a strong password, and `SITE_URL`.

## 6. Backups

Everything is in **`instance/`**: `augs.sqlite3` (database), `uploads/products/` (product photos, public), `uploads/orders/` (buyers' style photos, private), `secret_key`. Copy the folder regularly.

## 7. Security notes

- Each seller can only see and change **their own** shop, products, orders and buyers' photos — enforced on the server.
- Passwords are hashed; changing one signs that account out everywhere; 10 wrong passwords in 15 minutes pauses sign-in.
- Prices are re-checked on the server, stock and custom slots are enforced, all input is validated, uploads are checked by their real bytes.
- Strict Content-Security-Policy (relaxed on public pages only when AdSense is on), cross-site requests blocked.

---

## For developers

```
app.py / wsgi.py        run locally / production entry point
market/
  __init__.py           create_app()
  config.py             settings from .env
  db.py                 SQLite schema + migrations, seller/product/order shapes, demo data
  accounts.py           manager & seller logins, throttle, CLI: create-manager, hash-password
  api.py                /api (public) and /api/dash (signed-in, scoped per seller)
  analytics.py          per-seller page-view counting + ad-revenue allocation
  reports.py            Excel (openpyxl) and PDF (reportlab) dashboard reports
  validation.py         input cleaning
  uploads.py, notify.py photos, order e-mails
  views.py              pages: /, /s/<slug>, /p/<id>, /sell, /legal/<doc>, /admin, sitemap, ads.txt
  templates/            index.html (home/store/product), admin.html, sell.html, layout.html, legal/, about_developer.html
  static/js/            core, api, art, shop, admin, flyer (status flyers), consent (cookies + AdSense), sell
tests/                  pytest — 36 tests incl. seller isolation, revenue split, migration
```

`python -m pip install -r requirements-dev.txt && python -m pytest`. After changing files in `market/static/`, bump `VERSION` in `sw.js`.
