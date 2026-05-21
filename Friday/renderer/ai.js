const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

let currentTextNode;
let currentSteps = [];
let currentStepIndex = 0;

// ==========================
// PLANNER STATE
// ==========================
function initializePlanner(steps) {
  currentSteps = steps;
  currentStepIndex = 0;

  // Create planner message block
  const logs = document.getElementById("logs");
  const block = document.createElement("div");
  block.classList.add("msg-block");

  const header = document.createElement("div");
  header.classList.add("ai-msg");
  header.innerHTML = `<strong>🔄 Executing ${steps.length} Steps...</strong>`;
  block.appendChild(header);

  // Add step list
  const stepListDiv = document.createElement("div");
  stepListDiv.id = "step-list-container";
  stepListDiv.classList.add("planner-steps");

  steps.forEach((step, idx) => {
    const stepDiv = document.createElement("div");
    stepDiv.classList.add("step-item");
    stepDiv.id = `step-${idx}`;
    stepDiv.innerHTML = `
      <div class="step-number">${idx + 1}</div>
      <div class="step-content">
        <div class="step-action">${step.tool.toUpperCase()}</div>
        <div class="step-details">${JSON.stringify(step.args)}</div>
      </div>
      <div class="step-status"></div>
    `;
    stepListDiv.appendChild(stepDiv);
  });

  block.appendChild(stepListDiv);
  logs.appendChild(block);
  logs.scrollTop = logs.scrollHeight;
}

function updateStepStatus(stepIdx, status, message) {
  const stepEl = document.getElementById(`step-${stepIdx}`);
  if (!stepEl) return;

  stepEl.classList.remove("active", "success", "error");
  stepEl.classList.add(status);

  let statusText = "";
  if (status === "active") statusText = "Executing...";
  else if (status === "success") statusText = "✓ Complete";
  else if (status === "error") statusText = `✕ ${message}`;

  const existingStatus = stepEl.querySelector(".step-status");
  if (existingStatus) existingStatus.remove();

  if (statusText) {
    const statusDiv = document.createElement("div");
    statusDiv.className = "step-status";
    statusDiv.textContent = statusText;
    stepEl.querySelector(".step-content").appendChild(statusDiv);
  }
}

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

  createMessageBlock(cmd);
  startShimmer();

  try {
    const res = await fetch("http://localhost:3001/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: cmd,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();

    if (!data.success) {
      logResp(data.error || "Unknown error occurred");
      stopShimmer();
      return;
    }

    // CHAT MODE
    if (data.mode === "chat") {
      logResp(data.reply);
      stopShimmer();
      input.value = "";
      return;
    }

    // ACTION MODE - PLANNER
    if (data.steps && data.steps.length > 0) {
      initializePlanner(data.steps);

      for (let i = 0; i < data.steps.length; i++) {
        currentStepIndex = i;
        const step = data.steps[i];

        updateStepStatus(i, "active");

        try {
          await runStep(step, i);
          updateStepStatus(i, "success");
        } catch (err) {
          updateStepStatus(i, "error", err.message);
          logResp(`Step ${i + 1} failed: ${err.message}`);
          throw err;
        }
      }
    }

    input.value = "";
    stopShimmer();
  } catch (err) {
    logResp(`Error: ${err.message}`);
    stopShimmer();
  }
});

// ==========================
// RUN STEP
// ==========================
async function runStep(step, stepIdx) {
  logResp(`[Step ${stepIdx + 1}] Executing: ${step.tool}`);

  const r = await fetch("http://localhost:3001/step", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(step),
  });

  const d = await r.json();

  if (!d.success) {
    logResp(`[Step ${stepIdx + 1}] ERROR: ${d.error}`);
    throw new Error(d.error);
  }

  await mirror(d.url, d.html);

  if (d.content) {
    logResp(`[Step ${stepIdx + 1}] READ:\n\n${d.content}`);
  }

  logResp(`[Step ${stepIdx + 1}] Completed ✓`);
}

// ==========================
// MIRROR PLAYWRIGHT → WEBVIEW
// ==========================
async function mirror(url, html) {
  const webview = document.getElementById("webview");

  return new Promise((resolve) => {
    const done = () => {
      webview.removeEventListener("did-finish-load", done);
      resolve();
    };

    webview.addEventListener("did-finish-load", done);

    webview.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  });
}

// ==========================
// UI BLOCK
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

  logs.scrollTop = logs.scrollHeight;

  currentTextNode = span;
}

// ==========================
// LOG
// ==========================
function logResp(msg) {
  if (!currentTextNode) return;

  currentTextNode.innerText = msg;
}

// ==========================
// SHIMMER
// ==========================
function startShimmer() {
  document.querySelector(".animation").classList.add("active");
}

function stopShimmer() {
  document.querySelector(".animation").classList.remove("active");
}
