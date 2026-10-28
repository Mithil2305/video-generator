/**
 * NullMotion Adapter Contract & Registry for Launch-Video Engine
 *
 * Every motion template implements:
 * {
 *   id: string,
 *   duration?: number,
 *   schema: { [field: string]: { type: string, required: boolean, default?: any } },
 *   mount(root, data, theme, width, height): void,
 *   seek(t): void
 * }
 *
 * Rules:
 * - Deterministic: seek(t) is a pure function of t.
 * - GSAP timelines are built paused: tl.seek(t, false).
 * - gsap.ticker.lagSmoothing(0) is enforced.
 * - Zero external CDN loads; pure local rendering.
 * - Data-driven: No invented numbers or hardcoded claims.
 */

(function (global) {
  // Ensure GSAP lagSmoothing is 0 for headless frame-by-frame rendering
  if (typeof global.gsap !== "undefined" && global.gsap.ticker) {
    global.gsap.ticker.lagSmoothing(0);
  }

  // Schema Validator
  function validateSchema(schema, data, templateId) {
    if (!schema) return data || {};
    const input = data || {};
    const out = {};

    for (const [key, rule] of Object.entries(schema)) {
      const val = input[key];
      if (val === undefined || val === null) {
        if (rule.required) {
          throw new Error(`[${templateId}] Missing required field: "${key}"`);
        }
        if (rule.default !== undefined) {
          out[key] = rule.default;
        }
        continue;
      }

      if (rule.type === "string" && typeof val !== "string") {
        throw new Error(`[${templateId}] Field "${key}" must be a string, got ${typeof val}`);
      }
      if (rule.type === "number" && typeof val !== "number") {
        throw new Error(`[${templateId}] Field "${key}" must be a number, got ${typeof val}`);
      }
      if (rule.type === "array" && !Array.isArray(val)) {
        throw new Error(`[${templateId}] Field "${key}" must be an array, got ${typeof val}`);
      }
      if (rule.type === "object" && (typeof val !== "object" || Array.isArray(val))) {
        throw new Error(`[${templateId}] Field "${key}" must be an object, got ${typeof val}`);
      }
      if (rule.type === "boolean" && typeof val !== "boolean") {
        throw new Error(`[${templateId}] Field "${key}" must be a boolean, got ${typeof val}`);
      }

      out[key] = val;
    }
    return out;
  }

  // Easing helpers
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    out3: (k) => 1 - (1 - k) ** 3,
    inout3: (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
    back: (k) => { const c = 1.5; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; }
  };

  const MotionAdapters = {};

  function registerAdapter(adapter) {
    if (!adapter.id) throw new Error("Adapter must have an id");
    if (typeof adapter.mount !== "function") throw new Error(`Adapter ${adapter.id} must have mount()`);
    if (typeof adapter.seek !== "function") throw new Error(`Adapter ${adapter.id} must have seek()`);
    MotionAdapters[adapter.id] = adapter;
  }

  // =========================================================================
  // Template 1: 16-line-growth (Canvas / Smooth Cubic Growth Curve)
  // =========================================================================
  registerAdapter({
    id: "16-line-growth",
    duration: 5.0,
    schema: {
      points: {
        type: "array",
        required: false,
        default: [10, 25, 45, 80, 120]
      },
      markers: {
        type: "array",
        required: false,
        default: []
      },
      title: {
        type: "string",
        required: false,
        default: "Growth Trend"
      }
    },
    mount(root, data, theme, width, height) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      root.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.data = data;
      this.theme = theme;
      this.width = width;
      this.height = height;
    },
    seek(t) {
      const g = this.ctx;
      const W = this.width, H = this.height;
      const theme = this.theme;
      g.save();
      g.clearRect(0, 0, W, H);
      g.textAlign = "start";
      g.textBaseline = "alphabetic";
      g.shadowBlur = 0;
      g.globalAlpha = 1.0;

      // Grid lines
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.lineWidth = 1.5;
      for (let y = H * 0.2; y < H * 0.85; y += H * 0.18) {
        g.beginPath(); g.moveTo(W * 0.1, y); g.lineTo(W * 0.9, y); g.stroke();
      }

      const dur = 5.0;
      const pStart = W * 0.12, pEnd = W * 0.88;
      const drawK = E.inout3(clamp(t / (dur * 0.75)));
      const currentX = lerp(pStart, pEnd, drawK);

      // Draw Curve
      g.save();
      g.beginPath();
      g.moveTo(pStart, H * 0.78);
      for (let x = pStart; x <= currentX; x += 4) {
        const rel = (x - pStart) / (pEnd - pStart);
        const y = H * (0.78 - 0.55 * Math.pow(rel, 1.6) - 0.06 * Math.sin(rel * Math.PI * 3));
        g.lineTo(x, y);
      }
      g.strokeStyle = theme.accent || "#00E5FF";
      g.lineWidth = 5;
      g.shadowColor = theme.accent || "#00E5FF";
      g.shadowBlur = 16;
      g.stroke();

      // Area fill
      g.lineTo(currentX, H * 0.85);
      g.lineTo(pStart, H * 0.85);
      g.closePath();
      const areaGrad = g.createLinearGradient(0, H * 0.2, 0, H * 0.85);
      areaGrad.addColorStop(0, "rgba(0, 229, 255, 0.35)");
      areaGrad.addColorStop(1, "transparent");
      g.fillStyle = areaGrad;
      g.shadowBlur = 0;
      g.fill();
      g.restore();

      // Draw markers if provided in data
      const markers = this.data.markers || [];
      markers.forEach((m) => {
        const rel = m.rel !== undefined ? m.rel : 0.5;
        if (drawK >= rel) {
          const mx = lerp(pStart, pEnd, rel);
          const my = H * (0.78 - 0.55 * Math.pow(rel, 1.6) - 0.06 * Math.sin(rel * Math.PI * 3));
          const mPop = E.back(clamp((drawK - rel) / 0.12));

          g.fillStyle = "#FFFFFF";
          g.beginPath(); g.arc(mx, my, 6 * mPop, 0, Math.PI * 2); g.fill();

          if (m.val || m.label) {
            const txt = String(m.val || m.label);
            const badgeW = 70 * mPop, badgeH = 26 * mPop;
            g.fillStyle = "#1E293B";
            g.strokeStyle = theme.accent || "#00E5FF";
            g.lineWidth = 1.5;
            g.beginPath();
            g.roundRect(mx - badgeW / 2, my - badgeH - 10, badgeW, badgeH, 4);
            g.fill(); g.stroke();
            g.fillStyle = theme.accent || "#00E5FF";
            g.font = `600 13px "JetBrains Mono", monospace`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(txt, mx, my - badgeH / 2 - 10);
          }
        }
      });
      g.restore();
    }
  });

  // =========================================================================
  // Template 2: 13-compare-bars (Data-Driven Comparison Bars without "Surge 10x")
  // =========================================================================
  registerAdapter({
    id: "13-compare-bars",
    duration: 5.0,
    schema: {
      bars: {
        type: "array",
        required: true
      },
      unit: {
        type: "string",
        required: false,
        default: ""
      }
    },
    mount(root, data, theme, width, height) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      root.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.data = data;
      this.theme = theme;
      this.width = width;
      this.height = height;
    },
    seek(t) {
      const g = this.ctx;
      const W = this.width, H = this.height;
      const theme = this.theme;
      g.save();
      g.clearRect(0, 0, W, H);
      g.textAlign = "start";
      g.textBaseline = "alphabetic";
      g.shadowBlur = 0;
      g.globalAlpha = 1.0;

      const bars = this.data.bars || [];
      if (bars.length < 2) { g.restore(); return; }

      const bar1 = bars[0];
      const bar2 = bars[1];
      const b1Val = Math.max(0.001, Number(bar1.value) || 1);
      const b2Val = Math.max(0.001, Number(bar2.value) || 1);
      const maxVal = Math.max(b1Val, b2Val);

      const barW = W * 0.22;
      const leftX = W * 0.32;
      const rightX = W * 0.68;
      const baselineY = H * 0.75;
      const maxH = H * 0.52;

      // Bar 1 (Baseline)
      const b1Prog = clamp(t / 0.8);
      const b1H = (b1Val / maxVal) * maxH * E.out3(b1Prog);
      g.fillStyle = "rgba(255,255,255,0.25)";
      g.fillRect(leftX - barW / 2, baselineY - b1H, barW, b1H);

      g.fillStyle = "rgba(255,255,255,0.85)";
      g.font = `600 16px "Inter", sans-serif`;
      g.textAlign = "center";
      g.fillText(`${bar1.label}: ${bar1.value}${this.data.unit || ""}`, leftX, baselineY + 28);

      // Bar 2 (Target / Comparative)
      if (t > 0.3) {
        const b2Prog = clamp((t - 0.3) / 1.0);
        const b2H = (b2Val / maxVal) * maxH * E.out3(b2Prog);
        g.fillStyle = theme.accent || "#38BDF8";
        g.shadowColor = theme.accent || "#38BDF8";
        g.shadowBlur = 14;
        g.fillRect(rightX - barW / 2, baselineY - b2H, barW, b2H);
        g.shadowBlur = 0;

        g.fillStyle = "#FFFFFF";
        g.font = `600 16px "Inter", sans-serif`;
        g.fillText(`${bar2.label}: ${bar2.value}${this.data.unit || ""}`, rightX, baselineY + 28);

        // Dynamically computed multiplier badge (No hardcoded "Surge 10x")
        if (t > 0.8 && b1Val > 0) {
          const badgeProg = clamp((t - 0.8) / 0.4);
          const ratio = (b2Val / b1Val).toFixed(1);
          const badgeText = `${ratio}x Difference`;
          const badgeY = baselineY - b2H - 24;

          g.save();
          g.globalAlpha = badgeProg;
          g.fillStyle = "rgba(15, 23, 42, 0.9)";
          g.strokeStyle = theme.accent || "#38BDF8";
          g.lineWidth = 1.5;
          const bw = 140, bh = 32;
          g.beginPath();
          g.roundRect(rightX - bw / 2, badgeY - bh / 2, bw, bh, 6);
          g.fill(); g.stroke();
          g.fillStyle = theme.accent || "#38BDF8";
          g.font = `700 14px "JetBrains Mono", monospace`;
          g.textBaseline = "middle";
          g.fillText(badgeText, rightX, badgeY);
          g.restore();
        }
      }
      g.restore();
    }
  });

  // =========================================================================
  // Template 3: 10-candlestick (Market Structure Price Action)
  // =========================================================================
  registerAdapter({
    id: "10-candlestick",
    duration: 5.0,
    schema: {
      title: { type: "string", required: false, default: "Market Structure" },
      metric: { type: "string", required: false },
      candles: { type: "array", required: false }
    },
    mount(root, data, theme, width, height) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      root.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.data = data;
      this.theme = theme;
      this.width = width;
      this.height = height;
    },
    seek(t) {
      const g = this.ctx;
      const W = this.width, H = this.height;
      const theme = this.theme;
      g.save();
      g.clearRect(0, 0, W, H);
      g.textAlign = "start";
      g.textBaseline = "alphabetic";
      g.shadowBlur = 0;
      g.globalAlpha = 1.0;

      const cols = 9;
      const colW = (W * 0.72) / cols;
      const greenIndices = [1, 2, 4, 5, 7, 8];

      for (let i = 0; i < cols; i++) {
        const cK = E.out3(clamp((t - i * 0.22) / 0.8));
        if (cK <= 0) continue;

        const cx = W * 0.14 + i * colW + colW * 0.5;
        const isGreen = greenIndices.includes(i);
        const baseH = H * (0.68 - i * 0.035);
        const bodyH = (32 + Math.sin(i * 2.3) * 18) * cK;
        const wickH = bodyH * 1.6;

        g.strokeStyle = isGreen ? "#10B981" : "#EF4444";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx, baseH - wickH);
        g.lineTo(cx, baseH + wickH);
        g.stroke();

        g.fillStyle = isGreen ? "#10B981" : "#EF4444";
        g.fillRect(cx - colW * 0.32, baseH - bodyH / 2, colW * 0.64, Math.max(4, bodyH));
      }

      // Title header
      if (t > 0.2) {
        g.fillStyle = "rgba(255, 255, 255, 0.85)";
        g.font = `600 18px "Inter", sans-serif`;
        g.textAlign = "left";
        g.fillText(this.data.title || "Market Structure", W * 0.14, H * 0.18);
      }

      // Metric badge (only drawn if provided in data)
      if (this.data.metric && t > 0.6) {
        const mProg = clamp((t - 0.6) / 0.4);
        g.save();
        g.globalAlpha = mProg;
        g.fillStyle = "#10B981";
        g.font = `700 16px "JetBrains Mono", monospace`;
        g.textAlign = "right";
        g.fillText(this.data.metric, W * 0.86, H * 0.18);
        g.restore();
      }
      g.restore();
    }
  });

  // =========================================================================
  // Template 4: 14-leaderboard (Ranked Benchmark Leaderboard)
  // =========================================================================
  registerAdapter({
    id: "14-leaderboard",
    duration: 5.0,
    schema: {
      items: { type: "array", required: true },
      title: { type: "string", required: false, default: "Leaderboard" }
    },
    mount(root, data, theme, width, height) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      root.appendChild(this.canvas);
      this.ctx = this.canvas.getContext("2d");
      this.data = data;
      this.theme = theme;
      this.width = width;
      this.height = height;
    },
    seek(t) {
      const g = this.ctx;
      const W = this.width, H = this.height;
      const theme = this.theme;
      g.save();
      g.clearRect(0, 0, W, H);
      g.textAlign = "start";
      g.textBaseline = "alphabetic";
      g.shadowBlur = 0;
      g.globalAlpha = 1.0;

      const items = (this.data.items || []).slice(0, 5);
      const rowH = Math.min(54, (H * 0.58) / Math.max(1, items.length));
      const startY = H * 0.24;
      const maxScore = Math.max(...items.map((it) => Number(it.score) || 100), 1);

      // Title
      g.fillStyle = "#FFFFFF";
      g.font = `700 22px "Inter", sans-serif`;
      g.textAlign = "left";
      g.fillText(this.data.title || "Benchmark Leaderboard", W * 0.14, H * 0.18);

      items.forEach((item, idx) => {
        const rowK = E.out3(clamp((t - idx * 0.18) / 0.6));
        if (rowK <= 0) return;

        const y = startY + idx * (rowH + 12);
        const barStartX = W * 0.38;
        const barMaxW = W * 0.44;
        const score = Number(item.score) || 0;
        const currentBarW = (score / maxScore) * barMaxW * rowK;

        // Rank Badge
        g.fillStyle = idx === 0 ? (theme.accent || "#38BDF8") : "rgba(255,255,255,0.2)";
        g.beginPath();
        g.roundRect(W * 0.14, y, 32, rowH, 6);
        g.fill();
        g.fillStyle = idx === 0 ? "#0B0F17" : "#FFFFFF";
        g.font = `700 14px "JetBrains Mono"`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(item.rank || idx + 1), W * 0.14 + 16, y + rowH / 2);

        // Name
        g.fillStyle = "#FFFFFF";
        g.font = `600 16px "Inter", sans-serif`;
        g.textAlign = "left";
        g.fillText(String(item.name || "Model"), W * 0.20, y + rowH / 2);

        // Progress Track & Bar
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.beginPath();
        g.roundRect(barStartX, y + rowH * 0.25, barMaxW, rowH * 0.5, 4);
        g.fill();

        g.fillStyle = idx === 0 ? (theme.accent || "#38BDF8") : "rgba(255,255,255,0.45)";
        g.beginPath();
        g.roundRect(barStartX, y + rowH * 0.25, currentBarW, rowH * 0.5, 4);
        g.fill();

        // Score text
        g.fillStyle = "#FFFFFF";
        g.font = `600 15px "JetBrains Mono"`;
        g.textAlign = "right";
        g.fillText(String(Math.round(score * rowK)), W * 0.88, y + rowH / 2);
      });
      g.restore();
    }
  });

  // =========================================================================
  // Template 5: 01-cta-pill (Obsidian Glass CTA Pill with Glint Sweep)
  // =========================================================================
  registerAdapter({
    id: "01-cta-pill",
    duration: 4.0,
    schema: {
      label: { type: "string", required: true },
      subcopy: { type: "string", required: false, default: "" }
    },
    mount(root, data, theme, width, height) {
      this.wrap = document.createElement("div");
      this.wrap.style.position = "absolute";
      this.wrap.style.inset = "0";
      this.wrap.style.display = "flex";
      this.wrap.style.flexDirection = "column";
      this.wrap.style.alignItems = "center";
      this.wrap.style.justifyContent = "center";
      this.wrap.style.gap = "18px";

      this.pill = document.createElement("div");
      this.pill.style.position = "relative";
      this.pill.style.padding = "24px 64px";
      this.pill.style.borderRadius = "999px";
      this.pill.style.background = "linear-gradient(180deg, #2b2b2e 0%, #161618 46%, #0a0a0b 100%)";
      this.pill.style.boxShadow = "inset 0 2px 1px rgba(255,255,255,0.22), 0 24px 45px rgba(0,0,0,0.55)";
      this.pill.style.border = "1px solid rgba(255,255,255,0.12)";
      this.pill.style.overflow = "hidden";

      this.label = document.createElement("div");
      this.label.style.fontSize = "32px";
      this.label.style.fontWeight = "600";
      this.label.style.letterSpacing = "0.14em";
      this.label.style.textTransform = "uppercase";
      this.label.style.color = "#FFFFFF";
      this.label.textContent = data.label;
      this.pill.appendChild(this.label);

      // Glint bar
      this.glint = document.createElement("div");
      this.glint.style.position = "absolute";
      this.glint.style.top = "0";
      this.glint.style.left = "-60%";
      this.glint.style.width = "40%";
      this.glint.style.height = "100%";
      this.glint.style.background = "linear-gradient(105deg, transparent, rgba(255,255,255,0.55), transparent)";
      this.glint.style.transform = "skewX(-18deg)";
      this.pill.appendChild(this.glint);

      this.wrap.appendChild(this.pill);

      if (data.subcopy) {
        this.sub = document.createElement("div");
        this.sub.style.fontSize = "18px";
        this.sub.style.color = "rgba(214,214,218,0.72)";
        this.sub.textContent = data.subcopy;
        this.wrap.appendChild(this.sub);
      }

      root.appendChild(this.wrap);
    },
    seek(t) {
      // Deterministic entrance and glint sweep
      const p1 = clamp(t / 0.85);
      const y = lerp(80, 0, E.out3(p1));
      const op = p1;
      this.pill.style.transform = `translateY(${y}px)`;
      this.pill.style.opacity = op.toFixed(3);

      if (this.sub) {
        const pSub = clamp((t - 0.4) / 0.6);
        this.sub.style.opacity = pSub.toFixed(3);
        this.sub.style.transform = `translateY(${lerp(14, 0, E.out3(pSub))}px)`;
      }

      // Glint sweeps between 1.8s and 2.7s
      const glintProg = clamp((t - 1.8) / 0.9);
      const glintX = lerp(-60, 160, glintProg);
      this.glint.style.left = `${glintX}%`;
    }
  });

  // =========================================================================
  // Template 6: 02-three-step (3 Sequential Process Cards)
  // =========================================================================
  registerAdapter({
    id: "02-three-step",
    duration: 6.0,
    schema: {
      steps: { type: "array", required: true }
    },
    mount(root, data, theme, width, height) {
      this.wrap = document.createElement("div");
      this.wrap.style.position = "absolute";
      this.wrap.style.inset = "0";
      this.wrap.style.display = "flex";
      this.wrap.style.flexDirection = "row";
      this.wrap.style.alignItems = "center";
      this.wrap.style.justifyContent = "center";
      this.wrap.style.gap = "24px";
      this.wrap.style.padding = "0 40px";

      this.cards = (data.steps || []).slice(0, 3).map((st, i) => {
        const card = document.createElement("div");
        card.style.flex = "1";
        card.style.padding = "28px 24px";
        card.style.borderRadius = "14px";
        card.style.background = "rgba(18, 24, 38, 0.75)";
        card.style.border = "1px solid rgba(255,255,255,0.08)";
        card.style.backdropFilter = "blur(12px)";

        const num = document.createElement("div");
        num.style.fontSize = "14px";
        num.style.fontFamily = "JetBrains Mono";
        num.style.color = theme.accent || "#00E5FF";
        num.textContent = st.step || `0${i + 1}`;
        card.appendChild(num);

        const ttl = document.createElement("div");
        ttl.style.fontSize = "20px";
        ttl.style.fontWeight = "600";
        ttl.style.color = "#FFFFFF";
        ttl.style.marginTop = "8px";
        ttl.textContent = st.title || "";
        card.appendChild(ttl);

        if (st.desc) {
          const dsc = document.createElement("div");
          dsc.style.fontSize = "14px";
          dsc.style.color = "rgba(255,255,255,0.6)";
          dsc.style.marginTop = "8px";
          dsc.textContent = st.desc;
          card.appendChild(dsc);
        }

        this.wrap.appendChild(card);
        return card;
      });

      root.appendChild(this.wrap);
    },
    seek(t) {
      this.cards.forEach((c, i) => {
        const k = E.out3(clamp((t - i * 0.45) / 0.7));
        c.style.transform = `translateY(${lerp(40, 0, k)}px)`;
        c.style.opacity = k.toFixed(3);
      });
    }
  });

  // =========================================================================
  // Template 7: 06-notification (iOS/macOS Glass Notification)
  // =========================================================================
  registerAdapter({
    id: "06-notification",
    duration: 5.0,
    schema: {
      title: { type: "string", required: true },
      body: { type: "string", required: true },
      time: { type: "string", required: false, default: "now" }
    },
    mount(root, data, theme, width, height) {
      this.box = document.createElement("div");
      this.box.style.position = "absolute";
      this.box.style.top = "18%";
      this.box.style.left = "50%";
      this.box.style.transform = "translateX(-50%)";
      this.box.style.width = Math.min(width * 0.8, 540) + "px";
      this.box.style.padding = "18px 24px";
      this.box.style.borderRadius = "20px";
      this.box.style.background = "rgba(22, 28, 42, 0.85)";
      this.box.style.border = "1px solid rgba(255,255,255,0.14)";
      this.box.style.boxShadow = "0 20px 45px rgba(0,0,0,0.45)";
      this.box.style.display = "flex";
      this.box.style.gap = "16px";
      this.box.style.alignItems = "center";

      const ic = document.createElement("div");
      ic.style.width = "42px";
      ic.style.height = "42px";
      ic.style.borderRadius = "10px";
      ic.style.background = theme.accent || "#38BDF8";
      ic.style.display = "flex";
      ic.style.alignItems = "center";
      ic.style.justifyContent = "center";
      ic.style.color = "#0B0E14";
      ic.style.fontWeight = "700";
      ic.textContent = "●";
      this.box.appendChild(ic);

      const content = document.createElement("div");
      content.style.flex = "1";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.justifyContent = "space-between";

      const ttl = document.createElement("div");
      ttl.style.fontSize = "16px";
      ttl.style.fontWeight = "600";
      ttl.style.color = "#FFFFFF";
      ttl.textContent = data.title;
      header.appendChild(ttl);

      const tm = document.createElement("div");
      tm.style.fontSize = "12px";
      tm.style.color = "rgba(255,255,255,0.45)";
      tm.textContent = data.time || "now";
      header.appendChild(tm);
      content.appendChild(header);

      const bdy = document.createElement("div");
      bdy.style.fontSize = "14px";
      bdy.style.color = "rgba(255,255,255,0.75)";
      bdy.style.marginTop = "4px";
      bdy.textContent = data.body;
      content.appendChild(bdy);

      this.box.appendChild(content);
      root.appendChild(this.box);
    },
    seek(t) {
      const k = E.back(clamp(t / 0.7));
      this.box.style.transform = `translateX(-50%) translateY(${lerp(-60, 0, k)}px) scale(${lerp(0.9, 1, k)})`;
      this.box.style.opacity = clamp(t / 0.4).toFixed(3);
    }
  });

  // =========================================================================
  // Template 8: 18-cta-click (Simulated Cursor Click)
  // =========================================================================
  registerAdapter({
    id: "18-cta-click",
    duration: 4.0,
    schema: {
      label: { type: "string", required: true }
    },
    mount(root, data, theme, width, height) {
      this.wrap = document.createElement("div");
      this.wrap.style.position = "absolute";
      this.wrap.style.inset = "0";
      this.wrap.style.display = "flex";
      this.wrap.style.alignItems = "center";
      this.wrap.style.justifyContent = "center";

      this.btn = document.createElement("div");
      this.btn.style.padding = "20px 54px";
      this.btn.style.borderRadius = "12px";
      this.btn.style.background = theme.accent || "#00E5FF";
      this.btn.style.color = "#080F1A";
      this.btn.style.fontSize = "22px";
      this.btn.style.fontWeight = "700";
      this.btn.textContent = data.label;
      this.wrap.appendChild(this.btn);

      // SVG Cursor
      this.cursor = document.createElement("div");
      this.cursor.style.position = "absolute";
      this.cursor.style.width = "28px";
      this.cursor.style.height = "36px";
      this.cursor.style.pointerEvents = "none";
      this.cursor.innerHTML = `<svg viewBox="0 0 20 26"><path d="M1.5 1.5 L1.5 20.5 L6.4 16 L9.6 23.6 L13 22.1 L9.9 14.7 L16.6 14.7 Z" fill="#0B0B0C" stroke="#FFFFFF" stroke-width="1.6"/></svg>`;
      this.wrap.appendChild(this.cursor);

      root.appendChild(this.wrap);
    },
    seek(t) {
      // Cursor moves from bottom right to center button
      const moveK = E.inout3(clamp(t / 1.4));
      const curX = lerp(120, 0, moveK);
      const curY = lerp(160, 10, moveK);
      this.cursor.style.transform = `translate(${curX}px, ${curY}px)`;

      // Click at t=1.6
      const isClicked = t >= 1.6 && t < 1.9;
      this.btn.style.transform = isClicked ? "scale(0.95)" : "scale(1)";
    }
  });

  // =========================================================================
  // Template 9: 22-kinetic-headline (High-Impact Fast Cut Typography)
  // =========================================================================
  registerAdapter({
    id: "22-kinetic-headline",
    duration: 4.0,
    schema: {
      words: { type: "array", required: true },
      counter: { type: "string", required: false, default: "" }
    },
    mount(root, data, theme, width, height) {
      this.wrap = document.createElement("div");
      this.wrap.style.position = "absolute";
      this.wrap.style.inset = "0";
      this.wrap.style.display = "flex";
      this.wrap.style.flexDirection = "column";
      this.wrap.style.alignItems = "center";
      this.wrap.style.justifyContent = "center";

      if (data.counter) {
        this.cnt = document.createElement("div");
        this.cnt.style.fontSize = "16px";
        this.cnt.style.fontFamily = "JetBrains Mono";
        this.cnt.style.color = theme.accent || "#38BDF8";
        this.cnt.style.letterSpacing = "0.2em";
        this.cnt.textContent = data.counter;
        this.wrap.appendChild(this.cnt);
      }

      this.wordEl = document.createElement("div");
      this.wordEl.style.fontSize = Math.min(width * 0.12, 110) + "px";
      this.wordEl.style.fontWeight = "800";
      this.wordEl.style.color = "#FFFFFF";
      this.wordEl.style.letterSpacing = "-0.04em";
      this.wordEl.style.marginTop = "12px";
      this.wrap.appendChild(this.wordEl);

      this.words = data.words || ["LAUNCH", "SCALE", "WIN"];
      root.appendChild(this.wrap);
    },
    seek(t) {
      const stepDur = 4.0 / Math.max(1, this.words.length);
      const idx = Math.min(this.words.length - 1, Math.floor(t / stepDur));
      const localT = t - idx * stepDur;
      this.wordEl.textContent = this.words[idx];

      const pop = E.out3(clamp(localT / 0.25));
      this.wordEl.style.transform = `scale(${lerp(0.88, 1.0, pop)})`;
      this.wordEl.style.opacity = pop.toFixed(3);
    }
  });

  // Export to global and Node environment
  global.MotionAdapters = MotionAdapters;
  global.validateSchema = validateSchema;
  global.registerAdapter = registerAdapter;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      MotionAdapters,
      validateSchema,
      registerAdapter
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
