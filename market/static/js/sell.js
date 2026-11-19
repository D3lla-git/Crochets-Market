/* Crochets Market — seller sign-up (/sell). */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const form = $("#sellForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#sErr");
    const btn = $("#sBtn");
    err.textContent = "";
    const data = {
      shopName: $("#sShop").value.trim(), ownerName: $("#sOwner").value.trim(), whatsapp: $("#sWa").value.trim(),
      location: $("#sLoc").value.trim(), email: $("#sEmail").value.trim(), password: $("#sPw").value,
      agree: $("#sAgree").checked
    };
    if (!data.agree) { err.textContent = "Please accept the Terms of Use and Seller Policy."; $("#sAgree").focus(); return; }
    btn.disabled = true;
    btn.textContent = "Creating your shop…";
    let r;
    try {
      const res = await fetch("/api/sellers/register", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data)
      });
      r = await res.json();
    } catch {
      r = { ok: false, error: "Couldn't connect. Check your internet and try again." };
    }
    btn.disabled = false;
    btn.textContent = "Create my shop";
    if (!r.ok) { err.textContent = r.error || "Something went wrong"; return; }
    form.classList.add("done-card");
    form.innerHTML = `
      <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
      <h2>Your shop is ${r.status === "active" ? "open" : "created"}!</h2>
      <p>${r.status === "active"
        ? "Add your first crochet piece and share your link."
        : "We'll check your details and switch your shop on shortly. Meanwhile you can set up your store and add pieces — they go live once you're approved."}</p>
      <a class="btn btn-grad btn-block" href="/admin">Go to my dashboard</a>`;
  });
})();
