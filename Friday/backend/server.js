const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const MCP = require("./mcp");

const app = express();

app.use(cors());
app.use(express.json());

const MODEL = "qwen3:8b";

let browser = null;
let page = null;

async function connectCDP() {
  let lastError;

  for (let i = 0; i < 30; i++) {
    try {
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

      console.log("✅ Connected to Electron CDP");

      return browser;
    } catch (err) {
      lastError = err;

      console.log(`Waiting for Electron CDP... ${i + 1}/30`);

      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  throw lastError;
}

app.post("/init", async (req, res) => {
  try {
    const p = await getActivePage();

    fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: "hi",
        stream: false,
      }),
    }).catch(() => {});

    res.json({
      success: true,
      url: p.url(),
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================
// DOM
// =====================
async function getDOM() {
  const p = await ensurePage();

  return await p.evaluate(() => ({
    text: document.body.innerText.slice(0, 3000),
  }));
}
async function connectCDP() {
  console.log("Connecting to Electron CDP...");

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

  return browser;
}

async function getActivePage() {
  if (!browser) {
    browser = await connectCDP();
  }

  for (let i = 0; i < 30; i++) {
    const contexts = browser.contexts();

    if (contexts.length) {
      const ctx = contexts[0];

      const pages = ctx.pages();

      const page = pages.find(
        (p) =>
          !p.url().startsWith("devtools://") &&
          !p.url().startsWith("chrome://"),
      );

      if (page) {
        return page;
      }
    }

    console.log(`Waiting for Electron page... (${i + 1}/30)`);

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("Electron page not found");
}
async function getActivePage() {
  if (!browser) {
    browser = await connectCDP();
  }

  const contexts = browser.contexts();

  if (!contexts.length) {
    throw new Error("No Electron context found");
  }

  context = contexts[0];

  const pages = context.pages();

  const active =
    pages.find(
      (p) =>
        !p.url().startsWith("devtools://") && !p.url().startsWith("chrome://"),
    ) || pages[0];

  if (!active) {
    throw new Error("No active page found");
  }

  page = active;

  return page;
}
async function ensurePage() {
  return await getActivePage();
}

// =====================
// REGEX FAST PATH
// =====================
function regexPlan(command) {
  const steps = [];

  const parts = String(command)
    .split(/\d+\)/)
    .map((x) => x.trim())
    .filter(Boolean);

  for (const p of parts) {
    const lower = p.toLowerCase();

    if (lower.startsWith("click")) {
      steps.push({
        tool: "click",
        args: { text: p.replace(/click/i, "").trim() },
      });
    } else if (lower.startsWith("type")) {
      const m = p.match(/type\s+(.+?)\s+as\s+(.+)/i);

      if (m) {
        steps.push({
          tool: "type",
          args: {
            field: m[1],
            value: m[2],
          },
        });
      }
    } else if (lower.startsWith("read") || lower.startsWith("get")) {
      const m = p.match(/"(.*?)"/) || p.match(/read\s+(.+?)\s+passage/i);

      if (m) {
        steps.push({
          tool: "read",
          args: { title: m[1] },
        });
      }
    }
  }

  return steps.length ? steps : null;
}

// =====================
// SAFE PARSE
// =====================
function safeParse(raw) {
  raw = raw.replace(/```json|```/g, "").trim();

  const m = raw.match(/\{[\s\S]*\}/);

  if (!m) return null;

  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// =====================
// QWEN ROUTER
// =====================
async function aiRouter(command) {
  const fast = regexPlan(command);

  if (fast) {
    return {
      mode: "action",
      steps: fast,
    };
  }

  const dom = await getDOM();

  const prompt = `
Return ONLY valid JSON.

CHAT:
{"mode":"chat","reply":"..."}

ACTION:
{
"mode":"action",
"steps":[
{"tool":"click","args":{"text":"..."}},
{"tool":"type","args":{"field":"...","value":"..."}},
{"tool":"read","args":{"title":"..."}}
]
}

PAGE:
${dom.text}

USER:
${command}
`;

  const r = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0,
      },
    }),
  });

  const json = await r.json();

  return (
    safeParse(json.response) || {
      mode: "chat",
      reply: json.response,
    }
  );
}

// =====================
// AI
// =====================
app.post("/ai", async (req, res) => {
  try {
    const result = await aiRouter(req.body.command);

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================
// NAVIGAtion
// =====================
app.post("/navigate", async (req, res) => {
  res.json({
    success: true,
  });
});

// =====================
// STEP
// =====================
app.post("/step", async (req, res) => {
  try {
    const p = await ensurePage();

    const result = await MCP.execute({ page: p }, req.body.tool, req.body.args);

    await p
      .waitForLoadState("domcontentloaded", {
        timeout: 3000,
      })
      .catch(() => {});

    res.json({
      success: true,
      ...result,
      url: p.url(),
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.listen(3001, () => console.log("Jarvis ready :3001"));
