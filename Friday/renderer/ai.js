const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

let currentTextNode;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const cmd = input.value.trim();

  if (!cmd) return;

  createMessageBlock(cmd);

  startShimmer();

  await handleAction(cmd);

  stopShimmer();

  input.value = "";
});

async function mirror(url) {
  const webview = document.getElementById("webview");

  return new Promise((resolve) => {
    webview.addEventListener("dom-ready", () => resolve(), { once: true });

    webview.loadURL(url);
  });
}

async function handleAction(cmd) {
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
    return;
  }

  if (data.mode === "single") {
    logResp(JSON.stringify(data.action, null, 2));

    await mirror(data.url);

    return;
  }

  for (const step of data.steps) {
    logResp(step);

    const r = await fetch("http://localhost:3001/step", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instruction: step,
      }),
    });

    const d = await r.json();

    if (!d.success) {
      logResp(d.error);
      return;
    }

    await mirror(d.url);
  }
}

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

  currentTextNode = span;
}

function logResp(msg) {
  currentTextNode.innerText = msg;
}

function startShimmer() {
  document.querySelector(".animation").classList.add("active");
}

function stopShimmer() {
  document.querySelector(".animation").classList.remove("active");
}
