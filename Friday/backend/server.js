const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const MCP = require("./mcp");

const app = express();

app.use(cors());
app.use(express.json());

let browser, page;

// =====================
// INIT
// =====================
app.post("/init", async (req, res) => {
  if (!browser) {
    browser = await chromium.launch({ headless: false });

    const context = await browser.newContext();
    page = await context.newPage();
  }

  await page.goto(req.body.url);

  res.json({
    success: true,
    url: page.url(),
  });
});

// =====================
// SAFE PARSE
// =====================
function safeParse(raw) {
  raw = raw
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const match = raw.match(/\[[\s\S]*\]/);

  if (!match) throw new Error("Planner parse failed");

  return JSON.parse(match[0]);
}

// =====================
// DOM
// =====================
async function getDOM() {
  return page.evaluate(() => ({
    buttons: [
      ...document.querySelectorAll(
        "button,a,[role='button'],input[type='submit']",
      ),
    ].map((b) => ({
      text: (b.innerText || b.value || "").trim(),
    })),

    inputs: [...document.querySelectorAll("input")].map((i) => ({
      placeholder: i.placeholder || "",
      name: i.name || "",
      type: i.type || "",
    })),

    text: document.body.innerText.slice(0, 3000),
  }));
}

// =====================
// FAST REGEX PLANNER
// =====================
function regexPlan(command) {
  const steps = [];

  const parts = command
    .split(/\d+\)/)
    .map((x) => x.trim())
    .filter(Boolean);

  for (const p of parts) {
    const lower = p.toLowerCase();

    if (lower.startsWith("click")) {
      steps.push({
        tool: "click",
        args: {
          text: p.replace(/click/i, "").trim(),
        },
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
          args: {
            title: m[1],
          },
        });
      }
    }
  }

  return steps.length ? steps : null;
}

// =====================
// QWEN FALLBACK
// =====================
async function qwenPlan(command) {
  const dom = await getDOM();

  const prompt = `
Return ONLY JSON array.

Schema:
[
 {"tool":"click","args":{"text":"..."}},
 {"tool":"type","args":{"field":"...","value":"..."}},
 {"tool":"read","args":{"title":"..."}}
]

DOM:
${JSON.stringify(dom, null, 2)}

Command:
${command}
`;

  const r = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3:latest",
      prompt,
      stream: false,
      options: {
        temperature: 0,
        top_p: 0.1,
      },
    }),
  });

  const json = await r.json();

  return safeParse(json.response);
}

// =====================
// PLAN
// =====================
async function plan(command) {
  return regexPlan(command) || (await qwenPlan(command));
}

// =====================
// AI
// =====================
app.post("/ai", async (req, res) => {
  try {
    const steps = await plan(req.body.command);

    res.json({
      success: true,
      steps,
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
      .waitForLoadState("networkidle", { timeout: 2500 })
      .catch(() => {});

    await page.waitForTimeout(400);

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

app.listen(3001, () => console.log("Planner ready"));
