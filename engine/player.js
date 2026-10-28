// Launch-video engine: a deterministic motion-graphics player.
//
// render.mjs loads player.html, calls __load(data) once, then __seek(t) for every frame and screenshots the page.
// Nothing animates on its own: every style is a pure function of t, so any frame can be rendered in any order.
//
// data = { plan, timeline|null, base }   base = file:// URL of the project folder (assets resolve against it)
(() => {
  const FORMATS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
  const SIZES = { xs: 44, s: 60, m: 80, l: 100, xl: 150, xxl: 240 };
  const WPS = 2.7;               // speaking rate used to estimate a timeline before there is a voiceover
  const REVEAL = 0.34;           // word reveal length (s)
  const LEAD = 0.06;             // words start revealing this much before they are spoken
  let W, H, S, P, BASE, stage, theme, brand, scenes = [], videos = [];

  // ---------- helpers ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, t0, d) => (d <= 0 ? (t >= t0 ? 1 : 0) : clamp((t - t0) / d));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    lin: (k) => k,
    out3: (k) => 1 - (1 - k) ** 3,
    out5: (k) => 1 - (1 - k) ** 5,
    in3: (k) => k ** 3,
    inout3: (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
    back: (k) => { const c = 1.5; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; },
  };
  const el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9%$]/g, "");
  const url = (src) => (/^(https?:|file:|data:)/.test(src) ? src : BASE + src);
  const isVideo = (src) => /\.(mp4|mov|webm|m4v)$/i.test(src || "");
  const hexA = (hex, a) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const shade = (hex, f) => {   // f > 0 lightens towards white, f < 0 darkens
    const n = parseInt(hex.replace("#", ""), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  const tf = (o) => {
    let s = `translate(${(o.x || 0).toFixed(2)}px,${(o.y || 0).toFixed(2)}px)`;
    if (o.persp) s += ` perspective(${o.persp}px)`;
    if (o.rx) s += ` rotateX(${o.rx.toFixed(3)}deg)`;
    if (o.ry) s += ` rotateY(${o.ry.toFixed(3)}deg)`;
    if (o.rz) s += ` rotate(${o.rz.toFixed(3)}deg)`;
    if (o.s != null && o.s !== 1) s += ` scale(${o.s.toFixed(4)})`;
    if (o.sx != null) s += ` scaleX(${o.sx.toFixed(4)})`;
    return s;
  };
  const setFx = (e, op, blur) => {
    e.style.opacity = op.toFixed(3);
    e.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
  };
  // keyframes [{at, ...props}] -> props at time t (inout3 between keys)
  function keyAt(keys, t, props) {
    const out = {};
    for (const p of props) {
      const ks = keys.filter((k) => k[p] != null);
      if (!ks.length) continue;
      if (t <= ks[0].at) { out[p] = ks[0][p]; continue; }
      if (t >= ks[ks.length - 1].at) { out[p] = ks[ks.length - 1][p]; continue; }
      for (let i = 0; i < ks.length - 1; i++) {
        if (t >= ks[i].at && t <= ks[i + 1].at) {
          const k = E[ks[i + 1].ease || "inout3"](prog(t, ks[i].at, ks[i + 1].at - ks[i].at));
          out[p] = lerp(ks[i][p], ks[i + 1][p], k);
        }
      }
    }
    return out;
  }

  // ---------- markup ----------
  // [pill words]  *accent*  _serif italic_  {11..22} counter pill  @brand inline logo  | line break
  function parse(str) {
    const lines = [];
    for (const raw of String(str || "").split("|")) {
      const s = raw.trim(), groups = [];
      const plain = (txt, cls) => {
        const parts = txt.split(/(\s+)/);
        let glue = !/^\s/.test(txt) && groups.length && !groups[groups.length - 1].spaced;
        for (const p of parts) {
          if (!p) continue;
          if (/^\s+$/.test(p)) { if (groups.length) groups[groups.length - 1].spaced = true; glue = false; continue; }
          if (glue) { groups[groups.length - 1].after = (groups[groups.length - 1].after || "") + p; glue = false; continue; }
          groups.push({ kind: "word", words: [{ text: p, cls }] });
        }
      };
      let i = 0;
      while (i < s.length) {
        const c = s[i], prevSpace = i === 0 || /\s/.test(s[i - 1]);
        const close = (ch) => s.indexOf(ch, i + 1);
        if (c === "[" && close("]") > 0) {
          const j = close("]");
          groups.push({ kind: "pill", words: s.slice(i + 1, j).split(/\s+/).filter(Boolean).map((text) => ({ text, cls: "inpill" })) });
          i = j + 1; if (i < s.length && /\s/.test(s[i])) groups[groups.length - 1].spaced = true;
        } else if ((c === "*" || c === "_") && prevSpace && close(c) > 0) {
          const j = close(c);
          plain(s.slice(i + 1, j), c === "*" ? "accent" : "serif");
          i = j + 1; if (i < s.length && /\s/.test(s[i])) groups[groups.length - 1].spaced = true;
        } else if (c === "{" && close("}") > 0) {
          const j = close("}"), inner = s.slice(i + 1, j);
          const [a, b] = inner.includes("..") ? inner.split("..") : [null, inner];
          const m = b.match(/^([^\d-]*)(-?[\d,.]+)(.*)$/) || ["", "", "0", ""];
          const to = parseFloat(m[2].replace(/,/g, "")), from = a != null ? parseFloat(a.replace(/[^\d.-]/g, "")) : Math.round(to * 0.5);
          groups.push({ kind: "count", words: [{ text: b, cls: "inpill count" }], from, to, pre: m[1], suf: m[3],
            commas: m[2].includes(","), dec: (m[2].split(".")[1] || "").length });
          i = j + 1; if (i < s.length && /\s/.test(s[i])) groups[groups.length - 1].spaced = true;
        } else if (s.startsWith("@brand", i)) {
          groups.push({ kind: "brand", words: brand.name.split(/\s+/).map((text) => ({ text, cls: "" })) });
          i += 6; if (i < s.length && /\s/.test(s[i])) groups[groups.length - 1].spaced = true;
        } else {
          let j = i + 1;
          while (j < s.length && !(s[j] === "[" || s[j] === "{" || s.startsWith("@brand", j) ||
            ((s[j] === "*" || s[j] === "_") && /\s/.test(s[j - 1])))) j++;
          plain(s.slice(i, j));
          i = j;
        }
      }
      lines.push(groups);
    }
    return lines;
  }
  const spoken = (str) => parse(str).flat().flatMap((g) => g.words.map((w) => w.text));

  // display tokens -> {s, e} spoken times (scene-local). Exact sequential matches first, gaps interpolated.
  function mapTimes(tokens, words, t0, t1) {
    const N = tokens.length, M = words.length, out = new Array(N).fill(null);
    let j = 0;
    for (let k = 0; k < N; k++) {
      const a = norm(tokens[k]);
      for (let q = j; q < Math.min(M, j + 4); q++) {
        const b = norm(words[q].w);
        if (a && b && (a === b || (a.length > 3 && b.startsWith(a)) || (b.length > 3 && a.startsWith(b)))) { out[k] = words[q]; j = q + 1; break; }
      }
    }
    for (let k = 0; k < N; k++) {
      if (out[k]) continue;
      let p = k - 1; while (p >= 0 && !out[p]) p--;
      let n = k + 1; while (n < N && !out[n]) n++;
      const ps = p >= 0 ? out[p].e : (M ? words[0].s : t0), pi = p;
      const ns = n < N ? out[n].s : (M ? words[M - 1].e : t1), ni = n;
      const f = (k - pi) / (ni - pi);
      const s = lerp(ps, ns, f - 0.5 / (ni - pi)), e = lerp(ps, ns, f + 0.5 / (ni - pi));
      out[k] = { s: Math.max(t0, s), e: Math.max(s + 0.05, e), guess: true };
    }
    return out;
  }

  // ---------- text block ----------
  // A block of kinetic lines laid out absolutely so a centred line can re-centre as each word grows in.
  function TextBlock(parent, str, o) {
    const fs0 = (SIZES[o.size] || o.size || SIZES.l) * S;
    const lines = parse(str);
    const root = el("div", "abs", parent);
    root.style.color = o.color;
    root.style.setProperty("--track", o.track ?? "-0.045em");
    const weight = o.weight || 500;
    const toks = [], pills = [], groupsAll = [], carets = [];
    const meas = el("span", "abs tok", root);
    meas.style.visibility = "hidden";
    const measure = (text, cls, fs, w) => {
      meas.className = "abs tok " + (cls || "");
      meas.style.fontSize = fs + "px"; meas.style.fontWeight = w;
      meas.textContent = text; return meas.getBoundingClientRect().width;
    };
    // fit: shrink the font until the longest line fits the region
    const lineWidth = (groups, fs) => {
      let w = 0;
      groups.forEach((g, gi) => {
        const inner = g.kind === "pill" || g.kind === "count";
        const f = inner ? fs * 0.9 : fs;
        g.words.forEach((wd, wi) => { w += measure(wd.text, wd.cls, f, inner ? 600 : weight); if (wi < g.words.length - 1) w += measure(" ", "", f, weight); });
        if (inner) w += fs * 0.4;
        if (g.kind === "brand") w += fs * 1.0;
        if (g.after) w += measure(g.after, "", fs, weight);
        if (gi < groups.length - 1) w += measure(" ", "", fs, weight) * (inner ? 1.4 : 1);
      });
      return w;
    };
    let fs = fs0;
    if (o.wrap !== false) {   // too long for one line: break into balanced lines
      for (let li = lines.length - 1; li >= 0; li--) {
        const T = lineWidth(lines[li], fs0);
        if (T <= o.region.w * 1.25 || lines[li].length < 2) continue;
        const k = Math.ceil(T / (o.region.w * 0.92)), target = T / k;
        const parts = [[]]; let acc = 0;
        for (const g of lines[li]) {
          const gw = lineWidth([g], fs0) + measure(" ", "", fs0, weight);
          if (acc > 0 && acc + gw / 2 > target && parts.length < k) { parts.push([]); acc = 0; }
          parts[parts.length - 1].push(g); acc += gw;
        }
        lines.splice(li, 1, ...parts);
      }
    }
    const widest = Math.max(...lines.map((g) => lineWidth(g, fs0)));
    if (widest > o.region.w) fs = Math.max(fs0 * 0.45, fs0 * (o.region.w / widest));
    const lh = fs * (o.lineHeight || 1.2), sp = measure(" ", "", fs, weight);

    lines.forEach((groups, li) => {
      groups.forEach((g, gi) => {
        const inner = g.kind === "pill" || g.kind === "count";
        const f = inner ? fs * 0.9 : fs;
        const gr = { kind: g.kind, toks: [], g, li, padL: 0, padR: 0, gapAfter: 0 };
        if (inner) {
          gr.padL = gr.padR = fs * 0.2;
          gr.bg = el("div", "abs pill", root);
          gr.bg.style.height = fs * 1.08 + "px";
          pills.push(gr);
        }
        if (g.kind === "brand") {
          gr.padL = fs * 1.0;
          gr.orb = el("div", "abs orb", root);
          gr.orb.style.width = gr.orb.style.height = fs * 0.78 + "px";
          gr.orb.style.boxShadow = `0 0 ${fs * 0.5}px ${hexA(theme.accent, 0.55)}`;
        }
        g.words.forEach((wd, wi) => {
          const e = el("span", "abs tok " + (wd.cls || ""), root);
          e.style.fontSize = f + "px"; e.style.fontWeight = inner ? 600 : weight;
          e.style.lineHeight = lh + "px";
          e.textContent = wd.text;
          const tk = { e, text: wd.text, w: measure(wd.text, wd.cls, f, inner ? 600 : weight), li, gr, i: toks.length,
            gap: wi < g.words.length - 1 ? measure(" ", "", f, weight) : 0 };
          if (o.mode === "type") {
            e.textContent = "";
            tk.chars = [...wd.text].map((ch) => { const c = el("span", "", e); c.textContent = ch; return c; });
            tk.prefix = [0]; let acc = "";
            for (const ch of wd.text) { acc += ch; tk.prefix.push(measure(acc, wd.cls, f, inner ? 600 : weight)); }
          }
          if (o.mode === "letters") {
            e.textContent = "";
            tk.chars = [...wd.text].map((ch) => { const c = el("span", "", e); c.style.display = "inline-block"; c.textContent = ch; return c; });
          }
          if (g.kind === "count") tk.count = g;
          gr.toks.push(tk); toks.push(tk);
        });
        if (g.after) {
          gr.afterEl = el("span", "abs tok", root);
          gr.afterEl.style.fontSize = fs + "px"; gr.afterEl.style.lineHeight = lh + "px"; gr.afterEl.style.fontWeight = weight;
          gr.afterEl.textContent = g.after; gr.afterW = measure(g.after, "", fs, weight);
        }
        gr.gapAfter = gi < groups.length - 1 ? sp * (inner ? 1.35 : 1) : 0;
        groupsAll.push(gr);
      });
    });
    const fullW = Math.max(...lines.map((g) => lineWidth(g, fs)));
    meas.remove();
    if (o.mode === "type") {
      const c = el("div", "abs caret", root);
      c.style.width = Math.max(2, fs * 0.055) + "px"; c.style.height = fs * 1.0 + "px";
      carets.push(c);
    }
    const nLines = lines.length, blockH = nLines * lh;
    const top0 = o.vpos === "top" ? o.region.y : o.vpos === "bottom" ? o.region.y + o.region.h - blockH : o.region.y + (o.region.h - blockH) / 2;
    const rnd = (k) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

    function update(lt, times, exitK = 0) {
      // per-token reveal 0..1
      const rev = toks.map((tk) => {
        if (o.mode === "letters" || o.static) return 1;
        const tm = times[tk.i] || { s: 0, e: 0.3 };
        if (o.mode === "type") return prog(lt, tm.s, Math.max(0.08, tm.e - tm.s));
        return E.out3(prog(lt, tm.s - LEAD, REVEAL));
      });
      const grow = o.grow !== false && o.mode !== "letters";
      let caretX = null, caretY = 0, typing = false;
      for (let li = 0; li < nLines; li++) {
        const grs = groupsAll.filter((g) => g.li === li);
        // pass 1: widths at this instant
        const xs = []; let x = 0;
        for (const gr of grs) {
          const first = rev[gr.toks[0].i], last = rev[gr.toks[gr.toks.length - 1].i];
          const a = grow ? first : 1;
          gr.x0 = x; x += gr.padL * (grow ? E.out3(Math.min(1, first * 1.6)) : 1);
          for (const tk of gr.toks) {
            const r = rev[tk.i];
            const w = o.mode === "type" ? tk.prefix[Math.round(r * tk.chars.length)] : tk.w;
            xs[tk.i] = x; x += (grow ? (o.mode === "type" ? w + (r >= 1 ? tk.gap : 0) : (tk.w + tk.gap) * r) : tk.w + tk.gap);
            tk.cw = w;
          }
          if (gr.afterEl) { gr.afterX = x; x += gr.afterW * (grow ? last : 1); }
          x += gr.padR * (grow ? E.out3(Math.min(1, first * 1.6)) : 1);
          gr.x1 = x;
          x += gr.gapAfter * (grow ? (o.mode === "type" ? (last >= 1 ? 1 : 0) : last) : 1);
          gr.a = a;
        }
        const lineW = x - (grs.length ? grs[grs.length - 1].gapAfter * (grow ? rev[grs[grs.length - 1].toks.slice(-1)[0].i] : 1) : 0);
        const left = o.align === "left" ? o.region.x : o.align === "right" ? o.region.x + o.region.w - lineW : o.region.x + (o.region.w - lineW) / 2;
        const y = top0 + li * lh;
        // pass 2: place
        for (const gr of grs) {
          if (gr.bg) {
            const k = E.back(Math.min(1, rev[gr.toks[0].i] * 1.4));
            gr.bg.style.width = Math.max(0, gr.x1 - gr.x0) + "px";
            gr.bg.style.transform = tf({ x: left + gr.x0, y: y + (lh - fs * 1.08) / 2, s: lerp(0.6, 1, k) });
            gr.bg.style.opacity = clamp(rev[gr.toks[0].i] * 2).toFixed(3);
          }
          if (gr.orb) {
            const k = E.back(rev[gr.toks[0].i]);
            gr.orb.style.transform = tf({ x: left + gr.x0 + fs * 0.05, y: y + (lh - fs * 0.78) / 2, s: k });
          }
          for (const tk of gr.toks) {
            const r = rev[tk.i];
            const inner = gr.kind === "pill" || gr.kind === "count";
            const yy = y + (inner ? fs * 0.02 : 0);
            if (o.mode === "type") {
              const n = Math.round(r * tk.chars.length);
              tk.chars.forEach((c, ci) => {
                c.style.display = ci < n ? "inline" : "none";
                const age = lt - ((times[tk.i] || { s: 0 }).s + (ci / tk.chars.length) * ((times[tk.i] || { e: 0.3 }).e - (times[tk.i] || { s: 0 }).s));
                c.style.color = !inner && age < 0.28 ? theme.accent : "";
              });
              tk.e.style.transform = tf({ x: left + xs[tk.i], y: yy });
              if (r > 0 && r < 1) typing = true;
              if (r > 0) { caretX = left + xs[tk.i] + tk.cw + fs * 0.06; caretY = y; }
            } else if (o.mode === "letters") {
              tk.e.style.transform = tf({ x: left + xs[tk.i], y: yy });
              const t0 = (times[0] || { s: 0 }).s;
              tk.chars.forEach((c, ci) => {
                const k = E.out3(prog(lt, t0 - 0.1 + rnd(tk.i * 31 + ci) * 0.55, 0.45));
                c.style.transform = `translateY(${((1 - k) * fs * 0.18).toFixed(2)}px)`;
                setFx(c, k, (1 - k) * 16 * S);
              });
            } else {
              const k = r;
              tk.e.style.transform = tf({ x: left + xs[tk.i], y: yy + (1 - k) * fs * 0.22, s: lerp(0.96, 1, k) });
              setFx(tk.e, clamp(k * 1.25), (1 - k) * 14 * S);
            }
            if (tk.count) {
              const g = tk.count, tm = times[tk.i] || { s: 0 };
              const k = E.out5(prog(lt, tm.s - LEAD, 0.9));
              let v = lerp(g.from, g.to, k);
              v = g.dec ? v.toFixed(g.dec) : Math.round(v).toString();
              if (g.commas) v = Number(v).toLocaleString("en-US", { minimumFractionDigits: g.dec, maximumFractionDigits: g.dec });
              tk.e.textContent = g.pre + v + g.suf;
              tk.e.style.width = tk.w + "px";
            }
          }
          if (gr.afterEl) {
            const r = rev[gr.toks[gr.toks.length - 1].i];
            gr.afterEl.style.transform = tf({ x: left + gr.afterX, y });
            setFx(gr.afterEl, o.mode === "type" ? (r >= 1 ? 1 : 0) : clamp(r * 1.25), o.mode === "type" ? 0 : (1 - r) * 14 * S);
          }
        }
      }
      for (const c of carets) {
        const on = typing || Math.floor(lt * 2.2) % 2 === 0;
        c.style.opacity = caretX == null || exitK > 0 ? 0 : on ? 1 : 0;
        if (caretX != null) c.style.transform = tf({ x: caretX, y: caretY + (lh - fs) / 2 });
      }
      setFx(root, 1 - exitK, exitK * 14 * S);
    }
    return { root, toks, update, fs, lh, height: blockH, top: top0, width: fullW, count: toks.length, pills,
      // pills and counters pop, typed characters tick
      cues(times) {
        const c = [];
        for (const gr of pills) c.push({ t: (times[gr.toks[0].i] || { s: 0 }).s - 0.02, name: "pop", gain: 0.5 });
        if (o.mode === "type") toks.forEach((tk) => {
          const tm = times[tk.i] || { s: 0, e: 0.3 };
          tk.text.split("").forEach((_, ci) => c.push({ t: tm.s + (ci / tk.text.length) * (tm.e - tm.s), name: "key" + (1 + ((tk.i + ci) % 3)), gain: 0.22 }));
        });
        return c;
      } };
  }

  // ---------- backgrounds ----------
  function paintBg(bg, kind) {
    const a = theme.accent;
    const k = kind || "dark";
    bg.style.background = k.startsWith("light") || k === "dots" ? theme.light : theme.dark;
    if (k === "dots") bg.style.backgroundImage = `radial-gradient(circle, ${theme.dotColor} ${1.4 * S}px, transparent ${1.8 * S}px)`, bg.style.backgroundSize = `${30 * S}px ${30 * S}px`;
    const glow = el("div", "layer", bg);
    if (k === "glow") glow.style.background = `radial-gradient(ellipse 65% 55% at 50% 50%, ${hexA(a, 0.42)}, transparent 70%)`;
    else if (k === "glowbottom") glow.style.background = `radial-gradient(ellipse 80% 55% at 50% 115%, ${hexA(a, 0.6)}, transparent 70%)`;
    else if (k === "lightglow") glow.style.background = `linear-gradient(to top, ${hexA(a, 0.42)} 0%, ${hexA(a, 0.12)} 28%, transparent 55%)`;
    else glow.style.display = "none";
    return glow;
  }
  const isLight = (k) => (k || "dark").startsWith("light") || k === "dots";

  // ---------- scene builders ----------
  // each returns { update(lt, dur), cues(dur), tokens? } ; ctx = { root (layer), sc (plan scene), words (local) }
  const B = {};

  B.text = (ctx) => {
    const sc = ctx.sc, light = isLight(sc.bg);
    const color = sc.color || (light ? theme.ink : theme.paper);
    const portrait = H > W;
    const region = sc.pos === "top" ? { x: W * 0.07, y: H * 0.1, w: W * 0.86, h: H * 0.2 }
      : sc.pos === "bottom" ? { x: W * 0.07, y: H * 0.7, w: W * 0.86, h: H * 0.2 }
      : sc.pos === "left" ? { x: W * 0.08, y: 0, w: W * (portrait ? 0.84 : 0.5), h: H }
      : { x: W * 0.07, y: 0, w: W * 0.86, h: H };
    const tb = TextBlock(ctx.root, sc.text ?? sc.vo, { size: sc.size || "l", color, mode: sc.mode, align: sc.align || (sc.pos === "left" ? "left" : "center"),
      vpos: sc.pos === "top" ? "top" : sc.pos === "bottom" ? "bottom" : "center", region, weight: sc.weight, grow: sc.grow });
    let sub = null;
    if (sc.sub) sub = TextBlock(ctx.root, sc.sub, { size: sc.subSize || "xs", color: light ? "#7a7b80" : "#8d8e94", align: "center", static: true,
      region: { x: region.x, y: tb.top + tb.height + 26 * S, w: region.w, h: 80 * S }, vpos: "top", weight: 500, track: "-0.02em" });
    const times = ctx.times(tb.toks.map((t) => t.text));
    return {
      update(lt, dur, exitK) {
        tb.update(lt, times, exitK);
        if (sub) { const last = times[times.length - 1] || { e: 0 }; const k = E.out3(prog(lt, last.e, 0.4)); sub.update(lt, [], exitK); setFx(sub.root, k * (1 - exitK), (1 - k) * 8 * S); }
      },
      cues: () => tb.cues(times),
    };
  };

  B.hero = (ctx) => {
    const sc = ctx.sc, word = sc.text ?? sc.vo;
    const g = el("div", "layer", ctx.root);
    const glow = el("div", "abs", g), main = el("div", "abs", g);
    const fs = (SIZES[sc.size] || 300) * S * (H > W ? 0.8 : 1);
    for (const d of [glow, main]) {
      d.style.fontSize = fs + "px"; d.style.fontWeight = 600; d.style.letterSpacing = "-0.055em"; d.style.whiteSpace = "pre";
      d.style.lineHeight = "1";
    }
    const letters = [...word.replace(/[.!?]$/, "")];
    const mk = (parent, glowy) => letters.map((ch) => {
      const s = el("span", "", parent); s.textContent = ch; s.style.display = "inline-block";
      if (glowy) s.style.color = theme.accent;
      else {
        s.style.backgroundImage = `linear-gradient(180deg, ${shade(theme.accent, 0.55)} 0%, ${theme.accent} 45%, ${shade(theme.accent, -0.45)} 100%)`;
        s.style.webkitBackgroundClip = "text"; s.style.backgroundClip = "text"; s.style.color = "transparent";
      }
      return s;
    });
    const L = mk(main), G = mk(glow, true);
    glow.style.filter = `blur(${46 * S}px)`; glow.style.opacity = 0.75;
    let bw = 0, bh = 0;
    const times = ctx.times([word]);
    return {
      update(lt, dur, exitK) {
        if (!bw) { bw = main.offsetWidth; bh = main.offsetHeight; }
        const t0 = times[0].s - 0.12;
        const s = lerp(1.0, 1.05, prog(lt, t0, dur));
        for (const d of [main, glow]) d.style.transform = tf({ x: (W - bw) / 2, y: (H - bh) / 2 - fs * 0.04, s });
        L.forEach((c, i) => {
          const k = E.out3(prog(lt, t0 + i * 0.055, 0.5));
          c.style.transform = `translateY(${((1 - k) * fs * 0.16).toFixed(1)}px)`;
          setFx(c, k, (1 - k) * 24 * S);
          G[i].style.transform = c.style.transform; G[i].style.opacity = k;
        });
        setFx(g, 1 - exitK, exitK * 20 * S);
        ctx.glow.style.opacity = E.out3(prog(lt, t0, 0.8)).toFixed(3);
      },
      cues: () => [{ t: times[0].s - 1.0, name: "riser", gain: 0.55 }, { t: times[0].s - 0.08, name: "boom", gain: 0.8 }],
    };
  };

  B.logo = (ctx) => {
    const sc = ctx.sc, portrait = H > W;
    let fs = (SIZES[sc.size] || 150) * S * (portrait ? 0.75 : 1);
    const g = el("div", "layer", ctx.root);
    const rings = [0, 1, 2].map(() => { const r = el("div", "abs ring", g); return r; });
    const orbD = 260 * S;
    let mark;
    if (brand.mark) { mark = el("img", "abs", g); mark.src = url(brand.mark); mark.style.objectFit = "contain"; }
    else { mark = el("div", "abs orb", g); mark.style.boxShadow = `0 0 ${80 * S}px ${hexA(theme.accent, 0.6)}`; }
    mark.style.width = mark.style.height = orbD + "px";
    for (const r of rings) {
      r.style.width = r.style.height = orbD + "px";
      r.style.background = `radial-gradient(circle, transparent 46%, ${hexA(theme.accent, 0.3)} 60%, ${hexA(theme.accent, 0.1)} 66%, transparent 70%)`;
    }
    const name = el("div", "abs", g);
    name.style.fontSize = fs + "px"; name.style.fontWeight = 600; name.style.letterSpacing = "-0.05em"; name.style.color = theme.paper;
    name.style.whiteSpace = "pre"; name.style.lineHeight = "1";
    const letters = [...brand.name].map((ch) => { const s = el("span", "", name); s.textContent = ch; s.style.display = "inline-block"; return s; });
    {   // shrink the lockup (mark + name) to fit
      const maxW = W * (portrait || !sc.tagline ? 0.84 : 0.5), lw = fs * 1.12 + name.offsetWidth;
      if (lw > maxW) { fs *= maxW / lw; name.style.fontSize = fs + "px"; }
    }
    const nWords = brand.name.split(/\s+/).length;
    let tag = null, bar = null, trail = null;
    const tagStr = sc.tagline || "";
    const spokenAll = spoken(sc.vo || brand.name);
    if (tagStr) {
      tag = TextBlock(g, tagStr, { size: sc.tagSize || 46, color: theme.paper, align: "left", vpos: "top", weight: 500, track: "-0.025em",
        region: { x: 0, y: 0, w: W * 0.36, h: 200 * S } });
      bar = el("div", "abs", g); trail = el("div", "abs", g);
      bar.style.background = theme.accent; bar.style.boxShadow = `0 0 ${24 * S}px ${theme.accent}, 0 0 ${60 * S}px ${hexA(theme.accent, 0.7)}`;
    }
    const times = ctx.times(spokenAll);
    const tb = times[0].s;                               // brand is spoken here
    const tagTimes = tag ? ctx.times(tag.toks.map((t) => t.text), nWords) : [];
    let nameW = 0;
    return {
      update(lt, dur, exitK) {
        if (!nameW) nameW = name.offsetWidth;
        const appear = E.back(prog(lt, tb - 0.3, 0.5));
        const lock = E.inout3(prog(lt, tb + 0.35, 0.6));
        const small = fs * 0.82;
        const gap = fs * 0.3;
        const lockW = small + gap + nameW;
        const tagW = tag ? tag.width : 0;
        const tagK = tag ? E.inout3(prog(lt, (tagTimes[0] || { s: dur }).s - 0.35, 0.55)) : 0;
        const stack = portrait && tag;
        const total = lockW + (tag && !stack ? (gap * 1.6 + tagW) * tagK : 0);
        const lx = (W - total) / 2, cy = H / 2 - (stack ? fs * 0.45 * tagK : 0);
        // mark: centre -> left of the lockup
        const d = lerp(orbD, small, lock);
        const mx = lerp(W / 2, lx + small / 2, lock), my = cy;
        mark.style.width = mark.style.height = d + "px";
        mark.style.transform = tf({ x: mx - d / 2, y: my - d / 2, s: appear });
        mark.style.opacity = clamp(appear * 2).toFixed(3);
        rings.forEach((r, i) => {
          const k = prog(lt, tb - 0.25 + i * 0.16, 1.5);
          r.style.transform = tf({ x: W / 2 - orbD / 2, y: cy - orbD / 2, s: lerp(0.6, 4.2, E.out3(k)) });
          r.style.opacity = (k > 0 && k < 1 ? (1 - k) * (1 - lock * 0.6) : 0).toFixed(3);
        });
        // name letters reveal as the mark slides left
        const nx = lx + small + gap;
        name.style.transform = tf({ x: nx, y: cy - fs * 0.52 });
        letters.forEach((c, i) => {
          const k = E.out3(prog(lt, tb + 0.5 + i * 0.035, 0.4));
          c.style.transform = `translateX(${((1 - k) * -fs * 0.25).toFixed(1)}px)`;
          setFx(c, k, (1 - k) * 12 * S);
        });
        if (tag) {
          const bx = lx + lockW + gap * 0.8;
          const bh = fs * 0.95;
          const sweep = E.inout3(prog(lt, (tagTimes[0] || { s: dur }).s - 0.15, 0.7));
          bar.style.width = Math.max(3, 6 * S) + "px"; bar.style.height = bh + "px";
          bar.style.transform = tf({ x: bx, y: cy - bh / 2 });
          bar.style.opacity = stack ? 0 : tagK.toFixed(3);
          trail.style.height = bh + "px";
          trail.style.width = (tagW * 0.9 * sweep) + "px";
          trail.style.background = `linear-gradient(90deg, ${hexA(theme.accent, 0.55)}, ${hexA(theme.accent, 0.12)} 55%, transparent)`;
          trail.style.filter = `blur(${10 * S}px)`;
          trail.style.transform = tf({ x: bx, y: cy - bh / 2 });
          trail.style.opacity = stack ? 0 : (tagK * lerp(1, 0.55, prog(lt, (tagTimes[0] || { s: dur }).s + 0.6, 1))).toFixed(3);
          tag.root.style.left = "0px";
          const tagRegion = stack ? { x: (W - tagW) / 2, y: cy + fs * 0.75 } : { x: bx + gap * 0.9, y: cy - tag.height / 2 };
          tag.root.style.transform = tf({ x: tagRegion.x, y: tagRegion.y - tag.top });
          tag.update(lt, tagTimes.length ? tagTimes : tag.toks.map(() => ({ s: dur, e: dur })), 0);
          tag.root.style.opacity = (tagK * (1 - exitK)).toFixed(3);
        }
        setFx(g, 1 - exitK, exitK * 14 * S);
      },
      cues: () => [{ t: tb - 0.32, name: "boom", gain: 0.6 }, { t: tb + 0.33, name: "swish", gain: 0.45 },
        ...(tag && tagTimes[0] ? [{ t: tagTimes[0].s - 0.2, name: "swish", gain: 0.5 }] : [])],
    };
  };

  // screenshot or screen recording in a window, with camera, cursor, focus, typing and toasts
  B.ui = (ctx) => {
    const sc = ctx.sc, light = isLight(sc.bg), portrait = H > W;
    const media = ctx.media(sc.src);
    const iw = media.w, ih = media.h;
    const side = sc.text ? (portrait ? "top" : sc.side || "left") : "none";
    let ww, wx, wy, region;
    const frame = sc.frame || "browser";
    const barH = frame === "browser" ? 44 * S : 0;
    if (side === "left") { ww = W * (sc.width || 0.6); wx = W * 0.43; region = { x: W * 0.07, y: 0, w: W * 0.32, h: H }; }
    else if (side === "right") { ww = W * (sc.width || 0.6); wx = W - W * 0.43 - ww; region = { x: W * 0.61, y: 0, w: W * 0.32, h: H }; }
    else if (side === "top") { ww = W * (sc.width || (portrait ? 0.92 : 0.7)); wx = (W - ww) / 2; region = { x: W * 0.07, y: H * (portrait ? 0.1 : 0.07), w: W * 0.86, h: H * (portrait ? 0.16 : 0.15) }; }
    else { ww = W * (sc.width || (portrait ? 0.92 : 0.78)); wx = (W - ww) / 2; }
    const ch = ww * (ih / iw);                       // full screenshot height at window width
    let viewH = ch;                                    // visible part (tall screenshots scroll inside the window)
    if (side === "top") { wy = region.y + region.h + H * 0.03; viewH = Math.min(ch, H * 0.95 - wy - barH); }
    else if (ch + barH > H * 0.86) { wy = H * 0.07; viewH = H * 0.86 - barH; }
    else wy = (H - ch - barH) / 2;
    const wh = viewH + barH, scrollMax = ch - viewH;

    const wrap = el("div", "abs", ctx.root);
    wrap.style.width = ww + "px"; wrap.style.height = wh + "px";
    const win = el("div", "win" + (sc.dark ? " dark" : "") + (frame === "none" ? " none" : ""), wrap);
    win.style.width = ww + "px"; win.style.height = wh + "px";
    if (frame === "browser") {
      const bar = el("div", "bar", win); bar.style.height = barH + "px";
      [0, 1, 2].forEach((i) => { const d = el("div", "dot", bar); d.style.width = d.style.height = 12 * S + "px"; d.style.left = (20 + i * 20) * S + "px"; d.style.top = (barH - 12 * S) / 2 + "px"; });
      if (sc.title) { const t = el("div", "title", bar, esc(sc.title)); t.style.fontSize = 15 * S + "px"; t.style.lineHeight = barH + "px"; }
    }
    const content = el("div", "content", win);
    content.style.top = barH + "px"; content.style.width = ww + "px"; content.style.height = viewH + "px";
    const scroller = el("div", "abs", content);       // everything in screenshot coordinates moves with the scroll
    scroller.style.width = ww + "px"; scroller.style.height = ch + "px";
    const m = media.make(scroller); m.style.width = ww + "px"; m.style.height = ch + "px";

    // focus: lift a region of the screenshot out as a floating card
    const veil = el("div", "veil", scroller); veil.style.opacity = 0;
    if (sc.dark) veil.style.background = "#000";
    const focus = (sc.focus || []).map((f) => {
      const [fx, fy, fw, fh] = f.rect;
      const d = el("div", "focus", scroller);
      Object.assign(d.style, { left: fx * ww + "px", top: fy * ch + "px", width: fw * ww + "px", height: fh * ch + "px",
        backgroundImage: `url("${url(sc.src)}")`, backgroundSize: `${ww}px ${ch}px`, backgroundPosition: `${-fx * ww}px ${-fy * ch}px` });
      d.style.opacity = 0;
      return { d, f };
    });
    // typing into fields
    const typing = (sc.typing || []).map((ty) => {
      const d = el("div", "abs tok", scroller);
      d.style.fontSize = (ty.size || 0.012) * ww + "px"; d.style.color = ty.color || (sc.dark ? "#fff" : "#111");
      d.style.fontWeight = 500; d.style.letterSpacing = "-0.01em";
      d.style.transform = tf({ x: ty.x * ww, y: ty.y * ch });
      return { d, ty };
    });
    // cursor
    let cur = null, ripple = null;
    const path = sc.cursor || [];
    if (path.length) {
      cur = el("div", "cursor", scroller);
      const cs = (sc.cursorSize || 0.026) * ww;
      cur.innerHTML = `<svg width="${cs}" height="${cs * 1.3}" viewBox="0 0 20 26"><path d="M1.5 1.5 L1.5 20.5 L6.4 16 L9.6 23.6 L13 22.1 L9.9 14.7 L16.6 14.7 Z" fill="#0b0b0c" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
      ripple = el("div", "ripple", scroller);
    }
    // text beside / above
    let tb = null;
    if (side !== "none") tb = TextBlock(ctx.root, sc.text, { size: sc.size || (side === "top" ? "m" : "m"), color: light ? theme.ink : theme.paper,
      align: side === "top" ? "center" : "left", vpos: "center", region, mode: sc.mode });
    const times = tb ? ctx.times(tb.toks.map((t) => t.text)) : [];

    // toasts float above everything
    const toasts = (sc.toasts || []).map((t) => {
      const d = el("div", "toast", ctx.root);
      const tw = (portrait ? 0.86 : 0.36) * W;
      d.style.width = tw + "px"; d.style.padding = `${22 * S}px ${26 * S}px`;
      const ic = el("div", "ic", d); ic.style.width = ic.style.height = 64 * S + "px";
      ic.style.background = t.iconBg || hexA(theme.accent, 0.15); ic.style.fontSize = 34 * S + "px";
      if (t.icon && /\.(png|jpe?g|svg|webp)$/i.test(t.icon)) { const im = el("img", "", ic); im.src = url(t.icon); } else ic.textContent = t.icon || "●";
      if (!t.icon) ic.style.color = theme.accent;
      const tx = el("div", "tx", d);
      const tt = el("div", "tt", tx, esc(t.title || "")); tt.style.fontSize = 28 * S + "px";
      const tbb = el("div", "tb", tx, esc(t.body || "")); tbb.style.fontSize = 25 * S + "px";
      const tm = el("div", "tm", d, esc(t.time || "now")); tm.style.fontSize = 22 * S + "px";
      return { d, t, tw };
    });

    // camera keys (window-relative; x/y as fractions of the window, s scale, rx/ry degrees)
    const viewCX = side === "left" ? wx + Math.min(ww, W - wx) / 2 : side === "right" ? Math.max(0, wx) + Math.min(ww, wx + ww) / 2 : W / 2;
    const viewCY = side === "top" ? wy + Math.min(wh, H - wy) / 2 : H / 2;
    const camKeys = (() => {
      const c = sc.cam, d = ctx.dur;
      if (Array.isArray(c)) return c.map((k) => {
        if (k.to) {   // zoom to a rect of the screenshot
          const [rx, ry, rw, rh] = k.to;
          const s = Math.min((W * (k.fill || 0.55)) / (rw * ww), (H * (k.fill || 0.55)) / (rh * ch));
          const dx = (rx + rw / 2) * ww - ww / 2, dy = barH + (ry + rh / 2) * ch - wh / 2;
          return { at: k.at, s, x: (viewCX - (wx + ww / 2) - s * dx) / ww, y: (viewCY - (wy + wh / 2) - s * dy) / wh, rx: k.rx || 0, ry: k.ry || 0, ease: k.ease };
        }
        return k;
      });
      if (c === "tilt") return [{ at: 0, s: 0.9, rx: 24, y: 0.1 }, { at: 1.0, s: 1, rx: 0, y: 0 }, { at: d, s: 1.05 }];
      if (c === "pan") return [{ at: 0, s: 1 }, { at: d, s: 1.03 }];
      if (c === "still") return [{ at: 0, s: 1 }];
      if (c === "pushleft") return [{ at: 0, s: 1, x: 0.02 }, { at: d, s: 1.08, x: -0.04 }];
      return [{ at: 0, s: 1, ry: side === "left" ? -4 : side === "right" ? 4 : 0 }, { at: d, s: 1.07, ry: 0 }];
    })();

    return {
      update(lt, dur, exitK) {
        const enter = E.out5(prog(lt, 0, 0.6));
        const cam = keyAt(camKeys, lt, ["s", "x", "y", "rx", "ry"]);
        const sk = sc.scroll != null ? keyAt(Array.isArray(sc.scroll) ? sc.scroll : [{ at: 0, y: 0 }, { at: dur, y: sc.scroll }], lt, ["y"]).y
          : sc.cam === "pan" ? E.inout3(prog(lt, 0.45, dur - 0.6)) : 0;
        scroller.style.transform = `translateY(${(-clamp(sk) * scrollMax).toFixed(2)}px)`;
        const tiltIn = sc.cam === "tilt";
        wrap.style.transformOrigin = "50% 50%";
        wrap.style.transform = tf({ x: wx + (cam.x || 0) * ww, y: wy + (cam.y || 0) * wh + (tiltIn ? 0 : (1 - enter) * H * 0.06),
          persp: 2400, rx: cam.rx || 0, ry: cam.ry || 0, s: (cam.s || 1) * (tiltIn ? 1 : lerp(0.97, 1, enter)) });
        setFx(wrap, clamp(enter * 1.5) * (1 - exitK), (1 - enter) * 12 * S + exitK * 12 * S);
        // toast blur-behind
        const tk = toasts.length ? Math.max(...toasts.map((t) => E.out3(prog(lt, t.t.at || 0, 0.4)))) : 0;
        if (sc.blurBehind && tk > 0) win.style.filter = `blur(${(tk * 7 * S).toFixed(2)}px)`;
        if (ctx.glow && sc.glow != null) ctx.glow.style.opacity = (sc.glow ? E.out3(prog(lt, sc.glowAt || 0.2, 0.9)) : 0).toFixed(3);
        // focus cards
        let veilK = 0;
        for (const { d, f } of focus) {
          const k = E.back(prog(lt, f.at, 0.5)), k0 = prog(lt, f.at, 0.3);
          veilK = Math.max(veilK, k0);
          d.style.opacity = k0 > 0 ? 1 : 0;
          d.style.transform = `scale(${lerp(1, f.s || 1.08, k).toFixed(4)})`;
          d.style.boxShadow = `0 0 0 ${2 * S}px ${hexA(theme.accent, 0.6 * k0)}, 0 ${24 * S}px ${70 * S}px rgba(0,0,0,${0.2 * k0}), 0 0 ${90 * S}px ${hexA(theme.accent, 0.35 * k0)}`;
        }
        veil.style.opacity = (veilK * (sc.dark ? 0.45 : 0.55)).toFixed(3);
        for (const { d, ty } of typing) {
          const n = Math.floor(prog(lt, ty.at, ty.text.length / (ty.cps || 16)) * ty.text.length);
          d.textContent = ty.text.slice(0, n);
        }
        if (cur) {
          const p = keyAt(path, lt, ["x", "y"]);
          const first = path[0].at;
          let press = 0, rip = -1;
          for (const k of path) if (k.click) {
            const c = lt - k.at;
            if (c > -0.08 && c < 0.16) press = Math.max(press, 1 - Math.abs(c - 0.04) / 0.12);
            if (c >= 0 && c < 0.5) rip = c / 0.5;
          }
          const cs = (sc.cursorSize || 0.026) * ww;
          cur.style.transform = tf({ x: p.x * ww - cs * 0.08, y: p.y * ch - cs * 0.06, s: 1 - 0.18 * clamp(press) });
          cur.style.opacity = clamp((lt - first + 0.25) / 0.25).toFixed(3);
          if (rip >= 0) {
            const rr = cs * lerp(0.4, 2.2, E.out3(rip));
            Object.assign(ripple.style, { width: rr + "px", height: rr + "px", left: p.x * ww - rr / 2 + "px", top: p.y * ch - rr / 2 + "px", opacity: (1 - rip).toFixed(3) });
          } else ripple.style.opacity = 0;
        }
        // toasts stack from the top
        let ty = H * (portrait ? 0.32 : 0.16);
        toasts.forEach(({ d, t, tw }) => {
          const k = E.back(prog(lt, t.at || 0, 0.55)), k0 = prog(lt, t.at || 0, 0.25);
          const hh = d.offsetHeight;
          d.style.transform = tf({ x: (t.x != null ? t.x * W : (W - tw) / 2), y: ty + (1 - k) * -40 * S, s: lerp(0.9, 1, k) });
          setFx(d, k0 * (1 - exitK), (1 - k0) * 10 * S);
          if (k0 > 0) ty += (hh + 18 * S) * E.out3(k0);
        });
        if (tb) tb.update(lt, times, exitK);
      },
      cues() {
        const c = [{ t: 0.02, name: "swish", gain: 0.3 }];
        for (const k of path) if (k.click) c.push({ t: k.at, name: "click", gain: 0.7 });
        for (const t of sc.toasts || []) c.push({ t: t.at || 0, name: "ding", gain: 0.55 });
        for (const ty of sc.typing || []) for (let i = 0; i < ty.text.length; i++) c.push({ t: ty.at + i / (ty.cps || 16), name: "key" + (1 + (i % 3)), gain: 0.18 });
        for (const f of sc.focus || []) c.push({ t: f.at, name: "pop", gain: 0.4 });
        if (tb) c.push(...tb.cues(times));
        return c;
      },
      videos: media.video ? [{ v: media.video, clipIn: sc.in || 0, speed: sc.speed || 1 }] : [],
    };
  };

  // floating cards: screenshots, outputs, phone screens
  B.cards = (ctx) => {
    const sc = ctx.sc, light = isLight(sc.bg), portrait = H > W;
    const items = sc.items || [];
    let tb = null, top = 0;
    if (sc.text) {
      tb = TextBlock(ctx.root, sc.text, { size: sc.size || "m", color: light ? theme.ink : theme.paper, align: "center", vpos: "center",
        region: { x: W * 0.07, y: H * (portrait ? 0.08 : 0.06), w: W * 0.86, h: H * (portrait ? 0.16 : 0.18) }, mode: sc.mode });
      top = H * (portrait ? 0.26 : 0.25);
    }
    const n = items.length, layout = sc.layout || "row";
    const availW = W * (portrait ? 0.9 : 0.86), availH = H - top - H * 0.1;
    const cards = items.map((it, i) => {
      const media = ctx.media(it.src);
      const d = el("div", "card", ctx.root);
      const im = media.make(d); im.style.width = "100%"; im.style.height = "100%";
      let lab = null;
      if (it.label) { lab = TextBlock(ctx.root, `[${it.label}]`, { size: sc.labelSize || 34, color: "#fff", align: "center", static: true, region: { x: 0, y: 0, w: 600 * S, h: 60 * S }, vpos: "top" }); }
      return { d, media, it, lab, ar: media.w / media.h, video: media.video };
    });
    // layout
    const gap = W * 0.025;
    let rowW = 0;
    if (layout === "grid") {
      const cols = sc.cols || (portrait ? 2 : Math.min(3, n)), rows = Math.ceil(n / cols);
      const cw = Math.min((availW - gap * (cols - 1)) / cols, ((availH - gap * (rows - 1)) / rows) * cards[0].ar);
      cards.forEach((c, i) => { c.w = cw; c.h = cw / c.ar; const r = Math.floor(i / cols), k = i % cols;
        const rowN = Math.min(cols, n - r * cols); const rw = rowN * cw + (rowN - 1) * gap;
        c.x = (W - rw) / 2 + k * (cw + gap); c.y = top + (availH - (rows * c.h + (rows - 1) * gap)) / 2 + r * (c.h + gap); c.rz = 0; });
    } else if (portrait) {
      const cw = W * 0.8;
      cards.forEach((c) => { c.w = cw; c.h = cw / c.ar; });
      const tot = cards.reduce((a, c) => a + c.h, 0);
      const g2 = n > 1 ? Math.min(gap, (availH - tot) / (n - 1)) : 0;
      let y = top + Math.max(0, (availH - (tot + g2 * (n - 1))) / 2);
      cards.forEach((c, i) => { c.x = (W - cw) / 2 + (layout === "fan" ? (i % 2 ? 1 : -1) * W * 0.03 : 0); c.y = y; y += c.h + g2;
        c.rz = layout === "fan" ? (i % 2 ? 2.5 : -2.5) : 0; });
    } else {
      const hMax = availH * (layout === "fan" ? 0.8 : 0.85);
      let hs = cards.map((c) => Math.min(hMax, (availW / n - gap) / c.ar));
      const hh = Math.min(...hs);
      cards.forEach((c) => { c.h = hh; c.w = hh * c.ar; });
      rowW = cards.reduce((a, c) => a + c.w, 0) + gap * (n - 1) * (layout === "fan" ? -0.6 : 1);
      let x = (W - rowW) / 2;
      cards.forEach((c, i) => {
        c.x = x; c.y = top + (availH - c.h) / 2; x += c.w + (layout === "fan" ? -gap * 0.6 : gap);
        c.rz = layout === "fan" ? (i - (n - 1) / 2) * 5 : 0;
        if (layout === "fan") c.y += Math.abs(i - (n - 1) / 2) * H * 0.02;
      });
    }
    const times = tb ? ctx.times(tb.toks.map((t) => t.text)) : [];
    const at = cards.map((c, i) => c.it.at ?? (sc.stagger != null ? 0.15 + i * sc.stagger : 0.15 + (i / Math.max(1, n)) * Math.min(ctx.dur * 0.55, 0.35 * n)));
    return {
      update(lt, dur, exitK) {
        const drift = lerp(0, -W * 0.015, prog(lt, 0, dur));
        cards.forEach((c, i) => {
          const k = E.out5(prog(lt, at[i], 0.7));
          const fl = Math.sin(lt * 1.3 + i * 1.7) * 6 * S;
          c.d.style.width = c.w + "px"; c.d.style.height = c.h + "px";
          c.d.style.transform = tf({ x: c.x + drift, y: c.y + (1 - k) * H * 0.12 + fl, persp: 1800, rx: (1 - k) * 28, rz: c.rz, s: lerp(0.9, 1, k) });
          setFx(c.d, clamp(k * 1.4) * (1 - exitK), (1 - k) * 16 * S + exitK * 12 * S);
          if (c.lab) {
            const lk = E.back(prog(lt, at[i] + 0.35, 0.45));
            c.lab.root.style.transform = tf({ x: c.x + drift + c.w / 2 - 300 * S, y: c.y + c.h - 90 * S + fl, s: lerp(0.7, 1, lk) });
            c.lab.update(lt, [], 0);
            c.lab.root.style.opacity = (clamp(lk * 2) * (1 - exitK)).toFixed(3);
          }
        });
        if (tb) tb.update(lt, times, exitK);
      },
      cues() { const c = at.map((t) => ({ t, name: "swish", gain: 0.25 })); if (tb) c.push(...tb.cues(times)); return c; },
      videos: cards.filter((c) => c.video).map((c) => ({ v: c.video, clipIn: c.it.in || 0, speed: c.it.speed || 1, offset: at[cards.indexOf(c)] })),
    };
  };

  // terminal: typed commands and their output
  B.terminal = (ctx) => {
    const sc = ctx.sc, portrait = H > W, light = isLight(sc.bg);
    let tb = null, top = H * 0.12;
    if (sc.text) {
      tb = TextBlock(ctx.root, sc.text, { size: sc.size || "m", color: light ? theme.ink : theme.paper, align: "center", vpos: "center",
        region: { x: W * 0.07, y: H * 0.06, w: W * 0.86, h: H * 0.16 }, mode: sc.mode });
      top = H * 0.27;
    }
    const ww = W * (sc.width || (portrait ? 0.92 : 0.72));
    let fs = (sc.fontSize || 40) * S * (portrait ? 0.8 : 1), lh = fs * 1.7;
    const lines = sc.lines || [];
    {
      const longest = Math.max(1, ...lines.map((l) => (l.cmd != null ? (l.prompt ?? "›").length + 1 + l.cmd.length : String(l.out).length)));
      fs = Math.min(fs, (ww - 76 * S) / (longest * 0.6)); lh = fs * 1.7;
    }
    const wh = Math.min(H - top - H * 0.07, Math.max(H * 0.34, 44 * S + 52 * S + lh * (lines.length + 0.6)));
    top = sc.text ? top : (H - wh) / 2;
    const wrap = el("div", "abs", ctx.root);
    const win = el("div", "win dark term", wrap);
    win.style.width = ww + "px"; win.style.height = wh + "px";
    if (!light) win.style.boxShadow = `0 0 0 1px rgba(255,255,255,.16), 0 ${30 * S}px ${90 * S}px rgba(0,0,0,.6), 0 0 ${120 * S}px ${hexA(theme.accent, 0.18)}`;
    const bar = el("div", "bar", win); bar.style.height = 44 * S + "px";
    [0, 1, 2].forEach((i) => { const d = el("div", "dot", bar); d.style.width = d.style.height = 12 * S + "px"; d.style.left = (20 + i * 20) * S + "px"; d.style.top = 16 * S + "px"; });
    const tt = el("div", "title", bar, esc(sc.title || "claude")); tt.style.fontSize = 15 * S + "px"; tt.style.lineHeight = 44 * S + "px";
    const body = el("div", "abs", win);
    body.style.transform = tf({ x: 34 * S, y: 44 * S + 26 * S });
    body.style.fontSize = fs + "px";
    // schedule
    let t = sc.startAt ?? 0.35;
    const rows = lines.map((ln) => {
      const r = { ln, e: el("div", "ln", body) };
      r.e.style.top = 0;
      if (ln.cmd != null) { r.start = ln.at ?? t; r.end = r.start + ln.cmd.length / (ln.cps || 26); t = r.end + (ln.pause ?? 0.35); }
      else { r.start = ln.at ?? t; r.end = r.start; t = r.start + (ln.pause ?? 0.22); }
      return r;
    });
    const span = t, fitTo = ctx.dur * 0.88;
    if (sc.fit !== false && span > fitTo) for (const r of rows) { if (r.ln.at == null) { r.start *= fitTo / span; r.end *= fitTo / span; } }
    const caret = el("div", "abs caret", body); caret.style.width = fs * 0.55 + "px"; caret.style.height = fs * 1.15 + "px"; caret.style.color = "#e6e6e9";
    const times = tb ? ctx.times(tb.toks.map((t) => t.text)) : [];
    const wx = (W - ww) / 2;
    return {
      update(lt, dur, exitK) {
        const enter = E.out5(prog(lt, 0, 0.6));
        wrap.style.transform = tf({ x: wx, y: top + (1 - enter) * H * 0.05, s: lerp(0.97, 1, enter) * lerp(1, 1.03, prog(lt, 0, dur)) });
        setFx(wrap, clamp(enter * 1.5) * (1 - exitK), (1 - enter) * 12 * S + exitK * 12 * S);
        let y = 0, cx = 0, cy = 0, typingNow = false;
        const visible = rows.filter((r) => lt >= r.start);
        const maxRows = Math.floor((wh - 80 * S) / lh);
        const scroll = Math.max(0, visible.length - maxRows);
        rows.forEach((r, i) => {
          const shown = lt >= r.start;
          r.e.style.display = shown && i >= scroll ? "block" : "none";
          if (!shown || i < scroll) return;
          r.e.style.top = y + "px";
          if (r.ln.cmd != null) {
            const n = Math.floor(prog(lt, r.start, r.end - r.start) * r.ln.cmd.length);
            r.e.innerHTML = `<span class="pr">${esc(r.ln.prompt ?? "›")} </span>${esc(r.ln.cmd.slice(0, n))}`;
            if (lt < r.end + 0.05) typingNow = true;
            cx = ((r.ln.prompt ?? "›").length + 1 + n) * fs * 0.6; cy = y;
          } else {
            const k = E.out3(prog(lt, r.start, 0.25));
            r.e.innerHTML = `<span class="${r.ln.accent ? "acc" : r.ln.dim ? "mut" : ""}">${esc(r.ln.out)}</span>`;
            r.e.style.opacity = k;
            cx = 0; cy = y + lh;
          }
          y += lh;
        });
        const blink = typingNow || Math.floor(lt * 2.2) % 2 === 0;
        caret.style.opacity = blink && exitK === 0 ? 0.9 : 0;
        caret.style.transform = tf({ x: cx, y: cy + (lh - fs * 1.15) / 2 - fs * 0.12 });
        if (tb) tb.update(lt, times, exitK);
      },
      cues() {
        const c = [{ t: 0.02, name: "swish", gain: 0.3 }];
        for (const r of rows) if (r.ln.cmd != null) {
          const n = r.ln.cmd.length;
          for (let i = 0; i < n; i += 1) c.push({ t: r.start + (i / n) * (r.end - r.start), name: "key" + (1 + (i % 3)), gain: 0.2 });
          c.push({ t: r.end + 0.12, name: "enter", gain: 0.35 });
        }
        if (tb) c.push(...tb.cues(times));
        return c;
      },
    };
  };

  // flow chips: 2.7K Clicks -> 6.5% -> 129 Leads ...
  B.chips = (ctx) => {
    const sc = ctx.sc, light = isLight(sc.bg);
    let fs = (sc.fontSize || 64) * S * (H > W ? 0.8 : 1);
    if (!sc.fontSize) {   // few short chips: grow them to fill ~80% of the width (up to 2x)
      const est = (sc.items || []).reduce((a, it) => a + (/^(→|->)/.test(it) ? 1.67 : it.length * 0.52 + 0.92) * fs, 0);
      if (est < W * 0.8) fs *= Math.min(1.9, (W * 0.8) / est);
    }
    const row = el("div", "abs", ctx.root);
    const chips = (sc.items || []).map((it) => {
      const arrow = it.startsWith("→") || it.startsWith("->");
      const d = el("div", "chip " + (arrow ? "arrow" : "box"), row);
      d.style.fontSize = fs + "px"; d.style.fontWeight = 500;
      if (!light && !arrow) { d.style.background = "#151518"; d.style.boxShadow = "0 0 0 1px rgba(255,255,255,.08)"; }
      if (arrow) {
        const pct = it.replace(/^(→|->)\s*/, "");
        d.style.width = fs * 1.55 + "px"; d.style.height = fs * 2.1 + "px"; d.style.borderRadius = fs * 0.3 + "px";
        el("div", "", d, "→").style.fontSize = fs * 0.9 + "px";
        if (pct) { const p = el("div", "pct", d, esc(pct)); p.style.fontSize = fs * 0.62 + "px"; p.style.padding = `${fs * 0.06}px ${fs * 0.22}px`; p.style.marginTop = fs * 0.12 + "px"; }
      } else {
        const m = it.match(/^(\S+)\s+(.*)$/) || [null, it, ""];
        d.innerHTML = `<span>${esc(m[1])}</span>${m[2] ? `<span class="lbl">&nbsp;${esc(m[2])}</span>` : ""}`;
        d.style.height = fs * 1.5 + "px"; d.style.padding = `0 ${fs * 0.4}px`; d.style.borderRadius = fs * 0.22 + "px";
      }
      return { d, arrow };
    });
    const gap = fs * 0.12;
    let widths = null;
    const n = chips.length;
    const at = chips.map((_, i) => (sc.at && sc.at[i] != null ? sc.at[i] : 0.2 + (i / Math.max(1, n - 1)) * Math.min(ctx.dur * 0.75, n * 0.45)));
    if (!sc.at && ctx.words.length) {   // a chip appears when its label is spoken (voice ~ "voices"); arrows just before
      let j = 0, prev = 0.1;
      chips.forEach((c, i) => {
        if (c.arrow) return;
        const key = norm(sc.items[i].split(/\s+/).pop()).slice(0, 4);
        const q = ctx.words.findIndex((w, k) => k >= j && key && norm(w.w).startsWith(key));
        at[i] = q >= 0 ? Math.max(prev, ctx.words[q].s - 0.06) : (i === 0 ? 0.1 : prev + 0.3);
        if (q >= 0) j = q + 1;
        prev = at[i];
      });
      chips.forEach((c, i) => { if (c.arrow) at[i] = Math.max(0.05, (at[i + 1] ?? at[i - 1] + 0.3) - 0.18); });
    }
    return {
      update(lt, dur, exitK) {
        if (!widths) widths = chips.map((c) => c.d.offsetWidth);
        let x = 0; const xs = [];
        chips.forEach((c, i) => { xs.push(x); x += widths[i] + gap; });
        // camera follows the newest chip
        let focusX = 0;
        chips.forEach((c, i) => { const k = E.out3(prog(lt, at[i], 0.5)); if (k > 0) focusX = lerp(focusX, xs[i] + widths[i] / 2, k); });
        const total = x - gap;
        const offset = total < W * 0.84 ? (W - total) / 2 : Math.min(W * 0.08, W * 0.62 - focusX);
        chips.forEach((c, i) => {
          const k = E.back(prog(lt, at[i], 0.45)), k0 = prog(lt, at[i], 0.2);
          const hgt = c.arrow ? fs * 2.1 : fs * 1.5;
          c.d.style.transform = tf({ x: offset + xs[i], y: H / 2 - hgt / 2, s: lerp(0.8, 1, k) });
          setFx(c.d, k0, (1 - k0) * 10 * S);
        });
        setFx(row, 1 - exitK, exitK * 14 * S);
      },
      cues: () => at.map((t, i) => ({ t, name: chips[i].arrow ? "swish" : "pop", gain: chips[i].arrow ? 0.25 : 0.4 })),
    };
  };
  // ==============================================================================
  // UNIVERSAL ANIMATION ENGINE BUILDERS
  // ==============================================================================

  // Helper for deterministic pseudo-random numbers based on seed
  const prng = (seed) => {
    let s = (Math.sin(seed) * 43758.5453123) % 1;
    return s < 0 ? s + 1 : s;
  };

  // 1. STORY / NARRATIVE SCENE BUILDER
  B.story = (ctx) => {
    const sc = ctx.sc;
    const canvas = el("canvas", "scene-canvas", ctx.root);
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");

    // Camera move calculation
    const cam = sc.camera || "pan_left";
    const particlesType = sc.particles || "dust";
    const envDesc = (sc.environment || "").toLowerCase();
    const isMars = envDesc.includes("mars") || envDesc.includes("crimson") || envDesc.includes("red");
    const isSpace = envDesc.includes("space") || envDesc.includes("cosmic") || envDesc.includes("stars");
    const isCyber = envDesc.includes("cyber") || envDesc.includes("neon") || envDesc.includes("city");
    const isForest = envDesc.includes("forest") || envDesc.includes("garden") || envDesc.includes("sanctuary");

    // Subtitle card at bottom
    const textToShow = sc.text ?? sc.vo ?? "";
    const subRegion = { x: W * 0.1, y: H * 0.82, w: W * 0.8, h: H * 0.13 };
    const subWrap = el("div", "story-subtitle", ctx.root);
    subWrap.style.left = subRegion.x + "px";
    subWrap.style.top = subRegion.y + "px";
    subWrap.style.width = subRegion.w + "px";
    subWrap.style.height = subRegion.h + "px";
    subWrap.style.transform = "none";
    const tb = TextBlock(ctx.root, textToShow, {
      size: H > W ? "s" : "m", color: "#FFFFFF", align: "center", weight: 500, region: subRegion
    });
    const times = ctx.times(tb.toks.map((t) => t.text));

    return {
      update(lt, dur, exitK) {
        g.clearRect(0, 0, W, H);
        const kTime = clamp(lt / dur);

        // Camera transform values
        let camX = 0, camY = 0, camScale = 1.0;
        if (cam === "pan_left") camX = lerp(W * 0.02, -W * 0.02, kTime);
        else if (cam === "pan_right") camX = lerp(-W * 0.02, W * 0.02, kTime);
        else if (cam === "zoom_in") camScale = lerp(1.0, 1.08, kTime);
        else if (cam === "zoom_out") camScale = lerp(1.08, 1.0, kTime);
        else if (cam === "tilt_up") camY = lerp(H * 0.02, -H * 0.02, kTime);
        else if (cam === "drift") { camX = Math.sin(lt * 0.8) * 12 * S; camScale = lerp(1.0, 1.04, kTime); }

        g.save();
        g.translate(W / 2 + camX, H / 2 + camY);
        g.scale(camScale, camScale);
        g.translate(-W / 2, -H / 2);

        // 1. Sky & Atmospheric Backdrop
        const skyGrad = g.createLinearGradient(0, 0, 0, H);
        if (isMars) {
          skyGrad.addColorStop(0, "#1A0606");
          skyGrad.addColorStop(0.45, "#4A180E");
          skyGrad.addColorStop(0.75, "#8C341F");
          skyGrad.addColorStop(1, "#C2542B");
        } else if (isSpace) {
          skyGrad.addColorStop(0, "#030308");
          skyGrad.addColorStop(0.6, "#09091F");
          skyGrad.addColorStop(1, "#17123A");
        } else if (isCyber) {
          skyGrad.addColorStop(0, "#080214");
          skyGrad.addColorStop(0.6, "#1A0533");
          skyGrad.addColorStop(1, "#360A5E");
        } else if (isForest) {
          skyGrad.addColorStop(0, "#041410");
          skyGrad.addColorStop(0.6, "#0A2920");
          skyGrad.addColorStop(1, "#194234");
        } else {
          skyGrad.addColorStop(0, theme.dark || "#080F1A");
          skyGrad.addColorStop(1, shade(theme.dark || "#080F1A", 0.2));
        }
        g.fillStyle = skyGrad;
        g.fillRect(-W * 0.1, -H * 0.1, W * 1.2, H * 1.2);

        // 2. Celestial Body / Sun / Moons
        if (isMars) {
          // Phobos moon
          g.save();
          g.fillStyle = "rgba(235, 205, 185, 0.85)";
          g.beginPath(); g.arc(W * 0.75, H * 0.22, 38 * S, 0, Math.PI * 2); g.fill();
          // Soft moon halo
          const halo = g.createRadialGradient(W * 0.75, H * 0.22, 30 * S, W * 0.75, H * 0.22, 90 * S);
          halo.addColorStop(0, "rgba(224, 122, 95, 0.4)"); halo.addColorStop(1, "transparent");
          g.fillStyle = halo; g.beginPath(); g.arc(W * 0.75, H * 0.22, 90 * S, 0, Math.PI * 2); g.fill();
          // Deimos tiny moon
          g.fillStyle = "rgba(240, 220, 200, 0.7)";
          g.beginPath(); g.arc(W * 0.85, H * 0.14, 12 * S, 0, Math.PI * 2); g.fill();
          g.restore();
        } else if (isSpace || isCyber) {
          // Cosmic glow orb
          const orb = g.createRadialGradient(W * 0.5, H * 0.35, 10 * S, W * 0.5, H * 0.35, W * 0.45);
          orb.addColorStop(0, hexA(theme.accent, 0.28)); orb.addColorStop(1, "transparent");
          g.fillStyle = orb; g.fillRect(0, 0, W, H);
        }

        // 3. Multi-Layer Terrain / Silhouettes
        // Layer A: Distant peaks
        g.fillStyle = isMars ? "#381109" : isCyber ? "#0C061A" : "#0D111A";
        g.beginPath();
        g.moveTo(0, H * 0.65);
        for (let x = 0; x <= W; x += 40) {
          const ny = Math.sin(x * 0.003 + 1.2) * 45 * S + Math.cos(x * 0.007) * 25 * S;
          g.lineTo(x, H * 0.6 + ny);
        }
        g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();

        // Layer B: Midground rugged mesas
        g.fillStyle = isMars ? "#210905" : isCyber ? "#06030D" : "#080B12";
        g.beginPath();
        g.moveTo(0, H * 0.76);
        for (let x = 0; x <= W; x += 30) {
          const ny = Math.sin(x * 0.005 + 4.1) * 35 * S + Math.sin(x * 0.012) * 15 * S;
          g.lineTo(x, H * 0.72 + ny);
        }
        g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();

        // Layer C: Foreground surface
        g.fillStyle = isMars ? "#140503" : "#040508";
        g.beginPath();
        g.moveTo(0, H * 0.84);
        g.quadraticCurveTo(W * 0.4, H * 0.81, W, H * 0.85);
        g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();

        // 4. Character / Subject Rendering
        const charDesc = (sc.character || "").toLowerCase();
        const hasRobotChar = (P.continuity && P.continuity.characters && P.continuity.characters.some((c) => (c.type || "").includes("robot") || (c.name || "").includes("Unit")));
        if ((charDesc.includes("robot") || charDesc.includes("unit")) && hasRobotChar) {
          // Animated Robot Character (Unit 7)
          const rx = W * 0.52;
          const ry = H * 0.76 + Math.sin(lt * 2.5) * 4 * S; // subtle hover/breath

          g.save();
          g.translate(rx, ry);

          // Robot shadow
          g.fillStyle = "rgba(0,0,0,0.45)";
          g.beginPath(); g.ellipse(0, 48 * S, 42 * S, 12 * S, 0, 0, Math.PI * 2); g.fill();

          // Torso
          g.fillStyle = "#334155";
          g.strokeStyle = "#475569"; g.lineWidth = 3 * S;
          g.beginPath(); g.roundRect(-24 * S, -30 * S, 48 * S, 56 * S, 12 * S); g.fill(); g.stroke();

          // Chest core meter
          g.fillStyle = theme.accent;
          g.beginPath(); g.roundRect(-10 * S, -14 * S, 20 * S, 8 * S, 3 * S); g.fill();

          // Head
          g.fillStyle = "#1E293B";
          g.beginPath(); g.roundRect(-20 * S, -74 * S, 40 * S, 36 * S, 10 * S); g.fill(); g.stroke();

          // Antenna
          g.strokeStyle = "#64748B"; g.lineWidth = 2 * S;
          g.beginPath(); g.moveTo(0, -74 * S); g.lineTo(0, -92 * S); g.stroke();
          g.fillStyle = theme.accent;
          g.beginPath(); g.arc(0, -94 * S, 4 * S, 0, Math.PI * 2); g.fill();

          // Glowing Optic Eye
          const eyeX = Math.sin(lt * 1.5) * 6 * S;
          const eyePulse = 0.8 + 0.2 * Math.sin(lt * 4.0);
          g.fillStyle = "#00E5FF";
          g.shadowColor = "#00E5FF"; g.shadowBlur = 18 * S * eyePulse;
          g.beginPath(); g.arc(eyeX, -56 * S, 8 * S, 0, Math.PI * 2); g.fill();
          g.shadowBlur = 0; // reset shadow

          // Arms / hands gesture
          if (charDesc.includes("shelter") || charDesc.includes("hand")) {
            // Cupped protective hands
            g.strokeStyle = "#64748B"; g.lineWidth = 4 * S;
            g.beginPath();
            g.moveTo(-24 * S, -10 * S); g.quadraticCurveTo(-38 * S, 10 * S, -12 * S, 24 * S);
            g.moveTo(24 * S, -10 * S); g.quadraticCurveTo(38 * S, 10 * S, 12 * S, 24 * S);
            g.stroke();
          } else {
            // Relaxed arms
            g.strokeStyle = "#475569"; g.lineWidth = 4 * S;
            g.beginPath();
            g.moveTo(-24 * S, -10 * S); g.lineTo(-34 * S, 18 * S);
            g.moveTo(24 * S, -10 * S); g.lineTo(34 * S, 18 * S);
            g.stroke();
          }

          // If Garden / Flower is present, render glowing blossom
          if (charDesc.includes("flower") || charDesc.includes("blossom") || envDesc.includes("garden") || sc.id === "sc_03" || sc.id === "sc_04") {
            const fx = 0, fy = 20 * S;
            // Stem
            g.strokeStyle = "#10B981"; g.lineWidth = 3 * S;
            g.beginPath(); g.moveTo(fx, fy + 22 * S); g.quadraticCurveTo(fx + 4 * S, fy + 8 * S, fx, fy); g.stroke();
            // Glowing Petals
            const bloomK = clamp(prog(lt, 0.4, 1.2));
            const petalPulse = 1.0 + 0.15 * Math.sin(lt * 3.0);
            g.fillStyle = "rgba(52, 211, 153, 0.92)";
            g.shadowColor = "#34D399"; g.shadowBlur = 24 * S * petalPulse;
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2.5) {
              const px = fx + Math.cos(angle) * 11 * S * bloomK * petalPulse;
              const py = fy + Math.sin(angle) * 9 * S * bloomK * petalPulse;
              g.beginPath(); g.arc(px, py, 6 * S * bloomK, 0, Math.PI * 2); g.fill();
            }
            // Golden center
            g.fillStyle = "#FBBF24"; g.beginPath(); g.arc(fx, fy, 4 * S, 0, Math.PI * 2); g.fill();
            g.shadowBlur = 0;
          }

          g.restore();
        }

        // 5. Atmospheric Floating Particle System (Deterministic math)
        const pCount = 70;
        for (let i = 0; i < pCount; i++) {
          const seedX = prng(i * 19.3);
          const seedY = prng(i * 47.7);
          const speed = 0.04 + prng(i * 8.1) * 0.09;
          const pSize = (1.5 + prng(i * 12.3) * 2.8) * S;

          // Drift positions
          const px = ((seedX * W + lt * speed * W * 0.4) % (W * 1.2)) - W * 0.1;
          const py = ((seedY * H - lt * speed * H * 0.25) % (H * 1.2)) + (seedY * H < 0 ? H : 0);
          const alpha = 0.2 + 0.6 * Math.sin(lt * 2.0 + i);

          if (particlesType === "embers") g.fillStyle = `rgba(251, 146, 60, ${alpha})`;
          else if (particlesType === "spores" || particlesType === "fireflies") g.fillStyle = `rgba(52, 211, 153, ${alpha})`;
          else if (particlesType === "stars") g.fillStyle = `rgba(255, 255, 255, ${alpha * 0.9})`;
          else g.fillStyle = `rgba(224, 122, 95, ${alpha * 0.5})`; // dust

          g.beginPath(); g.arc(px, py, pSize, 0, Math.PI * 2); g.fill();
        }

        g.restore(); // restore camera transform

        // 6. Subtitle block update
        tb.update(lt, times, exitK);
        setFx(subWrap, 1 - exitK, exitK * 12 * S);
      },
      cues: () => tb.cues(times)
    };
  };

  // 2. MOTION GRAPHICS SCENE BUILDER (NullMotion Adapter Integration)
  B.motion = (ctx) => {
    const sc = ctx.sc;
    const template = sc.template || "16-line-growth";
    const adapters = window.MotionAdapters || {};
    const adapter = adapters[template];
    if (!adapter) {
      const allowed = Object.keys(adapters).join(", ");
      throw new Error(`Unknown motion template "${template}". Allowed: ${allowed}`);
    }

    // Validate scene.data against template schema
    const validatedData = window.validateSchema(adapter.schema, sc.data || sc, template);

    const card = el("div", "motion-card", ctx.root);
    const cardW = Math.round(W * (H > W ? 0.92 : 0.8));
    const cardH = Math.round(H * (H > W ? 0.6 : 0.68));
    card.style.width = cardW + "px"; card.style.height = cardH + "px";

    // Mount adapter once into card
    adapter.mount(card, validatedData, theme, cardW, cardH);

    // Caption header/footer
    const textToShow = sc.text ?? sc.vo ?? "";
    let tb = null;
    let times = [];
    if (textToShow) {
      tb = TextBlock(ctx.root, textToShow, {
        size: H > W ? "m" : "l", color: theme.paper || "#FFFFFF", align: "center",
        region: { x: W * 0.08, y: H * (H > W ? 0.08 : 0.07), w: W * 0.84, h: H * 0.14 }
      });
      times = ctx.times(tb.toks.map((t) => t.text));
    }

    return {
      update(lt, dur, exitK) {
        adapter.seek(lt);
        if (tb) tb.update(lt, times, exitK);
        setFx(card, 1 - exitK, exitK * 10 * S);
      },
      cues: () => (tb ? tb.cues(times) : [])
    };
  };

  // 3. CINEMATIC SCENE BUILDER
  B.cinematic = (ctx) => {
    const sc = ctx.sc;
    // Letterbox bars
    const barTop = el("div", "cinematic-bar top", ctx.root);
    const barBot = el("div", "cinematic-bar bottom", ctx.root);
    const flare = el("div", "flare", ctx.root);
    flare.style.top = H * 0.5 + "px";

    const canvas = el("canvas", "scene-canvas", ctx.root);
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");

    const textToShow = sc.text ?? sc.vo ?? "";
    const tb = TextBlock(ctx.root, textToShow, {
      size: "xl", color: "#FFFFFF", align: "center", weight: 600,
      region: { x: W * 0.1, y: H * 0.38, w: W * 0.8, h: H * 0.28 }
    });
    const times = ctx.times(tb.toks.map((t) => t.text));

    return {
      update(lt, dur, exitK) {
        g.clearRect(0, 0, W, H);
        const kTime = clamp(lt / dur);

        // Letterbox slide-in
        const barIn = E.out3(clamp(lt / 0.8));
        barTop.style.transform = `translateY(${(-70 * (1 - barIn) * S).toFixed(1)}px)`;
        barBot.style.transform = `translateY(${(70 * (1 - barIn) * S).toFixed(1)}px)`;

        // Anamorphic horizontal flare sweep
        const flareX = lerp(-W * 0.2, W * 0.8, kTime);
        flare.style.transform = `translateX(${flareX.toFixed(1)}px)`;
        flare.style.opacity = Math.sin(kTime * Math.PI).toFixed(3);

        // Deep cosmic / volumetric background
        const bgGrad = g.createRadialGradient(W * 0.5, H * 0.5, 20 * S, W * 0.5, H * 0.5, W * 0.6);
        bgGrad.addColorStop(0, hexA(theme.accent, 0.25));
        bgGrad.addColorStop(1, "#030408");
        g.fillStyle = bgGrad; g.fillRect(0, 0, W, H);

        // Starfield particles
        for (let i = 0; i < 90; i++) {
          const sx = (prng(i * 17.1) * W + Math.sin(lt * 0.3 + i) * 15 * S) % W;
          const sy = (prng(i * 31.7) * H + lt * 8 * S) % H;
          const sa = 0.3 + 0.6 * Math.sin(lt * 3.0 + i);
          g.fillStyle = `rgba(255, 255, 255, ${sa.toFixed(2)})`;
          g.beginPath(); g.arc(sx, sy, (1.2 + prng(i * 5.3) * 1.8) * S, 0, Math.PI * 2); g.fill();
        }

        tb.update(lt, times, exitK);
        setFx(ctx.root, 1 - exitK, exitK * 14 * S);
      },
      cues: () => [
        { t: 0.1, name: "whoosh", gain: 0.4 },
        ...tb.cues(times)
      ]
    };
  };

  // 4. WHITEBOARD / EDUCATIONAL DIAGRAM BUILDER
  B.whiteboard = (ctx) => {
    const sc = ctx.sc;
    const canvas = el("canvas", "scene-canvas", ctx.root);
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d");

    const textToShow = sc.text ?? sc.vo ?? "";
    const tb = TextBlock(ctx.root, textToShow, {
      size: "l", color: isLight(sc.bg) ? "#0F172A" : "#FFFFFF", align: "center",
      region: { x: W * 0.08, y: H * 0.1, w: W * 0.84, h: H * 0.16 }
    });
    const times = ctx.times(tb.toks.map((t) => t.text));

    return {
      update(lt, dur, exitK) {
        g.clearRect(0, 0, W, H);
        const kTime = clamp(lt / dur);
        const drawK = E.out3(clamp(lt / (dur * 0.7)));

        // Animated Hand-Drawn Diagram Nodes
        const nodes = [
          { x: W * 0.28, y: H * 0.52, label: "Input" },
          { x: W * 0.50, y: H * 0.52, label: "Core Model" },
          { x: W * 0.72, y: H * 0.52, label: "Insight" }
        ];

        // Draw connecting sketch arrows
        g.strokeStyle = theme.accent;
        g.lineWidth = 4 * S;
        g.setLineDash([8 * S, 4 * S]);

        if (drawK > 0.2) {
          const l1K = clamp((drawK - 0.2) / 0.35);
          g.beginPath();
          g.moveTo(nodes[0].x + 60 * S, nodes[0].y);
          g.lineTo(lerp(nodes[0].x + 60 * S, nodes[1].x - 60 * S, l1K), nodes[0].y);
          g.stroke();
        }
        if (drawK > 0.5) {
          const l2K = clamp((drawK - 0.5) / 0.35);
          g.beginPath();
          g.moveTo(nodes[1].x + 60 * S, nodes[1].y);
          g.lineTo(lerp(nodes[1].x + 60 * S, nodes[2].x - 60 * S, l2K), nodes[1].y);
          g.stroke();
        }
        g.setLineDash([]); // reset dash

        // Draw Nodes
        nodes.forEach((n, idx) => {
          const appearAt = 0.15 + idx * 0.28;
          if (drawK >= appearAt) {
            const popK = E.back(clamp((drawK - appearAt) / 0.15));
            g.save();
            g.translate(n.x, n.y);
            g.scale(popK, popK);

            // Node Circle
            g.fillStyle = isLight(sc.bg) ? "#F1F5F9" : "#1E293B";
            g.strokeStyle = theme.accent;
            g.lineWidth = 3.5 * S;
            g.beginPath(); g.arc(0, 0, 52 * S, 0, Math.PI * 2); g.fill(); g.stroke();

            // Label
            g.fillStyle = isLight(sc.bg) ? "#0F172A" : "#FFFFFF";
            g.font = `600 ${18 * S}px "Inter Tight"`;
            g.textAlign = "center"; g.textBaseline = "middle";
            g.fillText(n.label, 0, 0);
            g.restore();
          }
        });

        tb.update(lt, times, exitK);
        setFx(ctx.root, 1 - exitK, exitK * 12 * S);
      },
      cues: () => [
        { t: 0.3, name: "pop", gain: 0.3 },
        { t: 1.2, name: "ding", gain: 0.35 },
        ...tb.cues(times)
      ]
    };
  };

  // 5. KINETIC TYPOGRAPHY BUILDER (Social / TikTok / High-Energy)
  B.kinetic = (ctx) => {
    const sc = ctx.sc;
    const textToShow = sc.text ?? sc.vo ?? "";
    const tb = TextBlock(ctx.root, textToShow, {
      size: H > W ? "xl" : "xxl", color: "#FFFFFF", align: "center", weight: 700,
      region: { x: W * 0.05, y: H * 0.25, w: W * 0.9, h: H * 0.5 }
    });
    const times = ctx.times(tb.toks.map((t) => t.text));

    return {
      update(lt, dur, exitK) {
        tb.update(lt, times, exitK);
        // High-energy pulsating zoom on key beats
        const beatK = 1.0 + 0.04 * Math.sin(lt * 12.0) * Math.exp(-lt * 0.5);
        ctx.root.style.transform = `scale(${beatK.toFixed(3)})`;
        setFx(ctx.root, 1 - exitK, exitK * 16 * S);
      },
      cues: () => [
        { t: 0.05, name: "boom", gain: 0.5 },
        ...tb.cues(times)
      ]
    };
  };
  // ---------- media ----------
  const mediaCache = {};
  async function preload(src) {
    if (!src || mediaCache[src]) return;
    if (isVideo(src)) {
      const v = document.createElement("video");
      v.muted = true; v.preload = "auto"; v.playsInline = true; v.src = url(src);
      await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error("cannot load " + src)); });
      mediaCache[src] = { w: v.videoWidth, h: v.videoHeight, src, video: true };
    } else {
      const im = new Image(); im.src = url(src);
      await im.decode().catch(() => { throw new Error("cannot load " + src); });
      mediaCache[src] = { w: im.naturalWidth, h: im.naturalHeight, src };
    }
  }
  function media(src) {
    const m = mediaCache[src];
    if (!m) throw new Error("missing media " + src);
    const out = { w: m.w, h: m.h, video: null };
    out.make = (parent) => {
      if (m.video) { const v = el("video", "", parent); v.muted = true; v.preload = "auto"; v.src = url(src); out.video = v; videos.push(v); return v; }
      const im = el("img", "", parent); im.src = url(src); im.draggable = false; return im;
    };
    return out;
  }

  // ---------- timeline ----------
  function estimate(plan) {
    let t = 0.25; const out = [];
    for (const sc of plan.scenes) {
      const words = spoken(sc.vo || "");
      const start = t, vs = t + (sc.pre ?? 0.1);
      const ws = words.map((w, i) => ({ w, s: vs + i / WPS, e: vs + (i + 0.85) / WPS }));
      const ve = words.length ? vs + words.length / WPS : vs;
      t = Math.max(start + (sc.dur || 0), ve + (sc.post ?? (words.length ? 0.3 : 0)));
      if (!words.length && !sc.dur) t = start + 1.2;
      out.push({ start, end: t, vo_start: vs, vo_end: ve, words: ws });
    }
    const last = plan.scenes[plan.scenes.length - 1];
    out[out.length - 1].end += last ? (last.hold ?? 1.0) : 0;
    return { duration: out[out.length - 1].end, scenes: out, estimated: true };
  }

  // ---------- load / seek ----------
  window.__load = async (data) => {
    P = data.plan; BASE = data.base.endsWith("/") ? data.base : data.base + "/";
    // Early validation of motion scenes and schemas before any frame is rendered
    for (let i = 0; i < (P.scenes || []).length; i++) {
      const sc = P.scenes[i];
      if (sc.type === "motion") {
        const tmplId = sc.template || "16-line-growth";
        const adapters = window.MotionAdapters || {};
        const adapter = adapters[tmplId];
        if (!adapter) {
          const allowed = Object.keys(adapters).join(", ");
          throw new Error(`[motion] Unknown motion template "${tmplId}". Allowed: ${allowed}`);
        }
        if (typeof window.validateSchema === "function") {
          window.validateSchema(adapter.schema, sc.data || sc, tmplId);
        }
      }
    }
    [W, H] = FORMATS[P.format || "16:9"];
    S = Math.min(W, H) / 1080;
    theme = Object.assign({ accent: "#329CDA", dark: "#000000", light: "#FDFDFD", ink: "#0B0B0C", paper: "#ECEDF1", dotColor: "#E4E4E7" }, P.theme || {});
    brand = Object.assign({ name: "Product" }, P.brand || {});
    stage = document.getElementById("stage");
    stage.innerHTML = "";
    stage.style.width = W + "px"; stage.style.height = H + "px";
    const root = document.documentElement.style;
    root.setProperty("--s", S); root.setProperty("--accent", theme.accent);
    root.setProperty("--accent-hi", shade(theme.accent, 0.6)); root.setProperty("--accent-lo", shade(theme.accent, -0.45));
    if (theme.font) root.setProperty("--font", `"${theme.font}"`);
    await Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 100px "Inter Tight"`)));
    await document.fonts.load(`italic 400 100px "Instrument Serif"`);
    await Promise.all(["400", "600", "700"].map((w) => document.fonts.load(`${w} 100px "JetBrains Mono"`)));
    await document.fonts.ready;
    const srcs = new Set();
    for (const sc of P.scenes) { if (sc.src) srcs.add(sc.src); for (const it of sc.items || []) if (it.src) srcs.add(it.src); }
    await Promise.all([...srcs].map(preload));
    const hasTl = data.timeline && data.timeline.scenes;
    const countMatches = hasTl && data.timeline.scenes.length === P.scenes.length;
    if (data.timeline && !countMatches && !data.estimateTiming) {
      throw new Error(`timeline.json scene count (${data.timeline.scenes ? data.timeline.scenes.length : 0}) does not match plan scenes (${P.scenes.length}). Re-run vo.py build or pass --estimate-timing`);
    }
    const TL = (hasTl && countMatches) ? data.timeline : estimate(P);
    if (data.timeline && TL !== data.timeline) console.warn("timeline does not match the plan's scenes; using an estimate");
    scenes = P.scenes.map((sc, i) => {
      const tl = TL.scenes[i];
      const node = el("div", "scene", stage);
      node.style.display = "block"; node.style.visibility = "hidden";
      const bg = el("div", "bg", node);
      const glow = paintBg(bg, sc.bg || (sc.type === "hero" || sc.type === "logo" ? (sc.type === "hero" ? "glow" : "dark") : "dark"));
      const layer = el("div", "layer", node);
      const dur = tl.end - tl.start;
      const localWords = (tl.words || []).map((w) => ({ w: w.w, s: w.s - tl.start, e: w.e - tl.start }));
      const ctx = { sc, root: layer, glow, dur, media, words: localWords,
        times: (tokens, skip = 0) => {
          const ws = localWords.slice(skip);
          if (!ws.length) {   // nothing spoken: reveal over the opening of the scene
            const n = tokens.length, t1 = Math.min(dur * 0.55, 0.12 + n * 0.22);
            return tokens.map((_, k) => ({ s: lerp(0.12, t1, n > 1 ? k / (n - 1) : 0), e: lerp(0.12, t1, n > 1 ? k / (n - 1) : 0) + 0.2 }));
          }
          return mapTimes(tokens, ws, (tl.vo_start ?? tl.start) - tl.start, (tl.vo_end ?? tl.end) - tl.start);
        } };
      if (!B[sc.type]) throw new Error(`scene ${i}: unknown type "${sc.type}"`);
      const inst = B[sc.type](ctx);
      return { i, sc, node, layer, glow, start: tl.start, end: tl.end, dur, inst };
    });
    await Promise.all(videos.map((v) => (v.readyState >= 2 ? 0 : new Promise((ok) => { v.onloadeddata = ok; v.onerror = ok; }))));
    // first paint of every scene (measures widths), then hide
    for (const s of scenes) { s.inst.update(0, s.dur, 0); s.node.style.display = "none"; s.node.style.visibility = "visible"; }
    window.__duration = TL.duration;
    window.__timeline = TL;
    return { W, H, duration: TL.duration, estimated: !!TL.estimated, scenes: scenes.map((s) => ({ type: s.sc.type, start: s.start, end: s.end })) };
  };

  const OUT = { blur: 0.24, zoom: 0.3, slide: 0.3, fade: 0.3, cut: 0 };
  window.__seek = async (t) => {
    const pend = [];
    for (const s of scenes) {
      const on = t >= s.start && (t < s.end || (s === scenes[scenes.length - 1] && t <= s.end + 1));
      s.node.style.display = on ? "block" : "none";
      if (!on) continue;
      const lt = t - s.start;
      const out = s.sc.out || (["ui", "cards", "terminal"].includes(s.sc.type) ? "cut" : "blur");
      const od = OUT[out] ?? 0.24;
      const last = s === scenes[scenes.length - 1];
      const exitK = od && (!last || s.sc.out) ? E.in3(prog(lt, s.dur - od, od)) : last ? E.in3(prog(lt, s.dur - 0.6, 0.6)) : 0;
      s.layer.style.transform = out === "zoom" ? `scale(${lerp(1, 1.18, exitK).toFixed(4)})` : out === "slide" ? `translateX(${(-exitK * W * 0.08).toFixed(1)}px)` : "";
      s.node.style.opacity = last && !s.sc.out ? (1 - exitK).toFixed(3) : 1;
      s.inst.update(lt, s.dur, out === "fade" || out === "cut" ? 0 : (last && !s.sc.out ? 0 : exitK));
      if (out === "fade") s.layer.style.opacity = (1 - exitK).toFixed(3);
      for (const v of s.inst.videos || []) {
        const target = Math.max(0, Math.min(v.v.duration - 0.05, v.clipIn + (lt - (v.offset || 0)) * v.speed));
        if (Math.abs(v.v.currentTime - target) > 0.001) {
          pend.push(new Promise((ok, bad) => {
            const timer = setTimeout(() => bad(new Error(`video seek timeout at ${target.toFixed(2)}s`)), 2000);
            v.v.onseeked = () => { clearTimeout(timer); ok(); };
            v.v.currentTime = target;
          }));
        }
      }
    }
    await Promise.all(pend);
  };

  window.__cues = () => {
    const out = [];
    scenes.forEach((s, i) => {
      for (const c of (s.inst.cues ? s.inst.cues(s.dur) : [])) out.push({ t: +(s.start + c.t).toFixed(3), name: c.name, gain: c.gain ?? 0.5 });
      const o = s.sc.out;
      if ((o === "zoom" || o === "slide") && i < scenes.length - 1) out.push({ t: +(s.end - 0.28).toFixed(3), name: "whoosh", gain: 0.45 });
      for (const c of s.sc.sfx || []) out.push({ t: +(s.start + (c.at || 0)).toFixed(3), name: c.name, gain: c.gain ?? 0.6 });
    });
    return out.filter((c) => c.t >= 0).sort((a, b) => a.t - b.t);
  };
})();
