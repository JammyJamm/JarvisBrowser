// Jarvis AI automation, live data tracking, and inactivity auto-dismiss
(() => {
  const BACKEND_URL = window.aiState?.backendUrl || "http://localhost:9000";

  const form = document.getElementById("ai-form");
  const input = document.getElementById("cmd");

  let currentTextNode = null;
  let currentMsgContainer = null;
  let activeIntervalWatcher = null;

  function logPlannerEvent(message, details) {
    if (typeof window.jarvisLog !== "function") return;
    const detailText =
      details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
    window.jarvisLog(`[Planner] ${message}${detailText}`);
  }

  // ==========================================================
  // TIME KEY FORMATTER: "04:20pm", "09:05am", etc.
  // ==========================================================
  function formatTimeKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const formattedHours = String(hours).padStart(2, "0");
    return `${formattedHours}:${minutes}${ampm}`;
  }

  // ==========================================================
  // SPLIT BIG NUMBERS (> 19) & CLEAN 4-VALUES
  // ==========================================================
  function splitNumberIfAbove19(n) {
    if (typeof n !== "number" || isNaN(n)) return [];
    if (n <= 19 && n >= 0) return [n];

    const s = String(Math.floor(Math.abs(n)));
    let bestSplit = null;

    for (let i = 1; i < s.length; i++) {
      const sA = s.slice(0, i);
      const sB = s.slice(i);
      const vA = parseInt(sA, 10);
      const vB = parseInt(sB, 10);

      if (vA <= 19 && vA > 0 && vB <= 19 && vB > 0) {
        if (sA.length === 2 || !bestSplit) {
          bestSplit = [vA, vB];
        }
      }
    }

    if (bestSplit) {
      return bestSplit;
    }

    if (s.length === 2) {
      const vA = parseInt(s[0], 10);
      let vB = parseInt(s[1], 10);
      if (vB === 0) vB = 1;
      return [Math.min(vA, 19), vB];
    }

    const vA = Math.min(
      parseInt(s.slice(0, 2), 10) <= 19
        ? parseInt(s.slice(0, 2), 10)
        : parseInt(s.slice(0, 1), 10),
      19,
    );
    const remStr = s.slice(s.indexOf(String(vA)) + String(vA).length);
    let vB = remStr ? parseInt(remStr.slice(0, 2), 10) : 1;
    if (vB > 19) vB = parseInt(remStr.slice(0, 1), 10) || 1;
    if (vB === 0) vB = 1;

    return [vA, vB];
  }

  function cleanFourValues(chunk) {
    let [v0, v1, v2, v3] = Array.isArray(chunk) ? chunk : [0, 5, 5, 5];

    // 1. Check v0 <= 19; if above 19, split it
    if (typeof v0 === "number" && v0 > 19) {
      const [splitA, splitB] = splitNumberIfAbove19(v0);
      v0 = splitA;
      if (splitB !== undefined && (v1 === undefined || v1 === 0)) {
        v1 = splitB;
      }
    }

    // 2. Ensure v0 is <= 19
    v0 =
      typeof v0 === "number" && !isNaN(v0) ? Math.min(Math.max(0, v0), 19) : 0;

    // 3. Ensure v1, v2, v3 are not 0 and <= 19 (1..19)
    const sanitizePos = (val, fallback = 5) => {
      if (typeof val === "number" && !isNaN(val) && val > 0) {
        if (val > 19) {
          const parts = splitNumberIfAbove19(val);
          return parts[0] || Math.min(val, 19);
        }
        return Math.min(val, 19);
      }
      return fallback;
    };

    v1 = sanitizePos(v1, v0 > 0 && v0 <= 19 ? Math.min(v0, 5) : 5);
    v2 = sanitizePos(v2, 5);
    v3 = sanitizePos(v3, 5);

    return [v0, v1, v2, v3];
  }

  // ==========================================================
  // PARSE 4-VALUES AS [{ "04:20pm": [15, 5, 5, 5] }, ...]
  // ==========================================================
  function parseTimeToValues(data, baseDate = new Date()) {
    let rawText = "";

    if (typeof data === "string") {
      rawText = data;
    } else if (data?.text) {
      rawText = data.text;
    } else if (data?.timeValues && Array.isArray(data.timeValues)) {
      return data.timeValues.map((item) => {
        const k = Object.keys(item)[0];
        return { [k]: cleanFourValues(item[k]) };
      });
    } else if (
      Array.isArray(data) &&
      data.length &&
      typeof data[0] === "object"
    ) {
      const firstKey = Object.keys(data[0])[0];
      if (
        firstKey &&
        /^\d{2}:\d{2}(?:am|pm)$/i.test(firstKey) &&
        Array.isArray(data[0][firstKey])
      ) {
        return data.map((item) => {
          const k = Object.keys(item)[0];
          return { [k]: cleanFourValues(item[k]) };
        });
      }
    } else if (data?.frames) {
      for (const frame of data.frames) {
        if (frame.containers) {
          for (const c of frame.containers) {
            if (c.text) rawText += " " + c.text;
            if (c.svgs) {
              for (const s of c.svgs) {
                if (s.text) rawText += " " + s.text;
              }
            }
          }
        }
        if (frame.svgs) {
          for (const s of frame.svgs) {
            if (s.text) rawText += " " + s.text;
          }
        }
      }
    }

    // Extract all numbers from text
    const rawNumbers = (rawText.match(/\d+/g) || []).map(Number);
    const numbers = [];
    for (const n of rawNumbers) {
      if (typeof n === "number" && !isNaN(n)) {
        if (n > 19) {
          numbers.push(...splitNumberIfAbove19(n));
        } else {
          numbers.push(n);
        }
      }
    }

    const items = [];
    const baseTime = (
      baseDate instanceof Date ? baseDate : new Date()
    ).getTime();

    // Compute total number of 4-value chunks so timestamps end at baseTime (now)
    const totalChunks = Math.max(1, Math.ceil(numbers.length / 4));

    for (let i = 0; i < numbers.length; i += 4) {
      const chunk = numbers.slice(i, i + 4);
      if (chunk.length > 0) {
        const cleaned = cleanFourValues(chunk);
        const chunkIndex = i / 4; // 0-based
        // Assign times so the last chunk corresponds to baseTime, earlier chunks are baseTime - (remaining minutes)
        // Assign minutes so the last chunk corresponds to baseTime (now)
        // earlier chunks are baseTime - (remaining minutes). Use subtraction
        // so chunkIndex 0 (first chunk in processed order) maps to the oldest
        // timestamp and the final chunk maps to baseTime.
        const minutesOffset = totalChunks - 1 - chunkIndex;
        const setDate = new Date(baseTime - minutesOffset * 60000);
        const timeKey = formatTimeKey(setDate);
        items.push({ [timeKey]: cleaned });
      }
    }

    // items currently oldest->newest; reverse so first element is the latest (baseTime)
    return items.reverse();
  }

  // ==========================================================
  // AUTO-DISMISS INACTIVITY / PAUSE POPUPS & CLICK IN-GAME PLAY BUTTON
  // ==========================================================
  async function autoDismissInactivityPopups() {
    let dismissed = false;
    let count = 0;

    // 1. Try Backend CDP dismisser
    try {
      const res = await fetch(`${BACKEND_URL}/api/dismiss-popup`, {
        method: "POST",
      });
      if (res.ok) {
        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error(`/run returned an unreadable response (HTTP ${res.status}).`);
        }
        if (data.dismissed) {
          dismissed = true;
          count += data.count || 1;
        }
      }
    } catch (e) {}

    // 2. Try Electron BrowserView direct dismisser
    if (
      window.browserAPI &&
      typeof window.browserAPI.dismissPopup === "function"
    ) {
      try {
        const eRes = await window.browserAPI.dismissPopup();
        if (eRes && eRes.dismissed) {
          dismissed = true;
          count += eRes.count || 1;
        }
      } catch (e) {}
    }

    // 3. Try Local DOM in-game play-button overlay (e.g. data-role="play-button", .A2zb9M, .iTKQgM, .VQJTA7, .E0dFqh)
    try {
      const localPlayBtns = Array.from(
        document.querySelectorAll(
          'button[data-role="play-button"], button.A2zb9M, button.iTKQgM, button.VQJTA7, button.E0dFqh, [data-role="play-button"]',
        ),
      );
      for (const btn of localPlayBtns) {
        const style = window.getComputedStyle(btn);
        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0" &&
          style.pointerEvents !== "none"
        ) {
          btn.click();
          dismissed = true;
          count++;
        }
      }
    } catch (e) {}

    if (dismissed) {
      const guardEl = document.getElementById("inactivityStatus");
      if (guardEl) {
        guardEl.innerText = `Popup dismissed (${count})`;
        setTimeout(() => {
          guardEl.innerText = "Inactivity guard ready";
        }, 3000);
      }
    }

    return { dismissed, count };
  }

  document
    .getElementById("assistantDismissPopupBtn")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.innerText = "Checking...";
      try {
        const result = await autoDismissInactivityPopups();
        button.innerText = result.dismissed
          ? `Dismissed (${result.count})`
          : "No popup";
      } catch (error) {
        console.error("Unable to dismiss browser popup:", error);
        button.innerText = "Dismiss failed";
      } finally {
        setTimeout(() => {
          button.innerText = "🛡 Dismiss popup";
          button.disabled = false;
        }, 1500);
      }
    });

  setInterval(() => {
    autoDismissInactivityPopups();
  }, 5000);

  // ==========================================================
  // SUBMIT USER COMMAND HANDLER
  // ==========================================================
  async function handleUserCommand(cmd) {
    if (!cmd) return;

    // Stop previous watcher if running
    if (activeIntervalWatcher) {
      activeIntervalWatcher.stop();
      activeIntervalWatcher = null;
    }

    createMessageBlock(cmd);
    startShimmer();
    setStatus("Analyzing...");
    logPlannerEvent(`Submitting command to /run: ${cmd}`);

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

      logPlannerEvent(
        `/run returned HTTP ${res.status} · ${data.mode || "unknown"} · ${data.plannerSource || "planner source unavailable"}`,
      );
      if (data.plan !== undefined) {
        logPlannerEvent("Planner output", data.plan);
      }
      if (data.steps !== undefined) {
        logPlannerEvent("Playwright execution steps", data.steps);
      }

      if (!res.ok || !data.success) {
        logPlannerEvent(`Command failed: ${data.error || "Action failed."}`);
        logResp(`❌ ${data.error || "Action failed."}`);
        setStatus("Unable to complete that request");
        stopShimmer();
        return;
      }

      setStatus("Working...");

      // CHAT MODE
      if (data.mode === "chat") {
        logResp(data.reply);
        setStatus("Ready for your next request");
        stopShimmer();
        return;
      }

      if (!Array.isArray(data.steps)) {
        throw new Error("The planner response did not include executable Playwright steps.");
      }

      // ACTION MODE
      let isIframeDataCommand = false;
      let targetClass = ".tzQn0o";
      let lastResult = null;
      let requestedInterval = 5000;

      // Check interval in cmd (e.g. 5s, 10s, 15s)
      const intervalMatch = cmd.match(
        /(?:every|interval|for)?\s*(\d+(?:ms|s)?)/i,
      );
      if (intervalMatch && intervalMatch[1]) {
        const raw = intervalMatch[1];
        if (raw.endsWith("s") && !raw.endsWith("ms")) {
          requestedInterval = parseFloat(raw) * 1000;
        } else {
          requestedInterval = parseInt(raw, 10);
        }
      }

      for (const step of data.steps) {
        if (
          step.tool === "watch_iframe_data" ||
          step.tool === "get_iframe_data" ||
          step.tool === "get_iframe_svg" ||
          step.tool === "convert_svg_json"
        ) {
          isIframeDataCommand = true;
          targetClass =
            step.args?.target ||
            step.args?.parentClass ||
            step.args?.class ||
            targetClass;
          if (step.args?.interval) {
            requestedInterval = step.args.interval;
          }
          lastResult = step.result;
        }
      }

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
        if (currentTextNode) {
          currentTextNode.style.display = "none";
        }

        renderLiveIntervalCard(
          currentMsgContainer,
          targetClass,
          lastResult,
          requestedInterval,
        );
        setStatus(
          `Live data tracking active for ${targetClass} (Interval: ${requestedInterval / 1000}s)`,
        );
      } else {
        for (const step of data.steps) {
          logResp(JSON.stringify(step.result || step, null, 2));
        }
        setStatus("Ready for your next request");
      }
    } catch (err) {
      logPlannerEvent(`Request failed: ${err.message}`);
      logResp(`❌ ${err.message}`);
      setStatus("Unable to complete that request");
    } finally {
      stopShimmer();
    }
  }

  // ==========================================================
  // EXPOSE GLOBALLY TO WINDOW (FOR INDEX.HTML & ELECTRON)
  // ==========================================================
  window.handleAISubmit = handleUserCommand;
  window.executeUserCommand = handleUserCommand;
  window.autoDismissInactivityPopups = autoDismissInactivityPopups;
  if (window.aiState) {
    window.aiState.ready = true;
    window.aiState.backendReady = true;
  }

  // ==========================================================
  // ENTER KEY & SUBMIT LISTENERS
  // ==========================================================
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = input.value.trim();
        if (cmd) {
          input.value = "";
          handleUserCommand(cmd);
        }
      }
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const cmd = input ? input.value.trim() : "";
      if (cmd) {
        if (input) input.value = "";
        handleUserCommand(cmd);
      }
    });
  }

  // ==========================================================
  // RENDER LIVE INTERVAL CARD (TIME-KEYED 4-VALUES ONLY)
  // ==========================================================
  function renderLiveIntervalCard(
    container,
    targetClass,
    initialData,
    initialIntervalMs = 5000,
  ) {
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
    <span>LIVE DATA (${escapeHTML(targetClass)})</span>
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

    const intervalLabel = document.createElement("span");
    intervalLabel.innerText = "⏱ Interval:";

    const intervalSelect = document.createElement("select");
    intervalSelect.className = "interval-select";
    intervalSelect.innerHTML = `
    <option value="5000" ${initialIntervalMs === 5000 ? "selected" : ""}>5s (Fast)</option>
    <option value="10000" ${initialIntervalMs === 10000 ? "selected" : ""}>10s (Normal)</option>
    <option value="15000" ${initialIntervalMs === 15000 ? "selected" : ""}>15s (Extended)</option>
    <option value="1000" ${initialIntervalMs === 1000 ? "selected" : ""}>1s (Turbo)</option>
    <option value="2000" ${initialIntervalMs === 2000 ? "selected" : ""}>2s</option>
  `;

    // Quick Interval Buttons
    const btn5s = document.createElement("button");
    btn5s.type = "button";
    btn5s.className = `interval-quick-btn ${initialIntervalMs === 5000 ? "active" : ""}`;
    btn5s.innerText = "5s";

    const btn10s = document.createElement("button");
    btn10s.type = "button";
    btn10s.className = `interval-quick-btn ${initialIntervalMs === 10000 ? "active" : ""}`;
    btn10s.innerText = "10s";

    const btn15s = document.createElement("button");
    btn15s.type = "button";
    btn15s.className = `interval-quick-btn ${initialIntervalMs === 15000 ? "active" : ""}`;
    btn15s.innerText = "15s";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.innerText = "📋 Copy JSON";

    const saveBlockBtn = document.createElement("button");
    saveBlockBtn.type = "button";
    saveBlockBtn.innerText = "💾 Save JSON Block";

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.innerText = "⏹ Stop";

    toolbar.appendChild(pauseBtn);
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(intervalLabel);
    toolbar.appendChild(intervalSelect);
    toolbar.appendChild(btn5s);
    toolbar.appendChild(btn10s);
    toolbar.appendChild(btn15s);
    toolbar.appendChild(copyBtn);
    toolbar.appendChild(saveBlockBtn);
    toolbar.appendChild(stopBtn);

    // Stats bar
    const statsBar = document.createElement("div");
    statsBar.className = "json-stats-bar";
    statsBar.innerHTML = `<span class="stat-chip highlight">Processing 4-values...</span>`;

    // Code block showing ONLY the time-keyed 4-values JSON
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
    let latestTimeValues = parseTimeToValues(initialData);

    async function updateView(rawData) {
      if (isStopped) return;

      // Check & dismiss any inactivity popups automatically
      await autoDismissInactivityPopups();

      // Parse into strictly time-keyed 4-values structure: [{"04:20pm": [15,5,5,5]}, ...]
      const timeItems = parseTimeToValues(rawData);
      latestTimeValues = timeItems;

      // Update time & tick
      meta.querySelector(".tick-count").innerText = `Tick #${tick++}`;
      meta.querySelector(".update-time").innerText = formatTime(new Date());

      const setsCount = timeItems.length;

      const chipsHTML = [
        `<span class="stat-chip highlight">🎯 Target: ${escapeHTML(targetClass)}</span>`,
        `<span class="stat-chip highlight">🔢 4-Value Sets: ${setsCount}</span>`,
        `<span class="stat-chip">⏱ Interval: ${currentInterval / 1000}s</span>`,
        `<span class="stat-chip highlight">🛡 Guard: Auto-OK</span>`,
      ].join(" ");

      statsBar.innerHTML = chipsHTML;

      // Update status text on Jarvis bar
      setStatus(
        `🟢 ${targetClass}: ${setsCount} data sets received | ${formatTime(new Date())}`,
      );

      // Update JSON syntax highlighting with ONLY the time-keyed 4-values JSON
      const formatted = JSON.stringify(timeItems, null, 2);
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
        await autoDismissInactivityPopups();

        const res = await fetch(
          `${BACKEND_URL}/iframe/data?class=${encodeURIComponent(targetClass)}&target=${encodeURIComponent(targetClass)}&onlyIframes=true`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            await updateView(json.data);
            return;
          } else if (json.success) {
            await updateView(json);
            return;
          }
        }
      } catch (err) {
        console.warn("Backend poll error:", err.message);
      }

      // Fallback: Direct Electron API
      if (
        window.browserAPI &&
        typeof window.browserAPI.getContainerData === "function"
      ) {
        try {
          const containers =
            await window.browserAPI.getContainerData(targetClass);
          await updateView({ containers });
        } catch (err) {
          console.warn("Electron API fallback error:", err.message);
        }
      }
    }

    // Start Interval Timer
    let timerId = setInterval(fetchLiveSVGData, currentInterval);

    // SSE stream
    let eventSource = null;
    try {
      eventSource = new EventSource(
        `${BACKEND_URL}/iframe/stream?target=${encodeURIComponent(targetClass)}&interval=${currentInterval}`,
      );
      eventSource.onmessage = async (event) => {
        if (isPaused || isStopped) return;
        try {
          const sseData = JSON.parse(event.data);
          if (sseData) {
            await updateView(sseData);
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
        liveIndicator.querySelector(".pulse-dot").className =
          "pulse-dot stopped";
        liveIndicator.querySelector("span:last-child").innerText =
          `STOPPED (${targetClass})`;
        pauseBtn.disabled = true;
        refreshBtn.disabled = true;
        stopBtn.disabled = true;
      },
      pause: () => {
        isPaused = true;
        liveIndicator.className = "live-indicator paused";
        liveIndicator.querySelector(".pulse-dot").className =
          "pulse-dot paused";
        liveIndicator.querySelector("span:last-child").innerText =
          `PAUSED (${targetClass})`;
        pauseBtn.innerText = "▶ Resume";
      },
      resume: () => {
        isPaused = false;
        liveIndicator.className = "live-indicator";
        liveIndicator.querySelector(".pulse-dot").className = "pulse-dot";
        liveIndicator.querySelector("span:last-child").innerText =
          `LIVE DATA (${targetClass})`;
        pauseBtn.innerText = "⏸ Pause";
        fetchLiveSVGData();
      },
      setIntervalMs: (newMs) => {
        currentInterval = newMs;
        clearInterval(timerId);
        timerId = setInterval(fetchLiveSVGData, currentInterval);
        setStatus(`Interval changed to ${newMs / 1000}s for ${targetClass}`);
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
      if (latestTimeValues) {
        navigator.clipboard.writeText(
          JSON.stringify(latestTimeValues, null, 2),
        );
        copyBtn.innerText = "✅ Copied!";
        setTimeout(() => {
          copyBtn.innerText = "📋 Copy JSON";
        }, 1500);
      }
    });

    saveBlockBtn.addEventListener("click", () => {
      if (!latestTimeValues?.length) {
        saveBlockBtn.innerText = "⚠️ No JSON";
        setTimeout(() => (saveBlockBtn.innerText = "💾 Save JSON Block"), 1400);
        return;
      }

      const blob = new Blob([JSON.stringify(latestTimeValues, null, 2)], {
        type: "application/json",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `live-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      saveBlockBtn.innerText = "✅ Downloaded";
      setTimeout(() => (saveBlockBtn.innerText = "💾 Save JSON Block"), 1500);
    });

    function setQuickInterval(ms, btn) {
      watcher.setIntervalMs(ms);
      intervalSelect.value = String(ms);
      [btn5s, btn10s, btn15s].forEach((b) => b.classList.remove("active"));
      if (btn) btn.classList.add("active");
    }

    btn5s.addEventListener("click", () => setQuickInterval(5000, btn5s));
    btn10s.addEventListener("click", () => setQuickInterval(10000, btn10s));
    btn15s.addEventListener("click", () => setQuickInterval(15000, btn15s));

    intervalSelect.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (val) {
        watcher.setIntervalMs(val);
        [btn5s, btn10s, btn15s].forEach((b) => b.classList.remove("active"));
        if (val === 5000) btn5s.classList.add("active");
        if (val === 10000) btn10s.classList.add("active");
        if (val === 15000) btn15s.classList.add("active");
      }
    });

    stopBtn.addEventListener("click", () => {
      watcher.stop();
      activeIntervalWatcher = null;
      setStatus(`Stopped interval tracking and DB saving for ${targetClass}`);
    });
  }

  // ==========================================================
  // SYNTAX HIGHLIGHT JSON
  // ==========================================================
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

  // ==========================================================
  // UI MESSAGE BLOCK
  // ==========================================================
  function createMessageBlock(payload) {
    const conversation = document.getElementById("assistantConversation");
    if (!conversation) return;

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

    conversation.appendChild(block);
    scrollLogsToBottom();

    currentTextNode = span;
    currentMsgContainer = ai;
  }

  // ==========================================================
  // LOG
  // ==========================================================
  function logResp(msg) {
    if (!currentTextNode) return;
    currentTextNode.innerText = msg;
    scrollLogsToBottom();
  }

  // ==========================================================
  // SET STATUS TEXT
  // ==========================================================
  function setStatus(text) {
    const statusEl = document.getElementById("statusText");
    if (statusEl) {
      statusEl.innerText = text;
      statusEl.closest(".statusBlock").dataset.state =
        /analyz/i.test(text) ? "analyzing" :
        /working/i.test(text) ? "working" :
        /unable|error|failed/i.test(text) ? "error" : "ready";
    }
  }

  // ==========================================================
  // HELPERS
  // ==========================================================
  function scrollLogsToBottom() {
    const conversation = document.getElementById("assistantConversation");
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }

  function formatTime(date) {
    const d = date || new Date();
    return (
      d.toTimeString().split(" ")[0] +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
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
})();
