#!/usr/bin/env node
// Render a launch-video project: player.html frames in headless Chrome -> ffmpeg -> mux with the audio mix.
//
//   node render.mjs <project>                 full render -> <project>/out/<name>.mp4 (+ -review.mp4 at 720p)
//   node render.mjs <project> --draft         half size, 15 fps, quick look at timing
//   node render.mjs <project> --still 3.2,10  PNG frames -> <project>/out/stills/
//   node render.mjs <project> --board         one frame per scene on a contact sheet -> <project>/out/board.jpg
//   options: --fps 30  --workers 4  --from 5 --to 12  --no-audio --estimate-timing
import { chromium } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (!argv[0] || argv[0].startsWith("--")) { console.error("usage: node render.mjs <project> [--draft|--still t,t|--board]"); process.exit(1); }
const PROJ = path.resolve(argv[0]);
const plan = JSON.parse(fs.readFileSync(path.join(PROJ, "plan.json"), "utf8"));
const tlPath = path.join(PROJ, "timeline.json");
const timeline = fs.existsSync(tlPath) ? JSON.parse(fs.readFileSync(tlPath, "utf8")) : null;
const OUT = path.join(PROJ, "out");
fs.mkdirSync(OUT, { recursive: true });
const name = plan.name || path.basename(PROJ);
const draft = flag("draft");
const fps = Number(opt("fps", draft ? 15 : plan.fps || 30));
const scale = draft ? 0.5 : Number(opt("scale", 1));
const workers = Number(opt("workers", 4));

// RN-09: Review constants
const TARGET_REVIEW_SIZE_MB = 14;
const AUDIO_BITRATE_KBPS = 160;

// PL-02: Stale timeline verification
const curPlanSha = crypto.createHash("sha256").update(fs.readFileSync(path.join(PROJ, "plan.json"))).digest("hex");
if (timeline && timeline.plan_sha256 && timeline.plan_sha256 !== curPlanSha && !flag("estimate-timing")) {
  throw new Error("timeline.json is stale: re-run `vo.py build` (or pass --estimate-timing)");
}

// RN-07: Reject plan media paths that resolve outside project folder or root assets
const ROOT_ASSETS = path.resolve(HERE, "..", "assets");
for (const sc of plan.scenes || []) {
  if (sc.src) {
    const resPath = path.resolve(PROJ, sc.src);
    if (!resPath.startsWith(PROJ) && !resPath.startsWith(ROOT_ASSETS)) {
      throw new Error(`Security violation: scene media path "${sc.src}" resolves outside project root`);
    }
  }
}
if (plan.brand && plan.brand.mark) {
  const markPath = path.resolve(PROJ, plan.brand.mark);
  if (!markPath.startsWith(PROJ) && !markPath.startsWith(ROOT_ASSETS)) {
    throw new Error(`Security violation: brand mark path "${plan.brand.mark}" resolves outside project root`);
  }
}


// Auto-resolve ffmpeg path across platforms and ensure Windows PATH includes WinGet links
if (process.platform === "win32") {
  const extraPaths = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links") : null,
    "C:\\ProgramData\\chocolatey\\bin",
  ].filter((p) => p && fs.existsSync(p));
  if (extraPaths.length) {
    process.env.PATH = `${extraPaths.join(";")};${process.env.PATH}`;
  }
}

const FFMPEG = [
  process.env.FFMPEG,
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe") : null,
  "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg"
].find((p) => p && fs.existsSync(p)) || "ffmpeg";

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

// RN-08: Clear actionable error if Chrome is missing
if (!CHROME) {
  console.error("Chrome executable not found. Please install Google Chrome, set CHROME environment variable, or run: npx playwright install chromium");
  process.exit(1);
}

let browser = null;
const segs = [];
let pageFault = null;

try {
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--disable-web-security",
      "--autoplay-policy=no-user-gesture-required",
      "--hide-scrollbars",
      "--force-color-profile=srgb"
    ]
  });

  const data = {
    plan,
    timeline,
    base: pathToFileURL(PROJ).href + "/",
    estimateTiming: flag("estimate-timing")
  };

  async function openPage() {
    const FMT = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] }[plan.format || "16:9"];
    const ctx = await browser.newContext({ viewport: { width: FMT[0], height: FMT[1] }, deviceScaleFactor: scale });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text()); });
    // RN-06: Record page faults
    page.on("pageerror", (e) => {
      pageFault = pageFault || e;
      console.error("[page error]", e.message);
    });
    await page.goto(pathToFileURL(path.join(HERE, "player.html")).href);
    const info = await page.evaluate((d) => window.__load(d), data);
    return { page, info };
  }

  const shot = async (page, t, type = "png") => {
    // RN-06: Stop render immediately on page error
    if (pageFault) throw new Error("page error during render: " + pageFault.message);
    await page.evaluate((t) => window.__seek(t), t);
    return page.screenshot(type === "png" ? { type: "png" } : { type: "jpeg", quality: 93 });
  };

  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], timeout: 120000 });
    if (r.status !== 0) throw new Error(`${cmd} failed`);
  };

  const { page, info } = await openPage();
  if (info.estimated) console.log("note: timing is estimated (run vo.py to record exact voice-over timing)");
  const D = info.duration;
  console.log(`${name}: ${info.W}x${info.H}, ${D.toFixed(2)} s, ${info.scenes.length} scenes`);
  info.scenes.forEach((s, i) => console.log(`  ${String(i).padStart(2)} ${s.start.toFixed(2).padStart(6)}  ${s.type.padEnd(9)} ${(plan.scenes[i].vo || plan.scenes[i].text || "").slice(0, 70)}`));

  if (opt("still")) {
    const dir = path.join(OUT, "stills"); fs.mkdirSync(dir, { recursive: true });
    for (const t of String(opt("still")).split(",").map(Number)) {
      const f = path.join(dir, `t${t.toFixed(2)}.png`);
      fs.writeFileSync(f, await shot(page, t, "png")); console.log("still", f);
    }
    await browser.close();
    process.exit(0);
  }

  if (flag("board")) {
    const dir = path.join(OUT, "board"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const at = info.scenes.map((s) => s.start + Math.min(s.end - s.start - 0.3, Math.max(0.6, (s.end - s.start) * 0.72)));
    const cols = 4, n = Math.ceil(at.length / cols) * cols;
    for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, `${String(i).padStart(3, "0")}.jpg`), await shot(page, at[Math.min(i, at.length - 1)], "jpeg"));
    run(FFMPEG, ["-v", "error", "-y", "-i", path.join(dir, "%03d.jpg"), "-vf", `scale=480:-1,tile=${cols}x${n / cols}:padding=6:color=0x222222`, "-frames:v", "1", path.join(OUT, "board.jpg")]);
    console.log("board", path.join(OUT, "board.jpg"));
    await browser.close();
    process.exit(0);
  }

  // ---- full render ----
  const t0 = Number(opt("from", 0)), t1 = Math.min(D, Number(opt("to", D)));
  const total = Math.round((t1 - t0) * fps);

  // RN-01: Clamp worker count so no worker gets an empty range
  const N = Math.max(1, Math.min(workers, total));
  const per = Math.ceil(total / N);
  const jobs = [...Array(N)].map((_, k) => [k, k * per, Math.min(total, (k + 1) * per)]).filter(([, a, b]) => b > a);

  const started = Date.now();
  let done = 0;

  // RN-02: Use PNG pipe for final, JPEG pipe for draft
  const captureType = draft ? "jpeg" : "png";
  const pipeCodec = draft ? "mjpeg" : "png";

  async function renderRange(k, a, b, pg) {
    const seg = path.join(OUT, `.seg${k}.mp4`);
    segs[k] = seg;
    const ff = spawn(FFMPEG, [
      "-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", pipeCodec, "-i", "-",
      "-c:v", "libx264", "-preset", draft ? "veryfast" : "medium", "-crf", draft ? "23" : "16",
      "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-r", String(fps), seg
    ]);
    const closed = new Promise((ok, bad) => ff.on("close", (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg segment ${k} failed with code ${c}`)))));

    for (let f = a; f < b; f++) {
      if (pageFault) {
        ff.stdin.end();
        throw new Error("page error during render: " + pageFault.message);
      }
      const buf = await shot(pg, t0 + f / fps, captureType);
      if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once("drain", ok));
      done++;
      if (done % 60 === 0) process.stdout.write(`\r  ${done}/${total} frames  ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await closed;
  }

  const pages = [page];
  for (let k = 1; k < jobs.length; k++) {
    pages.push((await openPage()).page);
  }
  await Promise.all(jobs.map(([k, a, b], idx) => renderRange(k, a, b, pages[idx])));
  process.stdout.write(`\r  ${total}/${total} frames  ${((Date.now() - started) / 1000).toFixed(0)} s\n`);

  const cues = await page.evaluate(() => window.__cues());
  fs.writeFileSync(path.join(OUT, "cues.json"), JSON.stringify(cues.map((c) => ({ ...c, t: +(c.t - t0).toFixed(3) })).filter((c) => c.t >= 0 && c.t < t1 - t0), null, 0));

  await browser.close();
  browser = null;

  const list = path.join(OUT, ".segs.txt");
  fs.writeFileSync(list, segs.filter(Boolean).map((s) => `file '${s}'`).join("\n"));
  const silent = path.join(OUT, ".video.mp4");
  run(FFMPEG, ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);

  // Clean up segment files
  segs.forEach((s) => s && fs.existsSync(s) && fs.rmSync(s, { force: true }));
  if (fs.existsSync(list)) fs.rmSync(list, { force: true });

  const final = path.join(OUT, `${name}${draft ? "-draft" : ""}.mp4`);
  let audio = null;
  if (!flag("no-audio")) {
    const pyBin = process.platform === "win32" ? "python" : "python3";
    const py = spawnSync(pyBin, [path.join(HERE, "..", "audio.py"), "mix", PROJ, "--from", String(t0), "--to", String(t1)], { stdio: "inherit", timeout: 120000 });
    const mix = path.join(OUT, "mix.wav");
    if (py.status === 0 && fs.existsSync(mix)) audio = mix;
    else console.error("audio mix failed; writing a silent video");
  }

  // RN-03: Mux final video with bt709 color tags
  run(FFMPEG, [
    "-v", "error", "-y", "-i", silent,
    ...(audio ? ["-i", audio, "-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
    "-c:v", "copy",
    "-movflags", "+faststart",
    final
  ]);
  if (fs.existsSync(silent)) fs.rmSync(silent, { force: true });
  console.log("video", final);

  if (!draft) {
    const review = path.join(OUT, `${name}-review.mp4`);
    const kbps = Math.max(800, Math.min(5000, Math.floor((TARGET_REVIEW_SIZE_MB * 8192) / Math.max(1, t1 - t0)) - AUDIO_BITRATE_KBPS));
    run(FFMPEG, [
      "-v", "error", "-y", "-i", final,
      "-vf", "scale=-2:720,format=yuv420p",
      "-c:v", "libx264", "-preset", "medium", "-crf", "22",
      "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      review
    ]);
    console.log("review", review);
  }

  // Cross-cutting / PK-05: Write out/result.json
  const result = {
    project: name,
    video_path: final,
    plan_sha256: curPlanSha,
    timing: timeline ? (timeline.timing || "exact") : "estimated",
    browser_version: "Chromium (Playwright)",
    draft,
    fps,
    duration: D,
    rendered_at: new Date().toISOString()
  };
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));

} finally {
  // RN-05: Clean up browser and temp files on failure
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
  for (const s of segs) {
    if (s && fs.existsSync(s)) {
      try { fs.rmSync(s, { force: true }); } catch (_) {}
    }
  }
  const leftoverList = path.join(OUT, ".segs.txt");
  if (fs.existsSync(leftoverList)) {
    try { fs.rmSync(leftoverList, { force: true }); } catch (_) {}
  }
  const leftoverVideo = path.join(OUT, ".video.mp4");
  if (fs.existsSync(leftoverVideo)) {
    try { fs.rmSync(leftoverVideo, { force: true }); } catch (_) {}
  }
}
