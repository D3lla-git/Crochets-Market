/* =====================================================================
   Crochets Market — receipt page.
   Print / save as PDF, copy the private link, show dates in the buyer's
   own time zone, and remember this order for "My orders" on this device.
   ===================================================================== */
(function () {
  "use strict";
  const page = document.querySelector("[data-receipt-path]");
  if (!page) return;
  const path = page.dataset.receiptPath;
  const [, , id, key] = path.split("/");

  // Remember the order on this phone, so it shows under "My orders" even if the link came from WhatsApp.
  try {
    const list = JSON.parse(localStorage.getItem("cm:orders") || "[]");
    const at = page.querySelector("time")?.getAttribute("datetime") || new Date().toISOString();
    const i = list.findIndex((o) => o.id === id);
    if (i >= 0) list[i] = { ...list[i], key };
    else list.unshift({ id, seller: page.dataset.seller || "", at, key });
    localStorage.setItem("cm:orders", JSON.stringify(list.slice(0, 50)));
  } catch { /* storage blocked: the link still works */ }

  document.querySelectorAll("[data-local-date]").forEach((t) => {
    const d = new Date(t.getAttribute("datetime"));
    if (!isNaN(d)) t.textContent = d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  });

  function toast(msg) {
    let el = document.getElementById("rcToast");
    if (!el) {
      el = Object.assign(document.createElement("div"), { id: "rcToast", role: "status" });
      el.style.cssText = "position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--inverse-bg);color:var(--inverse-text);padding:12px 18px;border-radius:999px;font-weight:800;z-index:90;box-shadow:var(--shadow-lg)";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    if (b.dataset.action === "print") window.print();
    if (b.dataset.action === "copy-receipt") {
      const url = location.origin + path;
      try { await navigator.clipboard.writeText(url); toast("Receipt link copied"); }
      catch { window.prompt("Copy your receipt link:", url); }
    }
  });
})();
