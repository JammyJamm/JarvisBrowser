const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

let currentTextNode;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const cmd = input.value.trim();
  if (!cmd) return;

  createMessageBlock(cmd);
  startShimmer();

  if (isActionCommand(cmd)) {
    await handleAction(cmd);
  } else {
    await handleChat(cmd);
  }

  input.value = "";
  stopShimmer();
});

function isActionCommand(cmd) {
  const keywords = ["click", "open", "press", "select", "go", "scroll"];
  return keywords.some((k) => cmd.toLowerCase().includes(k));
}

async function handleAction(cmd) {
  const res = await fetch("http://localhost:3001/ai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command: cmd }),
  });

  const data = await res.json();

  logResp(JSON.stringify(data.action, null, 2));

  document.getElementById("webview").loadURL(data.url);
}

async function handleChat(cmd) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3",
      prompt: cmd,
      stream: false,
    }),
  });

  const data = await res.json();

  logResp(data.response);
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
