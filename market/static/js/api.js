/* =====================================================================
   Crochets Market — data layer.
   Talks to the Flask JSON API (market/api.py). Sellers and the platform
   manager are identified by an HttpOnly session cookie.
   ===================================================================== */
(function () {
  "use strict";

  const { store } = window.Market;

  /* ---------- sanitising (defence in depth — the server validates too) ---------- */
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const SAFE_IMG = /^(\/uploads\/|https:\/\/|data:image\/(jpeg|png|webp|gif);base64,|blob:)/i;
  const safeHex = (h) => (HEX.test(String(h || "").trim()) ? String(h).trim() : "#5EB8AE");
  const safeImg = (u) => SAFE_IMG.test(String(u || "").trim());

  function normalize(p) {
    const colors = (Array.isArray(p.colors) && p.colors.length ? p.colors : [{ n: "As pictured", h: "#5EB8AE" }])
      .map((c) => ({ n: String(c.n || c.name || "Colour"), h: safeHex(c.h || c.hex) }));
    const sizes = (Array.isArray(p.sizes) ? p.sizes : String(p.sizes || "").split(","))
      .map((s) => String(s).trim())
      .filter(Boolean);
    return {
      id: String(p.id),
      sellerId: p.sellerId ?? null,
      seller: String(p.seller || ""),
      name: String(p.name || "Untitled"),
      category: String(p.category || "Other"),
      price: Math.max(0, Number(p.price) || 0),
      stock: Math.max(0, Math.round(Number(p.stock) || 0)),
      sold: Math.max(0, Number(p.sold) || 0),
      sizes: sizes.length ? sizes : ["One size"],
      colors,
      desc: String(p.desc || ""),
      badge: String(p.badge || ""),
      shape: String(p.shape || "top"),
      images: (Array.isArray(p.images) ? p.images : []).map((u) => String(u).trim()).filter(safeImg),
      active: p.active !== false,
      customEnabled: !!p.customEnabled,
      turnaroundDays: Math.max(0, Number(p.turnaroundDays) || 0),
      soldAt: p.soldAt || null,
      created: p.created || "",
      updated: p.updated || ""
    };
  }

  /* ---------- HTTP ---------- */
  async function request(method, path, data, timeoutMs = 30000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const init = { method, credentials: "same-origin", signal: ctl.signal, headers: { Accept: "application/json" } };
      if (data !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(data);
      }
      const r = await fetch(path, init);
      try {
        return await r.json();
      } catch {
        return { ok: false, code: "server", error: `The server answered with an error (${r.status}). Please try again.` };
      }
    } catch (e) {
      const timedOut = e && e.name === "AbortError";
      return { ok: false, code: "network", error: timedOut ? "The connection timed out. Please try again." : "Couldn't connect. Check your internet and try again." };
    } finally {
      clearTimeout(timer);
    }
  }
  const enc = encodeURIComponent;
  let lastRate = 0; // newest L$ rate the server reported with the product list

  window.API = Object.freeze({
    live: true,
    normalize,
    lastRate: () => lastRate,

    /* ================= public ================= */

    /** → { products, sellers: { slug: profile } }. Pass a seller slug to load one store. */
    async getCatalog(seller) {
      const key = "cache:catalog:" + (seller || "all");
      const j = await request("GET", "/api/products" + (seller ? "?seller=" + enc(seller) : ""), undefined, 20000);
      if (j.ok && Array.isArray(j.products)) {
        if (Number(j.rate) > 0) lastRate = Number(j.rate);
        const out = { products: j.products.map(normalize), sellers: j.sellers || {} };
        store.set(key, out);
        return out;
      }
      const cached = store.get(key, null); // offline: show the last catalogue we saw
      if (cached) return { products: cached.products.map(normalize), sellers: cached.sellers || {} };
      throw new Error(j.error || "Couldn't load products");
    },
    sellers: () => request("GET", "/api/sellers", undefined, 20000),
    seller: (slug) => request("GET", `/api/sellers/${enc(slug)}`, undefined, 20000),
    placeOrder: (order) => request("POST", "/api/orders", order, 90000),
    review: (data) => request("POST", "/api/reviews", data),
    register: (data) => request("POST", "/api/sellers/register", data),
    /** Engagement beacon when a product pop-up opens (doesn't count as an ad page view). */
    trackOpen(productId) {
      try {
        const blob = new Blob([JSON.stringify({ productId })], { type: "application/json" });
        if (!navigator.sendBeacon || !navigator.sendBeacon("/api/track", blob)) request("POST", "/api/track", { productId }, 5000);
      } catch { /* analytics must never break the page */ }
    },

    /* ================= dashboard ================= */
    login: (email, password, remember) => request("POST", "/api/dash/login", { email, password, remember: !!remember }, 20000),
    logout: () => request("POST", "/api/dash/logout", {}),
    me: () => request("GET", "/api/dash/me", undefined, 15000),
    changePassword: (current, next) => request("POST", "/api/dash/password", { current, new: next }),

    async load() {
      const j = await request("GET", "/api/dash/data");
      if (j.ok) j.products = (j.products || []).map(normalize);
      return j;
    },
    async saveProduct(p, sellerId) {
      const j = await request("POST", "/api/dash/products", { product: p, sellerId });
      if (j.ok) j.product = normalize(j.product);
      return j;
    },
    markSold: (id) => request("POST", `/api/dash/products/${enc(id)}/sold`, {}),
    deleteProduct: (id) => request("DELETE", `/api/dash/products/${enc(id)}`, {}),
    adjustStock: (id, delta) => request("POST", `/api/dash/products/${enc(id)}/stock`, { delta }),
    uploadImage: (dataURL, name) => request("POST", "/api/dash/images", { image: { name, data: dataURL } }, 90000),
    updateOrder: (id, changes) => request("PATCH", `/api/dash/orders/${enc(id)}`, { changes }),
    orderSeen: (id) => request("POST", `/api/dash/orders/${enc(id)}/seen`, {}, 10000),
    pulse: () => request("GET", "/api/dash/pulse", undefined, 15000),
    saveStore: (store_, sellerId) => request("POST", "/api/dash/store", { store: store_, sellerId }),

    /* manager */
    saveSettings: (settings) => request("POST", "/api/dash/settings", settings),
    createSeller: (data) => request("POST", "/api/dash/sellers", data),
    updateSeller: (id, changes) => request("PATCH", `/api/dash/sellers/${id}`, changes),
    deleteSeller: (id, confirm) => request("DELETE", `/api/dash/sellers/${id}`, { confirm }),
    resetSellerPassword: (id) => request("POST", `/api/dash/sellers/${id}/reset-password`, {}),
    sellerReviews: (id) => request("GET", `/api/dash/sellers/${id}/reviews`),
    hideReview: (id, hidden) => request("PATCH", `/api/dash/reviews/${id}`, { hidden }),
    adReport: (month) => request("GET", `/api/dash/ads?month=${enc(month)}`),
    saveAdRevenue: (month, amount, note) => request("POST", "/api/dash/ads", { month, amount, note })
  });
})();
