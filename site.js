/* Site behaviour: theme, font picker, background picker, table of contents.
   No dependencies, no build step. Every piece degrades to a working page. */

(function () {
  "use strict";

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var root = document.documentElement;

  /* ── theme: light ⇄ dark ───────────────────────────────────────────── */

  function applyTheme(name) {
    root.setAttribute("data-theme", name);
    var btn = document.getElementById("theme-btn");
    if (btn) btn.setAttribute("aria-label", "theme: " + name + " (click to change)");
  }

  var theme = store.get("theme");
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  applyTheme(theme);

  /* ── fonts ──────────────────────────────────────────────────────────────
     Blocky / bitmap faces. `scale` compensates for how wildly different their
     natural sizes are — Press Start 2P at 15px would be enormous. `cyr` marks
     the ones that actually carry Cyrillic; the others fall back to the system
     stack on the ru/kk pages.                                              */

  var SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", ' +
    'Arial, "Noto Sans", sans-serif';

  /* `scale` corrects for how differently these two render at the same px size.
     Press Start 2P is served from this repo, so it costs no third party. */
  var FONTS = [
    { id: "press", name: "PIXEL", family: "Press Start 2P", local: true, scale: 0.72 },
    { id: "sans",  name: "SANS",  stack: SYSTEM_SANS, scale: 1 }
  ];

  var loaded = {};

  function loadFont(f) {
    if (f.local || !f.google || loaded[f.id]) return;   // local one ships with the page
    loaded[f.id] = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" +
      f.google.replace(/ /g, "+") + ":wght@400;700&display=swap";
    document.head.appendChild(link);
  }

  function applyFont(id) {
    var f = FONTS[0], at = 0;
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) { f = FONTS[i]; at = i; }
    loadFont(f);
    var family = f.family || f.google;
    root.style.setProperty("--mono", f.stack || ('"' + family + '", ' + SYSTEM_SANS));
    root.style.setProperty("--font-scale", f.scale || 1);
    root.setAttribute("data-font", f.id);
    // the button advertises the face it switches to, like the theme toggle
    var next = FONTS[(at + 1) % FONTS.length];
    var btn = document.getElementById("font-btn");
    if (btn) btn.setAttribute("title", "switch to " + next.name.toLowerCase());
  }

  /* ── background ─────────────────────────────────────────────────────────
     The Julia set, with the parameter c walking a circle so the loop is exact.
     Recomputed every frame at a fifth of the resolution and blown up with
     smoothing off, which is what gives it the chunky pixels. Over it sits a
     field of four-pointed pixel stars that fade in and out on their own
     periods — sized to match the Julia pixels.                             */

  function makeJulia(ctx, w, h, rgb) {
    var s = 0.22, bw = Math.max(2, Math.ceil(w * s)), bh = Math.max(2, Math.ceil(h * s));
    var MAX = 48;
    var buf = document.createElement("canvas");
    buf.width = bw; buf.height = bh;
    var bctx = buf.getContext("2d");
    var img = bctx.createImageData(bw, bh);
    var r = rgb[0], g = rgb[1], b = rgb[2];

    /* One Julia pixel, in css pixels. The stars are drawn on a finer grid than
       that — half a Julia pixel — so they read as dust, not as blocks. */
    var jpx = Math.max(2, Math.round(1 / s));
    var unit = Math.max(1, Math.round(jpx / 2));

    var seed = 20260821;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

    var stars = [];
    var count = Math.round((w * h) / 11000);
    for (var i = 0; i < count; i++) {
      var roll = rnd();
      stars.push({
        x: Math.round(rnd() * w / unit) * unit,
        y: Math.round(rnd() * h / unit) * unit,
        arm: roll < 0.72 ? 0 : (roll < 0.95 ? 1 : 2),   // usually a lone pixel
        period: 12 + rnd() * 28,                        // seconds per flare
        phase: rnd() * Math.PI * 2,
        peak: 0.3 + rnd() * 0.45
      });
    }

    /* Slow, soft clouds. Two offset radial gradients per blob so the falloff is
       uneven the way a nebula's is, drifting on their own long periods. */
    var nebulas = [];
    for (var k = 0; k < 5; k++) {
      nebulas.push({
        x: rnd() * w,
        y: rnd() * h,
        r: (0.22 + rnd() * 0.3) * Math.min(w, h),
        drift: 30 + rnd() * 60,
        period: 40 + rnd() * 60,
        phase: rnd() * Math.PI * 2,
        alpha: 0.035 + rnd() * 0.03
      });
    }

    function drawNebulas(t) {
      var sec = t / 0.3;
      for (var i = 0; i < nebulas.length; i++) {
        var nb = nebulas[i];
        var a = (sec * Math.PI * 2) / nb.period + nb.phase;
        var x = nb.x + Math.cos(a) * nb.drift;
        var y = nb.y + Math.sin(a * 0.7) * nb.drift * 0.6;
        var pulse = 0.75 + 0.25 * Math.sin(a * 1.3);
        for (var pass = 0; pass < 2; pass++) {
          var rr = nb.r * (pass ? 0.55 : 1);
          var gx = x + (pass ? nb.r * 0.18 : 0);
          var grad = ctx.createRadialGradient(gx, y, 0, gx, y, rr);
          var al = nb.alpha * pulse * (pass ? 0.8 : 1);
          grad.addColorStop(0, "rgba(" + r + "," + g + "," + b + "," + al.toFixed(4) + ")");
          grad.addColorStop(0.55, "rgba(" + r + "," + g + "," + b + "," + (al * 0.35).toFixed(4) + ")");
          grad.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
          ctx.fillStyle = grad;
          ctx.fillRect(gx - rr, y - rr, rr * 2, rr * 2);
        }
      }
    }

    function drawStar(st, a) {
      var u = unit, L = st.arm * u;
      ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
      if (L) {
        ctx.fillRect(st.x - L, st.y, 2 * L + u, u);        // horizontal arm
        ctx.fillRect(st.x, st.y - L, u, 2 * L + u);        // vertical arm
      }
      ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," +
        Math.min(1, a * 1.6).toFixed(3) + ")";
      ctx.fillRect(st.x, st.y, u, u);                       // the core pixel
    }

    return function (t) {
      var ang = t * 0.35;
      var cr = 0.7885 * Math.cos(ang), ci = 0.7885 * Math.sin(ang);
      var d = img.data, span = 3.0;
      for (var py = 0; py < bh; py++) {
        for (var px = 0; px < bw; px++) {
          var x = (px / bw - 0.5) * span, y = (py / bh - 0.5) * span * bh / bw;
          var n = 0;
          while (x * x + y * y <= 4 && n < MAX) {
            var xt = x * x - y * y + cr;
            y = 2 * x * y + ci; x = xt; n++;
          }
          var o = (py * bw + px) * 4;
          var a = n >= MAX ? 0.24 : (n > 3 ? (n / MAX) * 0.20 : 0.02);
          d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a * 255;
        }
      }
      bctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawNebulas(t);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buf, 0, 0, w, h);

      var sec = t / 0.3;
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        // sin^5 — a long dark stretch, then a slow swell and fade
        var v = Math.sin(sec * (Math.PI * 2 / st.period) + st.phase);
        if (v <= 0) continue;
        drawStar(st, st.peak * Math.pow(v, 5));
      }
    };
  }

  /* ── background driver ──────────────────────────────────────────────── */

  var bgOn = store.get("bg") !== "none";

  function initBackground() {
    var canvas = document.getElementById("bg");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var render = null, running = true, last = 0, raf = 0;

    /* Wall-clock phase. Every page of the site computes t from the same epoch,
       so navigating between languages does not restart the animation. */
    var epoch = parseInt(store.get("t0"), 10);
    if (!epoch) { epoch = Date.now(); store.set("t0", String(epoch)); }
    function now_t() { return reduced ? 4 : (Date.now() - epoch) / 1000 * 0.3; }

    function ink() {
      var v = getComputedStyle(root).getPropertyValue("--bg-glyph").trim();
      var p = (v || "128,128,128").split(",");
      return [parseInt(p[0], 10) || 128, parseInt(p[1], 10) || 128, parseInt(p[2], 10) || 128];
    }

    function build() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = window.innerWidth, h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      root.setAttribute("data-bg", bgOn ? "julia" : "none");
      render = bgOn ? makeJulia(ctx, w, h, ink()) : null;
      if (render) render(now_t());
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!running || !render) return;
      if (now - last < 66) return;                   // ~15fps is plenty
      last = now;
      render(now_t());
    }

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 150);
    });
    document.addEventListener("visibilitychange", function () { running = !document.hidden; });

    new MutationObserver(build)
      .observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", build);

    build();
    raf = requestAnimationFrame(frame);

    return build;
  }

  /* ── the background toggle's icon: a tiny Julia set, drawn honestly ──── */

  function drawIcon(on) {
    var c = document.getElementById("bg-icon");
    if (!c || !c.getContext) return;
    var ictx = c.getContext("2d"), N = c.width;
    var icon = ictx.createImageData(N, N);
    var d = icon.data;
    var cr = -0.4, ci = 0.6, MAX = 24;
    var m = (getComputedStyle(root).getPropertyValue("--bg-glyph") || "200,200,200")
      .split(",").map(function (v) { return parseInt(v, 10) || 200; });
    for (var py = 0; py < N; py++) {
      for (var px = 0; px < N; px++) {
        var x = (px / N - 0.5) * 3.2, y = (py / N - 0.5) * 3.2, n = 0;
        while (x * x + y * y <= 4 && n < MAX) {
          var xt = x * x - y * y + cr; y = 2 * x * y + ci; x = xt; n++;
        }
        var o = (py * N + px) * 4;
        var a = n >= MAX ? 1 : (n > 4 ? 0.35 : 0);
        d[o] = +m[0]; d[o + 1] = +m[1]; d[o + 2] = +m[2];
        d[o + 3] = a * (on ? 235 : 90);
      }
    }
    ictx.putImageData(icon, 0, 0);
  }

  /* ── table of contents ──────────────────────────────────────────────── */

  function initToc() {
    var d = document.getElementById("toc-details");
    if (!d) return;
    var wide = window.matchMedia("(min-width: 62rem)");
    function sync() { if (wide.matches) d.open = true; }
    sync();
    wide.addEventListener("change", sync);

    var links = {};
    var anchors = document.querySelectorAll("#toc a");
    for (var i = 0; i < anchors.length; i++) {
      links[anchors[i].getAttribute("href").slice(1)] = anchors[i];
      anchors[i].addEventListener("click", function () {
        if (!wide.matches) d.open = false;
      });
    }

    if (!("IntersectionObserver" in window)) return;
    var seen = {};
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { seen[en.target.id] = en.isIntersecting; });
      Object.keys(links).forEach(function (id) {
        links[id].classList.toggle("here", !!seen[id]);
      });
    }, { rootMargin: "-10% 0px -70% 0px" });

    Object.keys(links).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }

  /* ── rows that fold open ────────────────────────────────────────────────
     Hover and keyboard focus are handled in CSS. This adds the one case CSS
     cannot express: a tap on a touch screen, which has no hover to give.   */

  function initFolds() {
    var rows = document.querySelectorAll("li.has-sub");
    for (var i = 0; i < rows.length; i++) {
      (function (row) {
        var lead = row.querySelector(".lead");
        if (!lead) return;
        function toggle() {
          var open = !row.classList.contains("open");
          row.classList.toggle("open", open);
          // hovering the row would otherwise re-open it the instant it closes
          row.classList.toggle("shut", !open);
          lead.setAttribute("aria-expanded", String(open));
          if (open) {
            var label = row.querySelector(".label");
            track("fold/" + slug(label ? label.textContent : "row"), "opened a row");
          }
        }
        lead.addEventListener("click", toggle);
        lead.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
            ev.preventDefault();
            toggle();
          }
        });
        row.addEventListener("mouseleave", function () {
          row.classList.remove("shut");
        });
      })(rows[i]);
    }
  }

  /* ── the name plays ─────────────────────────────────────────────────────
     Click it and every letter takes one of the seven rainbow colours; click
     again and it goes back to plain. The draw is seeded from the clock, and
     each letter is barred from repeating the colour it last had, so no two
     rolls look the same.
     Only while the bitmap face is on — the plain font stays plain.        */

  var RAINBOW = 7;

  function initName() {
    var h1 = document.querySelector(".head h1");
    if (!h1) return;

    var letters = [];
    [].slice.call(h1.childNodes).forEach(function (node) {
      if (node.nodeType !== 3) return;                 // keep the number span
      var frag = document.createDocumentFragment();
      node.nodeValue.split("").forEach(function (ch) {
        if (ch.trim() === "") { frag.appendChild(document.createTextNode(ch)); return; }
        var sp = document.createElement("span");
        sp.className = "ltr";
        sp.textContent = ch;
        frag.appendChild(sp);
        letters.push(sp);
      });
      h1.replaceChild(frag, node);
    });
    if (!letters.length) return;

    h1.classList.add("playable");
    h1.setAttribute("role", "button");
    h1.setAttribute("tabindex", "0");
    h1.setAttribute("aria-label", h1.textContent.trim());

    var seed = 0;
    function rnd() {                                    // seeded per click
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    var lit = false;

    function roll() {
      if (root.getAttribute("data-font") === "sans") return;
      if (lit) {                                        // a second click resets
        lit = false;
        letters.forEach(function (sp) { sp.className = "ltr"; });
        return;
      }
      lit = true;
      track("ui/name-roll", "played with the name");
      seed = Date.now() & 0x7fffffff;
      letters.forEach(function (sp) {
        var was = parseInt(sp.dataset.c, 10);
        var pick = Math.floor(rnd() * (isNaN(was) ? RAINBOW : RAINBOW - 1));
        if (!isNaN(was) && pick >= was) pick += 1;      // never the same twice
        sp.dataset.c = pick;
        sp.className = "ltr r" + pick;
      });
    }

    h1.addEventListener("click", roll);
    h1.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); roll(); }
    });
  }

  /* ── analytics ──────────────────────────────────────────────────────────
     GoatCounter counts the pageview on its own. Everything here is an
     *event* — a thing someone did on the page, which a pageview cannot see.
     Every call goes through track(), which is a no-op when the script was
     never loaded or a blocker ate it, so nothing on the page depends on it. */

  function track(path, title) {
    var gc = window.goatcounter;
    if (!gc || typeof gc.count !== "function") return;
    gc.count({ path: path, title: title, event: true });
  }

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 40);
  }

  function initAnalytics() {
    // which language the visitor's browser asks for, as opposed to which
    // page they ended up reading — the two disagree more often than not
    var lang = (navigator.language || "").slice(0, 2).toLowerCase();
    if (lang) track("lang/" + lang, "browser language");

    // contact links: the closest thing this page has to an outcome
    var KIND = [
      [/\.pdf($|\?)/, "cv"],
      [/^mailto:/, "email"],
      [/t\.me/, "telegram"],
      [/linkedin/, "linkedin"],
      [/github/, "github"]
    ];
    var links = document.querySelectorAll(".links a");
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        var href = a.getAttribute("href") || "";
        var kind = "other";
        for (var k = 0; k < KIND.length; k++) {
          if (KIND[k][0].test(href)) { kind = KIND[k][1]; break; }
        }
        a.addEventListener("click", function () {
          track("link/" + kind, "link: " + kind);
        });
      })(links[i]);
    }

    // the EN / RU / KK switch in the bar
    var langs = document.querySelectorAll(".langs a");
    for (var j = 0; j < langs.length; j++) {
      (function (a) {
        var to = a.getAttribute("hreflang") || "?";
        a.addEventListener("click", function () {
          track("ui/lang-" + to, "switched to " + to);
        });
      })(langs[j]);
    }

    // which sections people jump to, rather than scroll past
    var toc = document.querySelectorAll("#toc a");
    for (var m = 0; m < toc.length; m++) {
      (function (a) {
        var id = (a.getAttribute("href") || "#").slice(1);
        a.addEventListener("click", function () {
          track("toc/" + id, "contents: " + id);
        });
      })(toc[m]);
    }
  }

  /* ── wire up ────────────────────────────────────────────────────────── */

  function init() {
    var themeBtn = document.getElementById("theme-btn");
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        theme = theme === "dark" ? "light" : "dark";
        store.set("theme", theme);
        applyTheme(theme);
        drawIcon(bgOn);
        track("ui/theme-" + theme, "theme: " + theme);
      });
    }

    var font = store.get("font") || FONTS[0].id;
    applyFont(font);
    var fontBtn = document.getElementById("font-btn");
    if (fontBtn) {
      fontBtn.addEventListener("click", function () {
        var i = 0;
        for (var k = 0; k < FONTS.length; k++) if (FONTS[k].id === font) i = k;
        font = FONTS[(i + 1) % FONTS.length].id;
        store.set("font", font);
        applyFont(font);
        track("ui/font-" + font, "font: " + font);
      });
    }

    var rebuild = initBackground();
    drawIcon(bgOn);
    var bgBtn = document.getElementById("bg-btn");
    if (bgBtn) {
      bgBtn.setAttribute("aria-pressed", String(bgOn));
      bgBtn.addEventListener("click", function () {
        bgOn = !bgOn;
        store.set("bg", bgOn ? "julia" : "none");
        bgBtn.setAttribute("aria-pressed", String(bgOn));
        drawIcon(bgOn);
        if (rebuild) rebuild();
        track("ui/bg-" + (bgOn ? "on" : "off"), "background: " + (bgOn ? "on" : "off"));
      });
    }

    initToc();
    initFolds();
    initName();
    initAnalytics();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
