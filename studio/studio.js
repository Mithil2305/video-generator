// Universal Animation Studio Client Controller

const EXAMPLES = [
  {
    category: "storytelling",
    style: "cinematic",
    mood: "cinematic",
    label: "🤖 Lonely Robot on Mars",
    prompt: "A 45-second animated story about a lonely robot discovering a garden on Mars."
  },
  {
    category: "educational",
    style: "whiteboard",
    mood: "lofi",
    label: "⚛️ Quantum Computing 101",
    prompt: "Explain how quantum computers use superposition and entanglement in 30 seconds."
  },
  {
    category: "cinematic",
    style: "cyberpunk",
    mood: "synthwave",
    label: "🌆 Cyberpunk Rain City",
    prompt: "Atmospheric sci-fi sequence of a detective walking through neon rain in Neo-Tokyo."
  },
  {
    category: "specialized",
    style: "motion_graphics",
    mood: "corporate",
    label: "📈 Financial Market Shift",
    prompt: "Data-driven breakdown of market volatility, support floors, and 10x growth surges."
  },
  {
    category: "social",
    style: "motion_graphics",
    mood: "synthwave",
    label: "📱 Viral TikTok Hook",
    prompt: "High-retention 9:16 kinetic text video revealing the 1 habit that doubles focus."
  },
  {
    category: "storytelling",
    style: "fantasy",
    mood: "ambient",
    label: "✨ Starborn Wanderer",
    prompt: "Fantasy story of an ancient astronomer whose telescope discovers living celestial light."
  },
  {
    category: "business",
    style: "motion_graphics",
    mood: "corporate",
    label: "🚀 SaaS Turnaround",
    prompt: "Product launch showing how automated decision intelligence halts margin leaks."
  }
];

let currentPlan = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  setupExamples();
  setupEventListeners();
  loadProjectList();
});

function setupExamples() {
  const container = document.getElementById("exampleChips");
  EXAMPLES.forEach((ex) => {
    const btn = document.createElement("button");
    btn.className = "chip-btn";
    btn.textContent = ex.label;
    btn.onclick = () => {
      document.getElementById("promptInput").value = ex.prompt;
      document.getElementById("categorySelect").value = ex.category;
      document.getElementById("styleSelect").value = ex.style;
      document.getElementById("moodSelect").value = ex.mood;
    };
    container.appendChild(btn);
  });
}

function setupEventListeners() {
  // Duration slider
  const slider = document.getElementById("durSlider");
  const durVal = document.getElementById("durVal");
  slider.oninput = () => { durVal.textContent = `${slider.value}s`; };

  // Tab switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("tab-storyboard").style.display = tab === "storyboard" ? "block" : "none";
      document.getElementById("tab-preview").style.display = tab === "preview" ? "block" : "none";
      document.getElementById("tab-validation").style.display = tab === "validation" ? "block" : "none";
    };
  });

  // Plan Button
  document.getElementById("planBtn").onclick = planStoryboard;

  // Render Buttons
  document.getElementById("renderBtn").onclick = () => renderVideo(false);
  document.getElementById("draftBtn").onclick = () => renderVideo(true);

  // Save changes button
  document.getElementById("savePlanBtn").onclick = saveCurrentPlan;

  // Add scene button
  document.getElementById("addSceneBtn").onclick = addNewScene;
}

async function planStoryboard() {
  const prompt = document.getElementById("promptInput").value.trim();
  if (!prompt) {
    alert("Please enter a creative prompt first.");
    return;
  }

  const planBtn = document.getElementById("planBtn");
  planBtn.disabled = true;
  planBtn.innerHTML = `<span>⏳</span> Planning with AI Director...`;

  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        category: document.getElementById("categorySelect").value,
        style: document.getElementById("styleSelect").value,
        format: document.getElementById("formatSelect").value,
        duration: parseFloat(document.getElementById("durSlider").value),
        mood: document.getElementById("moodSelect").value,
      })
    });
    const data = await res.json();
    if (data.success && data.plan) {
      currentPlan = data.plan;
      renderStoryboard(currentPlan);
    } else {
      alert("Planning failed: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Network error: " + err.message);
  } finally {
    planBtn.disabled = false;
    planBtn.innerHTML = `<span>✨</span> Plan Storyboard`;
  }
}

function renderStoryboard(plan) {
  document.getElementById("projectTitle").textContent = plan.title || plan.name;
  document.getElementById("projectMeta").textContent =
    `Category: ${plan.category.toUpperCase()} | Style: ${plan.style} | Format: ${plan.format} | Duration: ~${plan.scenes.reduce((a, s) => a + (s.dur || 5), 0).toFixed(1)}s`;

  const container = document.getElementById("scenesContainer");
  container.innerHTML = "";

  (plan.scenes || []).forEach((sc, idx) => {
    const card = document.createElement("div");
    card.className = "scene-card";
    card.innerHTML = `
      <div class="scene-header">
        <span class="scene-tag">${sc.type || "scene"}</span>
        <span class="scene-dur">${sc.dur ? sc.dur.toFixed(1) : "5.0"}s</span>
      </div>
      <div class="scene-desc"><strong>Visual:</strong> ${sc.visual_description || sc.environment || "Scene background"}</div>
      <div class="scene-vo">${sc.vo || sc.text || "(Instrumental beat)"}</div>
      <div class="scene-actions">
        <div style="display: flex; gap: 4px;">
          <button class="btn-secondary" style="padding: 4px 8px;" onclick="adjustSceneDur(${idx}, -0.5)">-0.5s</button>
          <button class="btn-secondary" style="padding: 4px 8px;" onclick="adjustSceneDur(${idx}, 0.5)">+0.5s</button>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="btn-secondary" style="padding: 4px 8px;" onclick="moveScene(${idx}, -1)" ${idx === 0 ? "disabled" : ""}>↑</button>
          <button class="btn-secondary" style="padding: 4px 8px;" onclick="moveScene(${idx}, 1)" ${idx === plan.scenes.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn-secondary" style="padding: 4px 8px; color: var(--danger);" onclick="deleteScene(${idx})">✕</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function adjustSceneDur(idx, delta) {
  if (!currentPlan || !currentPlan.scenes[idx]) return;
  currentPlan.scenes[idx].dur = Math.max(1.5, Math.round(((currentPlan.scenes[idx].dur || 5.0) + delta) * 10) / 10);
  renderStoryboard(currentPlan);
}

function moveScene(idx, dir) {
  if (!currentPlan) return;
  const target = idx + dir;
  if (target < 0 || target >= currentPlan.scenes.length) return;
  const temp = currentPlan.scenes[idx];
  currentPlan.scenes[idx] = currentPlan.scenes[target];
  currentPlan.scenes[target] = temp;
  renderStoryboard(currentPlan);
}

function deleteScene(idx) {
  if (!currentPlan || currentPlan.scenes.length <= 1) return;
  currentPlan.scenes.splice(idx, 1);
  renderStoryboard(currentPlan);
}

function addNewScene() {
  if (!currentPlan) return;
  currentPlan.scenes.push({
    type: "story",
    id: `sc_${currentPlan.scenes.length + 1}`,
    visual_description: "New visual narrative beat",
    vo: "And the adventure continues.",
    text: "Next chapter unfolds.",
    dur: 5.0,
    bg: "dark"
  });
  renderStoryboard(currentPlan);
}

async function saveCurrentPlan() {
  if (!currentPlan) return;
  try {
    const res = await fetch("/api/save-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentPlan)
    });
    const data = await res.json();
    if (data.success) {
      alert("Plan saved successfully!");
    }
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

function renderVideo(isDraft) {
  if (!currentPlan) {
    alert("Please plan or load a storyboard first.");
    return;
  }

  // Switch to preview tab
  document.querySelector('.tab-btn[data-tab="preview"]').click();

  const consoleLog = document.getElementById("consoleLog");
  consoleLog.innerHTML = `<div class="active-log">🎬 Launching rendering pipeline for ${currentPlan.name}...</div>`;

  const renderBtn = document.getElementById("renderBtn");
  renderBtn.disabled = true;

  const eventSource = new EventSource(`/api/render?project=${encodeURIComponent(currentPlan.name)}&draft=${isDraft}`);

  eventSource.addEventListener("progress", (e) => {
    const data = JSON.parse(e.data);
    const line = document.createElement("div");
    line.className = "active-log";
    line.textContent = `> ${data.message}`;
    consoleLog.appendChild(line);
    consoleLog.scrollTop = consoleLog.scrollHeight;
  });

  eventSource.addEventListener("log", (e) => {
    const data = JSON.parse(e.data);
    const line = document.createElement("div");
    line.textContent = data.message;
    consoleLog.appendChild(line);
  });

  eventSource.addEventListener("complete", (e) => {
    const data = JSON.parse(e.data);
    eventSource.close();
    renderBtn.disabled = false;

    const line = document.createElement("div");
    line.style.color = "var(--success)";
    line.style.fontWeight = "700";
    line.textContent = "🎉 Video Rendered and Validated Successfully!";
    consoleLog.appendChild(line);

    // Load video
    loadVideoPlayer(currentPlan.name);

    // Render validation
    if (data.validation) {
      renderValidationReport(data.validation);
    }
  });

  eventSource.addEventListener("error", (e) => {
    eventSource.close();
    renderBtn.disabled = false;
    const line = document.createElement("div");
    line.style.color = "var(--danger)";
    line.textContent = "❌ Rendering error encountered.";
    consoleLog.appendChild(line);
  });
}

function loadVideoPlayer(projectName) {
  const player = document.getElementById("videoPlayer");
  const placeholder = document.getElementById("videoPlaceholder");
  const downloadBtn = document.getElementById("downloadVideoBtn");
  const infoText = document.getElementById("videoInfoText");

  const videoUrl = `/media/video/${projectName}`;
  player.src = videoUrl;
  player.style.display = "block";
  placeholder.style.display = "none";
  downloadBtn.style.display = "inline-flex";
  downloadBtn.href = videoUrl;

  infoText.textContent = `Project: ${projectName} | Ready for playback`;
}

function renderValidationReport(report) {
  const badge = document.getElementById("valBadge");
  badge.className = `val-badge ${report.valid ? "valid" : "warn"}`;
  badge.textContent = report.valid ? "VALIDATED PASS" : "WARNINGS";

  const list = document.getElementById("valChecksList");
  list.innerHTML = "";

  (report.checks || []).forEach((c) => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.padding = "6px 10px";
    item.style.background = "rgba(0,0,0,0.2)";
    item.style.borderRadius = "6px";
    item.style.fontSize = "13px";

    const isPass = c.status === "PASS";
    item.innerHTML = `
      <span><strong>${c.name}</strong>: ${Object.entries(c).filter(([k]) => k !== "name" && k !== "status").map(([k,v]) => `${k}=${v}`).join(", ") || c.message || ""}</span>
      <span style="font-weight:700; color: ${isPass ? "var(--success)" : "var(--accent-warm)"}">${c.status}</span>
    `;
    list.appendChild(item);
  });
}

async function loadProjectList() {
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    if (data.projects && data.projects.length > 0) {
      // Load most recent
      const p = data.projects[0];
      const pRes = await fetch(`/launches/${p.name}/plan.json`);
      if (pRes.ok) {
        currentPlan = await pRes.json();
        renderStoryboard(currentPlan);
        if (p.hasVideo) {
          loadVideoPlayer(p.name);
        }
      }
    }
  } catch (e) {}
}
