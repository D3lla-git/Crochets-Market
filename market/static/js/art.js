/* =====================================================================
   Crochets Market — drawn crochet illustrations.
   Shown in place of a photo until the seller uploads one.
   Usage: window.crochetArt(product, optionalHexColour) → SVG string.
   ===================================================================== */
(function () {
  "use strict";

  function safeHex(h){ return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(h||"")) ? h : "#5EB8AE"; }
  function shade(hex, amt){
    let c = hex.replace("#",""); if(c.length===3) c=c.split("").map(x=>x+x).join("");
    const n = parseInt(c,16); let r=n>>16, g=(n>>8)&255, b=n&255;
    const f = v => Math.max(0,Math.min(255, Math.round(amt<0 ? v*(1+amt) : v+(255-v)*amt)));
    return "#"+[f(r),f(g),f(b)].map(v=>v.toString(16).padStart(2,"0")).join("");
  }
  function scallop(x1,x2,y,n,depth=7){ const w=(x2-x1)/n; let d=`M${x1} ${y}`; for(let i=0;i<n;i++) d+=` q${w/2} ${depth} ${w} 0`; return d; }
  let artSeq = 0;
  function art(p, colorHex){
    const c = safeHex(colorHex || (p.colors && p.colors[0] && p.colors[0].h)), light = shade(c,.45), dark = shade(c,-.32), acc = shade(c,.7);
    const u = "a"+(artSeq++);
    const S = `fill="url(#st${u})" stroke="${dark}" stroke-width="1.6" stroke-linejoin="round"`;
    const T = (d,w=3) => `<path d="${d}" fill="none" stroke="${acc}" stroke-width="${w}" stroke-linecap="round"/>`;
    const shapes = {
      top: `<path ${S} d="M70 58 L80 58 L88 92 Q100 98 112 92 L120 58 L130 58 L134 104 Q140 124 138 166 L62 166 Q60 124 66 104 Z"/>${T(scallop(62,138,166,8))}${T("M70 58 L80 58",4)}${T("M120 58 L130 58",4)}`,
      halter: `<path ${S} d="M95 50 L105 50 L114 94 Q136 106 140 160 L60 160 Q64 106 86 94 Z"/>${T(scallop(60,140,160,8))}<path d="M95 50 Q82 70 64 66 M105 50 Q118 70 136 66" stroke="${dark}" stroke-width="2" fill="none"/>`,
      dress: `<path ${S} d="M80 34 L88 34 L92 62 Q100 68 108 62 L112 34 L120 34 L126 84 Q122 98 116 104 L156 212 L44 212 L84 104 Q78 98 74 84 Z"/>${T("M80 102 Q100 108 120 102",5)}${T(scallop(44,156,212,10))}`,
      maxi: `<path ${S} d="M82 26 L89 26 L93 54 Q100 59 107 54 L111 26 L118 26 L124 76 Q120 88 115 94 L162 226 L38 226 L85 94 Q80 88 76 76 Z"/>${T("M82 92 Q100 98 118 92",5)}${T("M70 150 Q100 160 130 150",2)}${T("M58 190 Q100 202 142 190",2)}${T(scallop(38,162,226,12))}`,
      cardigan: `<path ${S} d="M78 40 Q100 52 122 40 L152 54 Q164 104 172 152 L152 158 L140 102 L140 206 L60 206 L60 102 L48 158 L28 152 Q36 104 48 54 Z"/><path d="M100 48 L100 206" stroke="${dark}" stroke-width="2"/>${[82,112,142,172].map(y=>`<circle cx="106" cy="${y}" r="3.6" fill="${acc}" stroke="${dark}" stroke-width="1"/>`).join("")}${T("M60 196 L140 196",5)}${T("M28 148 L48 154",4)}${T("M152 154 L172 148",4)}`,
      skirt: `<path ${S} d="M66 66 L134 66 L136 84 L160 184 L40 184 L64 84 Z"/><path d="M66 66 L134 66 L136 84 L64 84 Z" fill="${acc}" stroke="${dark}" stroke-width="1.6"/>${T(scallop(40,160,184,10))}`,
      set: `<path ${S} d="M76 30 L84 30 L90 54 Q100 58 110 54 L116 30 L124 30 L128 68 Q132 82 130 104 L70 104 Q68 82 72 68 Z"/>${T(scallop(70,130,104,6,6))}<path ${S} d="M70 120 L130 120 L132 132 L150 212 L50 212 L68 132 Z"/><path d="M70 120 L130 120 L132 132 L68 132 Z" fill="${acc}" stroke="${dark}" stroke-width="1.4"/>${T(scallop(50,150,212,9))}`,
      hat: `<path ${S} d="M64 92 Q100 58 136 92 L142 140 L172 154 Q100 180 28 154 L58 140 Z"/>${T("M60 132 Q100 144 140 132",7)}`,
      bag: `<path d="M74 104 Q74 50 100 50 Q126 50 126 104" stroke="${dark}" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M74 104 Q74 50 100 50 Q126 50 126 104" stroke="${c}" stroke-width="4.5" fill="none" stroke-linecap="round"/><path ${S} d="M48 100 L152 100 L144 206 L56 206 Z"/>${[0,72,144,216,288].map(a=>`<ellipse cx="100" cy="140" rx="7" ry="14" fill="${acc}" stroke="${dark}" stroke-width="1" transform="rotate(${a} 100 154)"/>`).join("")}<circle cx="100" cy="154" r="6" fill="#FFE07A" stroke="${dark}" stroke-width="1"/>`,
      romper: `<path ${S} d="M78 44 L86 44 L92 72 Q100 76 108 72 L114 44 L122 44 L128 96 L134 154 L138 192 L106 192 L100 158 L94 192 L62 192 L66 154 L72 96 Z"/>${T("M72 100 L128 100",5)}<circle cx="82" cy="60" r="3" fill="${acc}"/><circle cx="118" cy="60" r="3" fill="${acc}"/>`
    };
    return `<svg viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${window.Market.esc(p.name)}">
    <defs>
      <linearGradient id="bg${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--art-1,#E3F2EA)"/><stop offset=".55" style="stop-color:var(--art-2,#EEF5F0)"/><stop offset="1" style="stop-color:var(--art-3,#F5F1E6)"/></linearGradient>
      <pattern id="st${u}" width="9" height="8" patternUnits="userSpaceOnUse"><rect width="9" height="8" fill="${c}"/><path d="M0 4 Q2.25 0 4.5 4 T9 4" stroke="${light}" stroke-width="1.3" fill="none"/><circle cx="4.5" cy="6.6" r=".9" fill="${dark}" opacity=".35"/></pattern>
    </defs>
    <rect width="200" height="240" fill="url(#bg${u})"/>
    <circle cx="30" cy="34" r="16" style="fill:var(--art-dot,#fff)" opacity=".55"/><circle cx="176" cy="200" r="22" style="fill:var(--art-dot,#fff)" opacity=".45"/>
    <ellipse cx="100" cy="226" rx="62" ry="6" fill="#0D2413" opacity=".08"/>
    ${shapes[p.shape] || shapes.top}
  </svg>`;
  }

  window.crochetArt = art;
})();
