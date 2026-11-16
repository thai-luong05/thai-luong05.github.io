(() => {
  "use strict";
  const S = window.SITE;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MONO = '"JetBrains Mono", ui-monospace, monospace';
  const QC = ["q3", "q1", "q2", "q5", "q4", "q6"]; // color cycle

  /* ---------------- colors & theme ---------------- */
  const C = {};
  const TOKENS = ["bg", "bg-2", "canvas-bg", "text", "muted", "faint", "line", "line-strong", "q1", "q2", "q3", "q4", "q5", "q6"];
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    TOKENS.forEach((k) => (C[k] = cs.getPropertyValue("--" + k).trim()));
  }
  const isDark = () => document.documentElement.dataset.theme === "dark";
  function hexToRgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
  function makeLUT(stops) {
    const lut = new Uint8ClampedArray(256 * 3);
    const s = stops.map(([t, h]) => [t, hexToRgb(h)]);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < s.length - 2 && t > s[k + 1][0]) k++;
      const [t0, c0] = s[k], [t1, c1] = s[k + 1];
      const u = clamp((t - t0) / (t1 - t0), 0, 1);
      for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * u;
    }
    return lut;
  }
  const LUT_SEQ = makeLUT([[0, "#120638"], [0.25, "#4b1fb8"], [0.5, "#b02fd6"], [0.72, "#ff4f9a"], [0.88, "#ffa63d"], [1, "#fff1a1"]]);
  const LUT_DIV_DARK = makeLUT([[0, "#c9f7ff"], [0.14, "#22d3ee"], [0.32, "#4338ca"], [0.5, "#0a0720"], [0.68, "#a21caf"], [0.86, "#ff4fd8"], [1, "#ffd27a"]]);
  const LUT_DIV_LIGHT = makeLUT([[0, "#0e7490"], [0.22, "#67e8f9"], [0.5, "#ffffff"], [0.78, "#f9a8d4"], [1, "#7c3aed"]]);
  const lutCss = (lut, t) => { const i = clamp(Math.round(t * 255), 0, 255) * 3; return `rgb(${lut[i]},${lut[i + 1]},${lut[i + 2]})`; };

  const redrawers = [];
  const onRedraw = (fn) => redrawers.push(fn);
  const redrawAll = () => redrawers.forEach((f) => f());
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch (e) { /* storage unavailable */ }
    readColors();
    redrawAll();
  }

  /* ---------------- helpers ---------------- */
  function setupCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  function makeLoop(fn) {
    let id = 0, on = false, last = 0;
    const tick = (t) => { if (!on) return; const s = t / 1000; fn(s, Math.min(0.05, s - last || 0.016)); last = s; id = requestAnimationFrame(tick); };
    return { start() { if (!on) { on = true; last = 0; id = requestAnimationFrame(tick); } }, stop() { on = false; cancelAnimationFrame(id); } };
  }
  function whenVisible(elm, loop) {
    new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? loop.start() : loop.stop()))).observe(elm);
  }
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function gaussFrom(rnd) {
    let spare = null;
    return () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0; while (u === 0) u = rnd();
      const v = rnd(), m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(TAU * v);
      return m * Math.cos(TAU * v);
    };
  }
  const gauss = gaussFrom(Math.random);
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function fmtPi(v) {
    const r = v / Math.PI;
    for (const den of [1, 2, 3, 4, 6, 8]) {
      const num = Math.round(r * den);
      if (Math.abs(r * den - num) < 0.02 && num !== 0) {
        const n = num === 1 ? "" : num === -1 ? "−" : String(num).replace("-", "−");
        return den === 1 ? `${n}π` : `${n}π/${den}`;
      }
    }
    return Math.abs(v) < 0.005 ? "0" : v.toFixed(2);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; }
      catch (e2) { return false; }
    }
  }

  /* ---------------- content binding ---------------- */
  function bindContent() {
    $$("[data-bind]").forEach((n) => { const v = S[n.dataset.bind]; if (v != null) n.textContent = v; });
    $("#footLinks").innerHTML = S.links.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join("");
    $("#year").textContent = new Date().getFullYear();
    $("#mailBtn").href = "mailto:" + S.email;
    $("#mailBtn").textContent = "\u2709 " + S.email;
  }

  /* ---------------- header / nav ---------------- */
  function header() {
    const bar = $("#topbar");
    const onScroll = () => bar.classList.toggle("scrolled", window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const nav = $("#nav"), btn = $("#menuBtn");
    btn.addEventListener("click", () => btn.setAttribute("aria-expanded", nav.classList.toggle("open")));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) { nav.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); } });
    const links = $$(".nav a");
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.dataset.section === e.target.id));
    }), { rootMargin: "-45% 0px -50% 0px" });
    $$("main > section").forEach((s) => io.observe(s));
    $("#themeBtn").addEventListener("click", () => setTheme(isDark() ? "light" : "dark"));
  }

  /* ---------------- Bloch sphere renderer ---------------- */
  function drawBloch(ctx, o) {
    const cyw = Math.cos(o.yaw), syw = Math.sin(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    const R = o.R, cx = o.cx, cy = o.cy;
    const P = (x, y, z) => { const x1 = x * cyw - y * syw, y1 = x * syw + y * cyw; return [cx + x1 * R, cy - (y1 * sp + z * cp) * R, y1 * cp - z * sp]; };
    const dark = isDark();
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R * 1.05);
    g.addColorStop(0, rgba(C.q1, dark ? 0.32 : 0.16)); g.addColorStop(0.65, rgba(C.q2, dark ? 0.1 : 0.06)); g.addColorStop(1, rgba(C.q3, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = C["line-strong"]; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

    const circles = [(t) => [Math.cos(t), Math.sin(t), 0], (t) => [Math.cos(t), 0, Math.sin(t)], (t) => [0, Math.cos(t), Math.sin(t)]];
    circles.forEach((f, ci) => {
      for (const front of [false, true]) {
        ctx.beginPath(); ctx.setLineDash(front ? [] : [3, 4]);
        ctx.strokeStyle = ci === 0 ? rgba(C.q3, front ? 0.6 : 0.28) : front ? C["line-strong"] : C.line;
        ctx.lineWidth = ci === 0 ? 1.6 : 1;
        let pen = false;
        for (let k = 0; k <= 96; k++) {
          const [x, y, d] = P(...f((k / 96) * TAU));
          if ((d < 0) === front) { pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; } else pen = false;
        }
        ctx.stroke();
      }
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath();
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { const a = P(-v[0], -v[1], -v[2]), b = P(...v); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    ctx.font = `600 ${Math.max(10, Math.round(R * 0.1))}px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    [[[0, 0, 1.2], "|0⟩", C.q3], [[0, 0, -1.2], "|1⟩", C.q2], [[1.24, 0, 0], "|+⟩", C.muted], [[0, 1.24, 0], "|+i⟩", C.muted]].forEach(([v, l, c]) => { const p = P(...v); ctx.fillStyle = c; ctx.fillText(l, p[0], p[1]); });

    if (o.trail && o.trail.length > 1) {
      ctx.lineWidth = 2; ctx.lineCap = "round";
      for (let i = 1; i < o.trail.length; i++) {
        const a = P(...o.trail[i - 1]), b = P(...o.trail[i]);
        ctx.strokeStyle = rgba(C.q5, (i / o.trail.length) * 0.8);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    const v = o.vec, len = Math.hypot(v[0], v[1], v[2]);
    if (len > 0.08) {
      const tip = P(...v), foot = P(v[0], v[1], 0);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = rgba(C.q2, 0.45); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(foot[0], foot[1]); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]);
      const gr = ctx.createLinearGradient(cx, cy, tip[0], tip[1]); gr.addColorStop(0, C.q3); gr.addColorStop(1, C.q2);
      ctx.strokeStyle = gr; ctx.lineWidth = Math.max(3, R * 0.03); ctx.lineCap = "round";
      if (dark) { ctx.shadowColor = C.q2; ctx.shadowBlur = 16; }
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.q2; ctx.beginPath(); ctx.arc(tip[0], tip[1], Math.max(5, R * 0.055), 0, TAU); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    } else {
      const pulse = 1 + 0.25 * Math.sin(performance.now() / 250);
      ctx.fillStyle = rgba(C.q5, 0.25); ctx.beginPath(); ctx.arc(cx, cy, 16 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = C.q5; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = C.text; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, TAU); ctx.fill();
    ctx.textBaseline = "alphabetic";
  }
  const sph = (b) => [b.r * Math.sin(b.theta) * Math.cos(b.phi), b.r * Math.sin(b.theta) * Math.sin(b.phi), b.r * Math.cos(b.theta)];

  /* ---------------- journey: illustrated side-scroller ---------------- */
  const journeyAPI = {};
  const INK = "#1d1a39";

  /* outlined "capsule" stroke: ink underlay + colored core (cacti, robot arms…) */
  const capsule = (d, col, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 8}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  /* blob from overlapping circles with a single clean outline */
  const blob = (circles, fill) => circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 4}" fill="${INK}"/>`).join("") + circles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join("");
  const cloud = (x, y, s = 1, fill = "#fffcf6") => blob([[x, y, 34 * s], [x + 40 * s, y - 18 * s, 44 * s], [x + 88 * s, y, 32 * s], [x + 44 * s, y + 10 * s, 34 * s]], fill);
  const birds = (x, y) => `<path d="M${x} ${y} q 13 -13 26 0 q 13 -13 26 0" fill="none" class="o3"/>`;

  const SCENES = {
    profile: {
      sky: "#fde3c6", gnd: "#d79a62",
      svg: () => {
        const books = [[140, 26, 86, "#ff6b4a"], [168, 22, 76, "#10a5c4"], [192, 30, 92, "#ffc93c"], [224, 24, 70, "#6c5ce7"], [250, 28, 88, "#2fb36b"], [300, 24, 80, "#ff4f9a"], [326, 30, 66, "#ffc93c"], [358, 26, 90, "#10a5c4"]];
        return `
        <g opacity=".22">${Array.from({ length: 13 }, (_, i) => `<rect x="${i * 120 - 20}" y="0" width="44" height="800" fill="#f2bf8d"/>`).join("")}</g>
        <rect x="-300" y="772" width="2040" height="28" fill="#f4bf8c" class="o"/>
        <g>
          <rect x="120" y="560" width="300" height="240" fill="#b8693c" class="o"/>
          ${books.map(([x, w, h, c]) => `<rect x="${x}" y="${676 - h}" width="${w}" height="${h}" rx="3" fill="${c}" class="o3"/>`).join("")}
          ${books.map(([x, w, h, c], i) => `<rect x="${x}" y="${790 - (h - 12)}" width="${w}" height="${h - 12}" rx="3" fill="${books[(i + 3) % books.length][3]}" class="o3"/>`).join("")}
          <line x1="120" y1="680" x2="420" y2="680" class="o"/>
          <path d="M372 560 L376 520 L404 520 L408 560 Z" fill="#ff6b4a" class="o3"/>
          ${capsule("M390 518 V478", "#2fb36b", 14)}${capsule("M390 500 H376 V488", "#2fb36b", 8)}
        </g>
        <g>
          <path d="M470 690 L560 690 L548 800 L482 800 Z" fill="#ff4f9a" class="o"/>
          <path d="M515 690 C 495 620 450 600 440 552 C 490 572 528 620 515 690 Z" fill="#2fb36b" class="o"/>
          <path d="M517 690 C 535 610 575 590 590 545 C 556 572 520 620 517 690 Z" fill="#2fb36b" class="o"/>
          <path d="M516 690 C 512 630 515 570 524 512 C 540 572 530 640 516 690 Z" fill="#45c97f" class="o"/>
        </g>
        <g>
          <rect x="640" y="230" width="320" height="340" rx="6" fill="#fff6ea" class="o"/>
          <rect x="662" y="252" width="276" height="296" fill="#8fd8f5" class="o"/>
          <g class="far"><circle cx="876" cy="318" r="36" fill="#ffc93c" class="o"/>${cloud(690, 300, 0.55)}</g>
          <path d="M672 470 q 33 -44 66 0 t 66 0 t 66 0 t 66 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
          <path d="M672 505 q 33 -30 66 0 t 66 0 t 66 0 t 66 0" fill="none" stroke="#ff4f9a" stroke-width="5" stroke-linecap="round"/>
          <line x1="800" y1="252" x2="800" y2="548" class="o"/><line x1="662" y1="400" x2="938" y2="400" class="o"/>
          <rect x="624" y="568" width="352" height="20" rx="4" fill="#f4bf8c" class="o"/>
        </g>
        <g>
          <rect x="1060" y="140" width="220" height="250" rx="10" fill="#fff6ea" class="o"/>
          <circle cx="1170" cy="250" r="70" fill="#c9bcff" class="o"/>
          <ellipse cx="1170" cy="250" rx="70" ry="20" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="8 7"/>
          <line x1="1170" y1="250" x2="1214" y2="196" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
          <circle cx="1214" cy="196" r="10" fill="#ff4f9a" class="o3"/>
          <text x="1170" y="364" text-anchor="middle" font-size="28" fill="${INK}">|ψ⟩</text>
        </g>
        <g>
          <rect x="1000" y="632" width="22" height="168" fill="#a85f36" class="o"/>
          <rect x="1338" y="632" width="22" height="168" fill="#a85f36" class="o"/>
          <rect x="1170" y="632" width="168" height="96" fill="#b56a3e" class="o"/><circle cx="1254" cy="680" r="7" fill="#ffc93c" class="o3"/>
          <rect x="980" y="606" width="400" height="26" rx="4" fill="#c8784a" class="o"/>
          <path d="M1030 606 L1048 474 L1222 474 L1240 606 Z" fill="#2b2a6b" class="o"/>
          <text x="1135" y="558" text-anchor="middle" font-size="46" fill="#ffc93c">|ψ⟩</text>
          <rect x="1010" y="598" width="250" height="12" rx="4" fill="#a7acd6" class="o"/>
          <rect x="1280" y="552" width="46" height="54" rx="6" fill="#ff6b4a" class="o"/><path d="M1326 566 q 22 0 22 16 q 0 16 -22 16" fill="none" class="o"/>
          <path class="steam" d="M1295 540 q -8 -12 0 -24 q 8 -12 0 -24" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
          <path class="steam" style="animation-delay:-1.2s" d="M1312 540 q -8 -12 0 -24 q 8 -12 0 -24" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
        </g>`;
      },
    },

    hanoi: {
      sky: "#ffb27a", gnd: "#e3965a",
      svg: () => {
        const houses = [[720, 120, 420, "#ffd166"], [840, 110, 520, "#2ec4b6"], [950, 130, 380, "#ff8fab"], [1080, 110, 470, "#a0e7a0"], [1190, 120, 545, "#9b8cff"], [1310, 130, 430, "#ffd166"]];
        let h = `<g class="far"><circle cx="1180" cy="170" r="78" fill="#ffd23f" class="o"/>${birds(960, 150)}${birds(1010, 120)}${cloud(1240, 320, .6)}</g>`;
        h += `<rect x="-300" y="700" width="1000" height="100" fill="#3fb6e8" class="o"/>
          <path d="M60 740 q 20 -10 40 0 M200 760 q 20 -10 40 0 M470 735 q 20 -10 40 0 M580 765 q 20 -10 40 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
          <ellipse cx="330" cy="706" rx="120" ry="20" fill="#7cc77a" class="o"/>
          <rect x="292" y="612" width="76" height="92" fill="#f2d7a1" class="o"/>
          <path d="M318 704 v-30 a12 12 0 0 1 24 0 v30" fill="#8a4b2a" class="o3"/>
          <rect x="304" y="566" width="52" height="46" fill="#f2d7a1" class="o"/>
          <path d="M270 616 L390 616 L366 594 L294 594 Z" fill="#c0503a" class="o"/>
          <path d="M288 568 L372 568 L354 548 L306 548 Z" fill="#c0503a" class="o"/>
          <path d="M310 550 L350 550 L330 520 Z" fill="#c0503a" class="o"/>
          ${capsule("M110 800 C 112 740 100 690 84 640", "#8a5a3a", 14)}
          <path d="M84 640 C 40 620 20 640 0 660 C 30 630 60 630 84 640 Z M84 640 C 120 600 160 610 180 630 C 150 615 120 620 84 640 Z M84 640 C 70 590 90 560 120 550 C 100 575 92 600 84 640 Z" fill="#2fb36b" class="o"/>`;
        houses.forEach(([x, w, ht, c], i) => {
          const y = 800 - ht;
          h += `<rect x="${x}" y="${y}" width="${w}" height="${ht}" fill="${c}" class="o"/><rect x="${x - 6}" y="${y - 14}" width="${w + 12}" height="16" fill="#fff6ea" class="o3"/>`;
          for (let fy = y + 34; fy < 640; fy += 100) {
            h += `<rect x="${x + 18}" y="${fy}" width="${w / 2 - 28}" height="44" fill="#fff3d6" class="o3"/><rect x="${x + w / 2 + 10}" y="${fy}" width="${w / 2 - 28}" height="44" fill="#fff3d6" class="o3"/>`;
            h += `<line x1="${x + 8}" y1="${fy + 58}" x2="${x + w - 8}" y2="${fy + 58}" class="o3"/><circle cx="${x + 26}" cy="${fy + 50}" r="7" fill="#2fb36b" class="o3"/>`;
          }
          const stripes = Array.from({ length: Math.floor(w / 20) }, (_, k) => `<rect x="${x + k * 20}" y="${680}" width="10" height="26" fill="${k % 2 ? "#fff" : "#ff4f4f"}"/>`).join("");
          h += `${stripes}<rect x="${x}" y="680" width="${w}" height="26" fill="none" class="o3"/><rect x="${x + w / 2 - 20}" y="726" width="40" height="74" fill="#5a3a2a" class="o3"/>`;
          if (i === 1) h += `<rect x="${x + 30}" y="${y - 30}" width="40" height="16" fill="#9aa0c8" class="o3"/>${capsule(`M${x + 50} ${y - 34} L${x + 80} ${y - 86} L${x + 120} ${y - 70}`, "#ffc93c", 10)}<circle cx="${x + 80}" cy="${y - 86}" r="8" fill="#ff6b4a" class="o3"/><path d="M${x + 122} ${y - 80} l12 -6 M${x + 122} ${y - 62} l12 6" class="o3"/>`;
        });
        const lan = (t) => { const x = (1 - t) ** 2 * 700 + 2 * (1 - t) * t * 1080 + t * t * 1460, y = (1 - t) ** 2 * 260 + 2 * (1 - t) * t * 360 + t * t * 250; return [x, y]; };
        h += `<path d="M700 260 Q 1080 360 1460 250" fill="none" class="o3"/>`;
        for (let k = 1; k < 9; k++) { const [x, y] = lan(k / 9); h += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 14}" class="o3"/><ellipse cx="${x}" cy="${y + 32}" rx="15" ry="19" fill="${k % 3 ? "#ff3b3b" : "#ffc93c"}" class="o3"/>`; }
        h += `<g><circle cx="560" cy="778" r="20" fill="${INK}"/><circle cx="560" cy="778" r="8" fill="#ddd"/><circle cx="668" cy="778" r="20" fill="${INK}"/><circle cx="668" cy="778" r="8" fill="#ddd"/>
          <path d="M540 762 Q 552 722 596 722 L628 722 L640 688 L660 688 L684 762 Z" fill="#ff6b4a" class="o"/><rect x="584" y="708" width="44" height="14" rx="6" fill="${INK}"/>
          <line x1="648" y1="688" x2="636" y2="666" class="o"/><line x1="626" y1="666" x2="650" y2="666" class="o"/>
          <rect x="532" y="694" width="34" height="26" fill="#fff6ea" class="o3"/>${blob([[540, 690, 8], [554, 684, 9], [566, 692, 7]], "#ff8fab")}</g>`;
        return h;
      },
    },

    korea: {
      sky: "#c9ecff", gnd: "#b7c3d9",
      svg: () => {
        const canopy = [[100, 470, 60], [170, 430, 70], [240, 470, 62], [150, 520, 64], [220, 530, 56], [70, 530, 46]];
        let petals = "";
        for (let k = 0; k < 18; k++) petals += `<ellipse class="petal" style="animation-delay:${(-k * 0.43).toFixed(2)}s" cx="${60 + ((k * 97) % 520)}" cy="${420 + ((k * 53) % 160)}" rx="6" ry="4" fill="#ff8fb8" stroke="${INK}" stroke-width="1.5"/>`;
        return `<g class="far">${cloud(560, 150, .7)}${cloud(980, 110, .5)}
          <polygon points="-200,800 -200,560 0,470 180,560 360,430 540,560 700,450 880,560 1060,420 1240,540 1440,440 1640,560 1640,800" fill="#c7bdf0" class="o"/>
          <path d="M340 446 L360 430 L382 446 L370 452 L360 444 L350 452 Z M1040 436 L1060 420 L1082 436 L1070 442 L1060 434 L1050 442 Z" fill="#fff" class="o3"/></g>
          <path d="M-200 800 L-200 640 Q 200 560 560 650 Q 900 720 1240 620 Q 1440 580 1640 640 L1640 800 Z" fill="#8fd19e" class="o"/>
          <rect x="380" y="740" width="500" height="60" fill="#d9c2a0" class="o"/>
          <rect x="420" y="610" width="420" height="130" fill="#fff4dc" class="o"/>
          ${[470, 600, 730].map((x) => `<rect x="${x}" y="630" width="80" height="80" fill="#ffe9c2" class="o3"/><path d="M${x + 27} 630 V710 M${x + 53} 630 V710 M${x} 657 H${x + 80} M${x} 683 H${x + 80}" class="o3" fill="none"/>`).join("")}
          ${[430, 562, 694, 820].map((x) => `<rect x="${x}" y="610" width="18" height="130" fill="#d64545" class="o3"/>`).join("")}
          <path d="M440 578 Q 630 466 820 578 Z" fill="#565a80" class="o"/>
          <path d="M520 524 Q 630 500 740 524" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
          <path d="M330 624 Q 380 614 404 576 L 856 576 Q 880 614 930 624 Q 630 596 330 624 Z" fill="#3d405b" class="o"/>
          ${capsule("M160 800 C 160 700 170 620 160 540", "#7a4a2a", 18)}${capsule("M162 640 L 230 580", "#7a4a2a", 10)}${capsule("M160 600 L 100 540", "#7a4a2a", 9)}
          ${blob(canopy, "#ffafcc")}
          ${[[120, 460], [200, 450], [240, 500], [140, 530], [90, 500], [190, 500]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#fff"/>`).join("")}
          ${petals}
          <g><path d="M1000 772 L1008 732 L1060 726 L1092 694 L1176 694 L1206 726 L1246 734 L1250 772 Z" fill="#10a5c4" class="o"/>
            <path d="M1072 726 L1098 702 L1132 702 L1132 726 Z M1146 726 L1146 702 L1172 702 L1196 726 Z" fill="#cfefff" class="o3"/>
            <circle cx="1048" cy="776" r="22" fill="${INK}"/><circle cx="1048" cy="776" r="9" fill="#ddd"/><circle cx="1200" cy="776" r="22" fill="${INK}"/><circle cx="1200" cy="776" r="9" fill="#ddd"/>
            <rect x="1244" y="744" width="12" height="16" rx="3" fill="#ffc93c" class="o3"/>
            <g class="glow"><path d="M1272 730 q 16 22 0 44 M1294 714 q 30 38 0 76 M1318 698 q 44 54 0 108" fill="none" stroke="#ff4f9a" stroke-width="5" stroke-linecap="round"/></g>
            <text x="1330" y="676" font-size="22" fill="${INK}">77 GHz</text></g>`;
      },
    },

    arizona: {
      sky: "#ffd27a", gnd: "#e7a86a",
      svg: () => {
        const saguaro = (x, h) => capsule(`M${x} 800 V${800 - h}`, "#2a9d8f", 36) + capsule(`M${x - 18} ${800 - h * 0.42} H${x - 50} V${800 - h * 0.72}`, "#2a9d8f", 22) + capsule(`M${x + 18} ${800 - h * 0.55} H${x + 46} V${800 - h * 0.85}`, "#2a9d8f", 22);
        return `<g class="far"><circle cx="1120" cy="330" r="120" fill="#ff7b54" class="o"/>${birds(700, 180)}
          <g class="float"><ellipse cx="880" cy="170" rx="66" ry="80" fill="#ff4f9a" class="o"/><ellipse cx="880" cy="170" rx="36" ry="80" fill="#ffc93c" class="o3"/><ellipse cx="880" cy="170" rx="10" ry="80" fill="#10a5c4" class="o3"/>
            <path d="M836 236 L862 286 M924 236 L898 286" class="o3"/><rect x="860" y="284" width="40" height="28" rx="4" fill="#b8693c" class="o3"/></g></g>
          <path d="M600 800 L600 590 L640 560 L900 560 L940 610 L1080 610 L1110 570 L1640 570 L1640 800 Z" fill="#e0784a" class="o"/>
          <path d="M600 650 H900 M940 680 H1640 M600 720 H1640" stroke="#c4532c" stroke-width="5" fill="none"/>
          <g><rect x="130" y="600" width="400" height="200" fill="#f2a65a" class="o"/><rect x="118" y="584" width="424" height="22" fill="#c4532c" class="o"/>
            ${[170, 260, 350, 440].map((x) => `<rect x="${x}" y="626" width="50" height="46" fill="#fff3d6" class="o3"/>`).join("")}
            <rect x="290" y="704" width="80" height="96" fill="#8a4b2a" class="o3"/><rect x="250" y="680" width="160" height="22" rx="4" fill="${INK}"/>
            <text x="330" y="697" text-anchor="middle" font-size="16" fill="#ffc93c">SCHOOL OF ECEE</text></g>
          ${capsule("M600 800 C 604 720 596 650 610 580", "#8a5a3a", 14)}
          <path d="M610 580 C 560 560 530 580 520 600 C 550 580 580 578 610 580 Z M610 580 C 660 550 700 570 712 596 C 680 575 650 575 610 580 Z M610 580 C 600 540 620 512 650 504 C 630 530 618 552 610 580 Z M610 580 C 580 540 552 530 530 540 C 560 545 590 560 610 580 Z" fill="#2fb36b" class="o"/>
          ${saguaro(760, 230)}${saguaro(1330, 300)}${saguaro(1040, 150)}
          <ellipse cx="900" cy="790" rx="26" ry="10" fill="#c4532c" class="o3"/><ellipse cx="1200" cy="792" rx="18" ry="8" fill="#c4532c" class="o3"/>`;
      },
    },

    lab: {
      sky: "#2c2a72", gnd: "#4a3fa0",
      svg: () => {
        const plates = [[110, 150, 24], [230, 124, 20], [340, 100, 18], [440, 78, 15], [525, 58, 13]];
        const cx = 470;
        const kets = [[720, 420, "|0⟩", "#fff"], [760, 620, "|1⟩", "#2cc6e4"], [660, 720, "|+⟩", "#ff6aac"], [110, 300, "|ψ⟩", "#ffc93c"], [190, 520, "|−⟩", "#2cc6e4"], [80, 690, "|1⟩", "#fff"], [810, 520, "|0⟩", "#ffc93c"]];
        let h = `<g class="far">${Array.from({ length: 26 }, (_, k) => `<circle cx="${(k * 211) % 1440}" cy="${(k * 97) % 520 + 20}" r="${k % 3 ? 2 : 3}" fill="#fff" opacity=".7"/>`).join("")}</g>`;
        h += `<rect x="${cx - 100}" y="-20" width="200" height="56" fill="#9aa0c8" class="o"/>`;
        h += `<rect x="${cx - 70}" y="20" width="12" height="520" fill="#e6b84a" class="o3"/><rect x="${cx + 58}" y="20" width="12" height="520" fill="#e6b84a" class="o3"/><rect x="${cx - 6}" y="20" width="12" height="540" fill="#e6b84a" class="o3"/>`;
        h += `<path d="M${cx - 40} 110 C ${cx - 90} 170 ${cx - 20} 200 ${cx - 50} 230 C ${cx - 80} 270 ${cx - 10} 300 ${cx - 40} 340 C ${cx - 60} 390 ${cx - 10} 410 ${cx - 30} 440" fill="none" stroke="#ff6b4a" stroke-width="6"/>`;
        h += `<path d="M${cx + 40} 110 C ${cx + 90} 170 ${cx + 20} 200 ${cx + 50} 230 C ${cx + 80} 270 ${cx + 10} 300 ${cx + 40} 340 C ${cx + 60} 390 ${cx + 10} 410 ${cx + 30} 440" fill="none" stroke="#2cc6e4" stroke-width="6"/>`;
        plates.forEach(([y, rx, ry]) => { h += `<ellipse cx="${cx}" cy="${y + 8}" rx="${rx}" ry="${ry}" fill="#c9962e" class="o"/><ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${ry}" fill="#ffc93c" class="o"/>`; });
        h += `<circle class="glow" cx="${cx}" cy="610" r="64" fill="#2cc6e4" opacity=".35"/><rect x="${cx - 30}" y="540" width="60" height="64" fill="#e6b84a" class="o"/><rect x="${cx - 20}" y="596" width="40" height="28" fill="#2cc6e4" class="o3"/>
          <path d="M${cx - 12} 604 h24 M${cx - 12} 612 h24 M${cx - 4} 596 v28 M${cx + 6} 596 v28" stroke="${INK}" stroke-width="2"/>`;
        kets.forEach(([x, y, t, c], i) => { h += `<text class="float d${(i % 3) + 1}" x="${x}" y="${y}" font-size="${i % 2 ? 36 : 44}" fill="${c}">${t}</text>`; });
        h += `<g><rect x="930" y="690" width="430" height="22" fill="#6c5ce7" class="o"/><rect x="950" y="712" width="18" height="88" fill="#6c5ce7" class="o3"/><rect x="1322" y="712" width="18" height="88" fill="#6c5ce7" class="o3"/>
          <rect x="960" y="560" width="210" height="124" rx="8" fill="#120f3a" class="o"/><rect x="1056" y="684" width="18" height="8" fill="${INK}"/>
          <path d="M978 596 H1152 M978 624 H1152 M978 652 H1152" stroke="#2cc6e4" stroke-width="3"/>
          <rect x="1004" y="584" width="26" height="24" fill="#ff6aac" class="o3"/><rect x="1062" y="612" width="26" height="24" fill="#ffc93c" class="o3"/><circle cx="1120" cy="596" r="6" fill="#fff"/><path d="M1120 596 V652" stroke="#fff" stroke-width="3"/><circle cx="1120" cy="652" r="11" fill="none" stroke="#fff" stroke-width="3"/>
          <rect x="1190" y="586" width="160" height="98" rx="8" fill="#120f3a" class="o"/>
          ${[[1208, 40], [1236, 70], [1264, 26], [1292, 58], [1320, 16]].map(([x, hh]) => `<rect x="${x}" y="${670 - hh}" width="18" height="${hh}" fill="#49d488"/>`).join("")}</g>`;
        return h;
      },
    },

    federated: {
      sky: "#b9f3e4", gnd: "#8fd3c3",
      svg: () => {
        const clients = [[700, "#ff6b4a"], [880, "#ffc93c"], [1060, "#ff4f9a"], [1240, "#6c5ce7"]];
        let h = `<g class="far">${cloud(120, 120, .6)}${cloud(1240, 90, .7)}${cloud(430, 230, .45)}</g>`;
        clients.forEach(([x, c]) => { h += `<path class="flow" d="M${x} 642 C ${x} 470 ${(x + 880) / 2} 420 ${870} 302" fill="none" stroke="${c}" stroke-width="5"/>`; });
        h += blob([[760, 230, 60], [840, 180, 82], [945, 196, 70], [1004, 246, 52], [870, 258, 66], [800, 268, 44]], "#fffcf6");
        h += `<text x="878" y="226" text-anchor="middle" font-size="40" fill="${INK}">Σ θₖ</text><text x="872" y="262" text-anchor="middle" font-size="16" fill="#6c5ce7">global model</text>`;
        clients.forEach(([x, c], i) => {
          h += `<rect x="${x - 6}" y="736" width="12" height="54" fill="${INK}"/><rect x="${x - 40}" y="786" width="80" height="14" rx="4" fill="#9aa0c8" class="o3"/>
            <rect x="${x - 64}" y="640" width="128" height="100" rx="10" fill="${c}" class="o"/><rect x="${x - 50}" y="652" width="100" height="74" rx="6" fill="#fffcf6" class="o3"/>
            <circle cx="${x}" cy="689" r="24" fill="#e7e2ff" class="o3"/><ellipse cx="${x}" cy="689" rx="24" ry="7" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="4 4"/>
            <line x1="${x}" y1="689" x2="${x + 14 - i * 6}" y2="${671 + i * 3}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
        });
        h += `<g><rect x="80" y="572" width="470" height="200" rx="8" fill="#a8693c" class="o"/><rect x="98" y="588" width="434" height="166" rx="4" fill="#2f5d4f" class="o3"/>
          <text x="118" y="636" font-size="24" fill="#fffcf6">E‖ĝ − ∇f‖² ≤ O(dq/S)</text>
          <text x="118" y="682" font-size="22" fill="#ffc93c">⇒ min E‖∇F‖² → 0 ✓</text>
          <path d="M120 716 q 30 -24 60 0 t 60 0" fill="none" stroke="#fffcf6" stroke-width="3"/><text x="270" y="724" font-size="18" fill="#ff8fb8">1/√S</text>
          <rect x="240" y="752" width="40" height="8" fill="#fffcf6" class="o3"/>
          <line x1="140" y1="772" x2="124" y2="800" class="o"/><line x1="490" y1="772" x2="506" y2="800" class="o"/></g>`;
        return h;
      },
    },

    next: {
      sky: "#ffe27a", gnd: "#f2b950",
      svg: () => {
        const cols = ["#ff6b4a", "#10a5c4", "#6c5ce7", "#ff4f9a", "#2fb36b"];
        let conf = "";
        for (let k = 0; k < 28; k++) conf += `<rect class="confetti" style="animation-delay:${(-k * 0.37).toFixed(2)}s" x="${(k * 149) % 1440}" y="${(k * 61) % 240 - 40}" width="14" height="14" fill="${cols[k % 5]}" stroke="${INK}" stroke-width="2"/>`;
        return `<g class="far">${cloud(980, 120, .6)}${cloud(140, 90, .5)}</g>${conf}
          <g><rect x="292" y="420" width="16" height="380" fill="#b8693c" class="o"/><circle cx="300" cy="414" r="12" fill="#ffc93c" class="o3"/>
            <path d="M310 440 H520 L552 470 L520 500 H310 Z" fill="#ff6b4a" class="o"/><text x="426" y="478" text-anchor="middle" font-size="22" fill="${INK}">Industry R&amp;D</text>
            <path d="M290 520 H80 L48 550 L80 580 H290 Z" fill="#2cc6e4" class="o"/><text x="180" y="558" text-anchor="middle" font-size="22" fill="${INK}">Research labs</text>
            <path d="M310 600 H500 L532 630 L500 660 H310 Z" fill="#8f80ff" class="o"/><text x="414" y="638" text-anchor="middle" font-size="22" fill="${INK}">Postdoc</text></g>
          <g><rect x="690" y="762" width="140" height="38" fill="#9aa0c8" class="o"/>
            <path class="flame" d="M732 690 Q 760 800 788 690 Z" fill="#ffc93c" class="o3"/>
            <path d="M714 640 L676 724 L716 704 Z M806 640 L844 724 L804 704 Z" fill="#ff6b4a" class="o"/>
            <path d="M760 420 C 800 470 812 560 806 690 L714 690 C 708 560 720 470 760 420 Z" fill="#fffcf6" class="o"/>
            <path d="M760 420 C 780 444 792 466 798 490 L722 490 C 728 466 740 444 760 420 Z" fill="#ff4f9a" class="o"/>
            <circle cx="760" cy="556" r="24" fill="#8fd8f5" class="o"/><text x="760" y="650" text-anchor="middle" font-size="18" fill="${INK}">QPU-1</text></g>
          <text x="880" y="712" font-size="62" font-family="Bricolage Grotesque, Inter, sans-serif" font-weight="800" fill="${INK}" style="font-family:'Bricolage Grotesque',Inter,sans-serif">⟨ψ|you⟩ ≈ 1 ✓</text>`;
      },
    },
  };

  function qubiSVG(body) {
    return `<svg viewBox="0 0 100 120"><ellipse cx="50" cy="116" rx="26" ry="4" fill="rgba(29,26,57,.25)"/>
      <g class="m-legl"><line x1="42" y1="90" x2="40" y2="112" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M33 113 h11" stroke="${INK}" stroke-width="5" stroke-linecap="round"/></g>
      <g class="m-legr"><line x1="58" y1="90" x2="60" y2="112" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M56 113 h11" stroke="${INK}" stroke-width="5" stroke-linecap="round"/></g>
      <g class="m-body">
        <g class="m-arrow"><line x1="50" y1="30" x2="50" y2="5" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="5" r="6" fill="#ffc93c" stroke="${INK}" stroke-width="3"/></g>
        <circle cx="50" cy="62" r="34" fill="${body}" stroke="${INK}" stroke-width="4"/>
        <ellipse cx="50" cy="64" rx="34" ry="9" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="4 4" opacity=".5"/>
        <g class="m-eyes"><ellipse cx="40" cy="52" rx="4" ry="5" fill="${INK}"/><ellipse cx="60" cy="52" rx="4" ry="5" fill="${INK}"/></g>
        <path class="m-happy" d="M35 54 q5 -7 10 0 M55 54 q5 -7 10 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="31" cy="62" r="4" fill="#ffb3c6"/><circle cx="69" cy="62" r="4" fill="#ffb3c6"/>
        <rect x="33" y="68" width="34" height="20" rx="6" fill="#fff6ea" stroke="${INK}" stroke-width="3"/>
        <text class="m-ket" x="50" y="82.5" text-anchor="middle" font-size="12" font-family="JetBrains Mono, monospace" font-weight="700" fill="${INK}">|0⟩</text>
      </g></svg>`;
  }

  function sceneCard(s) {
    const acc = `--acc:var(--${s.accent || "q6"})`;
    if (s.scene === "profile") {
      const fc = ["q3", "yellow", "q2"];
      return `<article class="nb-card scard profile pos-${s.side}" style="${acc}">
        <span class="eyebrow">${esc(S.role)}</span>
        <h1 class="pname">${esc(S.name)} <span class="nick">(${esc(S.nickname)})</span></h1>
        <div class="focus">${S.focus.map((f, k) => `<span style="--c:var(--${fc[k % 3]})">${esc(f)}</span>`).join("")}</div>
        <p class="body">${esc(S.tagline)}</p>
        <div class="pbtns"><a class="btn sm primary" href="mailto:${esc(S.email)}">✉ Email</a>${S.links.map((l) => `<a class="btn sm" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}<button class="btn sm yellow" id="heroPlay" type="button">▶ Play the ride</button></div>
      </article>`;
    }
    const contact = s.contact ? `<div class="pbtns" style="margin-top:16px"><a class="btn sm primary" href="mailto:${esc(S.email)}">✉ ${esc(S.email)}</a>${S.links.slice(0, 1).map((l) => `<a class="btn sm" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("")}</div>` : "";
    return `<article class="nb-card scard pos-${s.side}" style="${acc}">
      ${s.gate ? `<span class="gate-badge" title="Circuit gate for this chapter">${esc(s.gate)}</span>` : ""}
      <span class="eyebrow">${esc(s.place || "")}${s.years ? " · " + esc(s.years) : ""}</span>
      <h2>${esc(s.title)}</h2><p class="body">${esc(s.body)}</p>
      <div class="tags">${(s.tags || []).map((t) => `<span>${esc(t)}</span>`).join("")}</div>${contact}
    </article>`;
  }

  function journey() {
    const J = S.journey, N = J.length;
    const sec = $("#journey"), sticky = $("#jSticky"), track = $("#jTrack"), mascot = $("#mascot");
    const items = $("#jItems"), prog = $("#jProg"), bubble = $("#bubble");
    track.innerHTML = J.map((s, i) => {
      const sc = SCENES[s.scene] || SCENES.profile;
      return `<div class="scene" data-i="${i}" style="--sky:${sc.sky};--gnd:${sc.gnd}"><div class="stars"></div>
        <svg class="illus" viewBox="0 0 1440 800" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${sc.svg()}</svg>
        <div class="ground"></div>${sceneCard(s)}</div>`;
    }).join("");
    mascot.insertAdjacentHTML("afterbegin", `<div class="q-ghost g1">${qubiSVG("#ff4f9a")}</div><div class="q-ghost g2">${qubiSVG("#10a5c4")}</div><div class="q-main">${qubiSVG("#ff6b4a")}</div>
      <svg class="tether" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 15 q 12.5 -12 25 0 t 25 0 t 25 0 t 25 0" fill="none" stroke="#ff4f9a" stroke-width="3"/></svg>
      <div class="q-partner">${qubiSVG("#10a5c4")}</div>`);
    sec.style.height = N * 100 + "vh";
    items.innerHTML = J.map((s, i) => `<button type="button" data-i="${i}">${esc(s.step)}</button>`).join("");
    const scenes = $$(".scene", track), fars = scenes.map((sc) => $$(".far", sc)), btns = $$("button", items);

    let sw = sticky.clientWidth, cur = -1, lastPos = -1, walkT = 0;
    const range = () => Math.max(1, sec.offsetHeight - window.innerHeight);
    const secTop = () => sec.getBoundingClientRect().top + window.scrollY;
    const posFromP = (p) => {
      const x = p * (N - 1), i = Math.min(N - 2, Math.floor(x)), f = x - i;
      return i + (f < 0.22 ? 0 : f > 0.78 ? 1 : ease((f - 0.22) / 0.56));
    };
    function setState(i) {
      const q = J[i].qubit || {};
      mascot.style.setProperty("--arrow", (q.arrow || 0) + "deg");
      mascot.dataset.mode = q.mode || "idle";
      $$(".m-ket", mascot).forEach((t) => (t.textContent = `|${q.ket || "0"}⟩`));
      btns.forEach((b, k) => (k === i ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
    }
    function update() {
      const p = clamp(-sec.getBoundingClientRect().top / range(), 0, 1), pos = posFromP(p);
      track.style.transform = `translate3d(${(-pos * sw).toFixed(1)}px,0,0)`;
      scenes.forEach((sc, j) => { const d = pos - j; if (Math.abs(d) < 1.3) fars[j].forEach((el) => (el.style.transform = `translateX(${(d * sw * 0.35).toFixed(1)}px)`)); });
      prog.style.width = (p * 100).toFixed(2) + "%";
      const a = Math.round(pos);
      if (a !== cur) { cur = a; setState(a); }
      if (lastPos >= 0 && Math.abs(pos - lastPos) > 1e-4) {
        mascot.classList.add("walking"); clearTimeout(walkT);
        walkT = setTimeout(() => mascot.classList.remove("walking"), 180);
      }
      lastPos = pos;
      bubble.classList.toggle("gone", p > 0.01);
    }
    const measure = () => {
      sw = sticky.clientWidth; track.style.setProperty("--sw", sw + "px");
      const par = window.innerWidth / window.innerHeight < 0.8 ? "xMidYMax slice" : "xMidYMax meet";
      $$(".illus", track).forEach((s) => s.setAttribute("preserveAspectRatio", par));
      update();
    };
    let ticking = false;
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }, { passive: true });
    window.addEventListener("resize", measure);
    measure();

    const scrollFor = (i) => secTop() + (i / (N - 1)) * range();
    items.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      stopPlay(); window.scrollTo({ top: scrollFor(+b.dataset.i), behavior: reduceMotion ? "auto" : "smooth" });
    });

    let playing = false, playRAF = 0, t0 = 0, p0 = 0;
    const DUR = (N - 1) * 3200;
    function playTick(now) {
      if (!playing) return;
      const p = clamp(p0 + (now - t0) / DUR, 0, 1);
      window.scrollTo(0, secTop() + p * range());
      if (p >= 1) { stopPlay(); return; }
      playRAF = requestAnimationFrame(playTick);
    }
    function startPlay() {
      playing = true;
      document.documentElement.style.scrollBehavior = "auto";
      const p = clamp(-sec.getBoundingClientRect().top / range(), 0, 1);
      p0 = p > 0.97 || p <= 0 ? 0 : p;
      if (p0 === 0) window.scrollTo(0, secTop());
      t0 = performance.now();
      playRAF = requestAnimationFrame(playTick);
    }
    function stopPlay() {
      if (!playing) return;
      playing = false; cancelAnimationFrame(playRAF);
      document.documentElement.style.scrollBehavior = "";
    }
    $("#heroPlay").addEventListener("click", startPlay);
    ["wheel", "touchstart", "keydown"].forEach((ev) => window.addEventListener(ev, (e) => {
      if (ev === "keydown" && e.target.closest && e.target.closest("button")) return;
      stopPlay();
    }, { passive: true }));
    Object.assign(journeyAPI, { play: startPlay, stop: stopPlay });
  }

  /* ---------------- research ---------------- */
  function research() {
    const stats = $("#stats");
    stats.innerHTML = S.stats.map((s, i) => `<div class="stat reveal" style="--c:var(--${QC[i % QC.length]})"><b data-to="${+s.value}" data-dec="${s.decimals || 0}" data-suffix="${esc(s.suffix || "")}">0</b><span>${esc(s.label)}</span></div>`).join("");
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      $$("b[data-to]", e.target).forEach((b) => {
        const to = +b.dataset.to, dec = +b.dataset.dec, suf = b.dataset.suffix, t0 = performance.now(), D = reduceMotion ? 0 : 1300;
        const step = (now) => {
          const k = D ? clamp((now - t0) / D, 0, 1) : 1;
          b.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(dec) + suf;
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }), { threshold: 0.4 });
    io.observe(stats);

    const cards = $("#researchCards");
    cards.innerHTML = S.research.map((r, i) => `<article class="card reveal" style="--c:var(--${QC[(i + 2) % QC.length]})"><canvas data-viz="${esc(r.viz || "")}" aria-hidden="true"></canvas><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p><div class="tags">${(r.tags || []).map((t, j) => `<span style="--c:var(--${QC[(i * 2 + j) % QC.length]})">${esc(t)}</span>`).join("")}</div></article>`).join("");

    const draw = () => $$("canvas[data-viz]", cards).forEach((cv) => {
      const { ctx, w: W, h: H } = setupCanvas(cv);
      ctx.clearRect(0, 0, W, H);
      const kind = cv.dataset.viz;
      if (kind === "fed") {
        const sx = W / 2, sy = H * 0.26, cols = [C.q3, C.q2, C.q5, C.q4, C.q6];
        const cl = cols.map((c, i) => [W * (0.12 + i * 0.19), H * 0.76, c]);
        cl.forEach(([x, y, c], i) => {
          const gr = ctx.createLinearGradient(x, y, sx, sy); gr.addColorStop(0, c); gr.addColorStop(1, C.q1);
          ctx.strokeStyle = gr; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(sx, sy); ctx.stroke(); ctx.setLineDash([]);
          const t = 0.35 + 0.12 * i; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(lerp(x, sx, t), lerp(y, sy, t), 3, 0, TAU); ctx.fill();
        });
        cl.forEach(([x, y, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill(); ctx.fillStyle = rgba(c, 0.25); ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill(); });
        const sg = ctx.createLinearGradient(sx - 18, sy - 18, sx + 18, sy + 18); sg.addColorStop(0, C.q1); sg.addColorStop(1, C.q2);
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 17, 0, TAU); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `700 14px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("ψ", sx, sy + 1); ctx.textBaseline = "alphabetic";
      } else if (kind === "kernel") {
        const n = 24, side = H - 16, cs = side / n, x0 = W / 2 - side * 0.85, y0 = 8;
        const cl = (i) => Math.floor(i / 8);
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const v = cl(i) === cl(j) ? 0.62 + 0.38 * Math.exp(-Math.abs(i - j) / 4) : 0.12 + 0.12 * Math.cos(i * j);
          ctx.fillStyle = lutCss(LUT_SEQ, v); ctx.fillRect(x0 + j * cs, y0 + i * cs, cs + 0.5, cs + 0.5);
        }
        ctx.fillStyle = C.muted; ctx.font = `600 18px ${MONO}`; ctx.textAlign = "center"; ctx.fillText("≈", x0 + side + 22, H / 2 + 6);
        const lx = x0 + side + 42;
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ctx.fillStyle = lutCss(LUT_SEQ, cl(i) === k ? 0.85 : 0.15); ctx.fillRect(lx + k * cs * 1.4, y0 + i * cs, cs * 1.4 + 0.5, cs + 0.5); }
        ctx.fillStyle = C.faint; ctx.font = `10px ${MONO}`; ctx.fillText("L", lx + cs * 2.1, H - 1);
      } else if (kind === "game") {
        const cell = 4;
        for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
          const u = (x / W) * 2 - 1, v = (y / H) * 2 - 1;
          ctx.fillStyle = lutCss(LUT_SEQ, clamp(0.5 + 0.45 * (u * u - v * v), 0, 1));
          ctx.fillRect(x, y, cell, cell);
        }
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath();
        for (let t = 0; t <= 14; t += 0.05) { const r = 0.9 * Math.exp(-0.22 * t), x = W / 2 + r * Math.cos(t) * W * 0.42, y = H / 2 + r * Math.sin(t) * H * 0.42; t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = `700 16px ${MONO}`; ctx.textAlign = "center"; ctx.fillText("★", W / 2, H / 2 + 6);
      }
    });
    draw(); onRedraw(draw); window.addEventListener("resize", draw);

    const half = Math.ceil(S.toolbox.length / 2);
    const row = (arr, off) => { const h = arr.map((t, i) => `<span style="--c:var(--${QC[(i + off) % QC.length]})">${esc(t)}</span>`).join(""); return h + h.replace(/<span /g, '<span aria-hidden="true" '); };
    $("#tools1").innerHTML = row(S.toolbox.slice(0, half), 0);
    $("#tools2").innerHTML = row(S.toolbox.slice(half), 3);
  }

  /* ---------------- playground tabs ---------------- */
  const tools = {};
  function tabs() {
    const tabEls = $$('[role="tab"]');
    function select(tab) {
      tabEls.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute("aria-controls"));
        panel.hidden = !on;
        const key = panel.id.replace("panel-", "");
        if (tools[key]) on ? tools[key].show() : tools[key].hide();
      });
    }
    tabEls.forEach((t, i) => {
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const n = tabEls[(i + (e.key === "ArrowRight" ? 1 : tabEls.length - 1)) % tabEls.length];
        n.focus(); select(n);
      });
    });
    select(tabEls[0]);
    return (key) => { const t = $("#tab-" + key); if (t) select(t); };
  }
  function segmented(root, onChange) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("button", root).forEach((x) => x.setAttribute("aria-pressed", x === b));
      onChange(b.dataset.v);
    });
  }
  function visibilityLoop(cv, fn) {
    const loop = makeLoop(fn);
    let inView = false, shown = false;
    const sync = () => (inView && shown ? loop.start() : loop.stop());
    new IntersectionObserver((es) => es.forEach((e) => { inView = e.isIntersecting; sync(); })).observe(cv);
    return { show() { shown = true; sync(); }, hide() { shown = false; sync(); } };
  }

  /* ---- Tool 1: Qubit lab ---- */
  function qubitLab() {
    const cv = $("#qBloch"), histEl = $("#hist"), out = $("#qRead"), trailEl = $("#trail");
    let v = [0, 0, 1], yaw = -2.2, pitch = 0.35, anim = null, path = [], basis = "z", shots = 256, theta = Math.PI / 4, applied = [], last = null;
    const AX = { X: [[1, 0, 0], Math.PI], Y: [[0, 1, 0], Math.PI], Z: [[0, 0, 1], Math.PI], H: [[Math.SQRT1_2, 0, Math.SQRT1_2], Math.PI], S: [[0, 0, 1], Math.PI / 2], T: [[0, 0, 1], Math.PI / 4] };
    const GCOL = { X: "q6", Y: "q4", Z: "q3", H: "q1", S: "q2", T: "q5", RX: "q6", RY: "q4" };
    $$("#gates button").forEach((b) => b.style.setProperty("--c", `var(--${GCOL[b.dataset.g]})`));
    const rot = (p, k, a) => {
      const c = Math.cos(a), s = Math.sin(a), d = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
      const cr = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
      return [0, 1, 2].map((i) => p[i] * c + cr[i] * s + k[i] * d * (1 - c));
    };
    function apply(g) {
      if (anim) { v = rot(anim.v0, anim.k, anim.a); anim = null; }
      let k, a;
      if (g === "RX") { k = [1, 0, 0]; a = theta; } else if (g === "RY") { k = [0, 1, 0]; a = theta; } else [k, a] = AX[g];
      anim = { v0: v.slice(), k, a, t0: performance.now() };
      if (reduceMotion) { v = rot(v, k, a); anim = null; measure(); draw(); }
      applied.push({ g, label: g === "RX" || g === "RY" ? `${g === "RX" ? "Rx" : "Ry"}(${fmtPi(theta)})` : g });
      if (applied.length > 9) applied.shift();
      renderTrail();
    }
    function renderTrail() {
      trailEl.innerHTML = `<span>|0⟩</span>` + (applied.length ? applied.map((a) => `<span>→</span><span class="g" style="--c:var(--${GCOL[a.g]})">${esc(a.label)}</span>`).join("") : `<span>&nbsp;· click a gate</span>`);
    }
    const bi = () => ({ x: 0, y: 1, z: 2 }[basis]);
    const KETS = { z: ["|0⟩", "|1⟩"], x: ["|+⟩", "|−⟩"], y: ["|+i⟩", "|−i⟩"] };
    function measure() {
      const ex = v[bi()], p0 = (1 + ex) / 2;
      let n0 = 0; for (let i = 0; i < shots; i++) if (Math.random() < p0) n0++;
      last = { n0, S: shots, p0, ex, est: (2 * n0 - shots) / shots };
      renderHist(); renderRead();
    }
    function renderHist() {
      if (!last) return;
      const [k0, k1] = KETS[basis];
      histEl.innerHTML = [[k0, last.n0, last.p0], [k1, last.S - last.n0, 1 - last.p0]].map(([k, n, p]) =>
        `<div class="bar"><span>${k}</span><div class="track"><div class="fill" data-w="${(n / last.S) * 100}"></div><div class="exact" style="left:calc(${p * 100}% - 1px)"></div></div><span>${n}</span></div>`).join("");
      requestAnimationFrame(() => $$(".fill", histEl).forEach((f) => (f.style.width = f.dataset.w + "%")));
    }
    function renderRead() {
      const th = Math.acos(clamp(v[2], -1, 1)), ph = Math.atan2(v[1], v[0]);
      const a = Math.cos(th / 2), b = Math.sin(th / 2);
      const se = last ? Math.sqrt(Math.max(0, 1 - last.ex * last.ex) / last.S) : 0;
      const B = basis.toUpperCase();
      out.innerHTML = `<dt>|ψ⟩</dt><dd>${a.toFixed(3)}|0⟩ + ${b.toFixed(3)}e<sup>i${fmtPi(ph)}</sup>|1⟩</dd>
        <dt>θ, φ</dt><dd>${fmtPi(th)}, ${fmtPi(ph)}</dd>
        <dt>⟨${B}⟩ exact</dt><dd class="c1">${last ? last.ex.toFixed(4) : "—"}</dd>
        <dt>⟨${B}⟩ estimate</dt><dd class="c2">${last ? last.est.toFixed(4) : "—"}</dd>
        <dt>Std. error ∝ 1/√S</dt><dd class="c3">${last ? se.toFixed(4) : "—"}</dd>`;
    }
    $("#gates").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) apply(b.dataset.g); });
    $("#th").addEventListener("input", (e) => { theta = +e.target.value; $("#thV").textContent = fmtPi(theta); });
    $("#shots").addEventListener("input", (e) => { shots = Math.max(1, Math.round(10 ** +e.target.value)); $("#shotsV").textContent = shots; measure(); });
    segmented($("#basis"), (b) => { basis = b; measure(); });
    $("#measure").addEventListener("click", measure);
    $("#qReset").addEventListener("click", () => { anim = null; v = [0, 0, 1]; path = []; applied = []; renderTrail(); measure(); if (reduceMotion) draw(); });

    let drag = null;
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) return;
      yaw -= (e.clientX - drag.x) * 0.01; pitch = clamp(pitch + (e.clientY - drag.y) * 0.01, -1.3, 1.3);
      drag = { x: e.clientX, y: e.clientY };
      if (reduceMotion) draw();
    });
    const endDrag = () => { drag = null; cv.style.cursor = ""; };
    cv.addEventListener("pointerup", endDrag); cv.addEventListener("pointercancel", endDrag);

    function draw() {
      const { ctx, w: W, h: H } = setupCanvas(cv);
      ctx.clearRect(0, 0, W, H);
      if (anim) {
        const u = clamp((performance.now() - anim.t0) / 700, 0, 1);
        v = rot(anim.v0, anim.k, anim.a * ease(u));
        path.push(v.slice()); if (path.length > 240) path.shift();
        if (u >= 1) { v = rot(anim.v0, anim.k, anim.a); anim = null; measure(); }
      }
      drawBloch(ctx, { vec: v, yaw, pitch, cx: W / 2, cy: H / 2, R: Math.min(W, H) * 0.36, trail: path });
    }
    renderTrail(); measure();
    const vl = reduceMotion ? null : visibilityLoop(cv, draw);
    onRedraw(draw);
    tools.qubit = { show() { draw(); vl && vl.show(); }, hide() { vl && vl.hide(); } };
  }

  /* ---- Tool 2: Optimizer race ---- */
  function optRace() {
    const land = $("#land"), lossCv = $("#lossPlot"), out = $("#oRead");
    const T1 = [0, TAU], T2 = [-Math.PI / 2, 1.5 * Math.PI];
    const cost = (a, b) => 0.6 * Math.cos(a) + 0.8 * Math.sin(a) * Math.cos(b);
    const grad = (a, b) => [-0.6 * Math.sin(a) + 0.8 * Math.cos(a) * Math.cos(b), -0.8 * Math.sin(a) * Math.sin(b)];
    const OPT = [{ k: "GD", col: "#22d3ee", v: "q3", cls: "c1" }, { k: "Adam", col: "#a3e635", v: "q4", cls: "c4" }, { k: "QNG", col: "#ffffff", v: "text", cls: "" }];
    $("#optLegend").innerHTML = OPT.map((o) => `<span style="--c:var(--${o.v})"><i></i>${o.k}</span>`).join("");
    const NIT = 150;
    let start = [0.45, 2.3], lr = 0.1, S = 1000, runs = null, iter = 0, running = false, geom = null, started = false;

    const heat = document.createElement("canvas");
    (function buildHeat() {
      const gw = 200, gh = 150; heat.width = gw; heat.height = gh;
      const hc = heat.getContext("2d"), im = hc.createImageData(gw, gh), d = im.data;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const a = T1[0] + ((i + 0.5) / gw) * (T1[1] - T1[0]), b = T2[1] - ((j + 0.5) / gh) * (T2[1] - T2[0]);
        const c = cost(a, b), dim = 0.9 + 0.1 * Math.cos(TAU * (c + 1) * 5);
        const k = (clamp((c + 1) / 2, 0, 1) * 255 | 0) * 3, p = (j * gw + i) * 4;
        d[p] = LUT_SEQ[k] * dim; d[p + 1] = LUT_SEQ[k + 1] * dim; d[p + 2] = LUT_SEQ[k + 2] * dim; d[p + 3] = 255;
      }
      hc.putImageData(im, 0, 0);
    })();

    function reset() {
      runs = OPT.map((o) => ({ o, th: start.slice(), m: [0, 0], s: [0, 0], path: [start.slice()], loss: [cost(...start)], hit: null }));
      iter = 0;
    }
    function step(r, t) {
      const g0 = grad(...r.th), sig = Math.sqrt(1 / (2 * S));
      const g = [g0[0] + gauss() * sig, g0[1] + gauss() * sig];
      let d;
      if (r.o.k === "GD") d = [lr * g[0], lr * g[1]];
      else if (r.o.k === "Adam") {
        const b1 = 0.9, b2 = 0.999;
        r.m = r.m.map((m, i) => b1 * m + (1 - b1) * g[i]);
        r.s = r.s.map((s, i) => b2 * s + (1 - b2) * g[i] * g[i]);
        d = [0, 1].map((i) => (lr * (r.m[i] / (1 - b1 ** t))) / (Math.sqrt(r.s[i] / (1 - b2 ** t)) + 1e-8));
      } else {
        const lam = 0.02, g11 = 0.25 + lam, g22 = 0.25 * Math.sin(r.th[0]) ** 2 + lam;
        d = [lr * g[0] / g11, lr * g[1] / g22];
        const n = Math.hypot(...d); if (n > 0.8) d = d.map((x) => (x * 0.8) / n);
      }
      r.th = [r.th[0] - d[0], r.th[1] - d[1]];
      r.path.push(r.th.slice());
      const c = cost(...r.th); r.loss.push(c);
      if (r.hit === null && c < -0.99) r.hit = t;
    }
    function drawLand() {
      const { ctx, w: W, h: H } = setupCanvas(land);
      ctx.clearRect(0, 0, W, H);
      const m = { l: 44, r: 10, t: 10, b: 32 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
      const X = (a) => m.l + ((a - T1[0]) / (T1[1] - T1[0])) * pw, Y = (b) => m.t + ((T2[1] - b) / (T2[1] - T2[0])) * ph;
      geom = { m, pw, ph };
      ctx.imageSmoothingEnabled = true; ctx.drawImage(heat, m.l, m.t, pw, ph);
      ctx.font = `11px ${MONO}`; ctx.fillStyle = C.muted; ctx.textAlign = "center";
      for (let k = 0; k <= 4; k++) { const a = (k * Math.PI) / 2; ctx.fillText(fmtPi(a), X(a), H - 14); }
      ctx.textAlign = "right";
      for (let k = -1; k <= 3; k++) { const b = (k * Math.PI) / 2; ctx.fillText(fmtPi(b), m.l - 6, Y(b) + 4); }
      ctx.textAlign = "center"; ctx.fillStyle = C.faint; ctx.fillText("θ₁", m.l + pw / 2, H - 1);
      ctx.save(); ctx.translate(10, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("θ₂", 0, 0); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
      const a1 = Math.atan2(0.8, -0.6);
      ctx.fillStyle = "#fff"; ctx.font = `700 16px ${MONO}`;
      [[a1, Math.PI], [TAU - a1, 0]].forEach(([a, b]) => ctx.fillText("★", X(a), Y(b) + 6));
      if (runs) runs.forEach((r) => {
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        for (const [w, col] of [[5, "rgba(10,7,32,.55)"], [2.4, r.o.col]]) {
          ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
          r.path.forEach(([a, b], i) => (i ? ctx.lineTo(X(a), Y(b)) : ctx.moveTo(X(a), Y(b)))); ctx.stroke();
        }
        const [a, b] = r.th; ctx.fillStyle = r.o.col; ctx.beginPath(); ctx.arc(X(a), Y(b), 5.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(10,7,32,.8)"; ctx.lineWidth = 1.5; ctx.stroke();
      });
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(start[0]), Y(start[1]), 8, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    function drawLoss() {
      const { ctx, w: W, h: H } = setupCanvas(lossCv);
      ctx.clearRect(0, 0, W, H);
      const m = { l: 44, r: 10, t: 10, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
      const X = (i) => m.l + (i / NIT) * pw, Y = (c) => m.t + ((1.05 - c) / 2.1) * ph;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath();
      [-1, 0, 1].forEach((c) => { ctx.moveTo(m.l, Y(c)); ctx.lineTo(m.l + pw, Y(c)); }); ctx.stroke();
      ctx.font = `10px ${MONO}`; ctx.fillStyle = C.muted; ctx.textAlign = "right";
      [-1, 0, 1].forEach((c) => ctx.fillText(c, m.l - 6, Y(c) + 3));
      ctx.textAlign = "left"; ctx.fillText("E(θ) per iteration · ground energy −1", m.l + 4, m.t + 10);
      ctx.textAlign = "right"; ctx.fillText(`${iter}/${NIT}`, m.l + pw, H - 6);
      if (runs) runs.forEach((r) => {
        ctx.strokeStyle = r.o.k === "QNG" ? C.text : r.o.col; ctx.lineWidth = 2; ctx.beginPath();
        r.loss.forEach((c, i) => (i ? ctx.lineTo(X(i), Y(c)) : ctx.moveTo(X(i), Y(c)))); ctx.stroke();
      });
    }
    function renderRead() {
      if (!runs) return;
      const shotsPer = 2 * 2 * 2 * S;
      out.innerHTML = runs.map((r) => `<dt>${r.o.k}: E / iters to 1%</dt><dd class="${r.o.cls}">${r.loss[r.loss.length - 1].toFixed(3)} / ${r.hit ?? "—"}</dd>`).join("") +
        `<dt>Shots per iteration</dt><dd>${shotsPer.toLocaleString()}</dd>`;
    }
    const frame = () => {
      if (running) {
        for (let k = 0; k < 2 && iter < NIT; k++) { iter++; runs.forEach((r) => step(r, iter)); }
        if (iter >= NIT) running = false;
        renderRead();
      }
      drawLand(); drawLoss();
    };
    const go = () => {
      reset(); running = true; renderRead();
      if (reduceMotion) { while (iter < NIT) { iter++; runs.forEach((r) => step(r, iter)); } running = false; renderRead(); frame(); }
    };
    land.addEventListener("click", (e) => {
      if (!geom) return;
      const r = land.getBoundingClientRect(), x = e.clientX - r.left - geom.m.l, y = e.clientY - r.top - geom.m.t;
      if (x < 0 || y < 0 || x > geom.pw || y > geom.ph) return;
      start = [T1[0] + (x / geom.pw) * (T1[1] - T1[0]), T2[1] - (y / geom.ph) * (T2[1] - T2[0])];
      go();
    });
    $("#optRun").addEventListener("click", go);
    $("#optRand").addEventListener("click", () => { start = [T1[0] + Math.random() * TAU, T2[0] + Math.random() * TAU]; go(); });
    $("#lr").addEventListener("input", (e) => { lr = +e.target.value; $("#lrV").textContent = lr.toFixed(2); });
    $("#oShots").addEventListener("input", (e) => { S = Math.round(10 ** +e.target.value); $("#oShotsV").textContent = S.toLocaleString(); });
    reset();
    const vl = reduceMotion ? null : visibilityLoop(land, frame);
    onRedraw(() => { if (!$("#panel-opt").hidden) frame(); });
    window.addEventListener("resize", () => { if (!$("#panel-opt").hidden) frame(); });
    tools.opt = { show() { if (!started) { started = true; go(); } frame(); vl && vl.show(); }, hide() { vl && vl.hide(); } };
  }

  /* ---- Tool 3: Low-rank quantum kernel ---- */
  function kernelLab() {
    const n = 48, d = 4, RMAX = 40, CELL = 6;
    const rnd = mulberry32(21), gs = gaussFrom(rnd);
    const centers = [[0.6, 2.4, 1.0, 2.0], [2.4, 0.7, 2.2, 0.9], [1.5, 1.6, 0.3, 2.8]];
    const Xd = [];
    centers.forEach((c) => { for (let k = 0; k < n / 3; k++) Xd.push(c.map((m) => m + gs() * 0.45)); });
    const Z = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) Z[i * n + j] = Z[j * n + i] = gs();
    let r = 8, gamma = 1, shotsLog = 5;
    const cE = $("#kExact"), cA = $("#kApprox"), cR = $("#kErr"), curve = $("#kCurve"), out = $("#kRead");
    [cE, cA, cR].forEach((c) => { c.width = c.height = n * CELL; });

    let K, res;
    function compute() {
      K = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        let p = 1; for (let q = 0; q < d; q++) { const c = Math.cos((gamma * (Xd[i][q] - Xd[j][q])) / 2); p *= c * c; }
        K[i * n + j] = p;
      }
      const Kh = K.slice();
      if (shotsLog < 4.99) {
        const Sh = 10 ** shotsLog;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const k = K[i * n + j], v = clamp(k + Z[i * n + j] * Math.sqrt((k * (1 - k)) / Sh), 0, 1); Kh[i * n + j] = Kh[j * n + i] = v; }
      }
      let normK = 0; for (let i = 0; i < n * n; i++) normK += K[i] * K[i]; normK = Math.sqrt(normK);
      const R = Kh.slice(), L = [], piv = [], errs = [];
      for (let s = 0; s < RMAX; s++) {
        let best = -1, bv = 1e-10;
        for (let i = 0; i < n; i++) if (R[i * n + i] > bv) { bv = R[i * n + i]; best = i; }
        if (best >= 0) {
          const sq = Math.sqrt(bv), l = new Float64Array(n);
          for (let i = 0; i < n; i++) l[i] = R[i * n + best] / sq;
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) R[i * n + j] -= l[i] * l[j];
          L.push(l); piv.push(best);
        }
        let e = 0;
        for (let i = 0; i < n * n; i++) { const df = K[i] - (Kh[i] - R[i]); e += df * df; }
        errs.push(Math.sqrt(e) / normK);
      }
      res = { L, piv, errs };
    }
    function heat(cv, val, piv) {
      const ctx = cv.getContext("2d");
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { ctx.fillStyle = lutCss(LUT_SEQ, clamp(val(i, j), 0, 1)); ctx.fillRect(j * CELL, i * CELL, CELL, CELL); }
      if (piv) {
        ctx.fillStyle = "#fff";
        piv.forEach((p) => { const x = (p + 0.5) * CELL; ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 7); ctx.fill(); });
      }
    }
    function draw() {
      const L = res.L.slice(0, r), piv = res.piv.slice(0, r);
      const A = new Float64Array(n * n);
      L.forEach((l) => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] += l[i] * l[j]; });
      heat(cE, (i, j) => K[i * n + j]);
      heat(cA, (i, j) => A[i * n + j], piv);
      heat(cR, (i, j) => Math.abs(K[i * n + j] - A[i * n + j]) * 4);

      const { ctx, w: W, h: H } = setupCanvas(curve);
      ctx.clearRect(0, 0, W, H);
      const m = { l: 44, r: 10, t: 12, b: 22 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
      const X = (k) => m.l + ((k - 1) / (RMAX - 1)) * pw, Y = (e) => m.t + (-Math.log10(clamp(e, 1e-4, 1)) / 4) * ph;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath();
      for (let p = 0; p <= 4; p++) { ctx.moveTo(m.l, Y(10 ** -p)); ctx.lineTo(m.l + pw, Y(10 ** -p)); } ctx.stroke();
      ctx.font = `10px ${MONO}`; ctx.fillStyle = C.muted; ctx.textAlign = "right";
      for (let p = 0; p <= 4; p += 2) ctx.fillText(p ? `1e-${p}` : "1", m.l - 6, Y(10 ** -p) + 3);
      ctx.fillText("relative error ‖K − LLᵀ‖F / ‖K‖F vs rank r", m.l + pw - 4, m.t + 10);
      const gr = ctx.createLinearGradient(m.l, 0, m.l + pw, 0); gr.addColorStop(0, C.q5); gr.addColorStop(0.5, C.q2); gr.addColorStop(1, C.q1);
      ctx.strokeStyle = gr; ctx.lineWidth = 2.5; ctx.beginPath();
      res.errs.forEach((e, i) => (i ? ctx.lineTo(X(i + 1), Y(e)) : ctx.moveTo(X(i + 1), Y(e)))); ctx.stroke();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C.faint; ctx.beginPath(); ctx.moveTo(X(r), m.t); ctx.lineTo(X(r), m.t + ph); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C.q2; ctx.beginPath(); ctx.arc(X(r), Y(res.errs[r - 1]), 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();

      const q = n * r, full = n * n, Sh = shotsLog >= 4.99 ? "∞ (exact)" : Math.round(10 ** shotsLog).toLocaleString();
      out.innerHTML = `<dt>Kernel entries queried</dt><dd class="c3">n·r = ${q}</dd>
        <dt>Full Gram matrix</dt><dd>n² = ${full}</dd>
        <dt>Circuit savings</dt><dd class="c4">${Math.max(0, Math.round((1 - q / full) * 100))}%</dd>
        <dt>Relative error</dt><dd class="c2">${res.errs[r - 1].toExponential(2)}</dd>
        <dt>Shots per entry</dt><dd>${Sh}</dd>`;
    }
    const full = () => { compute(); draw(); };
    $("#rank").addEventListener("input", (e) => { r = +e.target.value; $("#rV").textContent = r; draw(); });
    $("#gamma").addEventListener("input", (e) => { gamma = +e.target.value; $("#gV").textContent = gamma.toFixed(2); full(); });
    $("#kShots").addEventListener("input", (e) => { shotsLog = +e.target.value; $("#kShotsV").textContent = shotsLog >= 4.99 ? "∞" : Math.round(10 ** shotsLog).toLocaleString(); full(); });
    compute();
    onRedraw(() => { if (!$("#panel-kernel").hidden) draw(); });
    window.addEventListener("resize", () => { if (!$("#panel-kernel").hidden) draw(); });
    tools.kernel = { show: draw, hide() {} };
  }

  /* ---------------- publications ---------------- */
  function publications() {
    const list = $("#pubList"), filters = $("#pubFilters"), search = $("#pubSearch"), empty = $("#pubEmpty"), count = $("#pubCount"), toggleAll = $("#toggleAbs");
    const P = S.publications.slice().sort((a, b) => b.year - a.year);
    const TN = { journal: ["Journal", "yellow"], conference: ["Conference", "q2"], preprint: ["Preprint", "q3"] };
    const types = ["all", ...Object.keys(TN).filter((t) => P.some((p) => p.type === t))];
    let active = "all", q = "", allOpen = true;
    const closed = new Set();
    filters.innerHTML = types.map((t) => {
      const n = t === "all" ? P.length : P.filter((p) => p.type === t).length;
      return `<button type="button" class="chip" data-t="${t}" style="--c:var(--${t === "all" ? "q6" : TN[t][1]})" aria-pressed="${t === "all"}">${t === "all" ? "All" : TN[t][0]} <span class="count">${n}</span></button>`;
    }).join("");
    filters.addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      active = b.dataset.t; $$(".chip", filters).forEach((c) => c.setAttribute("aria-pressed", c === b)); render();
    });
    search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); render(); });
    toggleAll.addEventListener("click", () => {
      allOpen = !allOpen; closed.clear();
      if (!allOpen) P.forEach((_, i) => closed.add(i));
      toggleAll.setAttribute("aria-pressed", allOpen);
      toggleAll.textContent = allOpen ? "Collapse all abstracts" : "Expand all abstracts";
      render();
    });
    const me = new Set((S.aliases || [S.name]).map((a) => a.toLowerCase()));
    const authors = (a) => a.map((x, i) => (me.has(x.toLowerCase()) ? `<b>${esc(x)}</b>` : `<span>${esc(x)}</span>`) + (i < a.length - 2 ? ", " : i === a.length - 2 ? (a.length > 2 ? ", and " : " and ") : "")).join("");
    function bibtex(p) {
      const key = (p.authors[0] || "anon").split(/[\s-]/).pop().toLowerCase() + p.year + (p.title.split(" ")[0] || "").toLowerCase().replace(/[^a-z]/g, "");
      const kind = p.type === "journal" ? "article" : p.type === "conference" ? "inproceedings" : "misc";
      const vf = p.type === "journal" ? "journal" : p.type === "conference" ? "booktitle" : "howpublished";
      return `@${kind}{${key},\n  title = {${p.title}},\n  author = {${p.authors.join(" and ")}},\n  ${vf} = {${p.venue}${p.detail ? ", " + p.detail : ""}},\n  year = {${p.year}}\n}`;
    }
    function render() {
      const items = P.filter((p) => (active === "all" || p.type === active) && (!q || [p.title, p.venue, p.authors.join(" "), p.abstract || "", (p.highlights || []).join(" ")].join(" ").toLowerCase().includes(q)));
      empty.hidden = items.length > 0;
      count.textContent = `${items.length} of ${P.length} papers · newest first`;
      list.innerHTML = items.map((p) => {
        const i = P.indexOf(p), [tn, col] = TN[p.type] || [p.type, "q1"], shut = closed.has(i);
        return `<li class="pub${shut ? " collapsed" : ""}" style="--c:var(--${col})" data-i="${i}">
          <div><span class="pub-badge">${esc(p.badge || p.venue)}</span><span class="pub-year">${p.year}</span></div>
          <div>
            <h3>${esc(p.title)}</h3>
            <p class="authors">${authors(p.authors)}</p>
            <p class="venue"><i>${esc(p.venue)}</i>${p.detail ? `, ${esc(p.detail)}` : ""} · ${tn}</p>
            ${p.highlights ? `<div class="hl">${p.highlights.map((h) => `<span>${esc(h)}</span>`).join("")}</div>` : ""}
            ${p.abstract ? `<div class="abstract" id="abs-${i}"><p>${esc(p.abstract)}</p></div>` : ""}
            <div class="pub-links">
              ${p.abstract ? `<button type="button" data-abs="${i}" aria-expanded="${!shut}" aria-controls="abs-${i}">${shut ? "Show abstract" : "Hide abstract"}</button>` : ""}
              ${(p.links || []).map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}
              <button type="button" data-bib="${i}">BibTeX</button>
            </div>
          </div></li>`;
      }).join("");
    }
    list.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-abs]");
      if (a) {
        const i = +a.dataset.abs, li = a.closest(".pub");
        const shut = li.classList.toggle("collapsed");
        shut ? closed.add(i) : closed.delete(i);
        a.textContent = shut ? "Show abstract" : "Hide abstract";
        a.setAttribute("aria-expanded", !shut);
        return;
      }
      const b = e.target.closest("[data-bib]"); if (!b) return;
      const ok = await copyText(bibtex(P[+b.dataset.bib]));
      b.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => (b.textContent = "BibTeX"), 1600);
    });
    render();
    return { P };
  }

  /* ---------------- recognition & contact ---------------- */
  function recognition() {
    $("#talks").innerHTML = S.talks.map((t, i) => `<li class="reveal" style="--c:var(--${QC[i % QC.length]})"><span class="yr">${t.year}</span><div><div class="tt">${esc(t.title)}</div><div class="vn">${esc(t.venue)}</div></div></li>`).join("");
    $("#honors").innerHTML = S.honors.map((h, i) => `<li style="--c:var(--${QC[(i + 2) % QC.length]})"><time>${h.year}</time><span class="node"></span><span>${esc(h.text)}</span></li>`).join("");
    const chips = (arr, off) => arr.map((x, i) => `<span style="--c:var(--${QC[(i + off) % QC.length]})">${esc(x)}</span>`).join("");
    $("#revJ").innerHTML = chips(S.reviewing.journals, 0);
    $("#revC").innerHTML = chips(S.reviewing.conferences, 2);

    const btn = $("#copyMail");
    btn.addEventListener("click", async () => {
      const ok = await copyText(S.email);
      btn.textContent = ok ? "Copied ✓" : S.email;
      setTimeout(() => (btn.textContent = "Copy address"), 1800);
    });

    const cv = $("#contactViz");
    const draw = (t) => {
      const { ctx, w: W, h: H } = setupCanvas(cv);
      ctx.clearRect(0, 0, W, H);
      [C.q3, C.q1, C.q2, C.q5].forEach((col, k) => {
        ctx.strokeStyle = rgba(col, isDark() ? 0.5 : 0.4); ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const u = x / W, env = Math.sin(Math.PI * u);
          const y = H * (0.55 + k * 0.07) + Math.sin(u * TAU * (1.6 + k * 0.4) - t * (0.6 + k * 0.15) + k) * H * 0.16 * env;
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      });
    };
    if (reduceMotion) { draw(0); onRedraw(() => draw(0)); } else whenVisible(cv, makeLoop(draw));
  }

  function reveals() {
    const els = $$(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------------- terminal ---------------- */
  function terminal(selectTab, pubs) {
    const term = $("#term"), outEl = $("#termOut"), input = $("#termInput");
    const hist = []; let hi = 0, opener = null;
    const print = (html, cls) => { const d = document.createElement("div"); if (cls) d.className = cls; d.innerHTML = html; outEl.appendChild(d); outEl.scrollTop = outEl.scrollHeight; };
    const go = (id) => { close(); document.getElementById(id).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); };
    const sections = ["journey", "research", "playground", "publications", "recognition", "contact"];
    const cmds = {
      help: () => print(
        `<span class="a">Available commands</span>
  <span class="c">whoami</span>               who runs this QPU
  <span class="c">ls</span>                   list sections
  <span class="c">cd</span> &lt;section&gt;         jump to a section
  <span class="c">play</span>                 run the career circuit
  <span class="c">pubs</span> [journal|conf|preprint]
  <span class="c">lab</span> &lt;qubit|opt|kernel&gt; open a playground tool
  <span class="c">bell</span> [shots]         sample a Bell pair
  <span class="c">cv</span>, <span class="c">contact</span>, <span class="c">theme</span> [dark|light], <span class="c">clear</span>, <span class="c">exit</span>`),
      whoami: () => print(`<span class="a">${esc(S.name)} (${esc(S.nickname)})</span>\n<span class="d">${esc(S.role)}</span>\n${esc(S.tagline)}`),
      ls: () => print(sections.map((s) => `<span class="c">${s}/</span>`).join("  ")),
      cd: (a) => { const s = (a[0] || "").replace(/\/$/, ""); if (sections.includes(s)) go(s); else if (!s || s === "~") go("hero"); else print(`cd: no such section: ${esc(s)}`, "e"); },
      play: () => { close(); journeyAPI.play(); },
      pubs: (a) => {
        const f = (a[0] || "").toLowerCase();
        const items = pubs.P.filter((p) => !f || p.type.startsWith(f));
        if (!items.length) return print(`pubs: nothing matches '${esc(f)}'`, "e");
        print(items.map((p) => `<span class="y">[${p.year}]</span> <span class="c">${esc(p.venue)}</span>  ${esc(p.title)}`).join("\n"));
      },
      lab: (a) => { const k = { qubit: "qubit", bloch: "qubit", opt: "opt", vqe: "opt", kernel: "kernel", qsvm: "kernel" }[(a[0] || "").toLowerCase()]; if (!k) return print("usage: lab qubit | opt | kernel", "e"); selectTab(k); go("playground"); },
      bell: (a) => {
        const n = clamp(parseInt(a[0], 10) || 1024, 1, 100000); let c00 = 0;
        for (let i = 0; i < n; i++) if (Math.random() < 0.5) c00++;
        const bar = (k) => "█".repeat(Math.round((k / n) * 30));
        print(`|Φ⁺⟩ = (|00⟩ + |11⟩)/√2 · ${n} shots\n<span class="c">00</span> ${bar(c00)} ${c00}\n<span class="c">01</span>  0\n<span class="c">10</span>  0\n<span class="a">11</span> ${bar(n - c00)} ${n - c00}\n<span class="d">perfectly correlated ✓</span>`);
      },
      cv: () => { const cv = S.links.find((l) => /cv/i.test(l.label)); if (cv) window.open(cv.href, "_blank", "noopener"); print("opening CV…", "d"); },
      contact: () => print(`email: <a href="mailto:${esc(S.email)}">${esc(S.email)}</a>\n` + S.links.map((l) => `${esc(l.label.toLowerCase())}: <a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.href)}</a>`).join("\n")),
      email: () => cmds.contact(),
      theme: (a) => { const t = a[0] === "light" || a[0] === "dark" ? a[0] : isDark() ? "light" : "dark"; setTheme(t); print(`theme → ${t}`, "d"); },
      clear: () => (outEl.innerHTML = ""),
      exit: () => close(),
      sudo: (a) => a.join(" ") === "hire-me"
        ? print(`<span class="c">[sudo] superposition collapsed to |hired⟩.</span>\nDrafting offer letter… just kidding. Email: <span class="a">${esc(S.email)}</span>`)
        : print("sudo: nice try. Try 'sudo hire-me'.", "e"),
      echo: (a) => print(esc(a.join(" "))),
      date: () => print(new Date().toString()),
    };
    function run(line) {
      print(`<span class="a">$</span> ${esc(line)}`);
      const [c, ...args] = line.trim().split(/\s+/);
      if (!c) return;
      const fn = cmds[c.toLowerCase()];
      fn ? fn(args) : print(`command not found: ${esc(c)}. Type 'help'.`, "e");
    }
    function open() {
      opener = document.activeElement; term.hidden = false;
      if (!outEl.childElementCount) print(`<span class="a">qpu-0</span> · 2 qubits online · type <span class="c">help</span>\n<span class="d">Try 'bell', 'lab kernel', or 'sudo hire-me'.</span>`);
      input.focus();
    }
    function close() { term.hidden = true; if (opener && opener.focus) opener.focus(); }
    $("#termForm").addEventListener("submit", (e) => { e.preventDefault(); const v = input.value; input.value = ""; if (v.trim()) { hist.push(v); hi = hist.length; } run(v); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); if (hi > 0) input.value = hist[--hi]; }
      else if (e.key === "ArrowDown") { e.preventDefault(); hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ""; }
      else if (e.key === "Tab") { e.preventDefault(); const m = Object.keys(cmds).filter((k) => k.startsWith(input.value.trim())); if (m.length === 1) input.value = m[0] + " "; else if (m.length) print(m.join("  "), "d"); }
    });
    $("#termBtn").addEventListener("click", open);
    $("#termClose").addEventListener("click", close);
    term.addEventListener("click", (e) => { if (e.target === term) close(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !term.hidden) { close(); return; }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if ((e.key === "`" || e.key === "~") && !typing && term.hidden) { e.preventDefault(); open(); }
    });
  }

  /* ---------------- boot ---------------- */
  readColors();
  bindContent();
  header();
  journey();
  research();
  qubitLab();
  optRace();
  kernelLab();
  const selectTab = tabs();
  const pubs = publications();
  recognition();
  reveals();
  terminal(selectTab, pubs);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);
})();
