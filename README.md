# Nairobi Smart Concierge (Firebase AI Logic Demo)

[Live Demo](https://travel-assistant-demo.web.app/)

A simple, interactive web application built to demonstrate **Web Hybrid Inference** and **Template-Only Mode** using **Firebase AI Logic**.

This app is developed as a developer-facing demo for **Google I/O Extended Nairobi** to showcase how to build cost-efficient, offline-first, and secure generative AI applications on the web.

---

## Key Features Demonstrated

### 1. Web Hybrid Inference (Automatic & Zero Cost)

- **On-Device Primary Execution**: The application attempts to execute prompts locally in the user's browser using Chrome's built-in **Gemini Nano** model, requiring zero cloud tokens and incurring **$0.00 cost**.
- **Automatic Cloud Fallback**: If the browser does not support on-device inference, or the local model is not downloaded yet, the Firebase SDK automatically falls back to **Gemini 3.5 Flash** in the cloud.
- **Telemetry Badges**: A live routing badge dynamically displays the exact execution path (`⚡ Local Browser Hardware` vs `☁️ Firebase Cloud`) based on the SDK response metadata (`result.response.inferenceSource`).

### 2. Template-Only Mode (Security & Prompt Injection Shield)

- **The Threat**: In-client prompt construction exposes your system instructions and allows malicious users to abuse your API keys or perform prompt injection attacks.
- **The Shield**: By enabling "Template-Only Mode" on your Firebase Console, the backend strictly rejects any raw, client-side constructed prompts (throwing a `403 Forbidden` error).
- **Secure Templates**: All generative prompts are stored securely in the cloud. The client application only sends a template ID (e.g., `itinerary-generator`) and a structured JSON payload of variables.

---

## Technical Implementation & Code Examples

Here are the key technical parts of the implementation from `app.js` that make the web hybrid pipeline work:

### 1. Chrome Prompt API Shim (Capabilities $\rightarrow$ Availability)

The current Firebase AI SDK (v12.15.0) expects `LanguageModel.availability()` to check capability. However, modern Chrome versions implement `LanguageModel.capabilities()`. The compatibility shim wraps this mismatch:

```javascript
(function shimLanguageModel() {
  let provider = null;
  if (typeof LanguageModel !== "undefined") {
    provider = LanguageModel;
  } else if (typeof window.ai !== "undefined" && window.ai.languageModel) {
    provider = window.ai.languageModel;
    window.LanguageModel = provider; // Expose as global for SDK access
  }

  if (provider && !provider.availability) {
    // Translate modern capabilities() to SDK's expected availability()
    provider.availability = async function (options) {
      try {
        if (typeof provider.capabilities === "function") {
          const caps = await provider.capabilities(options);
          if (
            caps &&
            (caps.available === "readily" ||
              caps.available === "after-download")
          ) {
            return "available"; // Map to SDK expected string
          }
        }
      } catch (e) {
        console.warn("[Shim] Error checking capabilities:", e);
      }
      return "unavailable";
    };
  }
})();
```

### 2. Web Hybrid Model Instantiation

Configure the model to prioritize local hardware with cloud fallback using `InferenceMode.PREFER_ON_DEVICE`:

```javascript
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";

const ai = getAI(app, { backend: new GoogleAIBackend() });

// Hybrid model: tries on-device (Chrome Gemini Nano) first, falls back to cloud
const hybridModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
});
```

### 3. Pipeline Performance & Latency Measurement

We track the exact execution duration of model prompts using `performance.now()` and render it under the telemetry bar:

```javascript
const startTime = performance.now();
const result = await hybridModel.generateContent(prompt);
const endTime = performance.now();

const latencyMs = Math.round(endTime - startTime);
latencyVal.textContent = latencyMs;
latencyContainer.style.display = "block";
```

### 4. Telemetry Source Casing Resolution

The Firebase SDK returns the underlying execution source as a lowercase string (`"on_device"` or `"in_cloud"`). We parse this case-insensitively to correctly toggle UI indicators:

```javascript
const source = result.response.inferenceSource; // Returns "on_device" or "in_cloud"

if (source && source.toLowerCase() === "on_device") {
  enginePath.textContent =
    "⚡ Local Browser Hardware (Chrome Nano) — $0.00 Tokens";
  enginePath.style.color = "var(--accent-green)";
} else {
  enginePath.textContent = "☁️ Firebase Cloud (Gemini 2.5 Flash)";
  enginePath.style.color = "var(--accent-blue)";
}
```

---

## Device & Browser Requirements

Because on-device AI runs locally on the client hardware, specific browser and system configurations are required to see the native Gemini Nano model in action.

### Native Gemini Nano Requirements

| Requirement    | Specification                                                                |
| :------------- | :--------------------------------------------------------------------------- |
| **Browser**    | Google Chrome Desktop (Version 139 or newer)                                 |
| **Platforms**  | macOS (13+), Windows, Linux, or ChromeOS (Chromebook Plus)                   |
| **Mobile**     | Not supported on mobile browsers (Android / iOS)                             |
| **Disk Space** | At least **22 GB** of free space on the drive holding your Chrome profile    |
| **GPU**        | Discrete GPU or capable integrated GPU (WebGL/Hardware Acceleration enabled) |

### Step-by-Step Chrome Flags Configuration

1.  Open Chrome and type **`chrome://flags`** in the URL bar.
2.  Locate and configure the following flags:
    - **Optimization Guide On-Device Model**: Set to **`Enabled`** (or **`Enabled BypassPerfRequirement`** if on a slower device).
    - **Prompt API for Gemini Nano**: Set to **`Enabled`** (this activates the global `LanguageModel` interface).
3.  Click the **Relaunch** button at the bottom of the page to apply changes.
4.  Navigate to **`chrome://components`** and scroll down to **Optimization Guide On Device Model**.
    - Click **Check for update** and wait for the status to show **`Up-to-date`** (This downloads the ~3GB Gemini Nano weights to your computer).

---

## Simulation / Mock Mode (For Presentation Safety)

If you are presenting on a device that doesn't meet the system requirements, or you want to guarantee a flawless live demonstration of the on-device routing flow regardless of network/model download state, you can trigger **Mock Mode**:

- **URL**: [http://localhost:8088/?mock=true](http://localhost:8088/?mock=true)
- **Behavior**: The custom compatibility shim inside `app.js` will intercept capability requests and mock a fully downloaded, ready-to-run Gemini Nano model in the browser. Clicking "Process Layout" will instantly route to the local path and display the green `⚡ Local Browser Hardware` badge.

---

## Project Structure

```
travel-assistant/
├── index.html   # Main application shell with telemetry display & demo buttons
├── app.js       # App logic: Firebase SDK integration, custom Prompt API shim, & rendering
├── app.css      # Modern Glassmorphic styling with responsive mobile optimizations
└── README.md    # This project documentation
```

---

## How to Run Locally

1.  Open your terminal inside the workspace directory.
2.  Serve the folder using a local web server (e.g., using `http-server`):
    ```bash
    npx http-server -p 8088 -c-1
    ```
3.  Navigate to the local address in Chrome:
    - **Normal Mode**: [http://localhost:8088](http://localhost:8088)
    - **Mock Mode**: [http://localhost:8088/?mock=true](http://localhost:8088/?mock=true)

---

## How to Test

1.  Type a messy itinerary and click **Process Layout (Hybrid AI)**. Check out the routing status badge showing either local or cloud depending on the browser capability and the model that was used.
2.  Click **Direct Cloud Prompt (Unsecured)**. if **Template-Only Mode** is active on the Firebase project backend, the request is blocked (returning a `403 Forbidden` error), protecting your cloud resources else the model will be used to process the request.
3.  [Extra] Enable or disable **Template-Only Mode** by navigating to the Firebase Console for this project and toggle **Template-Only Mode** feature then test the app again.
