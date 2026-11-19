/* =====================================================================
   Crochets Market — one-click status flyers.
   Draws a 1080×1920 image (WhatsApp Status / Instagram Story size) for a
   crochet piece: photo, name, price in US$ and L$, an "Available now" tag
   and the seller's store link. Everything happens in the browser.

   window.makeFlyer({ product, seller, storeUrl }) → Promise<Blob (JPEG)>
   ===================================================================== */
(function () {
  "use strict";

  const { SHOP, usd, lrd } = window.Market;
  const W = 1080, H = 1920;

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  async function productImage(p) {
    if (p.images && p.images.length) {
      try { return await loadImage(p.images[0]); } catch { /* fall back to the drawing */ }
    }
    const svg = window.crochetArt(p).replace("<svg ", '<svg width="1000" height="1200" ');
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function coverDraw(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }

  /* Break text into lines that fit; the last allowed line ends with "…" if text is left over. */
  function wrap(ctx, text, maxWidth, maxLines) {
    const lines = [];
    let line = "";
    String(text).split(/\s+/).forEach((w) => {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
    while (ctx.measureText(last + "…").width > maxWidth && last.length > 3) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + "…";
    return kept;
  }

  async function makeFlyer({ product: p, seller, storeUrl }) {
    try { await Promise.all([document.fonts.load("700 80px Fraunces"), document.fonts.load("800 40px Nunito")]); } catch { /* system fonts */ }
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    const head = "Fraunces, Georgia, serif";
    const body = "Nunito, system-ui, sans-serif";

    // background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#D6EFDF"); bg.addColorStop(0.55, "#EAF5EE"); bg.addColorStop(1, "#F4F0E3");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.18)";
    for (let y = 30; y < H; y += 46) for (let x = 30; x < W; x += 46) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }

    // header: platform name
    ctx.fillStyle = "#0D2413";
    ctx.font = `700 46px ${head}`;
    ctx.textAlign = "center";
    ctx.fillText(SHOP.name || "Crochets Market", W / 2, 120);

    // photo card
    const img = await productImage(p);
    const px = 90, py = 180, pw = 900, ph = 1040;
    ctx.save();
    ctx.shadowColor = "rgba(30,41,59,.35)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 24;
    roundRect(ctx, px - 14, py - 14, pw + 28, ph + 28, 56);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, px, py, pw, ph, 44);
    ctx.clip();
    coverDraw(ctx, img, px, py, pw, ph);
    ctx.restore();

    // status tag
    const soldOut = p.stock <= 0;
    const tag = soldOut ? "MADE TO ORDER" : p.customEnabled ? "CUSTOM ORDERS OPEN" : "AVAILABLE NOW";
    ctx.font = `800 38px ${body}`;
    const tw = ctx.measureText(tag).width + 70;
    roundRect(ctx, px + 36, py + 36, tw, 76, 38);
    ctx.fillStyle = soldOut ? "#33443A" : "#198754"; ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "left";
    ctx.fillText(tag, px + 71, py + 88);

    // name + price panel
    const by = py + ph + 50;
    roundRect(ctx, 70, by, W - 140, 440, 48);
    ctx.fillStyle = "rgba(255,255,255,.94)"; ctx.fill();
    ctx.fillStyle = "#0D2413"; ctx.textAlign = "center";
    ctx.font = `700 70px ${head}`;
    const lines = wrap(ctx, p.name, W - 240, 2);
    lines.forEach((l, i) => ctx.fillText(l, W / 2, by + 110 + i * 80));
    const pyy = by + 110 + lines.length * 80 + 30;
    ctx.font = `800 84px ${body}`;
    ctx.fillStyle = "#198754";
    ctx.fillText(usd(p.price), W / 2, pyy);
    ctx.font = `700 40px ${body}`;
    ctx.fillStyle = "#5C6B62";
    ctx.fillText(`≈ ${lrd(p.price)}`, W / 2, pyy + 56);

    // footer band: seller + link
    const fy = H - 210;
    const fg = ctx.createLinearGradient(0, fy, W, H);
    fg.addColorStop(0, "#0D2413"); fg.addColorStop(0.6, "#145C36"); fg.addColorStop(1, "#198754");
    ctx.fillStyle = fg;
    ctx.fillRect(0, fy, W, 210);
    ctx.fillStyle = "#fff";
    ctx.font = `800 44px ${body}`;
    ctx.fillText(`Shop ${seller?.name || ""}`.trim(), W / 2, fy + 82);
    ctx.font = `700 38px ${body}`;
    ctx.globalAlpha = 0.92;
    ctx.fillText(String(storeUrl).replace(/^https?:\/\//, ""), W / 2, fy + 140);
    ctx.globalAlpha = 1;

    // JPEG: Story apps (Instagram, Facebook, WhatsApp Status) accept it everywhere, and it's a fraction of a PNG's size.
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("flyer"))), "image/jpeg", 0.92));
  }

  window.makeFlyer = makeFlyer;
})();
