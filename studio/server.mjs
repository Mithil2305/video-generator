import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = process.env.PORT || 4350;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".wav": "audio/wav"
};

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 5 * 1024 * 1024) req.destroy(); });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  // 1. API: Plan Storyboard (Call director.py)
  if (pathname === "/api/plan" && req.method === "POST") {
    try {
      const data = await parseBody(req);
      const prompt = data.prompt || "An animated story";
      const args = [path.join(ROOT, "director.py"), prompt, "--json"];
      if (data.category) args.push("--category", data.category);
      if (data.style) args.push("--style", data.style);
      if (data.format) args.push("--format", data.format);
      if (data.duration) args.push("--duration", String(data.duration));
      if (data.mood) args.push("--mood", data.mood);

      const pyBin = process.platform === "win32" ? "python" : "python3";
      const py = spawn(pyBin, args, { cwd: ROOT });
      let out = "", err = "";
      py.stdout.on("data", (d) => { out += d; });
      py.stderr.on("data", (d) => { err += d; });
      py.on("close", (code) => {
        if (code === 0) {
          try {
            const plan = JSON.parse(out);
            sendJson(res, 200, { success: true, plan });
          } catch (e) {
            sendJson(res, 500, { error: "Failed to parse director output", raw: out });
          }
        } else {
          sendJson(res, 500, { error: "Director execution failed", details: err });
        }
      });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // 2. API: Save Plan
  if (pathname === "/api/save-plan" && req.method === "POST") {
    try {
      const data = await parseBody(req);
      const name = data.name || "untitled-animation";
      const projDir = path.join(ROOT, "launches", name);
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, "plan.json"), JSON.stringify(data, null, 2));
      sendJson(res, 200, { success: true, project: name });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // 3. API: Render with Server-Sent Events (SSE) Live Progress
  if (pathname === "/api/render" && req.method === "GET") {
    const projName = url.searchParams.get("project");
    const draft = url.searchParams.get("draft") === "true";
    if (!projName) { sendJson(res, 400, { error: "Missing project query parameter" }); return; }

    const projDir = path.join(ROOT, "launches", projName);
    if (!fs.existsSync(path.join(projDir, "plan.json"))) {
      sendJson(res, 404, { error: `Project plan not found: ${projName}` });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent("start", { project: projName, stage: "Starting renderer" });

    const renderArgs = [path.join(ROOT, "engine", "render.mjs"), projDir];
    if (draft) renderArgs.push("--draft");

    const renderProc = spawn("node", renderArgs, { cwd: ROOT });

    renderProc.stdout.on("data", (chunk) => {
      const str = chunk.toString();
      sendEvent("progress", { message: str.trim() });
    });

    renderProc.stderr.on("data", (chunk) => {
      sendEvent("log", { message: chunk.toString().trim() });
    });

    renderProc.on("close", (code) => {
      if (code === 0) {
        // Run validation
        const pyBin = process.platform === "win32" ? "python" : "python3";
        const valProc = spawn(pyBin, [path.join(ROOT, "validator.py"), projDir, "--json"], { cwd: ROOT });
        let valOut = "";
        valProc.stdout.on("data", (d) => { valOut += d; });
        valProc.on("close", () => {
          let report = null;
          try { report = JSON.parse(valOut); } catch (e) { }
          sendEvent("complete", { success: true, project: projName, validation: report });
          res.end();
        });
      } else {
        sendEvent("error", { error: "Rendering process failed with exit code " + code });
        res.end();
      }
    });

    req.on("close", () => {
      renderProc.kill();
    });
    return;
  }

  // 4. API: Validate Project Video
  if (pathname.startsWith("/api/validate/")) {
    const projName = pathname.replace("/api/validate/", "").trim();
    const projDir = path.join(ROOT, "launches", projName);
    const pyBin = process.platform === "win32" ? "python" : "python3";
    const val = spawn(pyBin, [path.join(ROOT, "validator.py"), projDir, "--json"], { cwd: ROOT });
    let out = "";
    val.stdout.on("data", (d) => { out += d; });
    val.on("close", () => {
      try { sendJson(res, 200, JSON.parse(out)); }
      catch (e) { sendJson(res, 500, { error: "Validation parse error", raw: out }); }
    });
    return;
  }

  // 5. API: List Projects
  if (pathname === "/api/projects") {
    const launchesDir = path.join(ROOT, "launches");
    const projects = [];
    if (fs.existsSync(launchesDir)) {
      for (const f of fs.readdirSync(launchesDir)) {
        const planP = path.join(launchesDir, f, "plan.json");
        if (fs.existsSync(planP)) {
          try {
            const p = JSON.parse(fs.readFileSync(planP, "utf8"));
            const videoP = path.join(launchesDir, f, "out", `${p.name || f}.mp4`);
            projects.push({
              name: f,
              title: p.title || p.name || f,
              category: p.category || "business",
              style: p.style || "motion_graphics",
              format: p.format || "16:9",
              scenes: (p.scenes || []).length,
              hasVideo: fs.existsSync(videoP)
            });
          } catch (e) { }
        }
      }
    }
    sendJson(res, 200, { projects });
    return;
  }

  // 6. Serve Rendered Video Stream with Range Support
  if (pathname.startsWith("/media/video/")) {
    const projName = pathname.replace("/media/video/", "");
    const projDir = path.join(ROOT, "launches", projName);
    const videoFile = fs.readdirSync(path.join(projDir, "out")).find((f) => f.endsWith(".mp4") && !f.includes(".video.mp4"));
    if (!videoFile) { sendJson(res, 404, { error: "No video found" }); return; }

    const filePath = path.join(projDir, "out", videoFile);
    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "video/mp4",
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": stat.size,
        "Content-Type": "video/mp4",
      });
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // 7. Serve Static Files for Studio UI
  let filePath = path.join(HERE, pathname === "/" ? "index.html" : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT, pathname);
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } else {
    sendJson(res, 404, { error: "File not found" });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const nextPort = Number(PORT) + 1;
    console.warn(`⚠️ Port ${PORT} is already in use. Retrying on port ${nextPort}...`);
    server.listen(nextPort, () => {
      console.log(`\n======================================================`);
      console.log(`✨ ANIMATION STUDIO ONLINE`);
      console.log(`🚀 Open in your browser: http://127.0.0.1:${nextPort}`);
      console.log(`======================================================\n`);
    });
  } else {
    console.error("Server error:", err);
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`✨ ANIMATION STUDIO ONLINE`);
  console.log(`🚀 Open in your browser: http://127.0.0.1:${PORT}`);
  console.log(`======================================================\n`);
});

