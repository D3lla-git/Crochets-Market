/* =====================================================================
   Crochets Market — public marketplace (home, store and product pages).
   The page tells us what it is with <body data-page data-seller data-product>.
   ===================================================================== */
(function () {
  "use strict";

  const { SHOP, $, $$, cssId, esc, money, priceHTML, rateText, setRate, plural, store, toast, isImageFile,
    compressImage, blobToDataURL, layers, ICON } = window.Market;
  const API = window.API;
  const art = window.crochetArt;

  const PAGE = document.body.dataset.page || "home";        // home | store | product
  const SELLER = document.body.dataset.seller || "";        // store slug on store/product pages
  const START_PRODUCT = document.body.dataset.product || "";
  const BASE_URL = PAGE === "home" ? "/" : `/s/${SELLER}`;

  /* ---------------- custom-order measurement catalogue ---------------- */
  const MEASURES = {
    "Top / crop top":     ["bust", "underbust", "waist", "shoulder", "topLength", "armhole"],
    "Dress":              ["bust", "waist", "hips", "shoulder", "dressLength", "sleeve"],
    "Skirt":              ["waist", "hips", "skirtLength"],
    "Cardigan / sweater": ["bust", "shoulder", "sleeve", "upperArm", "bodyLength"],
    "Two-piece set":      ["bust", "underbust", "waist", "hips", "topLength", "bottomLength"],
    "Trousers / shorts":  ["waist", "hips", "thigh", "inseam", "outseam"],
    "Swimwear":           ["bust", "underbust", "waist", "hips"],
    "Kids wear":          ["age", "chest", "waist", "height", "bodyLength"],
    "Hat / beanie":       ["head"],
    "Bag / accessory":    [],
    "Other":              ["bust", "waist", "hips"]
  };
  const REQUIRED = {
    "Top / crop top": ["bust", "waist"], "Dress": ["bust", "waist", "hips"], "Skirt": ["waist", "hips"],
    "Cardigan / sweater": ["bust"], "Two-piece set": ["bust", "waist", "hips"], "Trousers / shorts": ["waist", "hips"],
    "Swimwear": ["bust", "waist", "hips"], "Kids wear": ["age"], "Hat / beanie": ["head"]
  };
  const M = {
    bust: { l: "Bust / chest", h: "Fullest part, under the arms" },
    underbust: { l: "Under-bust", h: "Just below the bust" },
    waist: { l: "Waist", h: "Narrowest part" },
    hips: { l: "Hips", h: "Fullest part" },
    shoulder: { l: "Shoulder width", h: "Shoulder point to shoulder point" },
    topLength: { l: "Top length", h: "Shoulder to where top ends" },
    armhole: { l: "Armhole", h: "Around shoulder & under arm" },
    dressLength: { l: "Dress length", h: "Shoulder to hem" },
    sleeve: { l: "Sleeve length", h: "Shoulder to wrist (0 if none)" },
    skirtLength: { l: "Skirt length", h: "Waist to hem" },
    upperArm: { l: "Upper arm", h: "Around the widest part" },
    bodyLength: { l: "Body length", h: "Shoulder to hem" },
    bottomLength: { l: "Bottom length", h: "Waist to hem" },
    thigh: { l: "Thigh", h: "Around the widest part" },
    inseam: { l: "Inseam", h: "Crotch to ankle/hem" },
    outseam: { l: "Outseam / length", h: "Waist to hem, outside leg" },
    chest: { l: "Chest", h: "Around the chest" },
    height: { l: "Height", h: "Head to toe" },
    head: { l: "Head", h: "Around forehead & back of head" },
    age: { l: "Child's age", h: "e.g. 3 years", unitless: true }
  };
  const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
  const MAX_PHOTOS = 6;
  const SAVED = "♥ Saved";

  /* ---------------- state ---------------- */
  let PRODUCTS = [];           // every available product in the marketplace
  let SELLERS = {};            // slug → public profile
  let DIRECTORY = [];          // all active makers (home page)
  let loaded = false;
  let cart = store.get("cart2", []);
  let favs = new Set(store.get("favs", []));
  let me = store.get("me", { name: "", phone: "", location: "" });
  let filter = "All";
  let query = "";
  let sort = "featured";

  const byId = (id) => PRODUCTS.find((p) => p.id === id);
  const sellerOf = (p) => SELLERS[p.seller] || { name: "Maker", slug: p.seller, pickupSpots: [], pickupDays: [], deliveryAvailable: true };
  const pageProducts = () => (PAGE === "home" ? PRODUCTS : PRODUCTS.filter((p) => p.seller === SELLER));
  const media = (p, colorHex, idx = 0) =>
    p.images && p.images.length
      ? `<img src="${esc(p.images[idx] || p.images[0])}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
      : art(p, colorHex);
  // api.whatsapp.com/send keeps the text intact; the wa.me redirect re-encodes it and can mangle characters.
  const waLink = (text, number) => `https://api.whatsapp.com/send?phone=${String(number || SHOP.whatsapp).replace(/\D/g, "")}&text=${encodeURIComponent(text)}`;
  const stars = (n) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

  /* ================= makers directory (home) ================= */
  function makerCard(s) {
    const slots = s.customEnabled
      ? (s.customSlotsWeek ? (s.customSlotsOpen ? `${s.customSlotsOpen} custom slot${s.customSlotsOpen === 1 ? "" : "s"} open` : "Custom: fully booked") : "Takes custom orders")
      : "";
    return `
      <a class="maker" href="/s/${esc(s.slug)}">
        <span class="maker-av">${s.avatar ? `<img src="${esc(s.avatar)}" alt="" loading="lazy">` : esc(s.name.slice(0, 1))}</span>
        <span class="maker-body">
          <b>${esc(s.name)} ${s.phoneVerified ? '<i class="fa-solid fa-circle-check verified" title="Verified phone" aria-label="Verified phone"></i>' : ""}</b>
          <small>${esc(s.location || "Liberia")}</small>
          <span class="maker-meta">
            ${s.rating ? `<span><i class="fa-solid fa-star" aria-hidden="true"></i> ${s.rating} (${s.reviews})</span>` : `<span>New maker</span>`}
            <span>${plural(s.products, "piece")}</span>
            ${s.handoffs ? `<span>${plural(s.handoffs, "handoff")}</span>` : ""}
          </span>
          ${slots ? `<span class="maker-slots">${esc(slots)}</span>` : ""}
        </span>
      </a>`;
  }

  function renderMakers() {
    const grid = $("#makerGrid");
    if (!grid) return;
    const q = ($("#mq")?.value || "").trim().toLowerCase();
    const list = DIRECTORY.filter((s) => !q || [s.name, s.location, s.bio, s.ownerName].join(" ").toLowerCase().includes(q));
    grid.innerHTML = list.length
      ? list.map(makerCard).join("")
      : `<div class="empty">${DIRECTORY.length ? "No makers match that search." : "Makers are setting up their shops — check back soon, or <a href='/sell'>open yours</a>."}</div>`;
  }

  /* ================= catalogue ================= */
  const categories = () => ["All", ...new Set(pageProducts().map((p) => p.category)), SAVED];

  function renderChips() {
    $("#chips").innerHTML = categories()
      .map((c) => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === filter}">${esc(c)}</button>`)
      .join("");
  }

  function visibleProducts() {
    let list = pageProducts().filter((p) => filter === "All" || (filter === SAVED ? favs.has(p.id) : p.category === filter));
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) => [p.name, p.category, p.desc, sellerOf(p).name, ...p.colors.map((c) => c.n)].join(" ").toLowerCase().includes(q));
    }
    if (sort === "low") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "high") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "new") list = [...list].sort((a, b) => String(b.created).localeCompare(String(a.created)));
    if (sort === "featured") list = [...list].sort((a, b) => (b.stock > 0) - (a.stock > 0));
    return list;
  }

  function stockNote(p) {
    if (p.stock <= 0) return `<span class="stock out">Sold out</span>`;
    if (p.stock <= 3) return `<span class="stock low">Only ${p.stock} left</span>`;
    return `<span class="stock">Available now</span>`;
  }

  function productCard(p) {
    const soldOut = p.stock <= 0;
    const s = sellerOf(p);
    const badge = soldOut
      ? `<span class="badge">Sold out</span>`
      : p.customEnabled ? `<span class="badge alt">Made to order</span>`
      : p.badge ? `<span class="badge ${p.badge === "New" ? "alt" : ""}">${esc(p.badge)}</span>` : "";
    return `
      <article class="card${soldOut ? " soldout" : ""}">
        <a class="card-media" href="/p/${esc(p.id)}" data-open="${esc(p.id)}" aria-label="View ${esc(p.name)}">${media(p)}</a>
        ${badge}
        <button class="fav" type="button" data-fav="${esc(p.id)}" aria-pressed="${favs.has(p.id)}" aria-label="Save ${esc(p.name)} to favourites">${ICON.heart}</button>
        <div class="card-body">
          <span class="cat">${esc(p.category)}</span>
          <h3>${esc(p.name)}</h3>
          ${PAGE === "home" ? `<a class="by-maker" href="/s/${esc(s.slug)}">by ${esc(s.name)}${s.phoneVerified ? ' <i class="fa-solid fa-circle-check" aria-label="verified"></i>' : ""}</a>` : ""}
          <div class="dots">${p.colors.map((c) => `<i style="background:${esc(c.h)}" title="${esc(c.n)}"></i>`).join("")}</div>
          ${stockNote(p)}
          <div class="row">
            <span class="price">${priceHTML(p.price)}</span>
            ${soldOut
              ? `<button class="add off" type="button" data-open="${esc(p.id)}">View</button>`
              : `<button class="add" type="button" data-open="${esc(p.id)}" aria-label="Add ${esc(p.name)}">${ICON.plus}Add</button>`}
          </div>
        </div>
      </article>`;
  }

  function renderGrid() {
    const grid = $("#grid");
    grid.setAttribute("aria-busy", String(!loaded));
    if (!loaded) {
      grid.innerHTML = Array.from({ length: 8 }, () =>
        `<div class="card skel" aria-hidden="true"><div class="card-media"></div><div class="card-body"><i></i><i></i><i></i></div></div>`).join("");
      return;
    }
    if (!pageProducts().length) {
      grid.innerHTML = `<div class="empty">${PAGE === "home" ? "New crochet pieces are coming soon 🧶" : "This maker has nothing ready right now 🧶"} — meanwhile, <a href="#custom">request a custom style</a>.</div>`;
      return;
    }
    const list = visibleProducts();
    grid.innerHTML = list.length
      ? list.map(productCard).join("")
      : `<div class="empty">${filter === SAVED ? "No saved favourites here yet — tap the ♥ on any piece to save it." : "Nothing matches your search. Try another word, or <a href='#custom'>request a custom style</a>."}</div>`;
  }

  /* ================= favourites ================= */
  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    store.set("favs", [...favs]);
    const on = favs.has(id);
    $$(`[data-fav="${cssId(id)}"]`).forEach((b) => b.setAttribute("aria-pressed", on));
    updateCounts();
    toast(on ? "♥ Saved to favourites" : "Removed from favourites");
    if (filter === SAVED) renderGrid();
  }

  /* ================= product pop-up ================= */
  let pState = null;
  const isoDay = (d) => d.toISOString().slice(0, 10);

  function openProduct(id, { track = true } = {}) {
    const p = byId(id);
    if (!p) return;
    pState = { p, size: p.sizes.length === 1 ? p.sizes[0] : null, color: p.colors[0], qty: 1, img: 0,
      custom: { colors: "", deadline: "", notes: "" } };
    renderProduct();
    layers.open($("#pModal"));
    try { history.replaceState(null, "", `/p/${encodeURIComponent(p.id)}`); } catch { /* ignore */ }
    if (track) API.trackOpen(p.id);
  }

  function readCustomFields() {
    if (!pState || !$("#pcColors")) return;
    pState.custom = { colors: $("#pcColors").value.trim(), deadline: $("#pcDeadline").value, notes: $("#pcNotes").value.trim() };
  }

  function renderProduct() {
    const { p, size, color, qty, img, custom } = pState;
    const s = sellerOf(p);
    const minDate = isoDay(new Date(Date.now() + Math.max(1, p.turnaroundDays) * 864e5));
    const hasImgs = p.images && p.images.length;
    $("#pSheet").innerHTML = `
    <div class="pd">
      <div class="pd-media">
        <button class="x" type="button" data-close="pModal" aria-label="Close">✕</button>
        ${hasImgs ? `<img src="${esc(p.images[img])}" alt="${esc(p.name)}">` : art(p, color.h)}
        ${p.images.length > 1
          ? `<div class="pd-thumbs">${p.images.map((u, i) => `<button type="button" data-img="${i}" aria-label="Photo ${i + 1}" aria-pressed="${i === img}"><img src="${esc(u)}" alt=""></button>`).join("")}</div>`
          : ""}
      </div>
      <div class="pd-info">
        <div><span class="cat">${esc(p.category)}</span><h2 id="pTitle">${esc(p.name)}</h2>
          <a class="by-maker" href="/s/${esc(s.slug)}">by ${esc(s.name)}${s.phoneVerified ? ' <i class="fa-solid fa-circle-check" aria-label="verified phone"></i>' : ""}${s.rating ? ` · <i class="fa-solid fa-star" aria-hidden="true"></i> ${s.rating}` : ""}</a></div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div class="price">${priceHTML(p.price)}</div>${stockNote(p)}</div>
        <p>${esc(p.desc)}</p>
        <div role="group" aria-label="Colour">
          <div class="opt-label">Colour <span>${esc(color.n)}</span></div>
          <div class="colors">${p.colors.map((c, i) => `<button class="color" type="button" data-color="${i}" style="background:${esc(c.h)}" aria-label="${esc(c.n)}" aria-pressed="${c === color}"></button>`).join("")}</div>
        </div>
        <div role="group" aria-label="Size">
          <div class="opt-label">Size <span>${size ? esc(size) : "Choose a size"}</span></div>
          <div class="sizes">${p.sizes.map((z) => `<button class="size" type="button" data-size="${esc(z)}" aria-pressed="${z === size}">${esc(z)}</button>`).join("")}</div>
        </div>
        ${p.customEnabled ? `
        <fieldset class="custom-opts">
          <legend><i class="fa-solid fa-scissors" aria-hidden="true"></i> Made to order — tell ${esc(s.name)} what you want</legend>
          <div class="field"><label for="pcColors">Preferred colours <span class="req">*</span></label><input id="pcColors" maxlength="120" placeholder="e.g. navy with cream trim" value="${esc(custom.colors)}"></div>
          <div class="field"><label for="pcDeadline">Needed by <span class="req">*</span></label><input id="pcDeadline" type="date" min="${minDate}" value="${esc(custom.deadline)}"><span class="hint">${p.turnaroundDays ? `Usually ready in about ${plural(p.turnaroundDays, "day")}.` : "Pick a realistic date — the maker will confirm."}</span></div>
          <div class="field"><label for="pcNotes">Notes (optional)</label><input id="pcNotes" maxlength="300" placeholder="Length, fit, extras…" value="${esc(custom.notes)}"></div>
          ${s.customSlotsWeek ? `<p class="slot-line">${s.customSlotsOpen ? `<b>${s.customSlotsOpen}</b> of ${s.customSlotsWeek} custom slots open this week` : "<b>Fully booked this week</b> — you can still send, the maker will confirm a later date"}</p>` : ""}
          ${s.depositRequired ? `<p class="slot-line"><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i> ${s.depositPercent}% deposit by mobile money before work starts</p>` : ""}
        </fieldset>` : ""}
        <div>
          <div class="opt-label">Quantity</div>
          <div class="qty"><button type="button" data-pq="-1" aria-label="Fewer">−</button><span aria-live="polite">${qty}</span><button type="button" data-pq="1" aria-label="More">+</button></div>
        </div>
        <div class="pd-actions">
          ${p.stock > 0
            ? `<button class="btn btn-grad" type="button" id="addToCart">Add to cart · ${money(p.price * qty)}</button>`
            : `<button class="btn btn-line" type="button" disabled>Sold out</button>`}
          <button class="fav" type="button" data-fav="${esc(p.id)}" aria-pressed="${favs.has(p.id)}" aria-label="Save to favourites">${ICON.heart}</button>
          <button class="fav" type="button" data-action="share-product" aria-label="Share this piece"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i></button>
        </div>
        ${s.customEnabled ? `<button class="link-btn" type="button" data-custom-from="${esc(p.id)}">Want it in another style or your exact measurements? Request a custom version →</button>` : ""}
      </div>
    </div>`;
  }

  function rerenderProduct(focusSelector) {
    readCustomFields();
    renderProduct();
    if (focusSelector) $(focusSelector, $("#pSheet"))?.focus({ preventScroll: true });
  }

  function shake(sel) {
    $(sel)?.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 300 });
  }

  function addToCart() {
    readCustomFields();
    const { p, size, color, qty, custom } = pState;
    if (!size) { toast("Please choose a size first"); shake(".sizes"); return; }
    if (p.customEnabled && (!custom.colors || !custom.deadline)) {
      toast("Pick your colours and the date you need it by");
      (custom.colors ? $("#pcDeadline") : $("#pcColors"))?.focus();
      return;
    }
    const inCart = cart.filter((l) => l.id === p.id).reduce((s, l) => s + l.qty, 0);
    if (inCart + qty > p.stock) {
      toast(p.stock - inCart > 0 ? `Only ${p.stock - inCart} more available` : `All ${p.stock} available are already in your cart`);
      return;
    }
    const customKey = p.customEnabled ? `|${custom.colors}|${custom.deadline}|${custom.notes}` : "";
    const key = `${p.id}|${size}|${color.n}${customKey}`;
    const existing = cart.find((l) => l.key === key);
    if (existing) existing.qty += qty;
    else cart.push({ key, id: p.id, seller: p.seller, size, color: color.n, hex: color.h, qty, custom: p.customEnabled ? { ...custom } : null });
    saveCart();
    layers.close($("#pModal"));
    toast(`Added ${p.name} to your cart`);
  }

  async function shareLink(url, title) {
    if (navigator.share) {
      try { await navigator.share({ url, title }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied — paste it anywhere"); }
    catch { prompt("Copy this link:", url); }
  }

  /* ================= cart (grouped by maker — one order per maker) ================= */
  const cartLines = () => cart.filter((l) => byId(l.id));
  const cartQty = () => cart.reduce((s, l) => s + l.qty, 0);
  function groups() {
    const out = {};
    cartLines().forEach((l) => {
      const p = byId(l.id);
      (out[p.seller] = out[p.seller] || { seller: sellerOf(p), lines: [] }).lines.push(l);
    });
    return Object.values(out);
  }
  const groupTotal = (g) => g.lines.reduce((s, l) => s + byId(l.id).price * l.qty, 0);   // items only
  let fulfil = {};   // slug → { how, spot, day, note, dopt }

  /* The delivery option the buyer picked for this maker (null for pickup / none chosen). */
  function groupDelivery(g) {
    const f = fulfil[g.seller.slug] || {};
    if (f.how !== "Delivery") return null;
    return (g.seller.deliveryOptions || []).find((o) => o.id === f.dopt) || null;
  }
  const groupFee = (g) => Number(groupDelivery(g)?.fee) || 0;
  const groupGrand = (g) => groupTotal(g) + groupFee(g);

  function saveCart() {
    store.set("cart2", cart);
    updateCounts();
    renderCart();
  }

  function updateCounts() {
    const q = cartQty();
    $$("[data-cart-count]").forEach((e) => { e.textContent = q; e.dataset.n = q; });
    $$("[data-fav-count]").forEach((e) => { e.textContent = favs.size; e.dataset.n = favs.size; });
    $$("[data-action='open-cart']").forEach((b) => b.setAttribute("aria-label", `Open cart (${plural(q, "item")})`));
  }

  function readFulfil() {
    $$("[data-g]").forEach((el) => {
      if (el.type === "radio" && !el.checked) return;
      const f = (fulfil[el.dataset.g] = fulfil[el.dataset.g] || {});
      f[el.dataset.f] = el.value;
    });
  }

  /* Items + delivery = this maker's total, with the chosen option's details spelled out. */
  function breakdown(g) {
    const f = fulfil[g.seller.slug] || {};
    const opt = groupDelivery(g);
    let line;
    if (f.how === "Pickup") line = `<div class="bd-row"><span>Pickup${f.spot ? ` · ${esc(f.spot)}` : ""}</span><span class="free">No delivery fee</span></div>`;
    else if (f.how === "Delivery" && opt) line = `<div class="bd-row"><span>Delivery · ${esc(opt.name)}${opt.details ? `<small>${esc(opt.details)}</small>` : ""}</span><span>${Number(opt.fee) ? priceHTML(opt.fee) : `<span class="free">Free</span>`}</span></div>`;
    else if (f.how === "Delivery" && (g.seller.deliveryOptions || []).length) line = `<div class="bd-row pending"><span>Delivery</span><span>Choose an area above</span></div>`;
    else line = `<div class="bd-row"><span>${esc(f.how || "Delivery")}</span><span>Agreed with the maker</span></div>`;
    return `<div class="breakdown">${line}<div class="bd-row bd-total"><span>${esc(g.seller.name)} total</span><span>${priceHTML(groupGrand(g))}</span></div></div>`;
  }

  function deliveryChoices(s, f) {
    const opts = s.deliveryOptions || [];
    if (!opts.length) {
      return `<p class="dopt-none" style="grid-column:1/-1"><i class="fa-solid fa-truck" aria-hidden="true"></i> ${esc(s.name)} will confirm the delivery fee with you.</p>`;
    }
    return `
      <fieldset class="dopts" style="grid-column:1/-1">
        <legend>Delivery area &amp; fee <span class="req">*</span></legend>
        ${opts.map((o) => `
        <label class="dopt ${f.dopt === o.id ? "on" : ""}">
          <input type="radio" name="g_${esc(s.slug)}_dopt" value="${esc(o.id)}" data-g="${esc(s.slug)}" data-f="dopt" data-rerender="1" ${f.dopt === o.id ? "checked" : ""}>
          <span class="dopt-main"><b>${esc(o.name)}</b>${o.details ? `<small>${esc(o.details)}</small>` : ""}</span>
          <span class="dopt-fee">${Number(o.fee) ? priceHTML(o.fee) : `<span class="free">Free</span>`}</span>
        </label>`).join("")}
      </fieldset>`;
  }

  function fulfilFields(g) {
    const s = g.seller;
    const f = fulfil[s.slug] = fulfil[s.slug] || {};
    const options = [];
    if (s.pickupSpots && s.pickupSpots.length) options.push("Pickup");
    if (s.deliveryAvailable !== false) options.push("Delivery");
    if (!options.length) options.push("Arrange with maker");
    if (!options.includes(f.how)) f.how = options[0];
    const pickup = f.how === "Pickup";
    const days = s.pickupDays && s.pickupDays.length ? s.pickupDays : Object.keys(DAY_NAMES);
    return `
      <div class="form-grid two">
        <div class="field"><label for="g_${esc(s.slug)}_how">Pickup or delivery?</label>
          <select id="g_${esc(s.slug)}_how" data-g="${esc(s.slug)}" data-f="how" data-rerender="1">${options.map((o) => `<option ${o === f.how ? "selected" : ""}>${o}</option>`).join("")}</select></div>
        ${pickup ? `
        <div class="field"><label for="g_${esc(s.slug)}_day">Pickup day</label>
          <select id="g_${esc(s.slug)}_day" data-g="${esc(s.slug)}" data-f="day">${days.map((d) => `<option value="${d}" ${d === f.day ? "selected" : ""}>${DAY_NAMES[d]}</option>`).join("")}</select></div>
        <div class="field" style="grid-column:1/-1"><label for="g_${esc(s.slug)}_spot">Meetup spot <span class="req">*</span></label>
          <select id="g_${esc(s.slug)}_spot" data-g="${esc(s.slug)}" data-f="spot">${s.pickupSpots.map((sp) => `<option ${sp === f.spot ? "selected" : ""}>${esc(sp)}</option>`).join("")}</select>
          <span class="hint"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Public spots chosen by the maker. No delivery fee for pickup. <a href="/legal/safety" target="_blank">Meetup safety tips</a></span></div>` : ""}
        ${f.how === "Delivery" ? deliveryChoices(s, f) : ""}
        <div class="field" style="grid-column:1/-1"><label for="g_${esc(s.slug)}_note">Note for ${esc(s.name)}</label>
          <input id="g_${esc(s.slug)}_note" data-g="${esc(s.slug)}" data-f="note" maxlength="500" placeholder="Any special requests?" value="${esc(f.note || "")}"></div>
      </div>`;
  }

  function renderCart() {
    if (!loaded && cart.length) {
      $("#cartBody").innerHTML = `<div class="cart-empty"><div class="spinner" role="status" aria-label="Loading"></div><p>Loading your cart…</p></div>`;
      $("#cartFoot").innerHTML = "";
      return;
    }
    readFulfil();
    const gs = groups();
    if (!gs.length) {
      $("#cartBody").innerHTML = `
        <div class="cart-empty">${ICON.bag.replace('stroke-width="2"', 'stroke-width="1.6"')}
          <h4 style="margin:0 0 6px;color:var(--ink)">Your cart is empty</h4>
          <p style="margin:0 0 16px">Add pieces you love to send an order to the maker.</p>
          <button class="btn btn-primary" type="button" data-action="go-shop">Start shopping</button>
        </div>`;
      $("#cartFoot").innerHTML = "";
      return;
    }
    const fields = gs.map(fulfilFields);          // sets each maker's pickup/delivery defaults first
    const total = gs.reduce((s, g) => s + groupGrand(g), 0);
    const anyFee = gs.some((g) => groupFee(g) > 0);
    $("#cartBody").innerHTML = (gs.length > 1 ? `<p class="note-box"><i class="fa-solid fa-store" aria-hidden="true"></i> Your cart has pieces from ${gs.length} makers — each maker gets their own order and WhatsApp message.</p>` : "") +
      gs.map((g, gi) => `
      <section class="cgroup" aria-label="Order from ${esc(g.seller.name)}">
        <h4 class="cg-head"><a href="/s/${esc(g.seller.slug)}">${esc(g.seller.name)}</a>${g.seller.phoneVerified ? ' <i class="fa-solid fa-circle-check verified" aria-label="verified"></i>' : ""}</h4>
        ${g.lines.map((l) => {
          const p = byId(l.id);
          const i = cart.indexOf(l);
          return `
          <div class="line">
            <div class="pic">${media(p, l.hex)}</div>
            <div><h4>${esc(p.name)}</h4><div class="meta">Size ${esc(l.size)} · ${esc(l.color)}</div>
              ${l.custom ? `<div class="meta">✂️ ${esc(l.custom.colors)} · by ${esc(l.custom.deadline)}</div>` : ""}
              <div class="qty"><button type="button" data-q="${i}" data-d="-1" aria-label="One fewer ${esc(p.name)}">−</button><span>${l.qty}</span><button type="button" data-q="${i}" data-d="1" aria-label="One more ${esc(p.name)}">+</button></div></div>
            <div class="right"><div class="price" style="font-size:.95rem">${priceHTML(p.price * l.qty)}</div><button class="rm" type="button" data-rm="${i}">Remove</button></div>
          </div>`;
        }).join("")}
        <div class="totals sub"><span>Items</span><span>${priceHTML(groupTotal(g))}</span></div>
        ${g.seller.depositRequired && g.lines.some((l) => l.custom) ? `<p class="small-note"><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i> ${g.seller.depositPercent}% deposit by mobile money before the maker starts custom pieces.</p>` : ""}
        ${fields[gi]}
        ${breakdown(g)}
      </section>`).join("") + `
      <div class="totals"><span>Total${anyFee ? " <small class='incl'>incl. delivery</small>" : ""}</span><span class="big">${priceHTML(total)}</span></div>
      <p class="small-note">Pay in US$ or L$ (rate: ${rateText()}) when you collect, unless the maker asks for a deposit.</p>
      <form class="details-box" id="cartForm" novalidate>
        <h4>Your details</h4>
        <div class="form-grid">
          <div class="field"><label for="oname">Your name <span class="req">*</span></label><input id="oname" data-sync="name" autocomplete="name" required maxlength="80" value="${esc(me.name)}"></div>
          <div class="field"><label for="ophone">Phone / WhatsApp <span class="req">*</span></label><input id="ophone" data-sync="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+231 77 000 0000" required maxlength="30" value="${esc(me.phone)}"></div>
          <div class="field"><label for="oloc">Your area <span class="req">*</span></label><input id="oloc" data-sync="location" autocomplete="address-level2" placeholder="e.g. Sinkor, Monrovia" required maxlength="120" value="${esc(me.location)}"></div>
        </div>
      </form>`;
    $("#cartFoot").innerHTML = `
      <button class="btn btn-grad btn-block" type="submit" form="cartForm">${ICON.send}${gs.length > 1 ? `Send ${gs.length} orders` : `Send to ${esc(gs[0].seller.name)}`} · ${money(total)}</button>
      <p class="small-note" style="text-align:center;margin:8px 0 0">No account needed · <a href="/legal/terms" target="_blank">Terms</a></p>`;
  }

  const openCart = () => { renderCart(); layers.open($("#cart")); };
  const closeCart = () => layers.close($("#cart"));

  /* ================= validation & customer details ================= */
  function need(input, ok) {
    const f = input.closest(".field");
    if (f) f.classList.toggle("err", !ok);
    input.setAttribute("aria-invalid", String(!ok));
    return ok;
  }
  const validPhone = (v) => v.replace(/\D/g, "").length >= 7;
  function rememberMe(src) {
    me = { name: src.name, phone: src.phone, location: src.location || me.location };
    store.set("me", me);
    syncMeInputs();
  }
  function syncMeInputs() {
    $$("[data-sync]").forEach((i) => { if (document.activeElement !== i && !i.value) i.value = me[i.dataset.sync] || ""; });
  }

  /* ================= order ids & the message the maker receives ================= */
  function orderId() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I lookalikes
    const r = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => alphabet[b % 32]).join("");
    return `CM-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${r}`;
  }

  /* WhatsApp text: plain characters + WhatsApp *bold* only. Emoji in pre-filled links show up as "?" on
     many phones and WhatsApp versions, so the message never relies on them. */
  function orderText(o, s) {
    const L = [];
    const deposit = () => {
      if (!s.depositRequired || !s.depositPercent) return;
      // Only custom work takes a deposit: a custom request, or the made-to-order pieces in a cart.
      const customLines = o.type === "cart" ? o.items.filter((i) => i.custom) : [];
      if (o.type === "cart" && !customLines.length) return;
      const pay = [s.momoNumber && `MTN MoMo ${s.momoNumber}`, s.orangeNumber && `Orange Money ${s.orangeNumber}`].filter(Boolean).join(" or ");
      const amt = o.type === "cart" ? ` ${money(customLines.reduce((a, i) => a + i.price * i.qty, 0) * s.depositPercent / 100)}`
        + (customLines.length < o.items.length ? " (on the made-to-order pieces)" : "") : " of the agreed price";
      L.push(`*Deposit (${s.depositPercent}%):*${amt}${pay ? ` via ${pay}` : ""}, before work starts`);
    };
    if (o.type === "cart") {
      L.push(`*NEW ORDER - ${SHOP.name}*`, `Shop: ${s.name}`, `Order #: ${o.id}`, ``,
        `*Customer*`, `Name: ${o.customer.name}`, `Phone: ${o.customer.phone}`, `Area: ${o.customer.location}`, ``, `*Items*`);
      o.items.forEach((it, i) => {
        L.push(`${i + 1}. ${it.name} - Size ${it.size}, ${it.color} x ${it.qty} = ${money(it.price * it.qty)}`);
        if (it.custom) L.push(`   Made to order: ${it.custom.colors}, needed by ${it.custom.deadline}${it.custom.notes ? `, ${it.custom.notes}` : ""}`);
      });
      L.push(``, `Items: ${money(o.itemsTotal)}`);
      if (o.delivery === "Pickup") {
        L.push(`Pickup (no delivery fee): ${o.pickupSpot}${o.pickupDay ? `, ${DAY_NAMES[o.pickupDay] || o.pickupDay}` : ""}`);
      } else if (o.deliveryChoice) {
        L.push(`Delivery - ${o.deliveryChoice.name}: ${Number(o.deliveryChoice.fee) ? money(o.deliveryChoice.fee) : "free"}`);
        if (o.deliveryChoice.details) L.push(`   ${o.deliveryChoice.details}`);
      } else {
        L.push(`${o.delivery} (fee to be agreed)`);
      }
      L.push(`*Total: ${money(o.total)}*`, `Rate: ${rateText()}`);
      deposit();
      if (o.note) L.push(``, `Note: ${o.note}`);
    } else {
      const c = o.custom;
      L.push(`*CUSTOM REQUEST - ${SHOP.name}*`, `Shop: ${s.name}`, `Request #: ${o.id}`, ``,
        `*Customer*`, `Name: ${o.customer.name}`, `Phone: ${o.customer.phone}`);
      if (o.customer.location) L.push(`Area: ${o.customer.location}`);
      L.push(``, `*Request*`, `Type: ${c.type} (for ${c.forWho})`);
      if (c.basedOn) L.push(`Based on: ${c.basedOn}`);
      if (c.usualSize) L.push(`Usual size: ${c.usualSize}`);
      if (c.measurements.length) {
        L.push(``, `*Measurements (${c.unit})*`);
        c.measurements.forEach((m) => L.push(`- ${m.label}: ${m.value}${m.unitless ? "" : " " + c.unit}`));
      }
      L.push(``);
      if (c.colors) L.push(`Colours: ${c.colors}`);
      if (c.budget) L.push(`Budget: ${c.budget}`);
      if (c.date) L.push(`Needed by: ${c.date}`);
      if (c.notes) L.push(`Notes: ${c.notes}`);
      L.push(`Style photos: ${o.photoCount} (files named ${o.id}-style-1.jpg ...)`);
      deposit();
    }
    return L.join("\n");
  }

  /* ================= custom-order photos & measurements ================= */
  let photos = []; // { blob, url }
  async function addPhotos(files) {
    const list = [...files].filter(isImageFile);
    for (const f of list) {
      if (photos.length >= MAX_PHOTOS) { toast(`You can add up to ${MAX_PHOTOS} photos`); break; }
      try {
        const blob = await compressImage(f);
        photos.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        toast(`Couldn't read "${f.name}". Please use a JPG or PNG photo.`);
      }
    }
    renderThumbs();
  }
  function renderThumbs() {
    if (!$("#thumbs")) return;
    $("#thumbs").innerHTML = photos
      .map((p, i) => `<div class="thumb"><img src="${p.url}" alt="Style photo ${i + 1}"><button type="button" data-rmphoto="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`)
      .join("");
    $("#drop b").textContent = photos.length ? `Add more photos (${photos.length}/${MAX_PHOTOS})` : "Tap to add photos";
  }

  let unit = store.get("unit", "in");
  let mvals = {};
  let basedOn = null;
  function renderMeasures() {
    if (!$("#ctype")) return;
    const type = $("#ctype").value;
    const keys = MEASURES[type] || [];
    const req = REQUIRED[type] || [];
    $("#measureBox").hidden = !type || !keys.length;
    $("#measureFields").innerHTML = keys.map((k) => {
      const m = M[k];
      const isReq = req.includes(k);
      return `
      <div class="field"><label for="m_${k}">${m.l}${isReq ? ' <span class="req">*</span>' : ""}</label>
        <div class="unit-wrap"><input id="m_${k}" data-m="${k}" ${m.unitless ? "" : 'inputmode="decimal"'} maxlength="20" value="${esc(mvals[k] || "")}" ${isReq ? "required" : ""} aria-describedby="h_${k}">${m.unitless ? "" : `<span aria-hidden="true">${unit}</span>`}</div>
        <span class="hint" id="h_${k}">${m.h}</span></div>`;
    }).join("");
    $$(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.unit === unit));
  }

  const customSeller = () => {
    const slug = $("#cseller")?.value || "";
    return SELLERS[slug] || DIRECTORY.find((s) => s.slug === slug) || null;
  };

  function renderSlotBox() {
    const box = $("#slotBox");
    if (!box) return;
    const s = customSeller();
    if (!s) { box.hidden = true; return; }
    const parts = [];
    if (s.customSlotsWeek) parts.push(s.customSlotsOpen ? `<b>${s.customSlotsOpen} of ${s.customSlotsWeek}</b> custom slots open this week` : `<b>Fully booked this week</b> — the maker will suggest a later date`);
    if (s.depositRequired) parts.push(`<b>${s.depositPercent}% deposit</b> by ${[s.momoNumber && "MTN MoMo", s.orangeNumber && "Orange Money"].filter(Boolean).join(" or ") || "mobile money"} before work starts`);
    if (s.pickupSpots && s.pickupSpots.length) parts.push(`Pickup: ${s.pickupSpots.map(esc).join(" · ")}`);
    box.innerHTML = `<b class="slot-title">${esc(s.name)}</b>${parts.map((x) => `<p>${x}</p>`).join("")}`;
    box.hidden = false;
  }

  function fillMakerSelect() {
    const sel = $("#cseller");
    if (!sel || sel.tagName !== "SELECT") return;
    const keep = sel.value;
    sel.innerHTML = `<option value="">Choose a maker…</option>` + DIRECTORY.filter((s) => s.customEnabled)
      .map((s) => `<option value="${esc(s.slug)}">${esc(s.name)}${s.location ? " — " + esc(s.location) : ""}${s.customSlotsOpen === 0 ? " (fully booked this week)" : ""}</option>`).join("");
    sel.value = keep;
  }

  /* ================= sending orders ================= */
  async function sendOrders(batch) {
    $("#sSheet").innerHTML = `<div class="send-body" style="text-align:center"><div class="spinner"></div><h2 id="sTitle">Sending ${batch.length > 1 ? `${batch.length} orders` : "your order"}…</h2></div>`;
    layers.open($("#sModal"));
    const results = [];
    for (const { order, seller } of batch) {
      order.message = orderText(order, seller);
      const payload = { ...order, photos: [] };
      for (let i = 0; i < (order.photos || []).length; i++) {
        payload.photos.push({ name: `${order.id}-style-${i + 1}.jpg`, data: await blobToDataURL(order.photos[i]) });
      }
      let res;
      try { res = await API.placeOrder(payload); } catch { res = { ok: false, code: "network" }; }
      results.push({ order, seller, res });
      if (res && res.ok) finishOrder(order);
    }
    const recent = store.get("orders", []);
    // Saved on this device for "My orders": the key is what opens the private receipt (no account needed).
    results.filter((r) => r.res.ok).forEach((r) => recent.unshift({ id: r.order.id, seller: r.seller.slug, at: r.order.createdAt, key: r.res.receiptKey || "" }));
    store.set("orders", recent.slice(0, 50));
    if (results.some((r) => r.res && ["stock", "full"].includes(r.res.code))) refreshCatalog();
    renderResults(results);
  }

  function finishOrder(order) {
    if (order._done) return;
    order._done = true;
    if (order.type === "cart") {
      const ids = new Set(order.items.map((i) => i.key));
      cart = cart.filter((l) => !ids.has(l.key));
      saveCart();
      if (!cart.length) closeCart();
    } else resetCustom();
  }

  function renderResults(results) {
    const okCount = results.filter((r) => r.res && r.res.ok).length;
    const rows = results.map(({ order: o, seller: s, res }) => {
      const kind = o.type === "cart" ? "Order" : "Request";
      if (res && res.ok) {
        return `<div class="result ok"><div><b>${esc(s.name)}</b><span class="order-no">${kind} #${esc(o.id)}</span>
          <p>Saved — ${esc(s.name)} will contact you on <b>${esc(o.customer.phone)}</b>.</p></div>
          <div class="result-actions">${res.receiptUrl ? `<a class="btn btn-line btn-sm" href="${esc(res.receiptUrl)}"><i class="fa-solid fa-receipt" aria-hidden="true"></i> View receipt</a>` : ""}
          <a class="btn btn-wa btn-sm" href="${waLink(o.message, s.whatsapp)}" target="_blank" rel="noopener">${ICON.whatsapp}Also message on WhatsApp</a></div></div>`;
      }
      if (res && ["stock", "full"].includes(res.code)) {
        return `<div class="result bad"><div><b>${esc(s.name)}</b><p>${esc(res.error)}. Please update your cart and send again.</p></div></div>`;
      }
      // Couldn't reach the server: the WhatsApp message still gets the order to the maker.
      return `<div class="result warn"><div><b>${esc(s.name)}</b><span class="order-no">${kind} #${esc(o.id)}</span>
        <p>${esc(res?.error || "We couldn't save it online.")} Send it on WhatsApp so the maker still gets it.</p></div>
        <a class="btn btn-wa btn-sm" href="${waLink(o.message, s.whatsapp)}" target="_blank" rel="noopener" data-fallback="${esc(o.id)}">${ICON.whatsapp}Send on WhatsApp</a></div>`;
    }).join("");
    $("#sSheet").innerHTML = `<div class="send-body">
      <button class="x" type="button" data-close="sModal" style="float:right" aria-label="Close">✕</button>
      ${okCount ? `<div class="badge-ok">${ICON.check}</div>` : ""}
      <h2 id="sTitle">${okCount === results.length ? (okCount > 1 ? "Orders sent to the makers!" : "Sent to the maker!") : okCount ? "Some orders were sent" : "Not sent yet"}</h2>
      <p>Thank you, <b>${esc(results[0].order.customer.name)}</b>. ${okCount ? `Your receipt is saved on this device under <a href="/orders">My orders</a>, where you can follow each order's status.` : "Nothing was charged or sent yet."}</p>
      <div class="results">${rows}</div>
      <div class="send-actions"><a class="btn btn-line" href="/orders"><i class="fa-solid fa-receipt" aria-hidden="true"></i> My orders</a><button class="btn btn-primary" type="button" data-close="sModal">Done</button></div>
      <p class="alt-line"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Meeting in person? <a href="/legal/safety" target="_blank">Read our safety tips</a>.</p>
    </div>`;
    $$("[data-fallback]").forEach((a) => a.addEventListener("click", () => {
      const r = results.find((x) => x.order.id === a.dataset.fallback);
      if (r) finishOrder(r.order);
    }));
  }

  /* ================= form submissions ================= */
  function submitCart(e) {
    e.preventDefault();
    readFulfil();
    const n = $("#oname"), ph = $("#ophone"), lo = $("#oloc");
    const ok = [need(n, n.value.trim().length > 1), need(ph, validPhone(ph.value)), need(lo, lo.value.trim().length > 1)].every(Boolean);
    if (!ok) {
      toast("Please fill in your name, phone and area");
      $(".field.err input")?.focus();
      return;
    }
    // Every maker that delivers with priced areas needs one chosen.
    const missing = groups().find((g) => (fulfil[g.seller.slug] || {}).how === "Delivery" && (g.seller.deliveryOptions || []).length && !groupDelivery(g));
    if (missing) {
      toast(`Choose a delivery area for ${missing.seller.name}`);
      const box = $(`input[name="g_${cssId(missing.seller.slug)}_dopt"]`)?.closest(".dopts");
      box?.classList.add("err");
      box?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const customer = { name: n.value.trim(), phone: ph.value.trim(), location: lo.value.trim() };
    rememberMe(customer);
    const batch = groups().map((g) => {
      const f = fulfil[g.seller.slug] || {};
      const items = g.lines.map((l) => {
        const p = byId(l.id);
        return { key: l.key, id: p.id, name: p.name, size: l.size, color: l.color, qty: l.qty, price: p.price, custom: l.custom || undefined };
      });
      const choice = groupDelivery(g);
      return {
        seller: g.seller,
        order: {
          id: orderId(), type: "cart", seller: g.seller.slug, createdAt: new Date().toISOString(), customer, items,
          itemsTotal: groupTotal(g), total: groupGrand(g), delivery: f.how || "Delivery",
          deliveryOption: choice ? choice.id : "", deliveryChoice: choice,
          pickupSpot: f.how === "Pickup" ? f.spot || (g.seller.pickupSpots || [])[0] || "" : "",
          pickupDay: f.how === "Pickup" ? f.day || (g.seller.pickupDays || [])[0] || "" : "",
          note: (f.note || "").trim(), photos: []
        }
      };
    });
    sendOrders(batch);
  }

  function submitCustom(e) {
    e.preventDefault();
    const type = $("#ctype"), n = $("#cname"), ph = $("#cphone"), sel = $("#cseller");
    let ok = true;
    if (sel.tagName === "SELECT") ok = need(sel, !!sel.value) && ok;
    if (!photos.length) {
      ok = false;
      $("#drop").classList.add("err");
      setTimeout(() => $("#drop").classList.remove("err"), 2500);
    }
    ok = need(type, !!type.value) && ok;
    const req = REQUIRED[type.value] || [];
    $$("[data-m]").forEach((i) => { if (req.includes(i.dataset.m)) ok = need(i, i.value.trim() !== "") && ok; });
    ok = need(n, n.value.trim().length > 1) && ok;
    ok = need(ph, validPhone(ph.value)) && ok;
    const seller = customSeller();
    if (!ok || !seller) {
      toast(!photos.length ? "Please add at least one photo of the style" : "Please fill in the required fields");
      const target = $(".field.err input, .field.err select") || $("#drop");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus?.({ preventScroll: true });
      return;
    }
    const customer = { name: n.value.trim(), phone: ph.value.trim(), location: $("#cloc").value.trim() };
    rememberMe(customer);
    const measurements = $$("[data-m]").filter((i) => i.value.trim())
      .map((i) => ({ key: i.dataset.m, label: M[i.dataset.m].l, value: i.value.trim(), unitless: !!M[i.dataset.m].unitless }));
    sendOrders([{
      seller,
      order: {
        id: orderId(), type: "custom", seller: seller.slug, createdAt: new Date().toISOString(), customer,
        custom: {
          type: type.value, forWho: $("#cfor").value, unit, measurements,
          usualSize: $("#csize").value, colors: $("#ccolors").value.trim(), budget: $("#cbudget").value.trim(),
          date: $("#cdate").value, notes: $("#cnotes").value.trim(), basedOn: basedOn ? byId(basedOn)?.name || "" : ""
        },
        photoCount: photos.length, photos: photos.map((p) => p.blob)
      }
    }]);
  }

  function resetCustom() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    photos = [];
    renderThumbs();
    ["ctype", "ccolors", "csize", "cbudget", "cdate", "cnotes"].forEach((id) => { if ($("#" + id)) $("#" + id).value = ""; });
    mvals = {};
    setBasedOn(null);
    renderMeasures();
  }

  function setBasedOn(id) {
    basedOn = id;
    $("#basedOn")?.classList.toggle("show", !!id);
    if ($("#basedOnName")) $("#basedOnName").textContent = id ? byId(id)?.name || "" : "";
  }

  /* ================= reviews (store pages) ================= */
  async function loadReviews() {
    const box = $("#reviewList");
    if (!box) return;
    const r = await API.seller(SELLER);
    if (!r.ok) { box.innerHTML = `<p class="muted">Reviews couldn't load.</p>`; return; }
    SELLERS[SELLER] = { ...(SELLERS[SELLER] || {}), ...r.seller };
    renderSlotBox();
    box.innerHTML = r.reviews.length
      ? r.reviews.map((v) => `
        <article class="review">
          <div class="rv-top"><span class="rv-stars" aria-label="${v.rating} out of 5 stars">${stars(v.rating)}</span><span class="rv-who">${esc(v.buyer)} <span class="vb"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verified buyer</span></span></div>
          ${v.comment ? `<p>${esc(v.comment)}</p>` : ""}
          <time datetime="${esc(v.created)}">${new Date(v.created).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</time>
        </article>`).join("")
      : `<p class="muted">No reviews yet. Bought from ${esc(r.seller.name)}? Once your order is marked delivered you can review it here.</p>`;
  }

  function openReview() {
    $("#rSheet").innerHTML = `<div class="send-body">
      <button class="x" type="button" data-close="rModal" style="float:right" aria-label="Close">✕</button>
      <h2 id="rTitle">Review your order</h2>
      <p>Only orders the maker has marked <b>delivered</b> can be reviewed, so every review comes from a real buyer.</p>
      <form id="reviewForm" novalidate class="form-grid">
        <div class="field"><label for="rvOrder">Order number <span class="req">*</span></label><input id="rvOrder" maxlength="20" placeholder="CM-261116-AB12" autocapitalize="characters" required value="${esc((store.get("orders", []).find((o) => o.seller === SELLER) || {}).id || "")}"></div>
        <div class="field"><label for="rvPhone">Phone you ordered with <span class="req">*</span></label><input id="rvPhone" type="tel" inputmode="tel" maxlength="30" required value="${esc(me.phone)}"></div>
        <fieldset class="field rating-field"><legend class="lab">Rating <span class="req">*</span></legend>
          <div class="rate-stars">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rvRating" id="rv${n}" value="${n}"><label for="rv${n}" title="${n} star${n > 1 ? "s" : ""}">★</label>`).join("")}</div></fieldset>
        <div class="field"><label for="rvComment">Your review</label><textarea id="rvComment" maxlength="600" placeholder="How was the piece, the fit and the handoff?"></textarea></div>
        <button class="btn btn-grad btn-block" type="submit">Post review</button>
      </form></div>`;
    layers.open($("#rModal"), { focus: "#rvOrder" });
  }

  async function submitReview(e) {
    e.preventDefault();
    const rating = Number(($('input[name="rvRating"]:checked') || {}).value || 0);
    if (!rating) { toast("Tap the stars to choose a rating"); return; }
    const btn = $("#reviewForm button[type=submit]");
    btn.disabled = true;
    const r = await API.review({ orderId: $("#rvOrder").value.trim(), phone: $("#rvPhone").value.trim(), rating, comment: $("#rvComment").value.trim() });
    btn.disabled = false;
    if (!r.ok) { toast(r.error || "Couldn't post your review"); return; }
    layers.close($("#rModal"));
    toast("Thank you — your review is live ⭐");
    loadReviews();
  }

  /* ================= install as an app (PWA) ================= */
  let deferredPrompt = null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("#installTop").classList.add("show"); });
  addEventListener("appinstalled", () => { deferredPrompt = null; $("#installTop").classList.remove("show"); toast(`${SHOP.name} installed 🎉`); });
  async function install() {
    if (standalone) { toast("You're already using the app 💚"); return; }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch { /* dismissed */ }
      deferredPrompt = null;
      $("#installTop").classList.remove("show");
      return;
    }
    $("#iosText").innerHTML = isIOS
      ? "In <b>Safari</b>, tap the <b>Share</b> button (square with an arrow), scroll down and choose <b>Add to Home Screen</b>, then tap <b>Add</b>."
      : "Open your browser menu (<b>⋮</b> on Android Chrome) and choose <b>Install app</b> or <b>Add to Home screen</b>. If you don't see it, open this site in Chrome.";
    layers.open($("#iosModal"));
  }

  /* ================= events ================= */
  const scrollToSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;

    if (d.open) { e.preventDefault(); return openProduct(d.open); }
    if (d.fav) return toggleFav(d.fav);
    if (d.cat) { filter = d.cat; renderChips(); renderGrid(); return; }
    if (d.close) return layers.close($("#" + d.close));

    if (pState && t.closest("#pSheet")) {
      if (d.color) { pState.color = pState.p.colors[+d.color]; return rerenderProduct(`[data-color="${d.color}"]`); }
      if (d.size) { pState.size = d.size; return rerenderProduct(`[data-size="${cssId(d.size)}"]`); }
      if (d.img) { pState.img = +d.img; return rerenderProduct(`[data-img="${d.img}"]`); }
      if (d.pq) {
        pState.qty = Math.max(1, Math.min(Math.max(1, pState.p.stock), pState.qty + Number(d.pq)));
        return rerenderProduct(`[data-pq="${d.pq}"]`);
      }
      if (d.action === "share-product") return shareLink(`${location.origin}/p/${pState.p.id}`, pState.p.name);
    }
    if (t.id === "addToCart") return addToCart();

    if (d.q) {
      const l = cart[+d.q];
      const p = byId(l.id);
      const others = cart.filter((x) => x !== l && x.id === l.id).reduce((s, x) => s + x.qty, 0);
      const want = l.qty + Number(d.d);
      if (want > p.stock - others) { toast(`Only ${p.stock} available`); return; }
      l.qty = Math.max(1, want);
      saveCart();
      $(`[data-q="${d.q}"][data-d="${d.d}"]`)?.focus();
      return;
    }
    if (d.rm) { cart.splice(+d.rm, 1); saveCart(); return; }
    if (d.rmphoto) {
      const [p] = photos.splice(+d.rmphoto, 1);
      URL.revokeObjectURL(p.url);
      renderThumbs();
      return;
    }
    if (d.unit) { unit = d.unit; store.set("unit", unit); renderMeasures(); return; }
    if (d.customFrom) {
      const p = byId(d.customFrom);
      layers.close($("#pModal"));
      if (PAGE === "home" && $("#cseller")) { $("#cseller").value = p.seller; renderSlotBox(); }
      setBasedOn(d.customFrom);
      if (!$("#cnotes").value) $("#cnotes").value = `I'd like something like your ${p.name}, but…`;
      scrollToSection("custom");
      return;
    }

    switch (d.action) {
      case "open-cart": openCart(); break;
      case "close-cart": closeCart(); break;
      case "go-shop": closeCart(); scrollToSection("shop"); break;
      case "show-favs": closeCart(); filter = SAVED; renderChips(); renderGrid(); scrollToSection("shop"); break;
      case "share-store": shareLink(`${location.origin}/s/${SELLER}`, document.title); break;
      case "review": openReview(); break;
    }
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id === "cartForm") submitCart(e);
    if (e.target.id === "customForm") submitCustom(e);
    if (e.target.id === "reviewForm") submitReview(e);
  });

  document.addEventListener("input", (e) => {
    const i = e.target;
    if (i.dataset.m) mvals[i.dataset.m] = i.value;
    const field = i.closest(".field.err");
    if (field) { field.classList.remove("err"); i.removeAttribute("aria-invalid"); }
    if (i.dataset.sync) $$(`[data-sync="${i.dataset.sync}"]`).forEach((o) => { if (o !== i) o.value = i.value; });
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.rerender) {
      readFulfil();
      renderCart();
      // Put focus back on the same control after the re-render (radios have a name, not an id).
      (t.id ? $("#" + cssId(t.id)) : $(`input[name="${cssId(t.name)}"]:checked`))?.focus();
    }
    if (t.id === "cseller") { t.closest(".field").classList.remove("err"); renderSlotBox(); }
    if (t.id === "ctype") { t.closest(".field").classList.remove("err"); renderMeasures(); }
    if (t.id === "photoInput") { addPhotos(t.files); t.value = ""; }
  });

  let searchTimer;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim(); renderGrid(); }, 120);
  });
  $("#mq")?.addEventListener("input", renderMakers);
  $("#sort").addEventListener("change", (e) => { sort = e.target.value; renderGrid(); });

  const drop = $("#drop");
  if (drop) {
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => addPhotos(e.dataTransfer.files));
    $("#clearBased").addEventListener("click", () => setBasedOn(null));
  }
  $("#installTop").addEventListener("click", install);
  $("#installMain")?.addEventListener("click", install);

  // Closing the product pop-up puts the page address back.
  $("#pModal").addEventListener("layerclose", () => {
    try { history.replaceState(null, "", BASE_URL + (location.hash || "")); } catch { /* ignore */ }
  });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      $$(".bnav [data-bn]").forEach((a) => {
        const on = a.dataset.bn === en.target.id;
        a.classList.toggle("active", on);
        if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
      });
    }), { rootMargin: "-45% 0px -50% 0px" });
    ["makers", "shop"].forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
  }

  /* ================= start-up ================= */
  function paintHero() {
    if (PAGE !== "home") return;
    const picks = [...PRODUCTS].sort((a, b) => (b.images.length > 0) - (a.images.length > 0) || (b.stock > 0) - (a.stock > 0)).slice(0, 3);
    ["#heroA", "#heroB", "#heroC"].forEach((s, i) => { if (picks[i] && $(s)) $(s).innerHTML = media(picks[i]); });
  }

  async function refreshCatalog() {
    let ok = true;
    try {
      const c = await API.getCatalog();
      PRODUCTS = c.products;
      SELLERS = { ...SELLERS, ...c.sellers };
      if (API.lastRate()) setRate(API.lastRate());
    } catch {
      ok = false;
      toast("Couldn't load the collection — check your internet and refresh");
    }
    loaded = true;
    if (ok) {
      // Only prune once we know the real catalogue — a failed load must never wipe a cart.
      cart = cart.filter((l) => byId(l.id));
      favs = new Set([...favs].filter(byId));
      store.set("cart2", cart);
      store.set("favs", [...favs]);
    }
    renderChips();
    renderGrid();
    paintHero();
    updateCounts();
    if (layers.isOpen($("#cart"))) renderCart();
    if (pState && layers.isOpen($("#pModal"))) {
      const p = byId(pState.p.id);
      if (p) { readCustomFields(); pState.p = p; renderProduct(); }
    }
  }

  async function loadDirectory() {
    if (PAGE !== "home" && !$("#cseller")) return;
    const r = await API.sellers();
    if (!r.ok) return;
    DIRECTORY = r.sellers;
    DIRECTORY.forEach((s) => { SELLERS[s.slug] = { ...(SELLERS[s.slug] || {}), ...s }; });
    renderMakers();
    fillMakerSelect();
  }

  (async function init() {
    layers.init({
      backgroundEls: [$(".top"), $("main"), $(".site-foot"), $(".bnav")],
      scrimEl: $("#scrim"),
      layerEls: [$("#cart"), $("#pModal"), $("#sModal"), $("#rModal"), $("#iosModal")]
    });
    if ($("#ctype")) $("#ctype").innerHTML = `<option value="">Choose…</option>` + Object.keys(MEASURES).map((k) => `<option>${esc(k)}</option>`).join("");
    if (standalone && $("#installMain")) $("#installMain").textContent = "Installed ✓";
    store.remove("cart"); // carts from the single-shop version can't be matched to a maker
    renderChips();
    renderGrid();
    renderMeasures();
    renderMakers();
    updateCounts();
    syncMeInputs();
    await Promise.all([refreshCatalog(), PAGE === "home" ? loadDirectory() : loadReviews()]);
    renderSlotBox();
    if (START_PRODUCT) openProduct(START_PRODUCT, { track: false });   // /p/<id>: the server already counted this view
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshCatalog(); });
    window.Market.registerServiceWorker();
  })();
})();
