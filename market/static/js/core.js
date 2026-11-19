/* =====================================================================
   Crochets Market — shared helpers for the shop and the seller dashboard.
   Exposes everything on window.Market so the page scripts stay small.
   Plain (non-module) script on purpose: the site keeps working when
   opened straight from a folder, with no build step or local server.
   ===================================================================== */
(function () {
  "use strict";

  const SHOP = window.SHOP;
  if (!SHOP) throw new Error("config.js must be loaded before js/core.js");

  /* ---------- DOM ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const cssId = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"));

  /* ---------- text & numbers ---------- */
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  /* ---------- money: prices are in US$, always shown with the L$ equivalent ---------- */
  let rate = Number(SHOP.rate) > 0 ? Number(SHOP.rate) : 171;   // L$ per US$, set by the seller
  const getRate = () => rate;
  const setRate = (r) => { if (Number(r) > 0) rate = Number(r); };
  const usd = (n) => {                       // US$25, US$7.50 (cents always shown in full)
    const v = round2(n);
    return SHOP.currency + v.toLocaleString(undefined, { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  };
  const lrd = (n, r = rate) => SHOP.altCurrency + Math.round((Number(n) || 0) * r).toLocaleString();
  /** "US$25 (≈ L$4,275)" — for messages, buttons and other plain text. */
  const money = (n, r = rate) => `${usd(n)} (≈ ${lrd(n, r)})`;
  /** Both amounts stacked, for price tags. */
  const priceHTML = (n, r = rate) =>
    `<span class="money"><span class="usd">${usd(n)}</span><span class="lrd">≈ ${lrd(n, r)}</span></span>`;
  const rateText = (r = rate) => `${SHOP.currency}1 = ${SHOP.altCurrency}${Number(r).toLocaleString()}`;
  const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;

  /* Turn a phone number typed by a customer into the digits WhatsApp expects. */
  function waNumber(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = (SHOP.countryCode || "") + d.slice(1);
    return d;
  }

  /* ---------- browser storage (never throws) ---------- */
  const PREFIX = "cm:";
  const area = (session) => (session ? window.sessionStorage : window.localStorage);
  const store = {
    get(key, fallback, session = false) {
      try {
        const v = area(session).getItem(PREFIX + key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value, session = false) {
      try {
        area(session).setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(PREFIX + key);
        sessionStorage.removeItem(PREFIX + key);
      } catch {
        /* storage blocked — nothing to remove */
      }
    }
  };

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  /* ---------- images ---------- */
  const IMAGE_FILE = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
  const isImageFile = (f) => /^image\//.test(f.type) || IMAGE_FILE.test(f.name);

  /* Shrink a photo before upload (phones produce 5–12 MB images). Resolves to a Blob or a data: URL. */
  function compressImage(file, { max = 1400, quality = 0.82, as = "blob" } = {}) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * s);
        canvas.height = Math.round(img.naturalHeight * s);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; // transparent PNGs would otherwise turn black as JPEG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        if (as === "dataURL") return resolve(canvas.toDataURL("image/jpeg", quality));
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("read"));
      };
      img.src = url;
    });
  }

  const blobToDataURL = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

  /* ---------- layers: modals & drawers ----------
     Keeps focus inside the top-most layer (everything behind it is made `inert`),
     closes on Escape / backdrop click, and returns focus to where it was. */
  const layers = (() => {
    const stack = [];
    let background = [];
    let scrim = null;

    function sync() {
      const any = stack.length > 0;
      background.forEach((el) => el && (el.inert = any));
      stack.forEach((entry, i) => (entry.el.inert = i !== stack.length - 1));
      if (scrim) scrim.classList.toggle("open", any);
      document.body.classList.toggle("no-scroll", any);
    }

    function init({ backgroundEls = [], scrimEl = null, layerEls = [] } = {}) {
      background = backgroundEls;
      scrim = scrimEl;
      layerEls.forEach((el) => {
        el.inert = true;
        el.setAttribute("aria-hidden", "true");
      });
      if (scrim) scrim.addEventListener("click", closeAll);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && stack.length) {
          e.preventDefault();
          close(stack[stack.length - 1].el);
        }
      });
    }

    function open(el, { focus } = {}) {
      if (!el || isOpen(el)) return;
      stack.push({ el, returnTo: document.activeElement });
      el.classList.add("open");
      el.setAttribute("aria-hidden", "false");
      el.inert = false;
      sync();
      requestAnimationFrame(() => {
        if (!isOpen(el) || el.contains(document.activeElement)) return; // already focused inside (or closed again)
        const target =
          (focus && el.querySelector(focus)) ||
          el.querySelector("[autofocus]") ||
          el.querySelector("button, [href], input, select, textarea");
        if (target) target.focus({ preventScroll: true });
      });
    }

    function close(el) {
      if (!el) return;
      el.classList.remove("open");
      el.setAttribute("aria-hidden", "true");
      el.inert = true;
      const i = stack.findIndex((s) => s.el === el);
      if (i < 0) return;
      const [entry] = stack.splice(i, 1);
      sync();
      el.dispatchEvent(new CustomEvent("layerclose"));
      const back = entry.returnTo;
      if (back && document.contains(back) && !back.closest("[inert]")) back.focus({ preventScroll: true });
    }

    function closeAll() {
      [...stack].reverse().forEach((s) => close(s.el));
    }

    const isOpen = (el) => stack.some((s) => s.el === el);

    return { init, open, close, closeAll, isOpen };
  })();

  /* ---------- shared icons ---------- */
  const ICON = {
    whatsapp:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5 0a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4a.5.5 0 0 0 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    heart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    plus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    send:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>',
    bag:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>'
  };

  /* ---------- service worker (offline + installable app) ---------- */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https:|^http:\/\/(localhost|127\.0\.0\.1)/.test(location.href)) return;
    addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}));
  }

  window.Market = Object.freeze({
    SHOP,
    $, $$, cssId,
    esc, round2, plural, waNumber,
    money, usd, lrd, priceHTML, rateText, getRate, setRate,
    store, toast,
    isImageFile, compressImage, blobToDataURL,
    layers, ICON,
    registerServiceWorker
  });
})();
