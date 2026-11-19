/* =====================================================================
   Crochets Market — "My orders" (no account).
   Lists the orders saved on this device (order number + private receipt
   key), grouped into pending, completed and cancelled, and finds an order
   by its number + the buyer's phone.
   ===================================================================== */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const saved = () => { try { return JSON.parse(localStorage.getItem("cm:orders") || "[]"); } catch { return []; } };
  const save = (list) => { try { localStorage.setItem("cm:orders", JSON.stringify(list.slice(0, 50))); } catch { /* ignore */ } };

  async function post(url, data) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), credentials: "same-origin" });
      return await r.json();
    } catch {
      return { ok: false, error: "Couldn't connect. Check your internet and try again." };
    }
  }

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  const summary = (o) => (o.type === "cart"
    ? o.items.map((i) => (i.qty > 1 ? `${i.qty}× ` : "") + i.name).join(", ")
    : `Custom ${o.custom?.type || "request"}`);

  function card(o) {
    return `<a class="mo-card" href="${esc(o.path)}">
      <span class="t">${esc(o.seller.name)} · #${esc(o.id)}</span>
      <span class="r"><span class="amt">${o.total ? esc(o.total.text) : "Price to agree"}</span><span class="st st-${esc(o.tone)}">${esc(o.statusLabel)}</span></span>
      <span class="s">${esc(summary(o))} · ${esc(fmtDate(o.createdAt))}</span>
    </a>`;
  }

  function group(title, list, icon) {
    if (!list.length) return "";
    return `<section class="mo-group"><h2><i class="fa-solid ${icon}" aria-hidden="true"></i>${title}<span class="n">${list.length}</span></h2>
      <div class="mo-list">${list.map(card).join("")}</div></section>`;
  }

  async function load() {
    const mine = saved().filter((o) => o.id && o.key);
    if (!mine.length) {
      $("#moList").innerHTML = `<div class="mo-empty"><b>No orders on this device yet</b>When you send an order, its receipt appears here. Ordered somewhere else? Find it below.<p style="margin:14px 0 0"><a class="btn btn-grad btn-sm" href="/#shop">Browse crochet</a></p></div>`;
      return;
    }
    const r = await post("/api/orders/mine", { orders: mine.map(({ id, key }) => ({ id, key })) });
    if (!r.ok) {
      $("#moList").innerHTML = `<div class="mo-empty"><b>Couldn't load your orders</b>${esc(r.error || "Please try again.")}</div>`;
      return;
    }
    const pending = r.orders.filter((o) => ["New", "Confirmed", "Paid"].includes(o.status));
    const done = r.orders.filter((o) => o.status === "Delivered");
    const cancelled = r.orders.filter((o) => o.status === "Cancelled");
    $("#moList").innerHTML = (group("In progress", pending, "fa-hourglass-half") + group("Completed", done, "fa-circle-check")
      + group("Cancelled", cancelled, "fa-ban")) || `<div class="mo-empty"><b>No orders found</b>They may have been removed by the maker.</div>`;
  }

  $("#moFind").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#moBtn");
    $("#moErr").textContent = "";
    btn.disabled = true;
    const r = await post("/api/orders/find", { orderId: $("#moId").value.trim(), phone: $("#moPhone").value.trim() });
    btn.disabled = false;
    if (!r.ok) { $("#moErr").textContent = r.error || "We couldn't find that order."; return; }
    const list = saved().filter((o) => o.id !== r.id);
    list.unshift({ id: r.id, seller: r.order.seller.slug, at: r.order.createdAt, key: r.key });
    save(list);
    location.href = r.url;
  });

  load();
})();
