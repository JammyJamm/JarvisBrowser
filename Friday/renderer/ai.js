const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

let currentTextNode;

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
    const data = await res.json();

    if (!data.success) {
      logResp(data.error);
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

    // ACTION MODE
    for (const step of data.steps) {
      await runStep(step);
    }

    input.value = "";
    stopShimmer();

    input.value = "";
  } catch (err) {
    logResp(err.message);
  }

  stopShimmer();
});

// ==========================
// RUN STEP
// ==========================
async function runStep(step) {
  logResp("STEP:\n" + JSON.stringify(step, null, 2));

  const r = await fetch("http://localhost:3001/step", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(step),
  });

  const d = await r.json();

  if (!d.success) {
    logResp("ERROR:\n" + d.error);
    throw new Error(d.error);
  }

  await mirror(d.url);

  if (d.content) {
    logResp("READ:\n\n" + d.content);
  }
}

// ==========================
// MIRROR PLAYWRIGHT → WEBVIEW
// ==========================
async function mirror(url) {
  const webview = document.getElementById("webview");

  return new Promise((resolve) => {
    const done = () => {
      webview.removeEventListener("dom-ready", done);

      resolve();
    };

    webview.addEventListener("dom-ready", done);

    webview.loadURL(url);
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
