import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-ai.js";

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  measurementId: "",
};

// Chrome Prompt API Shim for Firebase AI SDK
(function shimLanguageModel() {
  // Check if we should inject a simulated mock model for browser testing
  if (
    typeof window !== "undefined" &&
    window.location.search.includes("mock=true")
  ) {
    console.log(
      "[Shim] Mock mode active. Injecting simulated LanguageModel...",
    );
    window.LanguageModel = {
      capabilities: async () => ({
        available: "readily",
        defaultTemperature: 0.5,
        defaultTopK: 10,
        maxTopK: 20,
      }),
      create: async () => ({
        prompt: async (promptText) => {
          // Simulate local prompt response
          return "10:00 AM - Nairobi National Museum Tour\n- Guided tour through galleries\n- Location: Museum Hill\n- Tip: Cameras allowed but flash is prohibited.";
        },
      }),
    };
  }

  let provider = null;
  if (typeof LanguageModel !== "undefined") {
    provider = LanguageModel;
  } else if (typeof window.ai !== "undefined" && window.ai.languageModel) {
    provider = window.ai.languageModel;
    window.LanguageModel = provider;
  }

  if (provider) {
    if (!provider.availability) {
      provider.availability = async function (options) {
        try {
          if (typeof provider.capabilities === "function") {
            const caps = await provider.capabilities(options);
            if (
              caps &&
              (caps.available === "readily" ||
                caps.available === "after-download")
            ) {
              return "available";
            }
          }
        } catch (e) {
          console.warn("[Shim] Error checking capabilities:", e);
        }
        return "unavailable";
      };
    }
  } else {
    console.warn("[Shim] Chrome Prompt API not detected in this environment.");
  }
})();

const app = initializeApp(firebaseConfig);

const ai = getAI(app, { backend: new GoogleAIBackend() });

// Hybrid model: tries on-device (Chrome Gemini Nano) first, falls back to cloud
const hybridModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
});

// Direct cloud model for the "unsecured" demo button
const directCloudModel = getGenerativeModel(ai, { model: "gemini-2.5-flash" });

const connectionBadge = document.getElementById("connection-badge");
const itineraryInput = document.getElementById("itinerary-input");
const processBtn = document.getElementById("process-btn");
const directBtn = document.getElementById("direct-btn");
const enginePath = document.getElementById("engine-path");
const outputDisplay = document.getElementById("output-display");
const latencyContainer = document.getElementById("latency-container");
const latencyVal = document.getElementById("latency-val");

window.addEventListener("online", () => updateNetworkStatus(true));
window.addEventListener("offline", () => updateNetworkStatus(false));

function updateNetworkStatus(isOnline) {
  if (isOnline) {
    connectionBadge.textContent = "System Online";
    connectionBadge.className = "badge online";
  } else {
    connectionBadge.textContent = "Offline Mode Active";
    connectionBadge.className = "badge offline";
  }
}

processBtn.addEventListener("click", async () => {
  const rawText = itineraryInput.value.trim();
  if (!rawText) return alert("Please enter text details first!");

  processBtn.disabled = true;
  directBtn.disabled = true;

  showLoading(
    "✨",
    "Analyzing parameters...",
    "Executing prompt via Web Hybrid Inference pipeline.",
  );

  try {
    const prompt = buildPrompt(rawText);
    try {
      const availability = await LanguageModel.availability();
      console.log("[Hybrid] LanguageModel.availability():", availability);
    } catch (e) {
      console.error("[Hybrid] LanguageModel.availability() error:", e.message);
    }

    const startTime = performance.now();
    const result = await hybridModel.generateContent(prompt);
    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);

    latencyVal.textContent = latencyMs;
    latencyContainer.style.display = "block";

    const source = result.response.inferenceSource;
    console.info("[Hybrid] inferenceSource:", source);

    if (source && source.toLowerCase() === "on_device") {
      enginePath.textContent =
        "⚡ Local Browser Hardware (Chrome Nano) — $0.00 Tokens";
      enginePath.style.color = "var(--accent-green)";
    } else {
      enginePath.textContent = "☁️ Firebase Cloud (Gemini 3.5 Flash)";
      enginePath.style.color = "var(--accent-blue)";
    }

    renderOutput(result.response.text());
  } catch (error) {
    console.error("Hybrid execution failed:", error);
    enginePath.textContent = "Error Executing Pipeline Path";
    outputDisplay.innerHTML = `
      <div class="output-placeholder error-state">
        <div class="loading-icon">❌</div>
        <div class="loading-title">Execution failed</div>
        <div class="loading-sub">${escapeHtml(error.message)}</div>
      </div>
    `;
  }

  processBtn.disabled = false;
  directBtn.disabled = false;
});

directBtn.addEventListener("click", async () => {
  const rawText = itineraryInput.value.trim();
  if (!rawText) return alert("Please enter text details first!");

  directBtn.disabled = true;
  processBtn.disabled = true;
  showLoading(
    "🔒",
    "Sending Raw Client Prompt...",
    "Bypassing templates and calling direct Gemini API. Testing security restrictions...",
  );

  const startTime = performance.now();
  try {
    enginePath.textContent = "Attempting direct cloud prompt...";
    enginePath.style.color = "var(--accent-gold)";

    const prompt = buildPrompt(rawText);
    const result = await directCloudModel.generateContent(prompt);

    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);
    latencyVal.textContent = latencyMs;
    latencyContainer.style.display = "block";

    // If it somehow succeeds (e.g. Template-Only Mode is disabled in the project), show warning
    enginePath.textContent = "⚠️ Direct Cloud Mode";
    enginePath.style.color = "var(--accent-red)";
    renderOutput(
      `<strong>WARNING: Raw client prompt was successfully executed.</strong><br/><br/>Your application is vulnerable to prompt injection attacks because Template-Only Mode is not active.<br/><br/>Response:<br/>${result.response.text()}`,
    );
  } catch (error) {
    const endTime = performance.now();
    const latencyMs = Math.round(endTime - startTime);
    latencyVal.textContent = latencyMs;
    latencyContainer.style.display = "block";

    console.error("Direct cloud prompt execution failed:", error);

    // Determine if it was blocked by security rules (403, permission denied, unauthorized, key/app issues)
    const isSecurityBlocked =
      error.message.includes("403") ||
      error.message.toLowerCase().includes("permission") ||
      error.message.toLowerCase().includes("unauthorized") ||
      error.message.toLowerCase().includes("blocked");

    if (isSecurityBlocked) {
      enginePath.textContent = "🛡️ SECURED: Prompt Injection Neutralized";
      enginePath.style.color = "var(--accent-green)";
      outputDisplay.innerHTML = `
        <div class="timeframe-card night" style="border-left-color: var(--accent-green);">
          <div class="timeframe-card-header" style="color: var(--accent-green);">
            <span class="timeframe-icon">🛡️</span>
            <span class="timeframe-label">Firebase Security Active</span>
          </div>
          <div class="timeframe-card-body">
            <h4 style="margin: 0; color: #fff;">Template-Only Mode Active</h4>
            <p style="margin: 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-muted);">
              The direct client request was successfully rejected by Firebase AI Logic with a <strong>403 Forbidden</strong> error.
            </p>
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; border-radius: 6px; font-size: 0.85rem; font-family: monospace; color: var(--accent-green); line-height: 1.5;">
              Rejected Payload: { prompt: "${rawText.substring(0, 40)}..." }<br/>
              Reason: Direct client-constructed prompt calls are disabled.<br/>
              Result: Client-side prompt injection neutralized.
            </div>
          </div>
        </div>
      `;
    } else {
      enginePath.textContent = "Error Executing Direct Path";
      outputDisplay.innerHTML = `
        <div class="output-placeholder error-state">
          <div class="loading-icon">❌</div>
          <div class="loading-title">Direct call failed</div>
          <div class="loading-sub">${escapeHtml(error.message)}</div>
        </div>
      `;
    }
  }

  directBtn.disabled = false;
  processBtn.disabled = false;
});

function buildPrompt(rawText) {
  return `You are a smart travel assistant for Nairobi, Kenya. The user has shared their raw plans below.

Produce a structured daily itinerary. Follow these rules STRICTLY:
- Use PLAIN TEXT ONLY. Do NOT use asterisks (*), underscores, or any other markdown formatting.
- For each activity, write one line starting with the time in 12-hour format: "9:00 AM - Activity Name"
- Under each activity, add 2-3 short lines starting with a dash (-) for details like: Activity description, Location, and a local Tip.
- Do NOT write a general advice section at the end.
- Do NOT use bold, italic, or any formatting symbols.

User's raw plans: "${rawText}"`;
}

function showLoading(icon, title, sub) {
  if (latencyContainer) latencyContainer.style.display = "none";
  outputDisplay.innerHTML = `
    <div class="output-placeholder loading-pulse">
      <div class="loading-icon">${icon}</div>
      <div class="loading-title">${title}</div>
      <div class="loading-sub">${sub}</div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Markdown Formatter ───────────────────────────────────────────────────────
// Converts **bold** to <strong>, strips all other asterisks and # headers.
function formatMarkdown(str) {
  if (!str) return "";
  return str
    .replace(/\*\*\*(.+?)\*\*\*/gs, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
    .replace(/^#{1,6}\s+/gm, "") // strip markdown heading markers
    .replace(/\*/g, ""); // strip any remaining stray asterisks
}

// ─── Time Helpers ─────────────────────────────────────────────────────────────
const TIME_REGEX =
  /\b((?:1[0-2]|0?[1-9])(?::[0-5][0-9])?\s*(?:AM|PM|am|pm))\b|\b((?:2[0-3]|[0-1]?[0-9]):[0-5][0-9])\b/i;

function getHour(timeStr) {
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const ampm = match[3];
  if (ampm) {
    const isPM = ampm.toUpperCase() === "PM";
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
  }
  return hour;
}

function categorize(time) {
  if (!time) return null;
  const h = getHour(time);
  if (h === null) return null;
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

// ─── Core Renderer ────────────────────────────────────────────────────────────
function renderOutput(text) {
  // ── Step 1: Parse line by line ──────────────────────────────────────────
  // A new activity block starts ONLY when a line contains a time.
  // All subsequent dash/bullet lines become description of that activity.

  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const activities = []; // { time, title, descLines, category }
  let current = null;

  for (const rawLine of rawLines) {
    // Strip markdown heading markers
    const line = rawLine.replace(/^#{1,6}\s+/, "");

    // Strip bullet/numbered prefix
    const stripped = line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "");

    // Does this line start a new time-anchored activity?
    const timeMatch = stripped.match(TIME_REGEX);

    if (timeMatch) {
      const time = timeMatch[0];
      let title = stripped
        .replace(time, "")
        .replace(/^[\s\-\u2013:*\u2022\t|]+/, "")
        .replace(/[\s\-\u2013:*\u2022\t|]+$/, "")
        .trim();
      if (!title) title = "Activity";

      current = { time, title, descLines: [], category: categorize(time) };
      activities.push(current);
    } else if (current) {
      // Belongs to current activity as a description detail
      // Skip generic section headers like "General Advice"
      if (
        /general advice|general tips|important notes|additional tips/i.test(
          stripped,
        )
      )
        continue;
      // Skip empty or markdown-header-only lines
      if (!stripped || stripped.startsWith("#")) continue;

      current.descLines.push(stripped);
    }
    // Lines before any time is seen (intro sentences) are ignored
  }

  // ── Step 2: Fallback if no time-anchored activities found ───────────────
  if (activities.length === 0) {
    // Try the old block-based approach as a fallback
    renderFallback(text);
    return;
  }

  // ── Step 3: Carry-forward category for un-timed activities ─────────────
  let lastCategory = "morning";
  for (const act of activities) {
    if (act.category) {
      lastCategory = act.category;
    } else {
      act.category = lastCategory;
    }
  }

  // ── Step 4: Group by timeframe ──────────────────────────────────────────
  const groups = { morning: [], afternoon: [], evening: [], night: [] };

  for (const act of activities) {
    const descHtml = act.descLines
      .map((l) => `<span class="desc-line">${formatMarkdown(l)}</span>`)
      .join("");

    groups[act.category].push(`
      <div class="activity-item">
        <div class="activity-header">
          <span class="activity-time">${act.time}</span>
          <h4 class="activity-title">${formatMarkdown(act.title)}</h4>
        </div>
        ${descHtml ? `<div class="activity-desc">${descHtml}</div>` : ""}
      </div>
    `);
  }

  // ── Step 5: Render timeframe cards ──────────────────────────────────────
  const periods = [
    { key: "morning", icon: "🌅", label: "Morning" },
    { key: "afternoon", icon: "☀️", label: "Afternoon" },
    { key: "evening", icon: "🌆", label: "Evening" },
    { key: "night", icon: "🌙", label: "Night" },
  ];

  let html = '<div class="timeframe-container">';

  for (const p of periods) {
    const items = groups[p.key];
    if (!items.length) continue;
    const count = `${items.length} ${items.length === 1 ? "activity" : "activities"}`;
    html += `
      <div class="timeframe-card ${p.key}">
        <div class="timeframe-card-header">
          <span class="timeframe-icon">${p.icon}</span>
          <span class="timeframe-label">${p.label}</span>
          <span class="timeframe-count">${count}</span>
        </div>
        <div class="timeframe-card-body">
          <div class="activity-timeline">
            ${items.join("")}
          </div>
        </div>
      </div>
    `;
  }

  html += "</div>";
  outputDisplay.innerHTML = html;
}

// Fallback for when no time-anchored structure is found
function renderFallback(text) {
  outputDisplay.innerHTML = `
    <div class="timeframe-card morning">
      <div class="timeframe-card-header">
        <span class="timeframe-icon">📋</span>
        <span class="timeframe-label">Your Itinerary</span>
      </div>
      <div class="timeframe-card-body">
        <span class="fallback-text">${formatMarkdown(text)}</span>
      </div>
    </div>
  `;
}
