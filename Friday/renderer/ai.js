const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const cmd = input.value.trim();
  if (!cmd) return;

  runAI(cmd);
  input.value = "";
});

// INTENT DETECTION

function isActionCommand(cmd) {
  const keywords = ["click", "open", "press", "select", "go", "scroll"];
  return keywords.some((k) => cmd.toLowerCase().includes(k));
}
// MAIN ROUTER

async function runAI(cmd) {
  // log(cmd);

  if (isActionCommand(cmd)) {
    return handleAction(cmd);
  } else {
    return handleChatDirect(cmd);
  }
}

// FRONTEND → OLLAMA (NO BACKEND)

async function handleChatDirect(cmd) {
  log(" Thinking...");

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
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

    // Ollama sends JSON per line
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.response) {
          log(json.response);
        }
      } catch {}
    }
  }
}

// ACTION → BACKEND

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

// STREAM HANDLER (ACTION)

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
          log("🧠 " + json.response);
        }
      } catch {}
    }
  }

  const action = extractJSON(fullText);

  if (action) {
    log("⚡ ACTION: " + JSON.stringify(action, null, 2));
    executeAI(action);
  } else {
    log("❌ No valid action found");
  }
}

//JSON EXTRACT

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

// EXECUTION

function executeAI(action) {
  const webview = document.getElementById("webview");

  if (!action || action.action !== "click") {
    log("❌ Invalid action format");
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
    .then((r) => log("⚡ " + r))
    .catch((e) => log("❌ " + e.message));
}

// LOGGER

function log(msg) {
  const logs = document.getElementById("logs");

  const div = document.createElement("div");
  div.innerText = msg;

  logs.appendChild(div);
  logs.scrollTop = logs.scrollHeight;
}
