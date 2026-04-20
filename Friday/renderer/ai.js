const form = document.getElementById("ai-form");
const input = document.getElementById("cmd");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const cmd = input.value.trim();
  if (!cmd) return;

  runAI(cmd);
  input.value = "";
});

async function runAI(cmd) {
  log("Log " + cmd);

  const webview = document.getElementById("webview");

  const page = await webview.executeJavaScript(`
    ({
      buttons: [...document.querySelectorAll("button,a,[role='button']")]
        .map(b => ({text: b.innerText.trim()}))
        .filter(b => b.text)
        .slice(0,20)
    })
  `);

  const res = await fetch("http://localhost:3001/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: cmd, page }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let finalText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 🔥 split SSE messages
    const parts = buffer.split("\n\n");
    buffer = parts.pop(); // keep incomplete part

    for (let part of parts) {
      if (!part.startsWith("data:")) continue;

      let data = part.replace("data:", "").trim();

      if (data === "[DONE]") continue;

      try {
        const json = JSON.parse(data);

        if (json.response) {
          finalText += json.response;

          // 🧠 show clean thinking
          log("🧠 " + json.response);
        }
      } catch {
        // ignore broken chunks
      }
    }
  }

  // 🔥 extract final JSON action
  const match = finalText.match(/\{[\s\S]*\}/);

  if (match) {
    const action = JSON.parse(match[0]);
    log("⚡ ACTION: " + JSON.stringify(action));
    executeAI(action);
  } else {
    log("❌ No valid action found");
  }
}

function executeAI(action) {
  const webview = document.getElementById("webview");

  const script = `
    (function(){
      const text="${action.value}".toLowerCase();

      const el=[...document.querySelectorAll("button,a,[role='button']")]
        .find(e => (e.innerText||"").toLowerCase().includes(text));

      if(!el) return "Not found";

      el.scrollIntoView({behavior:"smooth",block:"center"});
      el.style.outline="3px solid red";
      el.click();

      return "Clicked";
    })();
  `;

  webview
    .executeJavaScript(script)
    .then((r) => log("⚡ " + r))
    .catch((e) => log("❌ " + e.message));
}

function log(msg) {
  const logs = document.getElementById("logs");
  const div = document.createElement("div");
  div.innerText = msg;
  logs.appendChild(div);
}
