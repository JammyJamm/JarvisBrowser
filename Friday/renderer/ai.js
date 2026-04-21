const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

let currentBlock = null;

// FORM SUBMIT
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const cmd = input.value.trim();
  if (!cmd) return;

  runAI(cmd);
  input.value = "";
});

// 🧠 INTENT DETECTION
function isActionCommand(cmd) {
  const keywords = ["click", "open", "press", "select", "go", "scroll"];
  return keywords.some((k) => cmd.toLowerCase().includes(k));
}

// 🚀 MAIN ROUTER
async function runAI(cmd) {
  createMessageBlock(cmd); // ✅ create block

  if (isActionCommand(cmd)) {
    return handleAction(cmd);
  } else {
    return handleChatDirect(cmd);
  }
}

// 💬 FRONTEND → OLLAMA
async function handleChatDirect(cmd) {
  logResp("🤖 Thinking...\n");

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3",
      prompt: cmd,
      stream: true,
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.response) {
          logResp(json.response); // stream inside block
        }
      } catch {}
    }
  }
}

// ⚡ ACTION → BACKEND
async function handleAction(cmd) {
  const webview = document.getElementById("webview");

  const page = await webview.executeJavaScript(`
    ({
      buttons: [...document.querySelectorAll("button,a,[role='button']")]
        .map((b, i) => ({
          text: (b.innerText || "").trim(),
          index: i
        }))
        .filter(b => b.text)
        .slice(0, 40)
    })
  `);

  const res = await fetch("http://localhost:3001/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: cmd, page }),
  });

  await handleActionStream(res);
}

// 🔁 STREAM HANDLER
async function handleActionStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop();

    for (let part of parts) {
      if (!part.startsWith("data:")) continue;

      const data = part.replace("data:", "").trim();
      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);

        if (json.response) {
          fullText += json.response;
          logResp("🧠 " + json.response);
        }
      } catch {}
    }
  }

  const action = extractJSON(fullText);

  if (action) {
    logResp("\n⚡ ACTION: " + JSON.stringify(action, null, 2));
    executeAI(action);
  } else {
    logResp("\n❌ No valid action found");
  }
}

// 🧠 JSON EXTRACT
function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*?\}/g);
    if (!match) return null;

    for (let i = match.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(match[i]);
      } catch {}
    }

    return null;
  } catch {
    return null;
  }
}

// ⚡ EXECUTION
function executeAI(action) {
  const webview = document.getElementById("webview");

  if (!action || action.action !== "click") {
    logResp("\n❌ Invalid action format");
    return;
  }

  const index = typeof action.index === "number" ? action.index : null;

  const script = `
    (function(){
      const elements = [...document.querySelectorAll("button,a,[role='button']")];

      if (${index} !== null && elements[${index}]) {
        const el = elements[${index}];
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "3px solid red";
        setTimeout(() => el.click(), 300);
        return "Clicked index: ${index}";
      }

      return "Not found";
    })();
  `;

  webview
    .executeJavaScript(script)
    .then((r) => logResp("\n⚡ " + r))
    .catch((e) => logResp("\n❌ " + e.message));
}

// 🎨 CREATE MESSAGE BLOCK
function createMessageBlock(payload) {
  const logs = document.getElementById("logs");

  const block = document.createElement("div");
  block.classList.add("msg-block");

  const user = document.createElement("div");
  user.classList.add("user-msg");
  user.innerText = payload;

  const ai = document.createElement("div");
  ai.classList.add("ai-msg");

  block.appendChild(user);
  block.appendChild(ai);

  logs.appendChild(block);
  logs.scrollTop = logs.scrollHeight;

  currentBlock = ai; // ✅ attach AI output here
}

// 🧾 RESPONSE LOGGER (ONLY THIS NOW)
function logResp(msg) {
  if (!currentBlock) return;

  const span = document.createElement("span");
  span.innerText = msg;

  currentBlock.appendChild(span);
}
