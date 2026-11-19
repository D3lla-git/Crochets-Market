# Changelog

## 4.4.0 — 2026-11-18

### Buyer receipts (no account needed)
- Every order gets a **private receipt link** (`/r/<order>/<secret key>`). It shows the status (Pending → Confirmed → Paid → Delivered, or Cancelled), the seller and buyer, the handoff, the items, the delivery fee and the total in US$ and L$, plus the deposit for custom work.
- While an order is in progress the page is titled *Order summary*. Once it's paid or delivered it becomes a *Receipt*.
- **Save PDF** prints a clean white receipt in any theme. **Copy link** and **Message the seller** are also on the page.
- **My orders** (`/orders`) lists every order sent from that phone or computer, grouped into *In progress*, *Completed* and *Cancelled*. *Find an order* (order number + phone) recovers orders made on another device. Wrong guesses are rate-limited.
- Links to My orders are on the "Sent!" screen (with a *View receipt* button per order), in the header, in the mobile bottom bar and in the footer.
- The seller's WhatsApp confirmation now ends with the buyer's receipt link.
- Privacy: receipts are never indexed, cached, shown with ads or leaked through the Referer header. The seller's private notes are never shown. Existing orders were given receipt links automatically.

## 4.3.0 — 2026-11-18

### Orders: confirm on WhatsApp
- In the order window, sellers can **set or change the delivery fee** for orders that aren't pickup, based on the buyer's area. The total updates as they type. Pickup orders can never have a fee.
- Before moving an order past *New* (except to cancel), the seller must **send a confirmation on WhatsApp**: "Hi Buyer, this is Shop name on Crochets Market | your order #CM-… | Delivery fees: … | Total: …". A deposit line, such as "Deposit (30%): …", is added **only for custom work**: a custom request, or the made-to-order pieces in a cart. The buyer's order message follows the same rule. The Save button becomes *Send on WhatsApp & save*. The date the confirmation was sent is recorded.

### New-order alerts
- A **bell** in the dashboard shows orders the seller hasn't opened yet. The dashboard checks every 30 seconds and whenever the tab comes back. A new order plays a chime, shows a message on screen and, if the seller turns on *phone alerts*, sends a phone or desktop notification. Tapping the notification opens the Orders page.
- Opening an order clears its alert. The manager sees alerts for the whole marketplace.

### Fixes
- Every Save in the order window now sends the buyer the WhatsApp message through the green WhatsApp *Save* button. Cancelling doesn't send anything.
- **Flyers can be shared to Stories.** *Share to Story / Status* sends the image on its own, with no caption, so Instagram and Facebook offer Stories and WhatsApp offers *My status* instead of only direct messages. The product link is copied for a Link sticker. *Send in a chat* still sends the image with the link, and flyers are now saved as JPEG.
- **WhatsApp messages no longer show "?" symbols.** Messages now use plain text with WhatsApp *bold* instead of emoji, and links go through `api.whatsapp.com/send`.
- The new-order count in the sidebar is now **gold with dark text**, so it's readable in dark mode.
- Prices with cents always show two decimals (US$7.50, not US$7.5).
- Fixed a script error when choosing a delivery area in the cart.

## 4.2.0 — 2026-11-17

### Delivery fees
- Sellers can add several **delivery options**, each with its own area name, fee and details, under *Settings → Delivery fees*.
- At checkout, buyers choose an option for each maker. The fee and its details appear in the cart breakdown and are added to the total. **Pick-up is always free.**
- The order records the chosen option and fee, and the WhatsApp message and dashboard show them.

### Footer
- The footer is now organised into clear sections: brand, **Shop**, **For makers**, **Help & legal** and **Contact**, followed by a bottom bar with the copyright and credits.
- Links are in proper lists and the contact details have icons. Social links appear when they are configured.
- Layout: five columns on desktop, three on tablet and two on phones.

### Mobile
- The header, buttons and cards were tidied at phone widths, and nothing scrolls sideways at 360–390px.

## 4.1.0 — 2026-11-17

### Reports
- Sellers can download their dashboard as **Excel** or **PDF** for the last 30 days, 90 days, 12 months or all time, from the Overview or *Settings & help*.
  - **Excel:** sheets for Summary, Monthly (with chart), Orders, Crochets/stock, Best sellers and Page views, in US$ and L$.
  - **PDF:** a branded report with key figures, a monthly sales chart, best sellers, orders and stock.
- The manager can download the same report for the whole marketplace (with a Sellers sheet) or for any one seller.
- Customer text is always written to Excel as plain text, never as a formula. Reports are private and never cached.

### Company structure
- Crochets Market is presented as a **subsidiary of LukeTrust LLC**, its parent company, in:
  - **Terms of Use:** who runs it, brand ownership, advertising revenue, transfers within the group, and enforcement.
  - **Privacy Policy:** the parent company's shared services and protections.
  - **Seller Policy and Cookie Policy.**
  - **The site footer and every report.**
- Configurable with `PARENT_COMPANY`. The old `LEGAL_ENTITY` is still read.

## 4.0.0 — 2026-11-16 — Multi-seller marketplace

### Accounts & dashboards
- **One login per seller plus platform-manager logins.** Sign-in is now by email and password. Changing a password signs that account out everywhere.
- **Per-seller dashboards:** sales, crochets available, orders, pending, pieces sold, stock value, custom work, page views, unique visitors and product opens. Every query is scoped to the signed-in seller on the server.
- **Manager dashboard:**
  - figures for the whole marketplace or any single seller (via the seller picker), and a "Sellers at a glance" table
  - seller approval, suspension, phone verification, shop editing, password resets, review moderation and manually added sellers
- **Seller sign-up page** at `/sell`. New shops wait for approval by default (`AUTO_APPROVE_SELLERS`).

### Page views & ad revenue
- Server-side, cookie-free page-view counting per seller and product, with bot filtering, daily-rotating visitor hashes kept 90 days, and signed-in users excluded.
- **Ad revenue report:** enter the month's AdSense earnings and they are split per seller by ad-page views, with CSV export.
- Optional **AdSense**: cookie-consent banner (ads load only after "Accept all"), ad slots, `/ads.txt`, and a CSP that relaxes only on public pages.
- `sitemap.xml` lists every shop and product page. `robots.txt` points to it.

### Marketplace features
- **Live catalogue link per seller** (`/s/<shop>`) and shareable product pages (`/p/<id>`) with social previews.
- **Maker directory** on the homepage.
- **Cart split per seller.** Each seller gets their own order and a structured WhatsApp message.
- **Made-to-order items:** buyers must pick colours and a "needed by" date. Turnaround time is shown on the item.
- **Custom slots per week and deposit tracker.** Shops show slots open this week and their MoMo/Orange Money deposit rules. The server enforces the limit.
- **Pickup-zone presets:** sellers list safe public spots and days, and buyers choose them at checkout. The server validates the choice.
- **Trust badges:** verified phone, completed handoffs, and reviews from verified buyers only (the order must be Delivered).
- **One-click status flyers:** 1080×1920 images with photo, price, "Available now" and the shop link, downloadable or shareable from the dashboard.

### Legal
- Terms of Use, Privacy Policy, Cookie Policy, Seller Policy and Meetup Safety Guide, written for how the platform works. Linked from every footer and from sign-up.

### Upgrading
- Existing products and orders are moved to a default "Crochets Market" shop automatically.
- The old single admin password is replaced by `MANAGER_EMAIL` + `ADMIN_PASSWORD`.
- API routes moved from `/api/admin/*` to `/api/dash/*`.

## 3.1.0 — 2026-11-16 — Crochets Market

### Rebrand
- The platform is now called **Crochets Market** everywhere: pages, app name, icons, e-mails and order exports. New order numbers start with `CM-`. Older `AC-` numbers are still accepted.
- Internal names now match: the Python package is `market/`, the JS namespace is `window.Market`, and the env var is `APP_ENV` (`AUGS_ENV` still works).

### Dual currency: US$ with L$ equivalent
- Every price shows both currencies: product cards, product page, cart, totals, the WhatsApp/e-mail order message, and dashboard figures.
- The exchange rate (L$ per US$1) is set by the seller under *Settings & help* and saved in the database. The starting value comes from `USD_TO_LRD` in `.env` (171, the mid-market rate in early November 2026).
- Each order stores the rate in force when it was placed, so past totals don't change when the rate does.
- The product editor and the custom-order quote field show the L$ amount live while typing. The CSV export has US$, L$ and rate columns.
- Custom-request budgets can be given in either currency.

### Unisex look
- A new palette replaces the pink: deep teal and steel blue on warm neutrals. CSS tokens are renamed from `--pink*` to `--accent*`.
- The logo and app icons are recoloured to match. Placeholder drawings and the theme colour are updated too.

### New: About the developer
- `/about/developer` presents Mandella L. Wleh-Sam: profile, highlights, experience, certifications, toolkit, projects (Crochets Market and D.A.R.T) and contact. It's linked from the shop footer and the dashboard.

## 3.0.0 — 2026-11-14 — Python + Flask

The app is now a **Flask** application. The Google Apps Script backend and Google Sheets storage are replaced.

### Architecture
- **Backend:** Flask app factory (`augs/`) with a JSON API blueprint, run with `python app.py` (local) or `waitress`/`gunicorn wsgi:app` (production).
- **Storage:** SQLite database plus an uploads folder, both inside `instance/`. Product photos and customers' style photos are stored on the server instead of in Google Drive.
- **Settings:** `.env` (see `.env.example`) replaces `config.js`. The browser still gets the public shop details from the generated `/config.js`.
- **Sign-in:** HttpOnly, SameSite session cookie (Flask session), optionally lasting 30 days. Supports a hashed password (`flask --app app hash-password`).
- **Order e-mails:** optional SMTP, sent in the background.
- Pages are Jinja templates. The existing JavaScript frontend is kept and talks to `/api/...`.

### Security
- Customers' style photos are only served to the signed-in seller. Before, they were public Drive links.
- Uploaded images are checked by file signature (JPEG/PNG/WebP/GIF), not by name or MIME type.
- Cross-site write requests are blocked (Origin check plus JSON-only API). Security headers (CSP, HSTS in production, nosniff, frame denial) are sent by Flask.
- Production mode refuses to run the dashboard without a real password.

### Removed
- Browser-only "demo mode" (running locally with sample data replaces it) and the Google Apps Script backend.

### Tooling
- `requirements.txt`, `requirements-dev.txt`, pytest suite (18 tests), `.gitignore`, `.env.example`.

## 2.0.0 — 2026-11-14

### Security
- **Dashboard sign-in uses expiring session tokens.** Before, the admin password was saved in the browser (`localStorage`) and sent with every request. Now only a signed token is kept, valid for 12 hours, or 30 days with "Keep me signed in". Any password saved by the old version is deleted.
- **Default password refused.** The backend won't sign anyone in until `ADMIN_PASSWORD` is changed to at least 10 characters.
- **Sign-in throttling.** After 10 wrong passwords in 15 minutes, sign-in pauses. Each wrong attempt is also slowed down.
- **Spreadsheet formula injection blocked.** Customer text starting with `= + - @` is stored as plain text in the Sheet and in CSV exports.
- **Server-side validation of all input.** Order numbers, names, phones, items, quantities, measurements, product fields, colours, image URLs and photo type/size are checked and size-limited. Orders are rebuilt from clean fields instead of storing whatever the browser sent. Before, an oversized payload could overflow the Sheet's 50,000-character cell limit.
- **Safer rendering.** Colour values and image URLs are sanitised before they reach `style` or `src` attributes. Social links must be `https://`.
- Constant-time password and token comparison. Server errors are logged in Apps Script instead of being shown to visitors.
- Added `_headers` (Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) and `robots.txt`. `admin.html` is `noindex`.

### Fixes
- The shop no longer **empties the customer's cart and favourites** when the collection fails to load (e.g. a bad connection).
- Opening the cart before products have loaded no longer crashes.
- Text typed into the product editor is no longer lost when a photo upload finishes.
- The backend lock uses `tryLock`, so a busy moment returns a friendly "try again" instead of an unhandled error.
- A wrong deployment (HTML instead of JSON) or a timeout now shows a clear message.

### Accessibility
- Modals and the cart drawer keep keyboard focus inside them, mark the page behind as `inert`, close with Escape and return focus to where it was.
- Dialogs have accessible names. Decorative icons are hidden from screen readers. Form errors set `aria-invalid`.
- Clickable cards and rows work with Enter **and** Space. The current page is announced in navigation.
- Skip link, `<noscript>` message, and `prefers-reduced-motion` support across the whole site.

### Improvements
- **Download orders as a real CSV file** (opens cleanly in Excel / Google Sheets), replacing copy-to-clipboard.
- Product list is cached on the server for 2 minutes, so the shop loads faster.
- Order emails list the customer's details and items in a cleaner format, and are skipped while `SELLER_EMAIL` is still the example address.
- Social-sharing preview tags (Open Graph) for links shared on WhatsApp/Facebook.
- Service worker caches the new CSS/JS files and only stores successful same-origin responses.

### Code structure
- Inline CSS and JS moved out of the HTML into `css/` and `js/`. Shared design tokens are in `css/base.css`, and shared helpers in `js/core.js`, no longer copied into each page.
- Backend moved to `backend/augs-backend.gs`.
- Readable, commented code. Still no build step or dependencies.
