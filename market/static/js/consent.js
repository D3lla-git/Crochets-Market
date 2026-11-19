/* =====================================================================
   Crochets Market — cookie consent + Google AdSense loader.

   • Essential storage (cart, favourites, sign-in) works without asking.
   • Advertising cookies are only used after the visitor taps "Accept all".
     Until then — or if they choose "Essential only" — AdSense is never loaded.
   • Ad slots are <div class="ad-slot"> placeholders in the page; they stay
     empty (and take no space) when ads are off.
   Needs window.SHOP from /config.js. Works on every public page.
   ===================================================================== */
(function () {
  "use strict";

  const SHOP = window.SHOP || {};
  const ADS = SHOP.ads || {};
  const KEY = "cm:consent";
  const VERSION = 1;

  const read = () => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && v.v === VERSION ? v : null; } catch { return null; }
  };
  const write = (ads) => {
    try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ads, at: new Date().toISOString() })); } catch { /* private mode */ }
  };

  let adsLoaded = false;
  function loadAds() {
    if (adsLoaded || !ADS.client || !/^ca-pub-\d{10,20}$/.test(ADS.client)) return;
    const slots = document.querySelectorAll(".ad-slot");
    if (!slots.length) return;
    adsLoaded = true;
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.client)}`;
    s.crossOrigin = "anonymous";
    document.head.appendChild(s);
    slots.forEach((slot) => {
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.dataset.adClient = ADS.client;
      if (slot.dataset.slot || ADS.slot) ins.dataset.adSlot = slot.dataset.slot || ADS.slot;
      ins.dataset.adFormat = "auto";
      ins.dataset.fullWidthResponsive = "true";
      slot.appendChild(ins);
      slot.classList.add("on");
      slot.setAttribute("aria-label", "Advertisement");
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ad blocked */ }
    });
  }

  function banner() {
    if (document.getElementById("consent")) return;
    const el = document.createElement("section");
    el.id = "consent";
    el.className = "consent";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", "Cookie choices");
    el.innerHTML = `
      <div class="consent-text">
        <b>🍪 Cookies on ${(SHOP.name || "this site").replace(/[<>&]/g, "")}</b>
        <p>We use essential storage to keep your cart, favourites and sign-in working. With your permission, Google also uses cookies to show and measure adverts, which keep this marketplace free for makers. <a href="/legal/cookies">Cookie Policy</a></p>
      </div>
      <div class="consent-actions">
        <button type="button" class="consent-btn ghost" data-consent="essential">Essential only</button>
        <button type="button" class="consent-btn" data-consent="all">Accept all</button>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-consent]");
      if (!b) return;
      const ads = b.dataset.consent === "all";
      write(ads);
      el.remove();
      if (ads) loadAds();
      else if (adsLoaded) location.reload(); // turning ads off after they loaded needs a fresh page
    });
    el.querySelector('[data-consent="all"]').focus({ preventScroll: true });
  }

  function init() {
    const c = read();
    if (c && c.ads) loadAds();
    if (!c && ADS.client) banner();
    document.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="cookie-settings"]')) { e.preventDefault(); banner(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
