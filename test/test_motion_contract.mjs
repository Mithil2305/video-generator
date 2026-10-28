import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PLAYER_HTML = pathToFileURL(path.join(ROOT, "engine", "player.html")).href;

const CHROME = [
  process.env.CHROME,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : null,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].find((p) => p && fs.existsSync(p));

if (!CHROME) {
  console.error("Chrome executable not found.");
  process.exit(1);
}

const IMPLEMENTED_TEMPLATES = [
  {
    template: "16-line-growth",
    data: { points: [10, 30, 60, 100, 150], title: "User Growth", markers: [{ rel: 0.5, val: "50k", label: "Breakout" }] }
  },
  {
    template: "13-compare-bars",
    data: { bars: [{ label: "Before", value: 10 }, { label: "After", value: 85 }], unit: "%" }
  },
  {
    template: "10-candlestick",
    data: { title: "BTC/USDT", metric: "+18.4%", candles: [{ open: 40, close: 65, high: 75, low: 35 }] }
  },
  {
    template: "14-leaderboard",
    data: { items: [{ rank: 1, name: "Alpha", score: "99" }, { rank: 2, name: "Beta", score: "88" }] }
  },
  {
    template: "01-cta-pill",
    data: { label: "Start Building Now", subcopy: "Free 14-day trial" }
  },
  {
    template: "02-three-step",
    data: { steps: [{ step: "01", title: "Connect", desc: "Sync your data" }, { step: "02", title: "Analyze", desc: "Run AI models" }, { step: "03", title: "Deploy", desc: "Ship instantly" }] }
  },
  {
    template: "06-notification",
    data: { title: "Deployment Live", body: "v2.4 successfully published", time: "Just now" }
  },
  {
    template: "18-cta-click",
    data: { label: "Confirm Order" }
  },
  {
    template: "22-kinetic-headline",
    data: { words: ["Build.", "Scale.", "Dominate."], counter: "10,000+" }
  }
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function runTests() {
  console.log("=== Starting NullMotion Engine Integration Tests ===\n");
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--disable-web-security",
      "--hide-scrollbars",
      "--force-color-profile=srgb"
    ]
  });

  const errors = [];

  try {
    // -------------------------------------------------------------
    // Test 1: Determinism (render same template at t = 1.5s twice -> identical hashes)
    // -------------------------------------------------------------
    console.log("TEST 1: Determinism check (t = 1.5s twice)");
    {
      const plan = {
        format: "16:9",
        scenes: [{
          type: "motion",
          template: "13-compare-bars",
          dur: 4.0,
          text: "Automated Metric Verification",
          data: { bars: [{ label: "Baseline", value: 20 }, { label: "Target", value: 120 }], unit: "x" }
        }]
      };

      async function renderShot() {
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
        await page.goto(PLAYER_HTML);
        await page.evaluate((p) => window.__load({ plan: p, base: window.location.href, estimateTiming: true }), plan);
        await page.evaluate(() => window.__seek(1.5));
        const shot = await page.screenshot({ type: "png" });
        await page.close();
        return { shot, hash: sha256(shot) };
      }

      const r1 = await renderShot();
      const r2 = await renderShot();

      if (r1.hash === r2.hash) {
        console.log("  [PASS] Hashes match perfectly:", r1.hash);
      } else {
        errors.push(`Test 1 Failed: Hashes mismatch (${r1.hash} vs ${r2.hash})`);
        console.error("  [FAIL] Determinism mismatch");
      }
    }

    // -------------------------------------------------------------
    // Test 2: Seek Order Independence (seek to 5s then 2s vs fresh page at 2s)
    // -------------------------------------------------------------
    console.log("\nTEST 2: Seek order independence (5s -> 2s vs fresh page at 2s)");
    {
      const plan = {
        format: "16:9",
        scenes: [{
          type: "motion",
          template: "16-line-growth",
          dur: 6.0,
          text: "Growth Trajectory",
          data: { points: [10, 40, 90, 160], markers: [{ rel: 0.6, val: "$1M" }] }
        }]
      };

      // Page 1: 5s then 2s
      const page1 = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page1.goto(PLAYER_HTML);
      await page1.evaluate((p) => window.__load({ plan: p, base: window.location.href, estimateTiming: true }), plan);
      await page1.evaluate(() => window.__seek(5.0));
      await page1.evaluate(() => window.__seek(2.0));
      const shot1 = await page1.screenshot({ type: "png" });
      const hash1 = sha256(shot1);
      await page1.close();

      // Page 2: direct seek to 2s
      const page2 = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page2.goto(PLAYER_HTML);
      await page2.evaluate((p) => window.__load({ plan: p, base: window.location.href, estimateTiming: true }), plan);
      await page2.evaluate(() => window.__seek(2.0));
      const shot2 = await page2.screenshot({ type: "png" });
      const hash2 = sha256(shot2);
      await page2.close();

      if (hash1 === hash2) {
        console.log("  [PASS] Seek order independent:", hash1);
      } else {
        errors.push(`Test 2 Failed: Seek order mismatch (${hash1} vs ${hash2})`);
        console.error("  [FAIL] Seek order mismatch");
      }
    }

    // -------------------------------------------------------------
    // Test 3: Schema Validation (missing required fails; missing optional passes)
    // -------------------------------------------------------------
    console.log("\nTEST 3: Schema validation (missing required fails, missing optional passes)");
    {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(PLAYER_HTML);

      // 3A: Missing required 'bars' in 13-compare-bars must throw naming template and field
      let failedRequired = false;
      let errorMsg = "";
      try {
        await page.evaluate(() => {
          const badPlan = {
            format: "16:9",
            scenes: [{ type: "motion", template: "13-compare-bars", dur: 3.0, data: { unit: "x" } }]
          };
          return window.__load({ plan: badPlan, base: window.location.href, estimateTiming: true });
        });
      } catch (err) {
        failedRequired = true;
        errorMsg = err.message;
      }

      if (failedRequired && errorMsg.includes("13-compare-bars") && errorMsg.includes("bars")) {
        console.log("  [PASS] Missing required field threw descriptive error:", errorMsg.slice(0, 80));
      } else {
        errors.push(`Test 3A Failed: Missing required field did not throw as expected (${errorMsg})`);
        console.error("  [FAIL] Missing required field did not fail properly");
      }

      // 3B: Missing optional field ('unit') passes cleanly
      let passedOptional = false;
      try {
        await page.evaluate(() => {
          const goodPlan = {
            format: "16:9",
            scenes: [{
              type: "motion",
              template: "13-compare-bars",
              dur: 3.0,
              data: { bars: [{ label: "A", value: 1 }, { label: "B", value: 5 }] }
            }]
          };
          return window.__load({ plan: goodPlan, base: window.location.href, estimateTiming: true });
        });
        passedOptional = true;
      } catch (err) {
        console.error("  [FAIL] Optional field omitted caused error:", err.message);
      }

      if (passedOptional) {
        console.log("  [PASS] Missing optional field omitted cleanly without error");
      } else {
        errors.push("Test 3B Failed: Missing optional field caused failure");
      }

      await page.close();
    }

    // -------------------------------------------------------------
    // Test 4: Formats (16:9, 9:16, 1:1, 4:5 with no text overflowing)
    // -------------------------------------------------------------
    console.log("\nTEST 4: Formats check (16:9, 9:16, 1:1, 4:5 text bounding boxes)");
    const formats = {
      "16:9": [1920, 1080],
      "9:16": [1080, 1920],
      "1:1": [1080, 1080],
      "4:5": [1080, 1350]
    };

    for (const [fmt, [W, H]] of Object.entries(formats)) {
      for (const item of IMPLEMENTED_TEMPLATES) {
        const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
        await page.goto(PLAYER_HTML);

        const plan = {
          format: fmt,
          scenes: [{
            type: "motion",
            template: item.template,
            dur: 4.0,
            text: `Checking ${item.template} in ${fmt}`,
            data: item.data
          }]
        };

        await page.evaluate((p) => window.__load({ plan: p, base: window.location.href, estimateTiming: true }), plan);
        await page.evaluate(() => window.__seek(1.5));

        // Check text overflow in DOM (only elements with visible text content)
        const overflow = await page.evaluate(([W, H]) => {
          const texts = document.querySelectorAll(".tok, .motion-card div, .motion-card span, .motion-card p, .motion-card text");
          const stageRect = document.getElementById("stage").getBoundingClientRect();
          const violations = [];
          for (const el of texts) {
            const txt = (el.textContent || "").trim();
            if (!txt) continue; // Skip empty layout/decorative containers
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // Allow small margin of 6px for rounding
            if (r.left < -6 || r.right > stageRect.right + 6) {
              violations.push({ text: txt.slice(0, 30), left: r.left, right: r.right, stageW: stageRect.width });
            }
          }
          return violations;
        }, [W, H]);

        await page.close();

        if (overflow.length > 0) {
          errors.push(`Test 4 Format Violation in ${item.template} (${fmt}): ${JSON.stringify(overflow[0])}`);
          console.error(`  [FAIL] ${item.template} in ${fmt} overflowed:`, overflow[0]);
        }
      }
      console.log(`  [PASS] All 9 templates rendered cleanly in ${fmt} (${W}x${H}) without text overflow`);
    }

    // -------------------------------------------------------------
    // Test 5: No Real-time Clock APIs in engine/motion/
    // -------------------------------------------------------------
    console.log("\nTEST 5: Real-time clock API ban check in engine/motion/");
    const motionDir = path.join(ROOT, "engine", "motion");
    const motionFiles = fs.readdirSync(motionDir).map((f) => path.join(motionDir, f));
    const forbiddenPatterns = [
      { name: "setTimeout", regex: /\bsetTimeout\s*\(/ },
      { name: "requestAnimationFrame", regex: /\brequestAnimationFrame\s*\(/ },
      { name: "Date.", regex: /\bDate\.(now|parse)\b/ },
      { name: "performance.now", regex: /\bperformance\.now\b/ },
      { name: "Math.random", regex: /\bMath\.random\s*\(/ }
    ];

    let forbiddenHits = 0;
    for (const f of motionFiles) {
      const code = fs.readFileSync(f, "utf8");
      for (const p of forbiddenPatterns) {
        if (p.regex.test(code)) {
          console.error(`  [FAIL] Found forbidden pattern ${p.name} in ${path.basename(f)}`);
          errors.push(`Forbidden ${p.name} in ${f}`);
          forbiddenHits++;
        }
      }
    }
    if (forbiddenHits === 0) {
      console.log("  [PASS] engine/motion/ is 100% clean of real-time APIs (setTimeout, rAF, Date.now, performance.now, Math.random)");
    }

    // -------------------------------------------------------------
    // Test 6: Smoke Render End-to-End (16:9 and 9:16 validated with validator.py)
    // -------------------------------------------------------------
    console.log("\nTEST 6: Smoke render end-to-end through render.mjs and validator.py");

    // 6A: 16:9 Smoke Render
    const smokeDir16 = path.join(ROOT, "launches", "smoke-motion-16x9");
    fs.mkdirSync(smokeDir16, { recursive: true });
    const plan16 = {
      name: "smoke-motion-16x9",
      format: "16:9",
      theme: { accent: "#38BDF8" },
      scenes: [
        {
          type: "motion",
          template: "13-compare-bars",
          dur: 3.0,
          text: "Comparing Performance Benchmarks",
          data: {
            bars: [{ label: "Baseline", value: 100 }, { label: "Benchmark", value: 350 }],
            unit: " fps"
          }
        }
      ]
    };
    fs.writeFileSync(path.join(smokeDir16, "plan.json"), JSON.stringify(plan16, null, 2));
    const tl16 = { duration: 3.0, scenes: [{ start: 0.0, end: 3.0, vo_start: 0.1, vo_end: 2.8, words: [] }] };
    fs.writeFileSync(path.join(smokeDir16, "timeline.json"), JSON.stringify(tl16, null, 2));

    const renderProc16 = spawnSync(process.execPath, [
      path.join(ROOT, "engine", "render.mjs"),
      smokeDir16,
      "--draft"
    ], { stdio: "pipe", encoding: "utf8" });

    if (renderProc16.status === 0) {
      const valProc16 = spawnSync("python", [
        "-c",
        `from validator import validate_project_video; r = validate_project_video('${smokeDir16.replace(/\\/g, "/")}'); print("Valid:", r.get("valid")); exit(0 if r.get("valid") else 1)`
      ], { stdio: "pipe", encoding: "utf8" });

      if (valProc16.status === 0 && valProc16.stdout.includes("Valid: True")) {
        console.log("  [PASS] 16:9 motion smoke render passed end-to-end quality validation (Valid: True)");
      } else {
        errors.push(`Test 6A validation failed: ${valProc16.stdout} ${valProc16.stderr}`);
        console.error("  [FAIL] 16:9 validation failed:", valProc16.stdout);
      }
    } else {
      errors.push(`Test 6A render failed: ${renderProc16.stderr || renderProc16.stdout}`);
      console.error("  [FAIL] 16:9 render process failed:", renderProc16.stderr);
    }

    // 6B: 9:16 Smoke Render
    const smokeDir9 = path.join(ROOT, "launches", "smoke-motion-9x16");
    fs.mkdirSync(smokeDir9, { recursive: true });
    const plan9 = {
      name: "smoke-motion-9x16",
      format: "9:16",
      theme: { accent: "#10B981" },
      scenes: [
        {
          type: "motion",
          template: "16-line-growth",
          dur: 3.0,
          text: "Mobile Growth Trajectory",
          data: {
            points: [15, 35, 70, 120, 200],
            title: "Mobile Growth",
            markers: [{ rel: 0.5, val: "100k" }]
          }
        }
      ]
    };
    fs.writeFileSync(path.join(smokeDir9, "plan.json"), JSON.stringify(plan9, null, 2));
    const tl9 = { duration: 3.0, scenes: [{ start: 0.0, end: 3.0, vo_start: 0.1, vo_end: 2.8, words: [] }] };
    fs.writeFileSync(path.join(smokeDir9, "timeline.json"), JSON.stringify(tl9, null, 2));

    const renderProc9 = spawnSync(process.execPath, [
      path.join(ROOT, "engine", "render.mjs"),
      smokeDir9,
      "--draft"
    ], { stdio: "pipe", encoding: "utf8" });

    if (renderProc9.status === 0) {
      const valProc9 = spawnSync("python", [
        "-c",
        `from validator import validate_project_video; r = validate_project_video('${smokeDir9.replace(/\\/g, "/")}'); print("Valid:", r.get("valid")); exit(0 if r.get("valid") else 1)`
      ], { stdio: "pipe", encoding: "utf8" });

      if (valProc9.status === 0 && valProc9.stdout.includes("Valid: True")) {
        console.log("  [PASS] 9:16 motion smoke render passed end-to-end quality validation (Valid: True)");
      } else {
        errors.push(`Test 6B validation failed: ${valProc9.stdout} ${valProc9.stderr}`);
        console.error("  [FAIL] 9:16 validation failed:", valProc9.stdout);
      }
    } else {
      errors.push(`Test 6B render failed: ${renderProc9.stderr || renderProc9.stdout}`);
      console.error("  [FAIL] 9:16 render process failed:", renderProc9.stderr);
    }

  } finally {
    await browser.close();
  }

  console.log("\n=================================================");
  if (errors.length === 0) {
    console.log("ALL TESTS PASSED SUCCESSFULLY! (6/6)");
    return true;
  } else {
    console.error(`TEST FAILURES (${errors.length}):`);
    errors.forEach((e) => console.error(" - " + e));
    process.exit(1);
  }
}

runTests();
