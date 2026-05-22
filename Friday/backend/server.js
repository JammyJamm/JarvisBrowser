const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const MCP = require("./mcp");

const app = express();
app.use(cors());
app.use(express.json());

let browser, page;

// const MODEL = "qwen3:8b";
const MODEL = "llama3";
// =====================
// INIT
// =====================
app.post("/init", async (req, res) => {
  try {
    if (!browser) {
      browser = await chromium.launch({
        headless: false,
        args: ["--start-maximized"],
      });

      const context = await browser.newContext({
        viewport: null,
      });

      page = await context.newPage();
      page.on("console", async (msg) => {
        try {
          const vals = await Promise.all(
            msg.args().map((a) => a.jsonValue().catch(() => null)),
          );

          console.log("\n=== PLAYWRIGHT BROWSER LOG ===");
          console.log(msg.text());

          if (vals.length) {
            console.dir(vals, { depth: null });
          }

          console.log("=============================\n");
        } catch {}
      });
      fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt: "hi",
          stream: false,
        }),
      }).catch(() => {});
    }

    const url = req.body?.url || "https://example.com";

    await page.goto(url, {
      waitUntil: "networkidle",
    });

    res.json({
      success: true,
      url: page.url(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});
app.get("/cookies", async (_, res) => {
  try {
    const cookies = await page.context().cookies();

    res.json({
      success: true,
      cookies,
      url: page.url(),
    });
  } catch (e) {
    res.json({
      success: false,
      error: e.message,
    });
  }
});
// =====================
// DOM
// =====================
async function getDOM() {
  return await page.evaluate(() => ({
    text: document.body.innerText.slice(0, 3000),
  }));
}
async function getHTML() {
  return await page.content();
}

// =====================
// REGEX FAST PATH
// =====================
function regexPlan(command) {
  const steps = [];

  const lines = String(command)
    .split(/\n+/)
    .map((x) =>
      x
        .trim()
        .replace(/^\d+\)\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .replace(/^-\s*/, ""),
    )
    .filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();

    // NAVIGATE
    if (/^(navigate to|go to|visit)\b/i.test(line)) {
      const urlMatch = line.match(/https?:\/\/[^\s]+/i);

      if (urlMatch) {
        steps.push({
          tool: "navigate",
          args: { url: urlMatch[0] },
        });
      }

      continue;
    }

    // SUBMIT LOGIN
    if (/^submit\b/i.test(line) || lower.includes("submit login form")) {
      steps.push({
        tool: "click",
        args: { text: "Log in" },
      });

      continue;
    }

    // IFRAME CLICK
    if (/^inside iframe click\b/i.test(line)) {
      const txt = line
        .replace(/^inside iframe click\s*/i, "")
        .replace(/^category\s*/i, "")
        .replace(/^["']|["']$/g, "")
        .trim();

      steps.push({
        tool: "iframeClick",
        args: { text: txt },
      });

      continue;
    }

    // CLICK
    if (/^click\b/i.test(line)) {
      let txt =
        line.match(/"([^"]+)"/)?.[1] ||
        line
          .replace(/^click\s*/i, "")
          .replace(/^the\s+tab\s+/i, "")
          .replace(/^tab\s+/i, "")
          .replace(/\bbutton\b$/i, "")
          .trim();

      steps.push({
        tool: "click",
        args: { text: txt },
      });

      continue;
    }

    // TYPE
    if (/^type\b/i.test(line)) {
      const m = line.match(/^type\s+(.+?)\s+"([^"]+)"$/i);

      if (m) {
        steps.push({
          tool: "type",
          args: {
            field: m[1].trim(),
            value: m[2],
          },
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
  if (!raw) return null;

  raw = String(raw)
    .replace(/```json|```/g, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;

    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
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
  const parsed = safeParse(json.response);

  if (parsed) {
    return parsed;
  }

  return {
    mode: "chat",
    reply: String(json.response)
      .replace(/```json|```/g, "")
      .trim(),
  };
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
// STEP
// =====================
app.post("/step", async (req, res) => {
  try {
    const result = await MCP.execute({ page }, req.body.tool, req.body.args);

    await page
      .waitForLoadState("networkidle", {
        timeout: 10000,
      })
      .catch(() => {});

    await page.waitForTimeout(1500);

    res.json({
      success: true,
      ...result,
      url: page.url(),
      html: await getHTML(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});
app.post("/canvas", async (req, res) => {
  try {
    const result = await MCP.execute({ page }, "readCanvas", req.body);

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
// NAVIGATE
// =====================
app.post("/navigate", async (req, res) => {
  try {
    const result = await MCP.execute({ page }, "navigate", {
      url: req.body.url,
    });

    res.json({
      success: true,
      ...result,
      url: page.url(),
      html: await getHTML(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.listen(3001, () => console.log("Jarvis ready :3001"));
