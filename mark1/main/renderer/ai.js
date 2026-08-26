// main/renderer/ai.js
// Ultra Intelligent AI Automation & Live SVG-to-JSON Interval Engine

const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

let currentTextNode = null;
let currentMsgContainer = null;
let activeIntervalWatcher = null;

// ==========================
// ENTER SUBMIT
// ==========================
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

// ==========================
// SUBMIT
// ==========================
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const cmd = input.value.trim();
  if (!cmd) return;

  // Handle stop commands directly
  if (/^(?:stop|stop\s+interval|stop\s+watch|cancel\s+interval)$/i.test(cmd)) {
    if (activeIntervalWatcher) {
      activeIntervalWatcher.stop();
      activeIntervalWatcher = null;
    }
    createMessageBlock(cmd);
    logResp("⏹ Active interval tracking stopped.");
    setStatus("Interval tracking stopped");
    input.value = "";
    return;
  }

  // Stop previous watcher if running
  if (activeIntervalWatcher) {
    activeIntervalWatcher.stop();
    activeIntervalWatcher = null;
  }

  createMessageBlock(cmd);
  startShimmer();
  setStatus(`Processing: ${cmd}`);

  try {
    const res = await fetch(`${BACKEND_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: cmd,
      }),
    });
    const data = await res.json();

    if (!data.success) {
      logResp(`❌ ${data.error || "Action failed."}`);
      setStatus(`Error: ${data.error || "Action failed."}`);
      stopShimmer();
      return;
    }

    // CHAT MODE
    if (data.mode === "chat") {
      logResp(data.reply);
      setStatus("Jarvis Browser is ready");
      stopShimmer();
      input.value = "";
      return;
    }

    // ACTION MODE
    let isIframeDataCommand = false;
    let targetClass = ".tzQn0o";
    let lastResult = null;

    for (const step of data.steps) {
      if (
        step.tool === "get_iframe_data" ||
        step.tool === "get_iframe_svg" ||
        step.tool === "watch_iframe_data" ||
        step.tool === "convert_svg_json"
      ) {
        isIframeDataCommand = true;
        targetClass =
          step.args?.target ||
          step.args?.parentClass ||
          step.args?.class ||
          targetClass;
        lastResult = step.result;
      }
    }

    // Check if command text references container/svg/tzQn0o
    if (
      /\.tzQn0o|tzQn0o|get data|get svg|watch data|extract svg|convert svg/i.test(
        cmd,
      )
    ) {
      isIframeDataCommand = true;
      const classMatch = cmd.match(/(?:\.?[a-zA-Z0-9_.-]+)/g);
      if (classMatch) {
        const found = classMatch.find((c) =>
          /tzQn0o|dGBOyn|\.[a-zA-Z]/i.test(c),
        );
        if (found) targetClass = found;
      }
    }

    if (isIframeDataCommand) {
      // Clean up thinking text
      if (currentTextNode) {
        currentTextNode.style.display = "none";
      }

      // Render Live Interval SVG-to-JSON card
      renderLiveIntervalCard(currentMsgContainer, targetClass, lastResult, 1500);
      setStatus(`Live SVG-to-JSON tracking active for ${targetClass}`);
    } else {
      // Standard steps output
      for (const step of data.steps) {
        logResp(JSON.stringify(step.result || step, null, 2));
      }
      setStatus("Action completed successfully");
    }

    input.value = "";
  } catch (err) {
    logResp(`❌ ${err.message}`);
    setStatus(`Error: ${err.message}`);
  } finally {
    stopShimmer();
  }
});

// ==========================
// RENDER LIVE INTERVAL CARD
// ==========================
function renderLiveIntervalCard(container, targetClass, initialData, initialIntervalMs = 1500) {
  if (!container) return;

  const card = document.createElement("div");
  card.className = "json-status-card";

  // Header
  const header = document.createElement("div");
  header.className = "json-header";

  const liveIndicator = document.createElement("div");
  liveIndicator.className = "live-indicator";
  liveIndicator.innerHTML = `
    <span class="pulse-dot"></span>
    <span>LIVE SVG → JSON (${escapeHTML(targetClass)})</span>
  `;

  const meta = document.createElement("div");
  meta.className = "json-meta";
  meta.innerHTML = `<span class="tick-count">Tick #1</span> | <span class="update-time">${formatTime(new Date())}</span>`;

  header.appendChild(liveIndicator);
  header.appendChild(meta);

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "json-toolbar";

  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.innerText = "⏸ Pause";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.innerText = "🔄 Refresh Now";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.innerText = "📋 Copy JSON";

  const intervalLabel = document.createElement("span");
  intervalLabel.innerText = "⏱ Every:";

  const intervalSelect = document.createElement("select");
  intervalSelect.innerHTML = `
    <option value="500">500ms</option>
    <option value="1000">1.0s</option>
    <option value="1500" selected>1.5s</option>
    <option value="2000">2.0s</option>
    <option value="3000">3.0s</option>
    <option value="5000">5.0s</option>
  `;

  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.innerText = "⏹ Stop";

  toolbar.appendChild(pauseBtn);
  toolbar.appendChild(refreshBtn);
  toolbar.appendChild(intervalLabel);
  toolbar.appendChild(intervalSelect);
  toolbar.appendChild(copyBtn);
  toolbar.appendChild(stopBtn);

  // Stats bar
  const statsBar = document.createElement("div");
  statsBar.className = "json-stats-bar";
  statsBar.innerHTML = `<span class="stat-chip highlight">Loading SVGs...</span>`;

  // Code block
  const pre = document.createElement("pre");
  pre.className = "json-code-block";
  const code = document.createElement("code");
  pre.appendChild(code);

  card.appendChild(header);
  card.appendChild(toolbar);
  card.appendChild(statsBar);
  card.appendChild(pre);

  container.appendChild(card);
  scrollLogsToBottom();

  // State
  let currentInterval = initialIntervalMs;
  let isPaused = false;
  let isStopped = false;
  let tick = 1;
  let latestJSON = initialData || null;

  function updateView(jsonData) {
    if (isStopped) return;
    latestJSON = jsonData;

    // Update time & tick
    meta.querySelector(".tick-count").innerText = `Tick #${tick++}`;
    meta.querySelector(".update-time").innerText = formatTime(new Date());

    // Update stats chips
    let totalSVGs = jsonData?.totalSVGs ?? 0;
    let containerCount = jsonData?.totalContainers ?? 0;
    let framesCount = jsonData?.matchedFrames ?? jsonData?.frames?.length ?? 0;
    let extractedNumbers = [];
    let rotationAngle = undefined;

    // Try finding svgs inside frames
    if (jsonData?.frames) {
      for (const f of jsonData.frames) {
        if (f.containers) {
          for (const c of f.containers) {
            if (c.svgs) {
              for (const s of c.svgs) {
                if (s.dynamicValues?.numbers) {
                  extractedNumbers.push(...s.dynamicValues.numbers);
                }
                if (s.dynamicValues?.rotationAngle !== undefined) {
                  rotationAngle = s.dynamicValues.rotationAngle;
                }
              }
            }
          }
        }
        if (f.svgs) {
          for (const s of f.svgs) {
            if (s.dynamicValues?.numbers) {
              extractedNumbers.push(...s.dynamicValues.numbers);
            }
            if (s.dynamicValues?.rotationAngle !== undefined) {
              rotationAngle = s.dynamicValues.rotationAngle;
            }
          }
        }
      }
    }

    const chipsHTML = [
      `<span class="stat-chip highlight">🎯 Target: ${escapeHTML(targetClass)}</span>`,
      `<span class="stat-chip">🖼️ Iframes: ${framesCount}</span>`,
      `<span class="stat-chip">📦 Containers: ${containerCount}</span>`,
      `<span class="stat-chip highlight">🎨 SVGs: ${totalSVGs}</span>`,
      rotationAngle !== undefined ? `<span class="stat-chip highlight">🔄 Angle: ${rotationAngle}°</span>` : "",
      extractedNumbers.length ? `<span class="stat-chip">🔢 Values: ${extractedNumbers.slice(0, 5).join(", ")}</span>` : "",
    ].filter(Boolean).join(" ");

    statsBar.innerHTML = chipsHTML;

    // Update status text on Jarvis bar
    setStatus(`🟢 ${targetClass}: ${totalSVGs} SVG(s) converted to JSON at ${formatTime(new Date())}`);

    // Update JSON syntax highlighting
    const formatted = JSON.stringify(jsonData, null, 2);
    code.innerHTML = syntaxHighlightJSON(formatted);
  }

  // Initial render
  if (initialData) {
    updateView(initialData);
  }

  // Poll fetch function
  async function fetchLiveSVGData() {
    if (isPaused || isStopped) return;
    try {
      // 1. Try Backend /iframe/data
      const res = await fetch(
        `${BACKEND_URL}/iframe/data?class=${encodeURIComponent(targetClass)}&target=${encodeURIComponent(targetClass)}&onlyIframes=true`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          updateView(json.data);
          return;
        } else if (json.success) {
          updateView(json);
          return;
        }
      }
    } catch (err) {
      console.warn("Backend poll error:", err.message);
    }

    // 2. Fallback: Direct Electron API
    if (window.browserAPI && typeof window.browserAPI.getContainerData === "function") {
      try {
        const containers = await window.browserAPI.getContainerData(targetClass);
        const fallbackData = {
          success: true,
          target: targetClass,
          timestamp: new Date().toISOString(),
          totalContainers: containers.length,
          totalSVGs: containers.reduce((sum, c) => sum + (c.svgCount || 0), 0),
          containers,
        };
        updateView(fallbackData);
      } catch (err) {
        console.warn("Electron API fallback error:", err.message);
      }
    }
  }

  // Start Interval Timer
  let timerId = setInterval(fetchLiveSVGData, currentInterval);

  // If SSE is supported, also connect
  let eventSource = null;
  try {
    eventSource = new EventSource(
      `${BACKEND_URL}/iframe/stream?target=${encodeURIComponent(targetClass)}&interval=${currentInterval}`,
    );
    eventSource.onmessage = (event) => {
      if (isPaused || isStopped) return;
      try {
        const sseData = JSON.parse(event.data);
        if (sseData) {
          updateView(sseData);
        }
      } catch (e) {}
    };
  } catch (e) {
    console.warn("SSE connection skipped, using polling interval.");
  }

  // Controller
  const watcher = {
    stop: () => {
      isStopped = true;
      clearInterval(timerId);
      if (eventSource) {
        eventSource.close();
      }
      liveIndicator.className = "live-indicator stopped";
      liveIndicator.querySelector(".pulse-dot").className = "pulse-dot stopped";
      liveIndicator.querySelector("span:last-child").innerText = `STOPPED (${targetClass})`;
      pauseBtn.disabled = true;
      refreshBtn.disabled = true;
      stopBtn.disabled = true;
    },
    pause: () => {
      isPaused = true;
      liveIndicator.className = "live-indicator paused";
      liveIndicator.querySelector(".pulse-dot").className = "pulse-dot paused";
      liveIndicator.querySelector("span:last-child").innerText = `PAUSED (${targetClass})`;
      pauseBtn.innerText = "▶ Resume";
    },
    resume: () => {
      isPaused = false;
      liveIndicator.className = "live-indicator";
      liveIndicator.querySelector(".pulse-dot").className = "pulse-dot";
      liveIndicator.querySelector("span:last-child").innerText = `LIVE SVG → JSON (${targetClass})`;
      pauseBtn.innerText = "⏸ Pause";
      fetchLiveSVGData();
    },
    setIntervalMs: (newMs) => {
      currentInterval = newMs;
      clearInterval(timerId);
      timerId = setInterval(fetchLiveSVGData, currentInterval);
    },
  };

  activeIntervalWatcher = watcher;

  // Button Listeners
  pauseBtn.addEventListener("click", () => {
    if (isPaused) {
      watcher.resume();
    } else {
      watcher.pause();
    }
  });

  refreshBtn.addEventListener("click", () => {
    fetchLiveSVGData();
  });

  copyBtn.addEventListener("click", () => {
    if (latestJSON) {
      navigator.clipboard.writeText(JSON.stringify(latestJSON, null, 2));
      copyBtn.innerText = "✅ Copied!";
      setTimeout(() => {
        copyBtn.innerText = "📋 Copy JSON";
      }, 1500);
    }
  });

  intervalSelect.addEventListener("change", (e) => {
    const val = parseInt(e.target.value, 10);
    if (val) {
      watcher.setIntervalMs(val);
    }
  });

  stopBtn.addEventListener("click", () => {
    watcher.stop();
    activeIntervalWatcher = null;
    setStatus(`Stopped interval tracking for ${targetClass}`);
  });
}

// ==========================
// SYNTAX HIGHLIGHT JSON
// ==========================
function syntaxHighlightJSON(jsonStr) {
  if (typeof jsonStr !== "string") {
    jsonStr = JSON.stringify(jsonStr, null, 2);
  }
  const escaped = jsonStr
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
        } else {
          cls = "json-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

// ==========================
// RUN STEP
// ==========================
async function runStep(step) {
  logResp("STEP:\n" + JSON.stringify(step, null, 2));

  const r = await fetch(`${BACKEND_URL}/tool`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(step),
  });

  const d = await r.json();

  if (!d.success) {
    throw new Error(d.error);
  }

  logResp(JSON.stringify(d.result, null, 2));
}

// ==========================
// UI MESSAGE BLOCK
// ==========================
function createMessageBlock(payload) {
  const logs = document.getElementById("logs");

  const block = document.createElement("div");
  block.classList.add("msg-block");

  const user = document.createElement("div");
  user.classList.add("user-msg");
  user.innerText = payload;

  const ai = document.createElement("div");
  ai.classList.add("ai-msg");

  const span = document.createElement("span");
  span.innerText = "Thinking...";

  ai.appendChild(span);
  block.appendChild(user);
  block.appendChild(ai);

  logs.appendChild(block);
  scrollLogsToBottom();

  currentTextNode = span;
  currentMsgContainer = ai;
}

// ==========================
// LOG
// ==========================
function logResp(msg) {
  if (!currentTextNode) return;
  currentTextNode.innerText = msg;
  scrollLogsToBottom();
}

// ==========================
// HELPERS
// ==========================
function scrollLogsToBottom() {
  const logs = document.getElementById("logs");
  if (logs) {
    logs.scrollTop = logs.scrollHeight;
  }
}

function formatTime(date) {
  const d = date || new Date();
  return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function startShimmer() {
  const anim = document.querySelector(".animation");
  if (anim) anim.classList.add("active");
}

function stopShimmer() {
  const anim = document.querySelector(".animation");
  if (anim) anim.classList.remove("active");
}
