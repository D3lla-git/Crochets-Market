/* =====================================================================
   Crochets Market — dashboard (admin.html)
   • Sellers see only their own shop: sales, stock, orders, views, settings.
   • The platform manager sees everything, can switch the figures to any one
     seller, approves/verifies sellers and splits advertising revenue.
   ===================================================================== */
(function () {
  "use strict";

  const { SHOP, $, $$, cssId, esc, money, usd, lrd, priceHTML, rateText, getRate, setRate, plural, waNumber,
    store, toast, isImageFile, compressImage, layers, ICON: BASE_ICON } = window.Market;
  const API = window.API;
  const art = window.crochetArt;

  /* ---------------- constants ---------------- */
  const STATUSES = ["New", "Confirmed", "Paid", "Delivered", "Cancelled"];
  const SALE = ["Paid", "Delivered"];
  const OPEN = ["New", "Confirmed"];
  const LOW = Number(SHOP.lowStockAt ?? 2);
  const MAX_IMAGES = 6;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const SIZE_PRESETS = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "One size", "0-6m", "6-12m", "1-2y", "2-3y", "3-4y", "5-6y", "7-8y"];
  const CAT_PRESETS = ["Tops", "Dresses", "Skirts", "Sets", "Cardigans", "Trousers", "Swimwear", "Kids", "Accessories", "Home"];
  const BADGES = ["", "New", "Bestseller", "Hot", "Premium", "Sale", "Limited"];
  const SHAPES = [["top", "Crop top"], ["halter", "Halter top"], ["dress", "Dress"], ["maxi", "Maxi dress"], ["cardigan", "Cardigan"],
    ["skirt", "Skirt"], ["set", "Two-piece set"], ["hat", "Hat"], ["bag", "Bag"], ["romper", "Romper"]];

  const NAV = [
    { id: "dash", label: "Overview", icon: "fa-gauge-high", roles: ["seller", "manager"], tab: true },
    { id: "sellers", label: "Sellers", icon: "fa-store", roles: ["manager"], tab: true },
    { id: "products", label: "Crochets", icon: "fa-shirt", roles: ["seller", "manager"], tab: true },
    { id: "orders", label: "Orders", icon: "fa-bag-shopping", roles: ["seller", "manager"], tab: true, badge: true },
    { id: "store", label: "My shop", icon: "fa-sliders", roles: ["seller"], tab: true },
    { id: "ads", label: "Ad revenue", icon: "fa-sack-dollar", roles: ["manager"], tab: false },
    { id: "more", label: "Settings & help", short: "More", icon: "fa-gear", roles: ["seller", "manager"], tab: true }
  ];

  const ICON = {
    money: '<i class="fa-solid fa-money-bill-wave" aria-hidden="true"></i>',
    box: '<i class="fa-solid fa-box-open" aria-hidden="true"></i>',
    bag: '<i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>',
    clock: '<i class="fa-regular fa-clock" aria-hidden="true"></i>',
    tag: '<i class="fa-solid fa-tag" aria-hidden="true"></i>',
    spark: '<i class="fa-solid fa-scissors" aria-hidden="true"></i>',
    alert: '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>',
    layers: '<i class="fa-solid fa-layer-group" aria-hidden="true"></i>',
    eye: '<i class="fa-regular fa-eye" aria-hidden="true"></i>',
    users: '<i class="fa-solid fa-user-group" aria-hidden="true"></i>',
    pointer: '<i class="fa-solid fa-hand-pointer" aria-hidden="true"></i>',
    search: '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>',
    photo: '<i class="fa-regular fa-images" aria-hidden="true" style="font-size:1.8rem;color:var(--blue)"></i>',
    wa: BASE_ICON.whatsapp
  };

  store.remove("pw");
  store.remove("session");

  /* ---------------- state ---------------- */
  let ME = null;               // { email, name, role }
  let MYSELLER = null;         // seller profile (seller role)
  let products = [], orders = [], sellers = [], analytics = {}, myReviews = [];
  let due = [], RULES = { resolveDays: 14, graceDays: 3, warnDays: 3 };
  let scope = "all";           // manager: "all" or a seller id (string)
  let view = "dash";
  let pFilter = "all", pQuery = "";
  let oFilter = "All", oType = "all", oQuery = "";
  let sFilter = "all", sQuery = "";
  let adMonth = new Date().toISOString().slice(0, 7);

  const isManager = () => ME && ME.role === "manager";
  const sellerById = (id) => sellers.find((s) => String(s.id) === String(id)) || (MYSELLER && String(MYSELLER.id) === String(id) ? MYSELLER : null);
  const sellerName = (id) => sellerById(id)?.name || "—";
  const storeUrl = (slug) => `${SHOP.siteUrl || location.origin}/s/${slug}`;
  const inScope = (x) => !isManager() || scope === "all" || String(x.sellerId) === String(scope);
  const scopedProducts = () => products.filter(inScope);
  const scopedOrders = () => orders.filter(inScope);
  const scopedSeller = () => (isManager() ? (scope === "all" ? null : sellerById(scope)) : MYSELLER);
  const scopedViews = () => {
    if (!isManager()) return analytics.mine || null;
    return scope === "all" ? analytics.platform : (analytics.bySeller || {})[scope] || emptyViews();
  };
  const emptyViews = () => ({ days: 30, storeViews: 0, productPageViews: 0, productOpens: 0, adPageViews: 0, uniqueVisitors: 0, series: [], topProducts: [] });

  /* ---------------- helpers ---------------- */
  const pById = (id) => products.find((p) => p.id === id);
  const pMedia = (p) => (p.images && p.images.length ? `<img src="${esc(p.images[0])}" alt="" loading="lazy" decoding="async">` : art(p));
  const orderValue = (o) => (o.type === "cart" ? Number(o.total) || 0 : o.quote != null ? Number(o.quote) : 0);
  const num = (n) => (Number(n) || 0).toLocaleString();

  function fmtDate(iso, withTime) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
    return withTime ? `${date} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : date;
  }
  function ago(iso) {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 604800) return Math.floor(s / 86400) + "d ago";
    return fmtDate(iso);
  }
  const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  function stockLabel(p) {
    if (p.stock <= 0) return `<span class="stockpill out">Sold out</span>`;
    if (p.stock <= LOW) return `<span class="stockpill low">Low · ${p.stock} left</span>`;
    return `<span class="stockpill ok">${p.stock} in stock</span>`;
  }
  const itemsSummary = (o) =>
    o.type === "cart"
      ? (o.items || []).map((i) => `${i.qty}× ${i.name}`).join(", ")
      : `Custom ${o.custom?.type || "style"}${o.custom?.forWho ? " · " + o.custom.forWho : ""}`;
  const searchBox = (id, label, placeholder, value) =>
    `<label class="search"><span class="sr">${label}</span>${ICON.search}<input class="in" id="${id}" type="search" placeholder="${placeholder}" value="${esc(value)}"></label>`;
  const stepper = (p) =>
    `<div class="stepper"><button type="button" data-stock="${esc(p.id)}" data-d="-1" aria-label="One less ${esc(p.name)}">−</button><span aria-live="polite">${p.stock}</span><button type="button" data-stock="${esc(p.id)}" data-d="1" aria-label="One more ${esc(p.name)}">+</button></div>`;
  const statusPill = (s) => `<span class="spill sp-${esc(s)}">${{ pending: "Waiting for approval", active: "Live", suspended: "Suspended" }[s] || esc(s)}</span>`;

  async function guard(promise, okMsg) {
    let r;
    try { r = await promise; } catch (e) { toast(e?.message || "Something went wrong"); return null; }
    if (r && r.code === "auth") { signOutLocal(); toast("Your session ended — please sign in again"); return null; }
    if (!r || r.ok === false) { toast(r?.error || "Something went wrong"); return null; }
    if (okMsg) toast(okMsg);
    return r;
  }

  async function copy(text, msg = "Copied") {
    try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt("Copy this:", text); }
  }

  /* ---------------- stats ---------------- */
  function stats(ps = scopedProducts(), os = scopedOrders()) {
    const active = ps.filter((p) => p.active);
    const sales = os.filter((o) => SALE.includes(o.status));
    const open = os.filter((o) => OPEN.includes(o.status));
    return {
      totalSales: sales.reduce((s, o) => s + orderValue(o), 0),
      salesCount: sales.length,
      available: active.reduce((s, p) => s + p.stock, 0),
      styles: active.length,
      stockValue: active.reduce((s, p) => s + p.stock * p.price, 0),
      orders: os.length,
      newOrders: os.filter((o) => o.status === "New").length,
      pendingValue: open.reduce((s, o) => s + orderValue(o), 0),
      pendingCount: open.length,
      sold: ps.reduce((s, p) => s + p.sold, 0),
      custom: os.filter((o) => o.type === "custom" || o.customWork).length,
      customNew: os.filter((o) => (o.type === "custom" || o.customWork) && o.status === "New").length,
      low: active.filter((p) => p.stock > 0 && p.stock <= LOW),
      out: active.filter((p) => p.stock <= 0)
    };
  }

  function monthly(os, n = 6) {
    const now = new Date();
    const months = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + "-" + d.getMonth(), label: d.toLocaleDateString(undefined, { month: "short" }),
        full: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), value: 0, count: 0 });
    }
    os.filter((o) => SALE.includes(o.status) && o.createdAt).forEach((o) => {
      const d = new Date(o.createdAt);
      const m = months.find((x) => x.key === d.getFullYear() + "-" + d.getMonth());
      if (m) { m.value += orderValue(o); m.count++; }
    });
    return months;
  }

  /* ---------------- navigation ---------------- */
  const allowed = () => NAV.filter((n) => n.roles.includes(ME.role));

  function buildNav() {
    const items = allowed();
    $("#sideNav").innerHTML = items.map((n) => `<button class="nav-btn" type="button" data-view="${n.id}"><i class="fa-solid ${n.icon}" aria-hidden="true"></i>${n.label}${n.badge ? '<span class="pill hidden" data-new-count></span>' : ""}</button>`).join("");
    $("#tabNav").innerHTML = items.filter((n) => n.tab).map((n) => `<button type="button" data-view="${n.id}"><i class="fa-solid ${n.icon}" aria-hidden="true"></i>${n.short || n.label}${n.badge ? '<span class="dot hidden" data-new-count></span>' : ""}</button>`).join("");
    $("#sideRole").textContent = isManager() ? "Platform manager" : "Seller dashboard";
    $("#sideName").textContent = isManager() ? SHOP.name : MYSELLER?.name || SHOP.name;
    $("#viewStore").href = isManager() ? "/" : MYSELLER ? `/s/${MYSELLER.slug}` : "/";
    $("#scopeWrap").classList.toggle("hidden", !isManager());
  }

  function fillScope() {
    if (!isManager()) return;
    $("#scope").innerHTML = `<option value="all">All sellers</option>` +
      sellers.map((s) => `<option value="${s.id}" ${String(s.id) === String(scope) ? "selected" : ""}>${esc(s.name)}${s.status !== "active" ? ` (${s.status})` : ""}</option>`).join("");
    $("#scope").value = scope;
  }

  function go(v) {
    const n = allowed().find((x) => x.id === v) || allowed()[0];
    view = n.id;
    $("#viewTitle").textContent = n.label;
    document.title = `${n.label} · ${SHOP.name} Dashboard`;
    $$("[data-view]").forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    render();
    window.scrollTo({ top: 0 });
    try { history.replaceState(null, "", "#" + view); } catch { /* ignore */ }
  }

  function render() {
    const s = stats();
    $$("[data-new-count]").forEach((e) => {
      e.textContent = s.newOrders;
      e.classList.toggle("hidden", !s.newOrders);
      e.setAttribute("aria-label", `${s.newOrders} new`);
    });
    $("#pendingBanner").classList.toggle("hidden", !(MYSELLER && MYSELLER.status === "pending"));
    renderDueBanner();
    ({ dash: renderDash, sellers: renderSellers, products: renderProducts, orders: renderOrders, store: renderStore, ads: renderAds, more: renderMore })[view]();
  }

  /* ---------- reporting sales: due dates, warnings, suspension ---------- */
  const dueText = (d) => d < 0 ? `${plural(-d, "day")} overdue` : d === 0 ? "due today" : `due in ${plural(d, "day")}`;
  const dueChip = (o) => {
    if (!["New", "Confirmed", "Paid"].includes(o.status) || !o.dueAt) return "";
    const d = Math.round((new Date(o.dueAt + "T00:00:00") - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00")) / 864e5);
    const cls = d < 0 ? "late" : d <= RULES.warnDays ? "soon" : "";
    return `<span class="due-chip ${cls}" title="Mark Delivered (sold) or Cancelled by ${esc(o.dueAt)}">${dueText(d)}</span>`;
  };

  function renderDueBanner() {
    const box = $("#dueBanner");
    if (!box) return;
    if (MYSELLER && MYSELLER.status === "suspended") {
      box.className = "banner bad";
      box.innerHTML = `<i class="fa-solid fa-ban" aria-hidden="true"></i><span><b>Your shop is suspended.</b> ${esc(MYSELLER.suspendReason || "")}
        It's hidden from the marketplace and you can't list pieces. Mark every open order <b>Delivered (sold)</b> or <b>Cancelled</b>, then email <a href="mailto:${esc(SHOP.email)}">${esc(SHOP.email)}</a> to reactivate it.</span>`;
      return;
    }
    const urgent = due.filter((d) => d.daysLeft <= RULES.warnDays);
    if (!urgent.length) { box.className = "banner hidden"; box.innerHTML = ""; return; }
    const late = urgent.filter((d) => d.daysLeft < 0);
    box.className = `banner ${late.length ? "bad" : ""}`;
    box.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span><b>${late.length ? `${plural(late.length, "order")} overdue` : `${plural(urgent.length, "order")} due soon`} — tell us if they sold.</b>
      Mark each order <b>Delivered (sold)</b> or <b>Cancelled</b>. Orders left open ${plural(RULES.graceDays, "day")} after their due date suspend your shop automatically.
      <span class="due-list">${urgent.slice(0, 6).map((d) => `<button type="button" class="due-pill ${d.daysLeft < 0 ? "late" : ""}" data-order="${esc(d.id)}">#${esc(d.id)} · ${esc(d.customer)} · ${dueText(d.daysLeft)}</button>`).join("")}</span></span>`;
  }

  /* ================= overview ================= */
  function kpi(o) {
    const clickable = o.go ? `data-go="${o.go}" role="button" tabindex="0"` : "";
    return `<div class="kpi ${o.hero ? "hero" : ""} ${o.go ? "click" : ""}" ${clickable}>
      <div class="k-top"><span class="k-ic">${o.icon}</span>${o.label}</div>
      <div class="k-val" title="${esc(String(o.value).replace(/<[^>]+>/g, ""))}">${o.value}</div>${o.alt ? `<div class="k-alt">${o.alt}</div>` : ""}
      <div class="k-sub">${o.sub}</div></div>`;
  }

  function renderDash() {
    const ps = scopedProducts(), os = scopedOrders();
    const s = stats(ps, os);
    const m = monthly(os, 6);
    const thisMonth = m[m.length - 1];
    const v = scopedViews() || emptyViews();
    const top = ps.filter((p) => p.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 5);
    const recent = os.slice(0, 6);
    const attention = [...s.out, ...s.low].slice(0, 6);
    const sel = scopedSeller();
    const who = isManager() ? (sel ? sel.name : "the whole marketplace") : "your shop";

    $("#view").innerHTML = `
    ${isManager() ? `<p class="scope-note"><i class="fa-solid fa-filter" aria-hidden="true"></i> Showing figures for <b>${esc(who)}</b>. Use the picker at the top to switch seller.</p>` : ""}
    ${reportBar()}
    <div class="kpis">
      ${kpi({ hero: true, icon: ICON.money, label: "Total sales", value: usd(s.totalSales), alt: `≈ ${lrd(s.totalSales)}`, sub: `${plural(s.salesCount, "paid order")} · ${usd(thisMonth.value)} this month`, go: "orders:Paid" })}
      ${kpi({ icon: ICON.box, label: "Crochets available", value: num(s.available), sub: `pieces across ${plural(s.styles, "style")}`, go: "products:all" })}
      ${kpi({ icon: ICON.bag, label: "Orders", value: num(s.orders), sub: s.newOrders ? `<b style="color:var(--blue)">${s.newOrders} new</b> waiting` : "no new orders", go: "orders:New" })}
      ${kpi({ icon: ICON.clock, label: "Pending", value: usd(s.pendingValue), alt: `≈ ${lrd(s.pendingValue)}`, sub: plural(s.pendingCount, "open order"), go: "orders:Confirmed" })}
      ${kpi({ icon: ICON.tag, label: "Pieces sold", value: num(s.sold), sub: "from confirmed orders" })}
      ${kpi({ icon: ICON.layers, label: "Stock value", value: usd(s.stockValue), alt: `≈ ${lrd(s.stockValue)}`, sub: "if all available pieces sell" })}
      ${kpi({ icon: ICON.spark, label: "Custom work", value: num(s.custom), sub: s.customNew ? `${s.customNew} new to quote` : "all answered", go: "orders:custom" })}
      ${kpi({ icon: ICON.alert, label: "Low / sold out", value: `${s.low.length} / ${s.out.length}`, sub: `styles at ${LOW} or fewer`, go: "products:low" })}
    </div>

    <div class="kpis kpis-3">
      ${kpi({ icon: ICON.eye, label: "Page views", value: num(v.adPageViews), sub: "last 30 days · " + (isManager() && scope === "all" ? `home ${num(v.homeViews)} · shops ${num(v.storeViews)} · products ${num(v.productPageViews)}` : `shop ${num(v.storeViews)} · products ${num(v.productPageViews)}`), go: isManager() ? "ads" : "" })}
      ${kpi({ icon: ICON.users, label: "Visitors", value: num(v.uniqueVisitors), sub: "unique, last 30 days · no cookies" })}
      ${kpi({ icon: ICON.pointer, label: "Product opens", value: num(v.productOpens), sub: "pieces tapped, last 30 days" })}
    </div>

    ${isManager() && scope === "all" ? sellersTable() : ""}

    <div class="cols">
      <section class="panel" aria-labelledby="hSales">
        <div class="panel-h"><h2 id="hSales">Sales by month</h2><span class="sub">paid &amp; delivered, last 6 months</span></div>
        ${chart("chartSales", m, usd, (x) => SHOP.currency + (x >= 10000 ? Math.round(x / 100) / 10 + "k" : Math.round(x).toLocaleString()), "order")}
      </section>
      <section class="panel" aria-labelledby="hViews">
        <div class="panel-h"><h2 id="hViews">Page views</h2><span class="sub">last 30 days${isManager() && scope !== "all" ? " · " + esc(who) : ""}</span></div>
        ${chart("chartViews", (v.series || []).map((d) => ({ label: d.day.slice(8), full: new Date(d.day + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }), value: d.views, count: d.views })), num, (x) => num(x), "view", true)}
        ${(v.topProducts || []).length ? `<div class="toplist"><b>Most viewed pieces</b>${v.topProducts.map((t) => `<span>${esc(pById(t.id)?.name || t.id)} <em>${num(t.views)}</em></span>`).join("")}</div>` : ""}
      </section>
    </div>

    <div class="cols">
      <section class="panel" aria-labelledby="hRecent">
        <div class="panel-h"><h2 id="hRecent">Recent orders</h2><button class="btn btn-line btn-sm right" type="button" data-go="orders:All">See all</button></div>
        ${recent.length ? `<div class="rows">${recent.map((o) => `
          <div class="row click" data-order="${esc(o.id)}" role="button" tabindex="0" aria-label="Open order ${esc(o.id)} from ${esc(o.customer.name)}">
            <div class="avatar" aria-hidden="true">${esc(initials(o.customer.name))}</div>
            <div class="grow"><div class="t">${esc(o.customer.name)}</div><div class="s">${isManager() ? esc(sellerName(o.sellerId)) + " · " : ""}${esc(itemsSummary(o))} · ${ago(o.createdAt)}</div></div>
            <div style="text-align:right;display:grid;gap:4px;justify-items:end"><span class="amt">${o.type === "custom" && o.quote == null ? "—" : priceHTML(orderValue(o), o.lrdRate || getRate())}</span><span class="status st-${esc(o.status)}">${esc(o.status)}</span></div>
          </div>`).join("")}</div>` : `<div class="empty"><b>No orders yet</b>${isManager() ? "Orders from every shop appear here." : "Share your shop link to get your first order."}</div>`}
      </section>
      ${!isManager() ? shareCard(MYSELLER) : `
      <section class="panel" aria-labelledby="hBest">
        <div class="panel-h"><h2 id="hBest">Best sellers</h2></div>
        ${top.length ? `<div class="rows">${top.map((p, i) => `
          <div class="row click" data-edit="${esc(p.id)}" role="button" tabindex="0">
            <div class="thumb">${pMedia(p)}</div>
            <div class="grow"><div class="t">${i + 1}. ${esc(p.name)}</div><div class="s">${esc(sellerName(p.sellerId))} · ${money(p.price)}</div></div>
            <span class="amt">${p.sold} sold</span>
          </div>`).join("")}</div>` : `<div class="empty"><b>No sales yet</b>Best sellers show here once orders are confirmed.</div>`}
      </section>`}
    </div>

    <div class="cols3">
      <section class="panel" aria-labelledby="hRestock">
        <div class="panel-h"><h2 id="hRestock">Needs restocking</h2></div>
        ${attention.length ? `<div class="rows">${attention.map((p) => `
          <div class="row">
            <div class="thumb">${pMedia(p)}</div>
            <div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${stockLabel(p)}</div></div>
            ${stepper(p)}
          </div>`).join("")}</div>` : `<div class="empty"><b>All stocked up 🎉</b>No crochets are low or sold out.</div>`}
      </section>
      ${!isManager() ? `
      <section class="panel" aria-labelledby="hRev">
        <div class="panel-h"><h2 id="hRev">Reviews</h2><span class="sub">${MYSELLER?.rating ? `★ ${MYSELLER.rating} from ${plural(MYSELLER.reviews, "review")}` : "none yet"}</span></div>
        ${myReviews.length ? `<div class="rows">${myReviews.slice(0, 4).map((r) => `<div class="row"><div class="grow"><div class="t">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} · ${esc(r.buyer)}</div><div class="s">${esc(r.comment || "No comment")}</div></div></div>`).join("")}</div>`
          : `<div class="empty"><b>No reviews yet</b>Mark orders <i>Delivered</i> after handoff — buyers can then review you.</div>`}
      </section>` : `
      <section class="panel" aria-labelledby="hPend">
        <div class="panel-h"><h2 id="hPend">Waiting for approval</h2><button class="btn btn-line btn-sm right" type="button" data-view="sellers">Sellers</button></div>
        ${sellers.filter((x) => x.status === "pending").length ? `<div class="rows">${sellers.filter((x) => x.status === "pending").map((x) => `
          <div class="row"><div class="avatar" aria-hidden="true">${esc(initials(x.name))}</div><div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${esc(x.ownerName)} · ${esc(x.email)}</div></div>
          <button class="btn btn-grad btn-sm" type="button" data-sact="approve" data-sid="${x.id}">Approve</button></div>`).join("")}</div>`
          : `<div class="empty"><b>No one waiting</b>New seller sign-ups appear here.</div>`}
      </section>`}
    </div>`;
    wireChart("chartSales", m, usd, "order");
    wireChart("chartViews", (v.series || []).map((d) => ({ full: d.day, value: d.views, count: d.views })), num, "view");
  }

  /* ---------- downloadable reports (Excel / PDF), built on the server ---------- */
  let reportPeriod = store.get("reportPeriod", "30d");
  const PERIODS = [["30d", "Last 30 days"], ["90d", "Last 90 days"], ["365d", "Last 12 months"], ["all", "All time"]];

  function reportBar(compact) {
    const who = isManager() ? (scope === "all" ? "all sellers" : sellerName(scope)) : "your shop";
    return `
    <div class="report-bar ${compact ? "compact" : ""}" role="group" aria-label="Download a report">
      <span class="rb-label"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> Report for ${esc(who)}</span>
      <label class="sr" for="rbPeriod${compact ? "2" : ""}">Period</label>
      <select class="in" id="rbPeriod${compact ? "2" : ""}" data-report-period>${PERIODS.map(([k, l]) => `<option value="${k}" ${k === reportPeriod ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn btn-line btn-sm" type="button" data-report="xlsx"><i class="fa-solid fa-file-excel" aria-hidden="true" style="color:#1D6F42"></i> Excel</button>
      <button class="btn btn-line btn-sm" type="button" data-report="pdf"><i class="fa-solid fa-file-pdf" aria-hidden="true" style="color:#B91C1C"></i> PDF</button>
    </div>`;
  }

  function downloadReport(fmt) {
    const params = new URLSearchParams({ period: reportPeriod });
    if (isManager()) params.set("seller", scope);
    const a = Object.assign(document.createElement("a"), { href: `/api/dash/report.${fmt}?${params}`, rel: "noopener" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`Preparing your ${fmt === "pdf" ? "PDF" : "Excel"} report…`);
  }

  function sellersTable() {
    const rows = sellers.map((s) => {
      const ps = products.filter((p) => String(p.sellerId) === String(s.id));
      const os = orders.filter((o) => String(o.sellerId) === String(s.id));
      const st = stats(ps, os);
      const v = (analytics.bySeller || {})[s.id] || emptyViews();
      return { s, st, v };
    }).sort((a, b) => b.st.totalSales - a.st.totalSales || b.v.adPageViews - a.v.adPageViews);
    return `
    <section class="panel" aria-labelledby="hBySeller" style="margin-bottom:16px">
      <div class="panel-h"><h2 id="hBySeller">Sellers at a glance</h2><span class="sub">tap a row to see that seller's dashboard</span></div>
      <div class="table-wrap"><table class="items stable">
        <thead><tr><th scope="col">Seller</th><th scope="col" class="n">Sales</th><th scope="col" class="n">Available</th><th scope="col" class="n">Orders</th><th scope="col" class="n">Pending</th><th scope="col" class="n">Sold</th><th scope="col" class="n">Views 30d</th></tr></thead>
        <tbody>${rows.map(({ s, st, v }) => `
          <tr class="click" data-scope="${s.id}" tabindex="0" role="button" aria-label="Show ${esc(s.name)}'s figures">
            <td><b>${esc(s.name)}</b> ${s.status !== "active" ? statusPill(s.status) : ""}</td>
            <td class="n">${usd(st.totalSales)}</td><td class="n">${num(st.available)}</td><td class="n">${num(st.orders)}${st.newOrders ? ` <span class="newdot">${st.newOrders} new</span>` : ""}</td>
            <td class="n">${usd(st.pendingValue)}</td><td class="n">${num(st.sold)}</td><td class="n">${num(v.adPageViews)}</td>
          </tr>`).join("") || `<tr><td colspan="7">No sellers yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;
  }

  function shareCard(s) {
    if (!s) return "";
    const url = storeUrl(s.slug);
    const msg = `Shop my handmade crochet on ${SHOP.name} 🧶 ${url}`;
    return `
      <section class="panel share-card" aria-labelledby="hShare">
        <div class="panel-h"><h2 id="hShare">Your shop link</h2><span class="sub">put it in your bio &amp; WhatsApp Status</span></div>
        <div class="linkbox"><code>${esc(url.replace(/^https?:\/\//, ""))}</code><button class="btn btn-line btn-sm" type="button" data-copy="${esc(url)}">Copy</button></div>
        <div class="share-actions">
          <a class="btn btn-wa btn-sm" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ICON.wa} Share on WhatsApp</a>
          <a class="btn btn-line btn-sm" href="/s/${esc(s.slug)}" target="_blank" rel="noopener">Open my shop ↗</a>
        </div>
        <p class="note">Tip: tap <b>Flyer</b> on any crochet to get a ready-made image to share to your Status or Stories.</p>
      </section>`;
  }

  /* ---------- simple bar chart (SVG, no library) ---------- */
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil((v / p) * 2) / 2 * p || 1;
  }
  function chart(id, m, fmt, short, unitWord, dense) {
    const W = 560, H = 220, pl = 8, pr = 8, pt = 26, pb = 28;
    const nice = niceMax(Math.max(...m.map((x) => x.value), 0) || (unitWord === "view" ? 10 : 100));
    const bw = (W - pl - pr) / Math.max(1, m.length);
    const barW = Math.min(46, bw * (dense ? 0.7 : 0.56));
    const y = (v) => pt + (H - pt - pb) * (1 - v / nice);
    const bars = m.map((d, i) => {
      const x = pl + i * bw + (bw - barW) / 2;
      const h = Math.max(d.value ? 3 : 0, H - pb - y(d.value));
      const base = H - pb;
      const r = Math.min(4, h / 2, barW / 2);
      const path = h ? `M${x} ${base} V${base - h + r} Q${x} ${base - h} ${x + r} ${base - h} H${x + barW - r} Q${x + barW} ${base - h} ${x + barW} ${base - h + r} V${base} Z` : "";
      const label = dense ? (i % 5 === 0 || i === m.length - 1 ? d.label : "") : d.label;
      return `<g><rect class="hit" x="${pl + i * bw}" y="${pt - 10}" width="${bw}" height="${H - pt - pb + 10}" data-i="${i}"/>${path ? `<path class="bar ${i === m.length - 1 ? "cur" : ""}" d="${path}" data-bar="${i}"/>` : ""}
        ${d.value && !dense ? `<text class="vl" x="${x + barW / 2}" y="${base - h - 7}" text-anchor="middle">${short(d.value)}</text>` : ""}
        ${label ? `<text class="ax" x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${label}</text>` : ""}</g>`;
    }).join("");
    return `<div class="chart-wrap" id="${id}">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <g class="grid">${[0, 0.5, 1].map((f) => `<line x1="${pl}" x2="${W - pr}" y1="${y(nice * f)}" y2="${y(nice * f)}"/>`).join("")}</g>${bars}
      </svg><div class="tip"></div>
      <table class="sr"><caption>${unitWord === "view" ? "Page views per day" : "Sales by month"}</caption>${m.map((x) => `<tr><td>${x.full}</td><td>${fmt(x.value)}</td></tr>`).join("")}</table>
    </div>`;
  }
  function wireChart(id, m, fmt, unitWord) {
    const c = $("#" + id);
    if (!c) return;
    const tip = $(".tip", c);
    $$(".hit", c).forEach((h) => {
      const show = () => {
        const i = +h.dataset.i, d = m[i];
        const r = h.getBoundingClientRect(), cr = c.getBoundingClientRect();
        tip.innerHTML = unitWord === "view" ? `${plural(d.value, "view")}<small>${esc(d.full)}</small>` : `${money(d.value)}<small>${d.full} · ${plural(d.count, "order")}</small>`;
        tip.style.left = r.left - cr.left + r.width / 2 + "px";
        tip.style.top = Math.max(40, r.top - cr.top + 30) + "px";
        tip.classList.add("show");
        $$(".bar", c).forEach((b) => b.classList.toggle("hover", b.dataset.bar == i));
      };
      h.addEventListener("mouseenter", show);
      h.addEventListener("click", show);
      h.addEventListener("mouseleave", () => { tip.classList.remove("show"); $$(".bar", c).forEach((b) => b.classList.remove("hover")); });
    });
  }

  /* ================= sellers (manager) ================= */
  function renderSellers() {
    const counts = { all: sellers.length };
    ["pending", "active", "suspended"].forEach((k) => (counts[k] = sellers.filter((s) => s.status === k).length));
    let list = sellers;
    if (sFilter !== "all") list = list.filter((s) => s.status === sFilter);
    if (sQuery) { const q = sQuery.toLowerCase(); list = list.filter((s) => [s.name, s.ownerName, s.email, s.location].join(" ").toLowerCase().includes(q)); }
    $("#view").innerHTML = `
    <div class="toolbar">
      ${searchBox("sq", "Search sellers", "Shop, name, email or area", sQuery)}
      <div class="chips" role="group" aria-label="Filter sellers">${[["all", "All"], ["pending", "Waiting"], ["active", "Live"], ["suspended", "Suspended"]]
        .map(([k, l]) => `<button class="chip" type="button" data-sf="${k}" aria-pressed="${sFilter === k}">${l}<span class="n">${counts[k]}</span></button>`).join("")}</div>
      <button class="btn btn-grad btn-sm" type="button" data-action="add-seller" style="margin-left:auto"><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Add seller</button>
    </div>
    ${list.length ? `<div class="slist">${list.map((s) => {
      const ps = products.filter((p) => String(p.sellerId) === String(s.id));
      const os = orders.filter((o) => String(o.sellerId) === String(s.id));
      const st = stats(ps, os);
      const v = (analytics.bySeller || {})[s.id] || emptyViews();
      return `
      <article class="scard">
        <div class="scard-top">
          <div class="avatar big" aria-hidden="true">${s.avatar ? `<img src="${esc(s.avatar)}" alt="">` : esc(initials(s.name))}</div>
          <div class="grow">
            <div class="t">${esc(s.name)} ${statusPill(s.status)} ${s.phoneVerified ? '<span class="spill sp-verified"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verified</span>' : ""}</div>
            <div class="s">${esc(s.ownerName || "—")} · ${esc(s.email)} · +${esc(s.whatsapp)}${s.location ? " · " + esc(s.location) : ""}</div>
            <div class="s">Joined ${fmtDate(s.created)} · /s/${esc(s.slug)}${s.rating ? ` · ★ ${s.rating} (${s.reviews})` : ""} · ${plural(s.handoffs, "handoff")}</div>
            ${s.status === "suspended" && s.suspendReason ? `<div class="s susp-reason">${s.autoSuspended ? "<b>Automatic:</b> " : ""}${esc(s.suspendReason)}${s.suspendedAt ? ` (${fmtDate(s.suspendedAt)})` : ""}</div>` : ""}
          </div>
        </div>
        <div class="mini-kpis">
          <span><b>${usd(st.totalSales)}</b>sales</span><span><b>${num(st.available)}</b>available</span><span><b>${num(st.orders)}</b>orders</span>
          <span><b>${usd(st.pendingValue)}</b>pending</span><span><b>${num(st.sold)}</b>sold</span><span><b>${num(v.adPageViews)}</b>views 30d</span>
        </div>
        <div class="scard-actions">
          ${s.status === "pending" ? `<button class="btn btn-grad btn-sm" type="button" data-sact="approve" data-sid="${s.id}">Approve</button>` : ""}
          ${s.status === "active" ? `<button class="btn btn-line btn-sm" type="button" data-sact="suspend" data-sid="${s.id}">Suspend</button>` : ""}
          ${s.status === "suspended" ? `<button class="btn btn-line btn-sm" type="button" data-sact="approve" data-sid="${s.id}">Reactivate</button>` : ""}
          <button class="btn btn-line btn-sm" type="button" data-sact="verify" data-sid="${s.id}">${s.phoneVerified ? "Remove verified badge" : "Mark phone verified"}</button>
          <button class="btn btn-line btn-sm" type="button" data-scope="${s.id}">Dashboard</button>
          <button class="btn btn-line btn-sm" type="button" data-sact="edit" data-sid="${s.id}">Edit shop</button>
          <button class="btn btn-line btn-sm" type="button" data-sact="reviews" data-sid="${s.id}">Reviews</button>
          <button class="btn btn-line btn-sm" type="button" data-sact="reset" data-sid="${s.id}">Reset password</button>
          <a class="btn btn-line btn-sm" href="/s/${esc(s.slug)}" target="_blank" rel="noopener">Open shop ↗</a>
          <button class="btn btn-danger btn-sm" type="button" data-sact="delete" data-sid="${s.id}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Delete shop</button>
        </div>
      </article>`;
    }).join("")}</div>` : `<div class="panel empty"><b>${sellers.length ? "No sellers match" : "No sellers yet"}</b>${sellers.length ? "Try another search or filter." : "Makers sign up at /sell, or add one yourself."}</div>`}`;
    liveSearch("sq", (v) => { sQuery = v; renderSellers(); });
  }

  async function sellerAction(act, sid) {
    const s = sellerById(sid);
    if (!s) return;
    if (act === "approve") {
      const r = await guard(API.updateSeller(sid, { status: "active" }), `${s.name} is live 🎉`);
      if (r) { Object.assign(s, r.seller); render(); }
    } else if (act === "suspend") {
      confirmBox(`Suspend ${s.name}?`, "Their shop and products disappear from the marketplace and they can't sign in. You can reactivate them later.", "Suspend", async () => {
        const r = await guard(API.updateSeller(sid, { status: "suspended" }), "Shop suspended");
        if (r) { Object.assign(s, r.seller); render(); }
      });
    } else if (act === "verify") {
      const r = await guard(API.updateSeller(sid, { phoneVerified: !s.phoneVerified }), s.phoneVerified ? "Badge removed" : "Marked as verified ✓");
      if (r) { Object.assign(s, r.seller); render(); }
    } else if (act === "reset") {
      confirmBox(`Reset ${s.name}'s password?`, "They'll be signed out everywhere. You'll get a temporary password to send them privately.", "Reset password", async () => {
        const r = await guard(API.resetSellerPassword(sid));
        if (r) showSecret(`New password for ${s.name}`, s.email, r.tempPassword);
      });
    } else if (act === "edit") {
      $("#mSellerSheet").innerHTML = `<div class="sh-head"><h2 id="msTitle">Edit ${esc(s.name)}</h2><button class="x" type="button" data-close="mSeller" aria-label="Close">✕</button></div><div class="sh-body" id="mStoreBody"></div>`;
      $("#mStoreBody").innerHTML = storeForm(s);
      layers.open($("#mSeller"));
    } else if (act === "delete") {
      const ps = products.filter((p) => String(p.sellerId) === String(s.id)).length;
      const os = orders.filter((o) => String(o.sellerId) === String(s.id)).length;
      $("#mSellerSheet").innerHTML = `
        <div class="sh-head"><h2 id="msTitle">Delete ${esc(s.name)}?</h2><button class="x" type="button" data-close="mSeller" aria-label="Close">✕</button></div>
        <form class="sh-body" id="deleteSellerForm" data-sid="${s.id}" data-slug="${esc(s.slug)}" novalidate>
          <div class="banner bad" style="margin:0 0 14px"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span><b>This can't be undone.</b>
            The shop, its seller login, ${plural(ps, "crochet")} with their photos, ${plural(os, "order")} (including buyers' details and photos) and its reviews are deleted permanently.
            Anonymous page-view counts are kept so past ad-revenue reports still add up.</span></div>
          <p class="note" style="margin-top:0">Need records first? <button type="button" class="link-like" data-report-for="${s.id}" data-fmt="xlsx">Download their Excel report</button> · <button type="button" class="link-like" data-report-for="${s.id}" data-fmt="pdf">PDF</button></p>
          <div class="field"><label for="delConfirm">Type <b>${esc(s.slug)}</b> to confirm</label><input id="delConfirm" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
        </form>
        <div class="sh-foot"><button class="btn btn-line" type="button" data-close="mSeller">Cancel</button><button class="btn btn-danger" type="submit" form="deleteSellerForm" id="delBtn" disabled>Delete shop permanently</button></div>`;
      layers.open($("#mSeller"), { focus: "#delConfirm" });
    } else if (act === "reviews") {
      const r = await guard(API.sellerReviews(sid));
      if (!r) return;
      $("#mSellerSheet").innerHTML = `<div class="sh-head"><h2 id="msTitle">Reviews · ${esc(s.name)}</h2><button class="x" type="button" data-close="mSeller" aria-label="Close">✕</button></div>
        <div class="sh-body">${r.reviews.length ? `<div class="rows">${r.reviews.map((v) => `
          <div class="row"><div class="grow"><div class="t">${"★".repeat(v.rating)}${"☆".repeat(5 - v.rating)} · ${esc(v.buyer)} · #${esc(v.orderId)}</div><div class="s" style="white-space:normal">${esc(v.comment || "No comment")}</div></div>
          <button class="btn btn-line btn-sm" type="button" data-hide-review="${v.id}" data-hidden="${v.hidden ? 0 : 1}">${v.hidden ? "Show" : "Hide"}</button></div>`).join("")}</div>` : `<div class="empty"><b>No reviews yet</b></div>`}</div>`;
      layers.open($("#mSeller"));
    }
  }

  function openAddSeller() {
    $("#mSellerSheet").innerHTML = `
      <div class="sh-head"><h2 id="msTitle">Add a seller</h2><button class="x" type="button" data-close="mSeller" aria-label="Close">✕</button></div>
      <form class="sh-body" id="addSellerForm" novalidate>
        <p class="note" style="margin-top:0">The shop goes live straight away. You'll get a temporary password to send the maker privately — they can change it after signing in.</p>
        <div class="grid2">
          <div class="field"><label for="asShop">Shop name <span class="req">*</span></label><input id="asShop" maxlength="60" required></div>
          <div class="field"><label for="asOwner">Maker's name <span class="req">*</span></label><input id="asOwner" maxlength="80" required></div>
          <div class="field"><label for="asEmail">Email (to sign in) <span class="req">*</span></label><input id="asEmail" type="email" maxlength="254" required></div>
          <div class="field"><label for="asWa">WhatsApp <span class="req">*</span></label><input id="asWa" type="tel" maxlength="30" required></div>
          <div class="field" style="grid-column:1/-1"><label for="asLoc">Area</label><input id="asLoc" maxlength="120"></div>
        </div>
      </form>
      <div class="sh-foot"><button class="btn btn-line" type="button" data-close="mSeller">Cancel</button><button class="btn btn-grad" type="submit" form="addSellerForm">Create shop</button></div>`;
    layers.open($("#mSeller"), { focus: "#asShop" });
  }

  function showSecret(title, email, password) {
    $("#mConfirmSheet").innerHTML = `<div class="sh-body"><h2 id="mcTitle" style="font-family:var(--head);margin:0 0 8px">${esc(title)}</h2>
      <p style="color:var(--muted);margin:0 0 12px">Send these to the maker privately (e.g. WhatsApp). This password is shown only once.</p>
      <dl class="kv"><dt>Sign in at</dt><dd>${esc(location.origin)}/admin</dd><dt>Email</dt><dd>${esc(email)}</dd><dt>Password</dt><dd><code class="secret">${esc(password)}</code></dd></dl>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px"><button class="btn btn-line" type="button" data-copy="${esc(`${location.origin}/admin\n${email}\n${password}`)}">Copy</button><button class="btn btn-primary" type="button" data-close="mConfirm">Done</button></div></div>`;
    layers.open($("#mConfirm"));
  }

  /* ================= crochets ================= */
  function liveSearch(inputId, onChange) {
    const input = $("#" + inputId);
    if (!input) return;
    input.addEventListener("input", (e) => {
      const pos = e.target.selectionStart;
      onChange(e.target.value);
      const n = $("#" + inputId);
      n.focus();
      n.setSelectionRange(pos, pos);
    });
  }

  function renderProducts() {
    const ps = scopedProducts();
    const s = stats(ps, scopedOrders());
    const counts = { all: ps.filter((p) => !p.soldAt).length, live: ps.filter((p) => p.active && p.stock > 0).length, low: s.low.length + s.out.length,
      hidden: ps.filter((p) => !p.active && !p.soldAt).length, sold: ps.filter((p) => p.soldAt).length };
    let list = ps.filter((p) => (pFilter === "sold") === !!p.soldAt);
    if (pFilter === "live") list = list.filter((p) => p.active && p.stock > 0);
    if (pFilter === "low") list = list.filter((p) => p.active && p.stock <= LOW);
    if (pFilter === "hidden") list = list.filter((p) => !p.active);
    if (pQuery) { const q = pQuery.toLowerCase(); list = list.filter((p) => (p.name + " " + p.category + " " + sellerName(p.sellerId)).toLowerCase().includes(q)); }
    $("#view").innerHTML = `
    <div class="toolbar">
      ${searchBox("pq", "Search crochets", "Search crochets…", pQuery)}
      <div class="chips" role="group" aria-label="Filter crochets">${[["all", "All"], ["live", "In shop"], ["low", "Low / sold out"], ["hidden", "Hidden"], ["sold", "Sold"]]
        .map(([k, l]) => `<button class="chip" type="button" data-pf="${k}" aria-pressed="${pFilter === k}">${l}<span class="n">${counts[k]}</span></button>`).join("")}</div>
    </div>
    ${list.length ? `<div class="plist">${list.map((p) => `
      <div class="pcard">
        <div class="thumb">${pMedia(p)}</div>
        <div style="min-width:0"><div class="name">${esc(p.name)}${p.soldAt ? `<span class="hide-tag sold">Sold ${fmtDate(p.soldAt)}</span>` : p.active ? "" : `<span class="hide-tag">Hidden</span>`}${p.customEnabled ? `<span class="hide-tag mto">Made to order</span>` : ""}</div>
          <div class="meta">${isManager() ? `<b>${esc(sellerName(p.sellerId))}</b> · ` : ""}${esc(p.category)} · ${plural(p.sizes.length, "size")} · ${plural(p.colors.length, "colour")}</div></div>
        <div class="bottom">
          <div><div class="cell-l">Price</div><b>${priceHTML(p.price)}</b></div>
          <div><div class="cell-l">Stock</div>${stepper(p)}</div>
          <div><div class="cell-l">Sold</div><b>${p.sold}</b></div>
          <div class="p-actions">
            ${p.soldAt ? "" : `<button class="btn btn-line btn-sm" type="button" data-sold="${esc(p.id)}" title="Mark as sold"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Sold</button>`}
            <button class="btn btn-line btn-sm" type="button" data-flyer="${esc(p.id)}" title="Status flyer"><i class="fa-regular fa-image" aria-hidden="true"></i> Flyer</button>
            <button class="btn btn-line btn-sm" type="button" data-copy="${esc(`${SHOP.siteUrl || location.origin}/p/${p.id}`)}" title="Copy link"><i class="fa-solid fa-link" aria-hidden="true"></i><span class="sr">Copy link</span></button>
            <button class="btn btn-line btn-sm" type="button" data-edit="${esc(p.id)}">Edit</button>
            <button class="btn btn-danger btn-sm" type="button" data-del="${esc(p.id)}" aria-label="Delete ${esc(p.name)}"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>
          </div>
        </div>
      </div>`).join("")}</div>`
    : `<div class="panel empty"><b>${ps.length ? "Nothing matches" : "No crochets yet"}</b>${ps.length ? "Try another search or filter." : "Tap “Add crochet” to upload your first piece."}<div style="margin-top:14px"><button class="btn btn-grad" type="button" data-action="add-product">+ Add crochet</button></div></div>`}`;
    liveSearch("pq", (v) => { pQuery = v; renderProducts(); });
  }

  /* ---------- product editor ---------- */
  let edit = null;

  function openEditor(id) {
    const p = id ? pById(id) : null;
    if (!p && isManager() && !sellers.length) { toast("Add a seller first"); return; }
    edit = p
      ? structuredClone(p)
      : { id: "", name: "", category: "", price: "", stock: 1, sizes: ["S", "M", "L"], colors: [{ n: "Natural", h: "#E8DCC2" }], desc: "", badge: "New",
          shape: "top", images: [], active: true, customEnabled: false, turnaroundDays: 0,
          sellerId: isManager() ? (scope !== "all" ? Number(scope) : sellers[0]?.id) : MYSELLER?.id };
    edit.uploading = 0;
    renderEditor();
    layers.open($("#mProduct"), { focus: "#fName" });
  }

  function renderEditor() {
    const e = edit;
    const cats = [...new Set([...CAT_PRESETS, ...products.map((p) => p.category)])];
    const customSizes = e.sizes.filter((s) => !SIZE_PRESETS.includes(s));
    const saveLabel = e.uploading ? "Uploading photos…" : e.id ? "Save changes" : "Add to shop";
    $("#mProductSheet").innerHTML = `
    <div class="sh-head"><h2 id="mpTitle">${e.id ? "Edit crochet" : "Add a crochet"}</h2><button class="x" type="button" data-close="mProduct" aria-label="Close">✕</button></div>
    <form class="sh-body" id="pForm" novalidate>
      ${isManager() ? `<div class="sec field"><label for="fSeller">Seller</label><select id="fSeller" ${e.id ? "disabled" : ""}>${sellers.map((s) => `<option value="${s.id}" ${String(s.id) === String(e.sellerId) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>` : ""}
      <div class="sec">
        <div class="sec-t">Photos <span style="color:var(--muted);font-weight:600;font-size:.82rem">first photo is the cover</span></div>
        <label class="drop" id="pDrop"><input type="file" accept="image/*" multiple class="sr" id="pFiles">
          ${ICON.photo}<b>Upload photos</b><small>Tap or drag &amp; drop · up to ${MAX_IMAGES}</small></label>
        <div class="pics" id="pPics">${e.images.map((u, i) => `<div class="pic"><img src="${esc(u)}" alt="Photo ${i + 1}">${i ? `<button type="button" class="cover" data-cover="${i}">Make cover</button>` : `<span class="cover">Cover</span>`}<button type="button" class="rm" data-rmimg="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("")}${Array.from({ length: e.uploading }, () => `<div class="pic"><div class="loading" role="status" aria-label="Uploading"><i></i></div></div>`).join("")}</div>
      </div>
      <div class="sec grid2">
        <div class="field" style="grid-column:1/-1"><label for="fName">Name <span class="req">*</span></label><input id="fName" value="${esc(e.name)}" placeholder="e.g. Blossom Crop Top" maxlength="100" required></div>
        <div class="field"><label for="fCat">Category <span class="req">*</span></label><input id="fCat" list="cats" value="${esc(e.category)}" placeholder="Tops, Dresses…" maxlength="40" required><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
        <div class="field"><label for="fPrice">Price in ${esc(SHOP.currency)} <span class="req">*</span></label><input id="fPrice" inputmode="decimal" value="${esc(e.price)}" placeholder="0" required aria-describedby="fPriceLrd" data-lrd-hint="fPriceLrd"><span class="hint" id="fPriceLrd">${e.price !== "" ? "≈ " + lrd(e.price) : "The L$ price is worked out automatically."}</span></div>
        <div class="field"><label for="fStock">Quantity available <span class="req">*</span></label><input id="fStock" type="number" min="0" max="9999" step="1" value="${esc(e.stock)}" required aria-describedby="fStockHint"><span class="hint" id="fStockHint">Pieces ready now (or that you can make). 0 = sold out.</span></div>
        <div class="field"><label for="fBadge">Label on photo</label><select id="fBadge">${BADGES.map((b) => `<option value="${b}" ${e.badge === b ? "selected" : ""}>${b || "None"}</option>`).join("")}</select></div>
      </div>
      <fieldset class="sec plain">
        <legend class="sec-t">Sizes</legend>
        <div class="sizes">${[...SIZE_PRESETS, ...customSizes].map((s) => `<button type="button" class="sz" data-sz="${esc(s)}" aria-pressed="${e.sizes.includes(s)}">${esc(s)}</button>`).join("")}</div>
        <div style="display:flex;gap:8px;margin-top:8px;max-width:320px"><input class="in" id="fSizeNew" placeholder="Other size, e.g. 38" maxlength="20" aria-label="Other size"><button type="button" class="btn btn-line btn-sm" data-action="add-size">Add</button></div>
      </fieldset>
      <fieldset class="sec plain">
        <legend class="sec-t">Colours available</legend>
        <div class="colors">${e.colors.map((c, i) => `<div class="crow"><input type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(c.h) ? c.h : "#5EB8AE")}" data-ch="${i}" aria-label="Colour ${i + 1} shade"><input class="in" value="${esc(c.n)}" data-cn="${i}" placeholder="Colour name" maxlength="40" aria-label="Colour ${i + 1} name"><button type="button" class="icon-btn" data-rmc="${i}" aria-label="Remove colour ${i + 1}">✕</button></div>`).join("")}</div>
        <button type="button" class="btn btn-line btn-sm" style="margin-top:8px" data-action="add-color">+ Add colour</button>
      </fieldset>
      <div class="sec field"><label for="fDesc">Description</label><textarea id="fDesc" maxlength="2000" placeholder="Yarn, fit, how to style it…">${esc(e.desc)}</textarea></div>
      <div class="sec mto-box">
        <label class="switch"><input type="checkbox" role="switch" id="fCustom" ${e.customEnabled ? "checked" : ""}> Made to order (custom)</label>
        <p class="hint">Buyers must pick their preferred colours and a “needed by” date before adding it to the cart. It uses one of your weekly custom slots.</p>
        <div class="field" style="max-width:220px"><label for="fTurn">Usual turnaround (days)</label><input id="fTurn" type="number" min="0" max="365" value="${esc(e.turnaroundDays || 0)}"></div>
      </div>
      <div class="sec grid2">
        <label class="switch"><input type="checkbox" role="switch" id="fActive" ${e.active ? "checked" : ""}> Show in shop</label>
        ${e.images.length ? "" : `<div class="field"><label for="fShape">Drawing to show until you add a photo</label><select id="fShape">${SHAPES.map(([k, l]) => `<option value="${k}" ${e.shape === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>`}
      </div>
    </form>
    <div class="sh-foot">
      <button class="btn btn-line" type="button" data-close="mProduct">Cancel</button>
      <button class="btn btn-grad" type="button" id="saveProduct" ${e.uploading ? "disabled" : ""}>${saveLabel}</button>
    </div>`;
    const drop = $("#pDrop");
    $("#pFiles").addEventListener("change", (ev) => { uploadImgs(ev.target.files); ev.target.value = ""; });
    ["dragenter", "dragover"].forEach((x) => drop.addEventListener(x, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((x) => drop.addEventListener(x, (ev) => { ev.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (ev) => uploadImgs(ev.dataTransfer.files));
    $("#pForm").addEventListener("submit", (ev) => { ev.preventDefault(); saveProduct(); });
  }

  function readForm() {
    if (!$("#pForm")) return;
    edit.name = $("#fName").value.trim();
    edit.category = $("#fCat").value.trim();
    edit.price = $("#fPrice").value.trim();
    edit.stock = $("#fStock").value;
    edit.badge = $("#fBadge").value;
    edit.desc = $("#fDesc").value.trim();
    edit.active = $("#fActive").checked;
    edit.customEnabled = $("#fCustom").checked;
    edit.turnaroundDays = Number($("#fTurn").value) || 0;
    if ($("#fSeller")) edit.sellerId = Number($("#fSeller").value);
    if ($("#fShape")) edit.shape = $("#fShape").value;
    $$("[data-cn]").forEach((i) => (edit.colors[+i.dataset.cn].n = i.value));
    $$("[data-ch]").forEach((i) => (edit.colors[+i.dataset.ch].h = i.value));
  }

  async function uploadImgs(files) {
    readForm();
    const room = Math.max(0, MAX_IMAGES - edit.images.length - edit.uploading);
    const list = [...files].filter(isImageFile).slice(0, room);
    if (!list.length) { if (!room) toast(`Up to ${MAX_IMAGES} photos per crochet`); return; }
    const target = edit;
    target.uploading += list.length;
    renderEditor();
    await Promise.all(list.map(async (f) => {
      try {
        const data = await compressImage(f, { quality: 0.84, as: "dataURL" });
        const r = await guard(API.uploadImage(data, (target.name || "crochet").replace(/\W+/g, "-") + ".jpg"));
        if (r && r.url) target.images.push(r.url);
      } catch {
        toast(`Couldn't read "${f.name}" — use a JPG or PNG`);
      } finally {
        target.uploading--;
        if (edit === target) { readForm(); renderEditor(); }
      }
    }));
  }

  async function saveProduct() {
    readForm();
    const e = edit;
    const checks = [["fName", e.name.length > 1], ["fCat", e.category.length > 0], ["fPrice", e.price !== "" && !isNaN(+e.price) && +e.price >= 0], ["fStock", e.stock !== "" && +e.stock >= 0]];
    let ok = true;
    checks.forEach(([id, valid]) => {
      $("#" + id).closest(".field").classList.toggle("err", !valid);
      $("#" + id).setAttribute("aria-invalid", String(!valid));
      if (!valid) ok = false;
    });
    if (!ok) { toast("Please fill in the highlighted fields"); $(".field.err input")?.focus(); return; }
    if (!e.sizes.length) e.sizes = ["One size"];
    e.colors = e.colors.filter((c) => c.n.trim());
    const btn = $("#saveProduct");
    btn.disabled = true;
    btn.textContent = "Saving…";
    const payload = { id: e.id, name: e.name, category: e.category, price: +e.price, stock: Math.round(+e.stock), sizes: e.sizes, colors: e.colors,
      desc: e.desc, badge: e.badge, shape: e.shape, images: e.images, active: e.active, customEnabled: e.customEnabled, turnaroundDays: e.turnaroundDays };
    const r = await guard(API.saveProduct(payload, isManager() ? e.sellerId : undefined), e.id ? "Saved ✓" : "Added to the shop 🎉");
    if (!r) { btn.disabled = false; btn.textContent = e.id ? "Save changes" : "Add to shop"; return; }
    const i = products.findIndex((p) => p.id === r.product.id);
    if (i >= 0) products[i] = r.product; else products.unshift(r.product);
    layers.close($("#mProduct"));
    edit = null;
    render();
  }

  /* ---------- status flyer ---------- */
  async function openFlyer(id) {
    const p = pById(id);
    const s = sellerById(p.sellerId) || MYSELLER;
    $("#mFlyerSheet").innerHTML = `<div class="sh-head"><h2 id="mfTitle">Status flyer</h2><button class="x" type="button" data-close="mFlyer" aria-label="Close">✕</button></div>
      <div class="sh-body flyer-body"><div class="loader" role="status"><i></i>Making your flyer…</div></div>`;
    layers.open($("#mFlyer"));
    let blob;
    try { blob = await window.makeFlyer({ product: p, seller: s, storeUrl: storeUrl(s?.slug || "") }); }
    catch { $(".flyer-body").innerHTML = `<div class="empty"><b>Couldn't make the flyer</b>Try again, or use a different photo.</div>`; return; }
    const url = URL.createObjectURL(blob);
    const name = `${p.name.replace(/\W+/g, "-").toLowerCase()}-flyer.jpg`;
    const file = new File([blob], name, { type: "image/jpeg" });
    const link = `${SHOP.siteUrl || location.origin}/p/${p.id}`;
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    $(".flyer-body").innerHTML = `
      <img class="flyer-img" src="${url}" alt="Flyer for ${esc(p.name)}">
      <div class="flyer-actions">
        ${canShare ? `<button class="btn btn-grad" type="button" id="shareStory"><i class="fa-solid fa-circle-plus" aria-hidden="true"></i> Share to Story / Status</button>
        <button class="btn btn-line" type="button" id="shareChat"><i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Send in a chat</button>` : ""}
        <a class="btn ${canShare ? "btn-line" : "btn-grad"}" href="${url}" download="${esc(name)}"><i class="fa-solid fa-download" aria-hidden="true"></i> Save image</a>
      </div>
      <div class="flyer-help">
        ${canShare ? `<p><b>Story / Status:</b> in the list that opens, choose <b>Instagram → Stories</b>, <b>Facebook → Stories</b> or <b>WhatsApp → My status</b>. Your link is copied, so you can paste it into a <b>Link sticker</b>.</p>` : ""}
        <p><b>Story option missing?</b> Tap <b>Save image</b>, then open the app's Story camera and pick the flyer from your gallery.</p>
      </div>
      <p class="note">Sized for WhatsApp Status &amp; Instagram/Facebook Stories (1080×1920).</p>`;
    // Story targets only appear when the share is a bare image: any caption or link makes Instagram and
    // Facebook offer Direct/Messenger only, and WhatsApp treats it as a chat message. So the image goes alone
    // and the link goes to the clipboard for the Link sticker.
    $("#shareStory")?.addEventListener("click", async () => {
      navigator.clipboard?.writeText(link).catch(() => {});
      try { await navigator.share({ files: [file] }); toast("Link copied: paste it into a Link sticker"); }
      catch (e) { if (e && e.name !== "AbortError") toast("Sharing isn't available. Save the image instead"); }
    });
    $("#shareChat")?.addEventListener("click", async () => {
      try { await navigator.share({ files: [file], text: `${p.name}, available now: ${link}` }); }
      catch (e) { if (e && e.name !== "AbortError") toast("Sharing isn't available. Save the image instead"); }
    });
    $("#mFlyer").addEventListener("layerclose", () => URL.revokeObjectURL(url), { once: true });
  }

  /* ================= orders ================= */
  function renderOrders() {
    const os = scopedOrders();
    const counts = { All: os.length };
    STATUSES.forEach((s) => (counts[s] = os.filter((o) => o.status === s).length));
    let list = os;
    if (oFilter !== "All") list = list.filter((o) => o.status === oFilter);
    if (oType === "custom") list = list.filter((o) => o.type === "custom" || o.customWork);
    else if (oType !== "all") list = list.filter((o) => o.type === oType);
    if (oQuery) { const q = oQuery.toLowerCase(); list = list.filter((o) => [o.id, o.customer.name, o.customer.phone, itemsSummary(o), sellerName(o.sellerId)].join(" ").toLowerCase().includes(q)); }
    $("#view").innerHTML = `
    <div class="toolbar">
      ${searchBox("oq", "Search orders", "Name, phone or order #", oQuery)}
      <select class="in" id="otype" style="width:auto;border-radius:999px" aria-label="Order type">
        <option value="all">All types</option>
        <option value="cart" ${oType === "cart" ? "selected" : ""}>Shop orders</option>
        <option value="custom" ${oType === "custom" ? "selected" : ""}>Custom work</option>
      </select>
    </div>
    <div class="chips" style="margin-bottom:16px" role="group" aria-label="Filter by status">${["All", ...STATUSES]
      .map((s) => `<button class="chip" type="button" data-of="${s}" aria-pressed="${oFilter === s}">${s}<span class="n">${counts[s]}</span></button>`).join("")}</div>
    ${list.length ? `<div class="olist">${list.map((o) => `
      <div class="ocard" data-order="${esc(o.id)}" role="button" tabindex="0" aria-label="Open order ${esc(o.id)} from ${esc(o.customer.name)}">
        <div class="avatar" aria-hidden="true">${esc(initials(o.customer.name))}</div>
        <div style="min-width:0"><div class="t">${esc(o.customer.name)} <span class="tag ${o.type === "cart" ? "shop" : ""}">${o.type === "cart" ? (o.customWork ? "Made to order" : "Shop") : "Custom"}</span>${isManager() ? ` <span class="tag seller-tag">${esc(sellerName(o.sellerId))}</span>` : ""}</div>
          <div class="s" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(itemsSummary(o))}</div>
          <div class="s">#${esc(o.id)} · ${fmtDate(o.createdAt, true)}${o.pickupSpot ? ` · 🤝 ${esc(o.pickupSpot)}${o.pickupDay ? " (" + esc(o.pickupDay) + ")" : ""}` : ""} ${dueChip(o)}</div></div>
        <div class="r"><span class="amt" style="font-weight:800">${o.type === "custom" && o.quote == null ? "No quote yet" : priceHTML(orderValue(o), o.lrdRate || getRate())}</span><span class="status st-${esc(o.status)}">${esc(o.status)}</span></div>
      </div>`).join("")}</div>`
    : `<div class="panel empty"><b>${os.length ? "No orders here" : "No orders yet"}</b>${os.length ? "Try another filter." : "When buyers send an order, it appears here and in your WhatsApp."}</div>`}`;
    liveSearch("oq", (v) => { oQuery = v; renderOrders(); });
    $("#otype").addEventListener("change", (e) => { oType = e.target.value; renderOrders(); });
  }

  let curOrder = null;
  const customItemsTotal = (o) => (o.items || []).filter((i) => i.custom).reduce((a, i) => a + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const hasCustomWork = (o) => o.type === "custom" || (o.items || []).some((i) => i.custom);
  const itemsTotal = (o) => (o.items || []).reduce((a, i) => a + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const isPickup = (o) => o.delivery === "Pickup";
  const feeEditable = (o) => o.type === "cart" && !isPickup(o) && !["Delivered", "Cancelled"].includes(o.status);
  /** Delivery fee as currently typed in the open order (falls back to the saved fee). */
  function draftFee(o) {
    const el = $("#oFee");
    if (!el) return Number(o.deliveryFee) || 0;
    const v = el.value.trim();
    return v === "" || isNaN(+v) || +v < 0 ? 0 : +v;
  }
  const draftTotal = (o) => (o.type === "cart" ? itemsTotal(o) + (isPickup(o) ? 0 : draftFee(o)) : null);
  function draftQuote(o) {
    const el = $("#oQuote");
    const v = el ? el.value.trim() : o.quote;
    return v === "" || v == null || isNaN(+v) ? null : +v;
  }
  /* The confirmation the seller sends before saving. Plain text only: emoji turn into "?" in many WhatsApp links. */
  function confirmText(o, s) {
    const rate = o.lrdRate || getRate();
    const who = String(s.name || SHOP.name).trim();
    const parts = [`Hi ${o.customer.name}, this is ${who} on ${SHOP.name}`];
    let base = null;
    if (o.type === "cart") {
      const fee = draftFee(o);
      base = draftTotal(o);
      parts.push(`your order #${o.id}`);
      parts.push(isPickup(o) ? `Delivery fees: none (pickup${o.pickupSpot ? " at " + o.pickupSpot : ""})`
        : `Delivery fees: ${fee ? money(fee, rate) : "free"}`);
      parts.push(`Total: ${money(base, rate)}`);
    } else {
      base = draftQuote(o);
      parts.push(`your custom request #${o.id}`);
      if (base != null) parts.push(`Price: ${money(base, rate)}`);
    }
    // Deposits are for custom work only: a custom request, or the made-to-order pieces in a cart.
    const depBase = o.type === "cart" ? customItemsTotal(o) : base;
    if (s.depositRequired && s.depositPercent && depBase) {
      const pay = [s.momoNumber && `MTN MoMo ${s.momoNumber}`, s.orangeNumber && `Orange Money ${s.orangeNumber}`].filter(Boolean).join(" or ");
      const label = o.type === "cart" && depBase < itemsTotal(o) ? "on made-to-order pieces" : "";
      parts.push(`Deposit (${s.depositPercent}%${label ? " " + label : ""}): ${money(depBase * s.depositPercent / 100, rate)}${pay ? " via " + pay : ""}`);
    }
    if (o.receiptUrl) parts.push(`Receipt: ${SHOP.siteUrl || location.origin}${o.receiptUrl}`);
    return parts.join(" | ");
  }
  const waSend = (phone, text) => `https://api.whatsapp.com/send?phone=${waNumber(phone)}&text=${encodeURIComponent(text)}`;
  /** Leaving "New" (except to cancel) needs the WhatsApp confirmation first. */
  /** Every save sends the buyer the WhatsApp message, except a cancellation. */
  const sendsWhatsApp = () => curOrder.status !== "Cancelled";
  function totalsFoot(o) {
    const rate = o.lrdRate || getRate();
    const fee = isPickup(o) ? 0 : draftFee(o);
    const feeRow = isPickup(o) ? `<tr class="fee-row"><td colspan="3">Pickup — no delivery fee</td><td class="n">—</td></tr>`
      : `<tr class="fee-row"><td colspan="3">Delivery${o.deliveryOption ? " · " + esc(o.deliveryOption) : ""}</td><td class="n">${fee ? money(fee, rate) : "Free"}</td></tr>`;
    return `${feeRow}<tr><td colspan="3">Total${fee ? " (incl. delivery)" : ""}</td><td class="n">${money(draftTotal(o), rate)}</td></tr>`;
  }
  /** Keep the preview, WhatsApp link, totals and Save label in step with what the seller types. */
  function refreshConfirm() {
    const o = orders.find((x) => x.id === curOrder?.id);
    if (!o || !$("#oConfirmText")) return;
    const s = sellerById(o.sellerId) || MYSELLER || { name: SHOP.name };
    const text = confirmText(o, s);
    $("#oConfirmText").textContent = text;
    curOrder.waHref = waSend(o.customer.phone, text);
    if ($("#oTotals")) $("#oTotals").innerHTML = totalsFoot(o);
    const st = $("#oConfirmState");
    const first = esc(String(o.customer.name).split(" ")[0]);
    st.className = "confirm-state" + (sendsWhatsApp() ? " on" : "");
    st.innerHTML = sendsWhatsApp()
      ? `<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Sent to ${first} on WhatsApp when you press Save${o.confirmedAt ? ` · last sent ${esc(fmtDate(o.confirmedAt, true))}` : ""}`
      : `<i class="fa-solid fa-circle-info" aria-hidden="true"></i> Cancelling: no WhatsApp message is sent`;
    const btn = $("#saveOrder");
    if (btn && !btn.disabled) {
      btn.className = "btn " + (sendsWhatsApp() ? "btn-wa" : "btn-grad");
      btn.innerHTML = sendsWhatsApp() ? `${ICON.wa} Save` : "Save";
      btn.setAttribute("aria-label", sendsWhatsApp() ? "Save and send on WhatsApp" : "Save");
    }
  }

  function openOrder(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    curOrder = { id: o.id, status: o.status, quote: o.quote, adminNote: o.adminNote || "", waHref: "" };
    renderOrder();
    layers.open($("#mOrder"));
    if (!o.seenAt && !isManager()) {          // opening it clears the alert
      o.seenAt = new Date().toISOString();
      unseen = unseen.filter((u) => u.id !== o.id);
      renderAlerts();
      API.orderSeen(o.id);
    }
  }

  function renderOrder() {
    const o = orders.find((x) => x.id === curOrder.id);
    const c = o.custom || {};
    const s = sellerById(o.sellerId) || MYSELLER || { name: SHOP.name };
    const orate = o.lrdRate || getRate();
    const firstName = String(o.customer.name).split(" ")[0];
    const hello = `Hi ${o.customer.name}, this is ${String(s.name).trim()} on ${SHOP.name} | your ${o.type === "cart" ? "order" : "custom request"} #${o.id}`;
    const kv = (label, value) => (value ? `<dt>${label}</dt><dd>${esc(value)}</dd>` : "");
    $("#mOrderSheet").innerHTML = `
    <div class="sh-head"><div><h2 id="moTitle">${o.type === "cart" ? "Order" : "Custom request"} #${esc(o.id)}</h2><div style="color:var(--muted);font-size:.84rem;font-weight:600">${fmtDate(o.createdAt, true)}${isManager() ? " · " + esc(s.name) : ""}</div></div><button class="x" type="button" data-close="mOrder" aria-label="Close">✕</button></div>
    <div class="sh-body">
      <section class="sec" aria-label="Customer">
        <div class="sec-t">Customer</div>
        <dl class="kv">${kv("Name", o.customer.name)}${kv("Phone", o.customer.phone)}${kv("Area", o.customer.location)}${kv("Handoff", o.delivery)}${kv("Delivery area", o.deliveryOption)}${kv("Meetup spot", o.pickupSpot)}${kv("Pickup day", o.pickupDay)}</dl>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <a class="btn btn-wa btn-sm" href="${esc(waSend(o.customer.phone, hello))}" target="_blank" rel="noopener">${ICON.wa} Chat with ${esc(firstName)}</a>
          <a class="btn btn-line btn-sm" href="tel:${esc(String(o.customer.phone).replace(/[^\d+]/g, ""))}">Call</a>
        </div>
      </section>
      ${o.type === "cart" ? `
      <section class="sec" aria-label="Items">
        <div class="sec-t">Items</div>
        <table class="items"><thead><tr><th scope="col">Piece</th><th scope="col">Size / colour</th><th scope="col" style="text-align:right">Qty</th><th scope="col" style="text-align:right">Amount</th></tr></thead>
        <tbody>${(o.items || []).map((i) => `<tr><td><b>${esc(i.name)}</b>${i.custom ? `<div class="mto-line">✂️ ${esc(i.custom.colors)} · needed by ${esc(i.custom.deadline)}${i.custom.notes ? " · " + esc(i.custom.notes) : ""}</div>` : ""}</td><td>${esc(i.size)} · ${esc(i.color)}</td><td class="n">${i.qty}</td><td class="n">${money(i.price * i.qty, orate)}</td></tr>`).join("")}</tbody>
        <tfoot id="oTotals">${totalsFoot(o)}</tfoot></table>
        <p class="note" style="margin-top:10px">💱 Rate used for this order: ${rateText(orate)}</p>
        ${o.note ? `<p class="note" style="margin-top:10px">📝 ${esc(o.note)}</p>` : ""}
      </section>` : `
      <section class="sec" aria-label="Style requested">
        <div class="sec-t">Style requested</div>
        <dl class="kv"><dt>Type</dt><dd>${esc(c.type)} · for ${esc(c.forWho || "")}</dd>${kv("Based on", c.basedOn)}${kv("Usual size", c.usualSize)}${kv("Colours", c.colors)}${kv("Budget", c.budget)}${kv("Needed by", c.date ? fmtDate(c.date) : "")}${kv("Notes", c.notes)}</dl>
      </section>
      ${(c.measurements || []).length ? `<section class="sec" aria-label="Measurements"><div class="sec-t">Measurements (${esc(c.unit)})</div><dl class="kv">${c.measurements.map((m) => `<dt>${esc(m.label)}</dt><dd>${esc(m.value)}${m.unitless ? "" : " " + esc(c.unit)}</dd>`).join("")}</dl></section>` : ""}
      <section class="sec" aria-label="Style photos"><div class="sec-t">Style photos</div>${(o.photoLinks || []).length
        ? `<div class="cphotos">${o.photoLinks.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Style photo ${i + 1}" loading="lazy"></a>`).join("")}</div>
           <p class="note">🔒 These photos are deleted automatically when you mark the order Delivered or Cancelled — save anything you still need first.</p>`
        : `<p class="note">${o.photosDeleted ? "🗑️ The buyer's photos were deleted automatically when this order was completed." : "No photos stored — the buyer may have sent them on WhatsApp."}</p>`}</section>
      <div class="sec field" style="max-width:260px"><label for="oQuote">Your price (in ${esc(SHOP.currency)})</label><input id="oQuote" inputmode="decimal" value="${curOrder.quote ?? ""}" placeholder="Set after agreeing with buyer" aria-describedby="oQuoteHint" data-lrd-hint="oQuoteLrd"><span class="hint" id="oQuoteHint"><b id="oQuoteLrd">${curOrder.quote != null ? "≈ " + lrd(curOrder.quote, orate) : ""}</b> Counts towards total sales once marked Paid.</span></div>`}
      <section class="sec confirm-sec" aria-labelledby="cfLabel">
        <div class="sec-t" id="cfLabel">Confirm with ${esc(firstName)} on WhatsApp</div>
        ${feeEditable(o) ? `<div class="field fee-field"><label for="oFee">Delivery fee (${esc(SHOP.currency)})</label>
          <input id="oFee" inputmode="decimal" value="${esc(o.deliveryFee || "")}" placeholder="0 = free" aria-describedby="oFeeHint" data-lrd-hint="oFeeLrd">
          <span class="hint" id="oFeeHint"><b id="oFeeLrd">${o.deliveryFee ? "≈ " + lrd(o.deliveryFee, orate) : ""}</b> Set it from where the buyer is: <b>${esc(o.customer.location || "area not given")}</b>${o.deliveryOption ? ` (they chose “${esc(o.deliveryOption)}”)` : ""}.</span></div>`
        : o.type === "cart" && isPickup(o) ? `<p class="note">Pickup${o.pickupSpot ? " at <b>" + esc(o.pickupSpot) + "</b>" : ""}: no delivery fee.</p>` : ""}
        <p class="wa-preview" id="oConfirmText"></p>
        <p class="confirm-state" id="oConfirmState"></p>
        ${s.depositRequired && s.depositPercent && hasCustomWork(o) ? `<p class="note">This is custom work and your shop takes a ${s.depositPercent}% deposit, so it's included in the message. Note it below when it's received.</p>` : ""}
      </section>
      <section class="sec" aria-label="Status">
        <div class="sec-t" id="stLabel">Status</div>
        <div class="steps" role="group" aria-labelledby="stLabel">${STATUSES.map((st) => `<button type="button" data-st="${st}" aria-pressed="${curOrder.status === st}">${st === "Delivered" ? "Delivered (sold)" : st}</button>`).join("")}</div>
        ${["New", "Confirmed", "Paid"].includes(o.status) && o.dueAt ? `<p class="note due-note">⏰ Mark this order <b>Delivered (sold)</b> or <b>Cancelled</b> by <b>${fmtDate(o.dueAt)}</b> ${dueChip(o)} — unreported sales suspend your shop ${plural(RULES.graceDays, "day")} after the due date.</p>` : ""}
        <p class="note" style="margin-top:10px">${o.type === "cart" ? "Confirming takes the pieces out of stock; cancelling puts them back. Paid &amp; Delivered count as sales. <b>Delivered (sold)</b> lets the buyer leave a review, adds to your completed handoffs, and retires any piece that has none left (its photos are deleted)." : "Paid &amp; Delivered requests count as sales using your price above."}</p>
      </section>
      <div class="sec field"><label for="oNote">Private note</label><textarea id="oNote" maxlength="2000" placeholder="Deposit received, pickup time…">${esc(curOrder.adminNote)}</textarea></div>
    </div>
    <div class="sh-foot"><button class="btn btn-line" type="button" data-close="mOrder">Close</button><button class="btn btn-grad" type="button" id="saveOrder">Save</button></div>`;
    refreshConfirm();
  }

  async function saveOrder() {
    const o = orders.find((x) => x.id === curOrder.id);
    const ch = {};
    if (curOrder.status !== o.status) ch.status = curOrder.status;
    const note = $("#oNote").value;
    if (note !== (o.adminNote || "")) ch.adminNote = note;
    if ($("#oFee")) {
      const f = $("#oFee").value.trim();
      if (f !== "" && (isNaN(+f) || +f < 0 || +f > 1000)) { toast("Enter a delivery fee between 0 and 1,000"); $("#oFee").focus(); return; }
      if ((+f || 0) !== (Number(o.deliveryFee) || 0)) ch.deliveryFee = +f || 0;
    }
    if ($("#oQuote")) {
      const q = $("#oQuote").value.trim();
      if (q !== "" && (isNaN(+q) || +q < 0)) { toast("Enter a valid price"); $("#oQuote").focus(); return; }
      const qv = q === "" ? null : +q;
      if (qv !== o.quote) ch.quote = qv;
    }
    // Saving sends the buyer the message on WhatsApp (opened right here, inside the click, so it isn't blocked).
    if (sendsWhatsApp()) {
      window.open(curOrder.waHref, "_blank", "noopener");
      ch.confirmSent = true;
    }
    if (!Object.keys(ch).length) { layers.close($("#mOrder")); return; }
    const btn = $("#saveOrder");
    btn.disabled = true;
    btn.textContent = "Saving…";
    const r = await guard(API.updateOrder(o.id, ch), ch.status ? `Marked as ${ch.status === "Delivered" ? "Delivered (sold)" : ch.status}` : "Saved ✓");
    if (!r) { btn.disabled = false; refreshConfirm(); return; }
    if (r.soldProducts && r.soldProducts.length) toast(`Sold out — ${plural(r.soldProducts.length, "piece")} retired and photos deleted`);
    layers.close($("#mOrder"));
    await reload(true);
  }

  /* ================= store settings (seller; manager via "Edit shop") ================= */
  function storeForm(s) {
    const spots = s.pickupSpots && s.pickupSpots.length ? s.pickupSpots : [""];
    return `
    <form class="store-form" id="storeForm" data-sid="${s.id}" novalidate>
      <section class="panel">
        <div class="panel-h"><h2>Shop profile</h2><a class="btn btn-line btn-sm right" href="/s/${esc(s.slug)}" target="_blank" rel="noopener">Preview ↗</a></div>
        <div class="avatar-row">
          <div class="avatar big" id="avPreview">${s.avatar ? `<img src="${esc(s.avatar)}" alt="">` : esc(initials(s.name))}</div>
          <label class="btn btn-line btn-sm"><input type="file" accept="image/*" class="sr" id="avFile">Upload logo / photo</label>
          ${s.avatar ? `<button type="button" class="btn btn-line btn-sm" data-action="rm-avatar">Remove</button>` : ""}
          <input type="hidden" id="stAvatar" value="${esc(s.avatar || "")}">
        </div>
        <div class="grid2">
          <div class="field"><label for="stName">Shop name <span class="req">*</span></label><input id="stName" maxlength="60" value="${esc(s.name)}" required>${s.status === "active" ? `<span class="hint">Your link stays /s/${esc(s.slug)}.</span>` : ""}</div>
          <div class="field"><label for="stOwner">Your name</label><input id="stOwner" maxlength="80" value="${esc(s.ownerName)}"></div>
          <div class="field"><label for="stWa">WhatsApp for orders <span class="req">*</span></label><input id="stWa" type="tel" maxlength="30" value="${esc(s.whatsapp)}" required><span class="hint">Country code + number, e.g. 231770000000.</span></div>
          <div class="field"><label for="stLoc">Area</label><input id="stLoc" maxlength="120" value="${esc(s.location)}" placeholder="e.g. Sinkor, Monrovia"></div>
          <div class="field" style="grid-column:1/-1"><label for="stBio">About your shop</label><textarea id="stBio" maxlength="600" placeholder="What you make, your style, how fast you work…">${esc(s.bio)}</textarea></div>
          <div class="field"><label for="stIg">Instagram link</label><input id="stIg" maxlength="300" value="${esc(s.instagram)}" placeholder="https://instagram.com/…"></div>
          <div class="field"><label for="stFb">Facebook link</label><input id="stFb" maxlength="300" value="${esc(s.facebook)}" placeholder="https://facebook.com/…"></div>
          <div class="field"><label for="stTt">TikTok link</label><input id="stTt" maxlength="300" value="${esc(s.tiktok)}" placeholder="https://tiktok.com/@…"></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Custom orders &amp; deposits</h2></div>
        <label class="switch"><input type="checkbox" role="switch" id="stCustom" ${s.customEnabled ? "checked" : ""}> Accept custom-style requests</label>
        <div class="grid2" style="margin-top:12px">
          <div class="field"><label for="stSlots">Custom slots per week</label><input id="stSlots" type="number" min="0" max="500" value="${esc(s.customSlotsWeek || 0)}"><span class="hint">0 = no limit. Buyers see how many are open this week${s.customSlotsWeek ? ` (now: ${s.customSlotsOpen} open)` : ""}.</span></div>
        </div>
        <label class="switch" style="margin-top:12px"><input type="checkbox" role="switch" id="stDeposit" ${s.depositRequired ? "checked" : ""}> Ask for a mobile-money deposit before starting custom work</label>
        <div class="grid2" style="margin-top:12px">
          <div class="field"><label for="stDepPct">Deposit (%)</label><input id="stDepPct" type="number" min="0" max="100" value="${esc(s.depositPercent || 0)}"></div>
          <div class="field"><label for="stMomo">MTN MoMo number</label><input id="stMomo" type="tel" maxlength="30" value="${esc(s.momoNumber)}"></div>
          <div class="field"><label for="stOrange">Orange Money number</label><input id="stOrange" type="tel" maxlength="30" value="${esc(s.orangeNumber)}"></div>
          <div class="field"><label for="stDepNote">Deposit note</label><input id="stDepNote" maxlength="300" value="${esc(s.depositNote)}" placeholder="e.g. Refundable if I can't start within 3 days"></div>
        </div>
        <p class="note">Numbers are only shown on your shop when a deposit is required.</p>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Pickup &amp; delivery</h2><a class="sub right" href="/legal/safety" target="_blank">Safety guide ↗</a></div>
        <label class="switch"><input type="checkbox" role="switch" id="stDelivery" ${s.deliveryAvailable ? "checked" : ""}> I can deliver</label>
        <div class="field" style="margin-top:12px"><span class="lab">Safe public meetup spots</span>
          <div class="spots" id="stSpots">${spots.map((sp, i) => `<div class="spot-row"><input class="in" data-spot="${i}" maxlength="120" value="${esc(sp)}" placeholder="e.g. ELWA Junction supermarket entrance" aria-label="Meetup spot ${i + 1}"><button type="button" class="icon-btn" data-rmspot="${i}" aria-label="Remove spot ${i + 1}">✕</button></div>`).join("")}</div>
          <button type="button" class="btn btn-line btn-sm" data-action="add-spot" style="margin-top:8px">+ Add spot</button>
          <span class="hint">Busy, well-lit public places — markets, malls, campuses, landmarks, delivery hubs.</span></div>
        <fieldset class="plain" style="margin-top:12px"><legend class="lab">Pickup days</legend>
          <div class="days">${DAYS.map((d) => `<label class="day"><input type="checkbox" value="${d}" data-day ${(s.pickupDays || []).includes(d) ? "checked" : ""}> ${d}</label>`).join("")}</div></fieldset>
        <p class="note">Pickup is always free for buyers.</p>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Delivery fees</h2><span class="sub">buyers pick one at checkout</span></div>
        <p class="note" style="margin-top:0">Add an option for each area you deliver to, with its fee in ${esc(SHOP.currency)} and the details (how and how fast). The fee is added to the buyer's total and shown in the order message. Leave the list empty to agree fees with buyers yourself.</p>
        <div class="dopt-edit" id="stDopts">${(s.deliveryOptions || []).map((o, i) => deliveryRow(o, i)).join("")}</div>
        <button type="button" class="btn btn-line btn-sm" data-action="add-dopt" style="margin-top:10px">+ Add delivery area</button>
        ${s.deliveryAvailable ? "" : `<p class="note" style="margin-top:10px">⚠️ “I can deliver” is switched off above, so buyers won't see these options.</p>`}
      </section>
      <div class="save-bar"><button class="btn btn-grad" type="submit">Save shop settings</button></div>
    </form>`;
  }

  function deliveryRow(o, i) {
    return `
      <div class="dopt-row" data-dopt-row="${i}">
        <input type="hidden" data-dopt-id value="${esc(o.id || "")}">
        <div class="field"><label for="dn${i}">Area</label><input id="dn${i}" class="in" data-dopt-name maxlength="60" value="${esc(o.name || "")}" placeholder="e.g. Sinkor & Congo Town"></div>
        <div class="field"><label for="df${i}">Fee (${esc(SHOP.currency)})</label><input id="df${i}" class="in" data-dopt-fee inputmode="decimal" value="${o.fee ?? ""}" placeholder="0" data-lrd-hint="dl${i}"><span class="hint" id="dl${i}">${o.fee !== "" && o.fee != null ? "≈ " + lrd(o.fee) : "0 = free"}</span></div>
        <div class="field dopt-details"><label for="dd${i}">Details</label><input id="dd${i}" class="in" data-dopt-details maxlength="200" value="${esc(o.details || "")}" placeholder="e.g. Same day by motorbike, 2–4 hrs"></div>
        <button type="button" class="icon-btn" data-rmdopt="${i}" aria-label="Remove delivery area ${i + 1}">✕</button>
      </div>`;
  }

  function readStoreForm() {
    const spots = $$("[data-spot]").map((i) => i.value.trim()).filter(Boolean);
    const deliveryOptions = $$("[data-dopt-row]").map((r) => ({
      id: $("[data-dopt-id]", r).value, name: $("[data-dopt-name]", r).value.trim(),
      fee: $("[data-dopt-fee]", r).value.trim() === "" ? 0 : Number($("[data-dopt-fee]", r).value.trim()),
      details: $("[data-dopt-details]", r).value.trim()
    })).filter((o) => o.name);
    return {
      name: $("#stName").value.trim(), ownerName: $("#stOwner").value.trim(), whatsapp: $("#stWa").value.trim(),
      location: $("#stLoc").value.trim(), bio: $("#stBio").value.trim(), avatar: $("#stAvatar").value,
      instagram: $("#stIg").value.trim(), facebook: $("#stFb").value.trim(), tiktok: $("#stTt").value.trim(),
      customEnabled: $("#stCustom").checked, customSlotsWeek: Number($("#stSlots").value) || 0,
      depositRequired: $("#stDeposit").checked, depositPercent: Number($("#stDepPct").value) || 0,
      momoNumber: $("#stMomo").value.trim(), orangeNumber: $("#stOrange").value.trim(), depositNote: $("#stDepNote").value.trim(),
      deliveryAvailable: $("#stDelivery").checked, pickupSpots: spots, pickupDays: $$("[data-day]:checked").map((i) => i.value),
      deliveryOptions
    };
  }

  function rerenderStoreForm() {
    const sid = $("#storeForm").dataset.sid;
    const data = readStoreForm();
    const base = sellerById(sid) || MYSELLER;
    const holder = $("#storeForm").parentElement;
    holder.innerHTML = storeForm({ ...base, ...data });
  }

  async function saveStore(e) {
    e.preventDefault();
    const sid = $("#storeForm").dataset.sid;
    const data = readStoreForm();
    if (data.depositRequired && !data.momoNumber && !data.orangeNumber) { toast("Add a MoMo or Orange Money number for deposits"); $("#stMomo").focus(); return; }
    const r = await guard(API.saveStore(data, isManager() ? Number(sid) : undefined), "Shop settings saved ✓");
    if (!r) return;
    if (isManager()) {
      const s = sellerById(sid);
      if (s) Object.assign(s, r.seller);
      layers.close($("#mSeller"));
    } else {
      MYSELLER = r.seller;
      buildNav();
    }
    render();
  }

  function renderStore() {
    $("#view").innerHTML = `<div class="store-wrap">${shareCard(MYSELLER)}<div>${storeForm(MYSELLER)}</div></div>`;
  }

  /* ================= ad revenue (manager) ================= */
  async function renderAds() {
    $("#view").innerHTML = `<div class="loader" role="status"><i></i>Loading ad report…</div>`;
    const r = await guard(API.adReport(adMonth));
    if (!r || view !== "ads") return;
    paintAds(r.report, r.adsense);
  }

  function paintAds(rep, adsense) {
    const rate = getRate();
    $("#view").innerHTML = `
    <div class="cols3" style="margin-top:0">
      <section class="panel">
        <div class="panel-h"><h2>How revenue is split</h2></div>
        <p class="note" style="margin-top:0">AdSense reports one total for the whole site. Every page load of a seller's shop or product pages is counted for that seller (bots and signed-in users excluded), so each seller's share = their ad-page views ÷ all ad-page views that month.</p>
        <p class="note">${adsense.client ? `AdSense is <b>on</b> (${esc(adsense.client)}). Ads show only to visitors who accept advertising cookies.` : "AdSense is <b>off</b>. Add ADSENSE_CLIENT (and ADSENSE_SLOT) to .env once your site is approved — page views are already being counted."}</p>
      </section>
      <section class="panel">
        <div class="panel-h"><h2>Earnings for the month</h2></div>
        <form id="adForm" class="grid2" novalidate>
          <div class="field"><label for="adMonth">Month</label><input id="adMonth" type="month" value="${esc(rep.month)}"></div>
          <div class="field"><label for="adAmount">AdSense earnings (US$)</label><input id="adAmount" inputmode="decimal" value="${rep.amount || ""}" placeholder="from AdSense → Reports" data-lrd-hint="adLrd"><span class="hint" id="adLrd">${rep.amount ? "≈ " + lrd(rep.amount) : ""}</span></div>
          <div class="field" style="grid-column:1/-1"><label for="adNote">Note</label><input id="adNote" maxlength="200" value="${esc(rep.note)}" placeholder="e.g. Finalised earnings, paid 21st"></div>
          <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-grad" type="submit">Save &amp; split</button><button class="btn btn-line" type="button" data-action="ads-csv">Download CSV</button></div>
        </form>
      </section>
    </div>
    <section class="panel" style="margin-top:16px">
      <div class="panel-h"><h2>${new Date(rep.from + "T12:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><span class="sub">${num(rep.totalAdPageViews)} ad-page views · ${usd(rep.amount)} earned</span></div>
      ${rep.lines.length ? `<div class="table-wrap"><table class="items stable">
        <thead><tr><th scope="col">Seller</th><th scope="col" class="n">Shop views</th><th scope="col" class="n">Product views</th><th scope="col" class="n">Ad-page views</th><th scope="col" class="n">Share</th><th scope="col" class="n">Revenue</th></tr></thead>
        <tbody>${rep.lines.map((l) => `<tr><td><b>${esc(l.name)}</b>${l.slug ? ` <a href="/s/${esc(l.slug)}" target="_blank" rel="noopener" class="sub">/s/${esc(l.slug)}</a>` : ""}</td>
          <td class="n">${num(l.storeViews)}</td><td class="n">${num(l.productPageViews)}</td><td class="n">${num(l.adPageViews)}</td>
          <td class="n">${(l.share * 100).toFixed(1)}%</td><td class="n">${usd(l.revenue)}<div class="sub">≈ ${lrd(l.revenue, rate)}</div></td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="empty"><b>No page views recorded for this month</b>Views are counted from the moment the site is live.</div>`}
    </section>`;
    $("#adMonth").addEventListener("change", (e) => { adMonth = e.target.value; renderAds(); });
    window.__adReport = rep;
  }

  function downloadAdsCSV() {
    const rep = window.__adReport;
    if (!rep) return;
    downloadCSV(`crochets-market-ad-revenue-${rep.month}.csv`,
      ["Month", "Seller", "Shop link", "Shop views", "Product page views", "Ad-page views", "Share %", "Revenue (US$)"],
      rep.lines.map((l) => [rep.month, l.name, l.slug ? storeUrl(l.slug) : "", l.storeViews, l.productPageViews, l.adPageViews, (l.share * 100).toFixed(2), l.revenue]));
  }

  /* ================= settings & help ================= */
  function renderMore() {
    $("#view").innerHTML = `
    <div class="cols3" style="margin-top:0">
      <section class="panel help">
        <h3>Your account</h3>
        <dl class="kv"><dt>Email</dt><dd>${esc(ME.email)}</dd><dt>Role</dt><dd>${isManager() ? "Platform manager" : "Seller"}</dd>${MYSELLER ? `<dt>Shop</dt><dd>${esc(MYSELLER.name)} · ${statusPill(MYSELLER.status)}</dd>` : ""}</dl>
        <form id="pwForm" class="grid2" style="margin-top:14px" novalidate>
          <div class="field"><label for="pwCur">Current password</label><input id="pwCur" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="pwNew">New password</label><input id="pwNew" type="password" autocomplete="new-password" minlength="8"></div>
          <div style="grid-column:1/-1"><button class="btn btn-line btn-sm" type="submit">Change password</button></div>
        </form>
      </section>
      ${isManager() ? `
      <section class="panel help">
        <h3>Exchange rate</h3>
        <p style="color:var(--muted)">Prices are set in US dollars and shown with the Liberian-dollar equivalent everywhere. Orders keep the rate they were placed at.</p>
        <form id="rateForm" novalidate>
          <div class="field"><label for="fRate">Liberian dollars for ${esc(SHOP.currency)}1</label>
            <div class="rate-row"><span class="rate-prefix" aria-hidden="true">${esc(SHOP.currency)}1 = ${esc(SHOP.altCurrency)}</span><input id="fRate" inputmode="decimal" value="${getRate()}" required><button class="btn btn-grad btn-sm" type="submit">Save rate</button></div>
            <span class="hint">Example: ${esc(SHOP.currency)}25 shows as ${lrd(25)}.</span></div>
        </form>
      </section>` : shareCard(MYSELLER)}
      <section class="panel help">
        <h3>Tools</h3>
        <p style="color:var(--muted);font-size:.88rem;margin:0 0 8px">Download your dashboard, sales, orders and stock as an Excel workbook or a PDF report.</p>
        ${reportBar(true)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-line btn-sm" type="button" data-action="csv">Download orders (CSV)</button>
          ${isManager() ? `<button class="btn btn-line btn-sm" type="button" data-view="products">All crochets</button><button class="btn btn-line btn-sm" type="button" data-view="ads">Ad revenue</button>` : `<button class="btn btn-line btn-sm" type="button" data-view="store">Shop settings</button>`}
          <a class="btn btn-line btn-sm" href="/legal/${isManager() ? "terms" : "sellers"}" target="_blank" rel="noopener">${isManager() ? "Terms of Use" : "Seller Policy"} ↗</a>
          <button class="btn btn-primary btn-sm" type="button" data-action="logout">Sign out</button>
        </div>
        <p style="color:var(--muted);font-size:.88rem;margin-top:14px">${esc(SHOP.name)} was built by <a href="/about/developer" target="_blank" rel="noopener">Mandella L. Wleh-Sam</a>. Need help? Email <a href="mailto:${esc(SHOP.email)}">${esc(SHOP.email)}</a>.</p>
      </section>
    </div>`;
  }

  function downloadCSV(filename, header, rows) {
    const cell = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadOrdersCSV() {
    const os = scopedOrders();
    downloadCSV(`crochets-market-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Date", "Order #", "Shop", "Type", "Customer", "Phone", "Area", "Items", "Handoff", "Meetup spot", "Pickup day", "Value (US$)", "Value (L$)", "Rate (L$ per US$)", "Status", "Private note"],
      os.map((o) => [
        o.createdAt ? new Date(o.createdAt).toISOString().replace("T", " ").slice(0, 16) : "", o.id, sellerName(o.sellerId),
        o.type === "cart" ? (o.customWork ? "Made to order" : "Shop") : "Custom", o.customer.name, o.customer.phone, o.customer.location || "",
        itemsSummary(o), o.delivery || "", o.pickupSpot || "", o.pickupDay || "", orderValue(o),
        Math.round(orderValue(o) * (o.lrdRate || getRate())), o.lrdRate || getRate(), o.status, o.adminNote || ""]));
    toast(`Downloaded ${plural(os.length, "order")}`);
  }

  /* ================= new-order alerts =================
     The dashboard checks for orders the seller hasn't opened yet every 30 seconds (and whenever the tab comes back).
     A new one rings a short chime, shows a toast and, if the seller allowed it, a phone/desktop notification. */
  let unseen = [];                 // [{id, customer, total, createdAt, sellerId, type, lrdRate}]
  let knownAlerts = null;          // ids already announced (null until the first check, so old ones don't ring)
  let alertTimer = 0;
  const POLL_MS = 30000;
  const canNotify = () => "Notification" in window;

  function chime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = chime.ctx || (chime.ctx = new Ctx());
      [880, 1320].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.16;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.4);
      });
    } catch { /* sound is a bonus */ }
  }

  async function systemNotify(a) {
    if (!canNotify() || Notification.permission !== "granted") return;
    const title = `New ${a.type === "cart" ? "order" : "custom request"} from ${a.customer}`;
    const body = `#${a.id}${a.total != null ? " · " + money(a.total, a.lrdRate || getRate()) : ""}${isManager() ? " · " + sellerName(a.sellerId) : ""}`;
    const opts = { body, tag: a.id, icon: "/static/icons/icon-192.png", badge: "/static/icons/icon-192.png", data: { url: "/admin#orders" } };
    try {
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) return reg.showNotification(title, opts);
      new Notification(title, opts);
    } catch { /* ignore */ }
  }

  function renderAlerts() {
    const n = unseen.length;
    const c = $("#notifCount");
    if (!c) return;
    c.textContent = n > 99 ? "99+" : n;
    c.classList.toggle("hidden", !n);
    $("#notifBtn").setAttribute("aria-label", n ? `Order alerts: ${n} new` : "Order alerts");
    $("#notifBtn").classList.toggle("ring", !!n);
    const perm = canNotify() ? Notification.permission : "unsupported";
    $("#notifPanel").innerHTML = `
      <div class="np-head"><b>New orders</b><span>${n ? `${n} not opened yet` : "You're all caught up"}</span></div>
      ${n ? `<div class="np-list">${unseen.map((a) => `
        <button type="button" class="np-item" data-order="${esc(a.id)}">
          <span class="avatar" aria-hidden="true">${esc(initials(a.customer))}</span>
          <span class="np-t"><b>${esc(a.customer)}</b><small>${a.type === "cart" ? "Order" : "Custom request"} #${esc(a.id)}${isManager() ? " · " + esc(sellerName(a.sellerId)) : ""}</small></span>
          <span class="np-r">${a.total != null ? `<b>${esc(usd(a.total))}</b>` : ""}<small>${esc(ago(a.createdAt))}</small></span>
        </button>`).join("")}</div>` : `<p class="np-empty"><i class="fa-regular fa-bell" aria-hidden="true"></i>New orders show up here the moment a buyer sends their cart.</p>`}
      <div class="np-foot">${perm === "default" ? `<button type="button" class="btn btn-grad btn-sm" data-action="notif-enable"><i class="fa-solid fa-bell" aria-hidden="true"></i> Turn on phone alerts</button>`
        : perm === "granted" ? `<span class="np-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Phone alerts are on</span>`
        : perm === "denied" ? `<span class="np-note">Alerts are blocked. Allow notifications for this site in your browser settings.</span>` : ""}
        <button type="button" class="btn btn-line btn-sm" data-go="orders:New">All new orders</button></div>`;
  }

  async function pollAlerts() {
    clearTimeout(alertTimer);
    if (!ME) return;
    const r = await API.pulse();
    if (r && r.ok) {
      const fresh = knownAlerts ? r.unseen.filter((a) => !knownAlerts.has(a.id)) : [];
      knownAlerts = new Set([...(knownAlerts || []), ...r.unseen.map((a) => a.id)]);
      unseen = r.unseen;
      renderAlerts();
      if (fresh.length) {
        chime();
        toast(fresh.length > 1 ? `${fresh.length} new orders` : `New ${fresh[0].type === "cart" ? "order" : "request"} from ${fresh[0].customer}`);
        fresh.slice(0, 3).forEach(systemNotify);
        // Bring the lists up to date, unless the seller is in the middle of editing something.
        if (!document.querySelector(".modal.open") && view !== "store") reload(true);
      }
    }
    if (document.visibilityState === "visible") alertTimer = setTimeout(pollAlerts, POLL_MS);
  }

  function toggleAlerts(open) {
    const p = $("#notifPanel"), b = $("#notifBtn");
    const show = open ?? p.classList.contains("hidden");
    p.classList.toggle("hidden", !show);
    b.setAttribute("aria-expanded", show);
    if (show) renderAlerts();
  }

  /* ================= dialogs ================= */
  function confirmBox(title, text, okLabel, onOk) {
    $("#mConfirmSheet").innerHTML = `<div class="sh-body"><h2 id="mcTitle" style="font-family:var(--head);margin:0 0 8px">${esc(title)}</h2><p style="color:var(--muted);margin:0 0 18px">${esc(text)}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn btn-line" type="button" data-close="mConfirm">Cancel</button><button class="btn btn-danger" type="button" id="cOk">${esc(okLabel)}</button></div></div>`;
    $("#cOk").onclick = async () => { $("#cOk").disabled = true; layers.close($("#mConfirm")); await onOk(); };
    layers.open($("#mConfirm"), { focus: "[data-close]" });
  }

  /* ================= data ================= */
  async function reload(quiet) {
    const b = $("#refreshBtn");
    b.classList.add("spin");
    const r = await guard(API.load());
    b.classList.remove("spin");
    if (!r) {
      if (!quiet && !products.length && ME) $("#view").innerHTML = `<div class="panel empty"><b>Couldn't load your data</b>Check your internet, then tap refresh ↻.</div>`;
      return;
    }
    if (r.settings) setRate(r.settings.usdToLrd);
    products = r.products;
    orders = (r.orders || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    analytics = r.analytics || {};
    if (r.sellers) { sellers = r.sellers; fillScope(); }
    if (r.reviews) myReviews = r.reviews;
    if (r.rules) RULES = r.rules;
    due = r.due || [];
    if (r.seller) { MYSELLER = r.seller; buildNav(); }
    render();
  }

  async function stockStep(id, d) {
    const p = pById(id);
    if (!p || (d < 0 && p.stock <= 0)) return;
    p.stock += d;
    render();
    $(`[data-stock="${cssId(id)}"][data-d="${d}"]`)?.focus();
    const r = await guard(API.adjustStock(id, d));
    if (r && typeof r.stock === "number") p.stock = r.stock;
    else if (!r) { p.stock -= d; render(); }
  }

  /* ================= auth ================= */
  async function enterApp(me) {
    ME = me.user;
    MYSELLER = me.seller || null;
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    buildNav();
    const h = location.hash.slice(1);
    view = allowed().some((n) => n.id === h) ? h : "dash";
    $("#view").innerHTML = `<div class="loader" role="status"><i></i>Loading…</div>`;
    await reload();
    go(view);
    pollAlerts();
  }

  function signOutLocal() {
    ME = null; MYSELLER = null;
    products = []; orders = []; sellers = []; analytics = {};
    scope = "all";
    layers.closeAll();
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
    $("#pw").value = "";
  }

  async function logout() {
    await API.logout();
    signOutLocal();
    $("#email").focus();
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    $("#loginErr").textContent = "";
    const r = await API.login($("#email").value.trim(), $("#pw").value, $("#remember").checked);
    btn.disabled = false;
    btn.textContent = "Sign in";
    if (r && r.ok) {
      $("#pw").value = "";
      const me = await API.me();
      if (me.signedIn) await enterApp(me);
    } else {
      $("#loginErr").textContent = r?.error || "Wrong email or password";
      $("#pw").select();
    }
  });

  /* ================= events ================= */
  document.addEventListener("click", (e) => {
    // The alerts panel closes on any click outside it, and after choosing an order from it.
    if (!e.target.closest(".notif-wrap") || e.target.closest("#notifPanel [data-order], #notifPanel [data-go]")) $("#notifPanel")?.classList.add("hidden"), $("#notifBtn")?.setAttribute("aria-expanded", "false");
    const t = e.target.closest("button, [data-go], [data-order], [data-edit], [data-scope], a");
    if (!t) return;
    const d = t.dataset;

    if (d.view) return go(d.view);
    if (d.scope) { scope = String(d.scope); fillScope(); return go("dash"); }
    if (d.go) {
      const [v, f] = d.go.split(":");
      if (v === "orders") { if (f === "custom") { oType = "custom"; oFilter = "All"; } else { oFilter = f || "All"; oType = "all"; } }
      if (v === "products") pFilter = f || "all";
      return go(v);
    }
    if (d.copy) { e.preventDefault(); return copy(d.copy, "Copied ✓"); }
    if (d.report) return downloadReport(d.report);
    if (d.reportFor) {
      const a = Object.assign(document.createElement("a"), { href: `/api/dash/report.${d.fmt}?period=all&seller=${encodeURIComponent(d.reportFor)}` });
      document.body.appendChild(a); a.click(); a.remove();
      return toast("Preparing the report…");
    }
    if (d.order) return openOrder(d.order);
    if (d.edit) return openEditor(d.edit);
    if (d.flyer) return openFlyer(d.flyer);
    if (d.sold) {
      const p = pById(d.sold);
      confirmBox(`Mark “${p.name}” as sold?`, "It leaves your shop and its photos are deleted permanently. Sold a piece outside the app? You still have to mark it here.", "Mark as sold", async () => {
        const r = await guard(API.markSold(p.id), "Marked as sold — photos deleted");
        if (r) await reload(true);
      });
      return;
    }
    if (d.del) {
      const p = pById(d.del);
      confirmBox("Delete this crochet?", `“${p.name}” will be removed from the shop. Past orders keep their details.`, "Delete", async () => {
        const r = await guard(API.deleteProduct(p.id), "Deleted");
        if (r) { products = products.filter((x) => x.id !== p.id); render(); }
      });
      return;
    }
    if (d.sact) return sellerAction(d.sact, d.sid);
    if (d.hideReview) {
      guard(API.hideReview(Number(d.hideReview), d.hidden === "1"), d.hidden === "1" ? "Review hidden" : "Review shown").then((r) => {
        if (r) { t.dataset.hidden = d.hidden === "1" ? "0" : "1"; t.textContent = d.hidden === "1" ? "Hide" : "Show"; }
      });
      return;
    }
    if (d.stock) return stockStep(d.stock, Number(d.d));
    if (d.pf) { pFilter = d.pf; renderProducts(); return; }
    if (d.of) { oFilter = d.of; renderOrders(); return; }
    if (d.sf) { sFilter = d.sf; renderSellers(); return; }
    if (d.close) return layers.close($("#" + d.close));
    if (d.st) {
      curOrder.status = d.st;
      $$(".steps button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.st === curOrder.status));
      refreshConfirm();
      return;
    }
    if (t.id === "saveOrder") return saveOrder();
    if (t.id === "saveProduct") return saveProduct();
    if (d.sz) {
      readForm();
      edit.sizes = edit.sizes.includes(d.sz) ? edit.sizes.filter((x) => x !== d.sz) : [...edit.sizes, d.sz];
      t.setAttribute("aria-pressed", edit.sizes.includes(d.sz));
      return;
    }
    if (d.rmimg) { readForm(); edit.images.splice(+d.rmimg, 1); renderEditor(); return; }
    if (d.cover) { readForm(); const [x] = edit.images.splice(+d.cover, 1); edit.images.unshift(x); renderEditor(); return; }
    if (d.rmc) { readForm(); edit.colors.splice(+d.rmc, 1); renderEditor(); return; }
    if (d.rmspot) { $$("[data-spot]")[+d.rmspot].value = ""; rerenderStoreForm(); return; }
    if (d.rmdopt) { $(`[data-dopt-row="${d.rmdopt}"]`)?.remove(); return; }

    switch (d.action) {
      case "add-product": openEditor(null); break;
      case "add-seller": openAddSeller(); break;
      case "add-color": readForm(); edit.colors.push({ n: "", h: "#A3BEE6" }); renderEditor(); $$("[data-cn]").pop()?.focus(); break;
      case "add-size": {
        readForm();
        const v = $("#fSizeNew").value.trim().slice(0, 20);
        if (v && !edit.sizes.includes(v)) edit.sizes.push(v);
        renderEditor();
        $("#fSizeNew").focus();
        break;
      }
      case "add-dopt": {
        if ($$("[data-dopt-row]").length >= 15) { toast("Up to 15 delivery areas"); break; }
        const i = Date.now() % 100000;
        $("#stDopts").insertAdjacentHTML("beforeend", deliveryRow({ id: "", name: "", fee: "", details: "" }, i));
        $(`#dn${i}`).focus();
        break;
      }
      case "add-spot": {
        if ($$("[data-spot]").length >= 10) { toast("Up to 10 spots"); break; }
        const holder = $("#stSpots");
        const i = $$("[data-spot]").length;
        holder.insertAdjacentHTML("beforeend", `<div class="spot-row"><input class="in" data-spot="${i}" maxlength="120" placeholder="Another public spot" aria-label="Meetup spot ${i + 1}"><button type="button" class="icon-btn" data-rmspot="${i}" aria-label="Remove spot ${i + 1}">✕</button></div>`);
        $(`[data-spot="${i}"]`).focus();
        break;
      }
      case "rm-avatar": $("#stAvatar").value = ""; rerenderStoreForm(); break;
      case "refresh": reload(); break;
      case "logout": clearTimeout(alertTimer); logout(); break;
      case "notif": toggleAlerts(); break;
      case "notif-enable":
        if (canNotify()) Notification.requestPermission().then((p) => { renderAlerts(); if (p === "granted") toast("Phone alerts are on"); });
        break;
      case "csv": downloadOrdersCSV(); break;
      case "ads-csv": downloadAdsCSV(); break;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#notifPanel").classList.contains("hidden")) { toggleAlerts(false); $("#notifBtn").focus(); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-order], [role=button][data-go], [role=button][data-edit], [role=button][data-scope]")) {
      e.preventDefault();
      e.target.click();
    }
    if (e.key === "Enter" && e.target.id === "fSizeNew") { e.preventDefault(); $('[data-action="add-size"]').click(); }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "delConfirm") {
      $("#delBtn").disabled = e.target.value.trim().toLowerCase() !== $("#deleteSellerForm").dataset.slug;
    }
    const hintId = e.target.dataset && e.target.dataset.lrdHint;
    if (hintId && $("#" + hintId)) {
      const v = e.target.value.trim();
      const r = ["oQuote", "oFee"].includes(e.target.id) ? orders.find((o) => o.id === curOrder?.id)?.lrdRate || getRate() : getRate();
      $("#" + hintId).textContent = v !== "" && !isNaN(+v) ? `≈ ${lrd(+v, r)}` : "";
    }
    if (["oQuote", "oFee"].includes(e.target.id)) refreshConfirm();
    const field = e.target.closest(".field.err");
    if (field) { field.classList.remove("err"); e.target.removeAttribute("aria-invalid"); }
  });

  document.addEventListener("change", async (e) => {
    if (e.target.id === "scope") { scope = e.target.value; render(); }
    if (e.target.matches("[data-report-period]")) { reportPeriod = e.target.value; store.set("reportPeriod", reportPeriod); }
    if (e.target.id === "avFile" && e.target.files[0]) {
      try {
        const data = await compressImage(e.target.files[0], { max: 600, quality: 0.86, as: "dataURL" });
        const r = await guard(API.uploadImage(data, "shop-logo.jpg"));
        if (r) { $("#stAvatar").value = r.url; $("#avPreview").innerHTML = `<img src="${esc(r.url)}" alt="">`; toast("Photo uploaded — remember to save"); }
      } catch { toast("Couldn't read that image"); }
    }
  });

  document.addEventListener("submit", async (e) => {
    const id = e.target.id;
    if (id === "storeForm") return saveStore(e);
    if (id === "deleteSellerForm") {
      e.preventDefault();
      const form = e.target;
      if ($("#delConfirm").value.trim().toLowerCase() !== form.dataset.slug) return;
      $("#delBtn").disabled = true;
      $("#delBtn").textContent = "Deleting…";
      const r = await guard(API.deleteSeller(Number(form.dataset.sid), form.dataset.slug));
      if (!r) { $("#delBtn").disabled = false; $("#delBtn").textContent = "Delete shop permanently"; return; }
      layers.close($("#mSeller"));
      if (String(scope) === String(form.dataset.sid)) scope = "all";
      toast(`${r.deleted.name} deleted — ${plural(r.deleted.products, "crochet")}, ${plural(r.deleted.orders, "order")} removed`);
      await reload(true);
      fillScope();
      return;
    }
    if (id === "rateForm") {
      e.preventDefault();
      const input = $("#fRate");
      const v = Number(input.value.trim());
      if (!(v >= 1 && v <= 100000)) { toast("Enter how many L$ make US$1, e.g. 171"); input.focus(); return; }
      const r = await guard(API.saveSettings({ usdToLrd: v }), "Exchange rate saved ✓");
      if (r) { setRate(r.settings.usdToLrd); render(); }
    }
    if (id === "pwForm") {
      e.preventDefault();
      const r = await guard(API.changePassword($("#pwCur").value, $("#pwNew").value), "Password changed ✓");
      if (r) { $("#pwCur").value = ""; $("#pwNew").value = ""; }
    }
    if (id === "addSellerForm") {
      e.preventDefault();
      const data = { shopName: $("#asShop").value.trim(), ownerName: $("#asOwner").value.trim(), email: $("#asEmail").value.trim(), whatsapp: $("#asWa").value.trim(), location: $("#asLoc").value.trim() };
      const r = await guard(API.createSeller(data), "Shop created 🎉");
      if (r) { layers.close($("#mSeller")); await reload(true); showSecret(`Login for ${data.shopName}`, data.email, r.tempPassword); }
    }
    if (id === "adForm") {
      e.preventDefault();
      const amount = $("#adAmount").value.trim();
      if (amount === "" || isNaN(+amount) || +amount < 0) { toast("Enter the AdSense earnings in US$"); $("#adAmount").focus(); return; }
      adMonth = $("#adMonth").value;
      const r = await guard(API.saveAdRevenue(adMonth, +amount, $("#adNote").value.trim()), "Saved — revenue split updated");
      if (r) paintAds(r.report, (await API.adReport(adMonth)).adsense || {});
    }
  });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ME) { reload(true); pollAlerts(); } });

  /* ================= start ================= */
  (async function start() {
    layers.init({ backgroundEls: [$("#app")], scrimEl: $("#scrim"), layerEls: [$("#mProduct"), $("#mOrder"), $("#mSeller"), $("#mFlyer"), $("#mConfirm")] });
    window.Market.registerServiceWorker();   // lets new-order alerts show as phone notifications
    const me = await API.me();
    $("#demoTag").classList.toggle("hidden", !me.devLogins);
    if (me.signedIn) await enterApp(me);
    else $("#email").focus();
  })();
})();
