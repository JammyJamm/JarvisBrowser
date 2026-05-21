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
  const lower = String(command).toLowerCase();

  // Read page fast path
  if (
    lower.includes("read page") ||
    lower.includes("read current") ||
    lower.includes("get page")
  ) {
    return [
      {
        tool: "read",
        args: { title: "" },
      },
    ];
  }

  // Go back fast path
  if (
    lower.includes("go back") ||
    lower.includes("back") ||
    lower.includes("previous")
  ) {
    return [
      {
        tool: "goback",
        args: {},
      },
    ];
  }

  // Go forward fast path
  if (
    lower.includes("go forward") ||
    lower.includes("forward") ||
    lower.includes("next page")
  ) {
    return [
      {
        tool: "goforward",
        args: {},
      },
    ];
  }

  // Refresh/reload fast path
  if (
    lower.includes("refresh") ||
    lower.includes("reload") ||
    lower.includes("retry")
  ) {
    return [
      {
        tool: "refresh",
        args: {},
      },
    ];
  }

  // Extract navigation if present
  let navUrl = null;
  if (
    lower.includes("go to") ||
    lower.includes("navigate to") ||
    lower.includes("visit")
  ) {
    // First, try to extract an actual URL
    const urlMatch = command.match(/https?:\/\/[^\s\n]+/i);

    if (urlMatch) {
      navUrl = urlMatch[0];
      steps.push({
        tool: "navigate",
        args: { url: navUrl },
      });
    } else {
      // Fallback: extract text after "go to" until newline
      const m = command.match(/(?:go to|navigate to|visit)\s+(.+?)(?:\n|$)/i);

      if (m) {
        let domain = m[1].trim();
        if (domain) {
          let url = domain;
          if (!url.startsWith("http")) {
            url = "https://" + url;
          }
          if (!url.includes(".")) {
            url = "https://" + domain + ".com";
          }
          navUrl = url;
          steps.push({
            tool: "navigate",
            args: { url },
          });
        }
      }
    }
  }

  // Parse remaining instructions
  const lines = String(command)
    .split(/\n/)
    .map((x) =>
      x
        .trim()
        .replace(/^\d+\)\s*/, "") // remove 1) 2) 3)
        .replace(/^-\s*/, ""),
    )
    .filter(Boolean);

  for (const line of lines) {
    const lineLower = line.toLowerCase();

    // Skip navigation lines
    if (
      lineLower.includes("go to") ||
      lineLower.includes("navigate to") ||
      lineLower.includes("visit") ||
      lineLower.includes("find my input")
    ) {
      continue;
    }

    if (/^click\b/i.test(line)) {
      steps.push({
        tool: "click",
        args: {
          text: line
            .replace(/^click\s*/i, "")
            .replace(/\s*\(.*?\)\s*$/, "")
            .replace(/\bbutton\b$/i, "")
            .replace(/^["']|["']$/g, "")
            .trim(),
        },
      });
    } else if (/^type\b/i.test(line)) {
      // Try format: "Type [field] as [value]"

      let m =
        line.match(/type\s+(.+?)\s+as\s+(.+)/i) ||
        line.match(/type\s+(.+?)\s+["'](.+?)["']/i);

      if (m) {
        steps.push({
          tool: "type",
          args: {
            field: m[1].trim().replace(/^["']|["']$/g, ""),
            value: m[2].trim().replace(/^["']|["']$/g, ""),
          },
        });
      }
    } else if (/^(read|get)\b/i.test(line)) {
      let title = "";

      const quoted = line.match(/"(.*?)"/);
      if (quoted) {
        title = quoted[1];
      } else {
        const m = line.match(
          /(?:read|get)\s+(.+?)(?:\s+(?:passage|from|in)|$)/i,
        );
        if (m) {
          title = m[1].trim();
        }
      }

      if (title) {
        steps.push({
          tool: "read",
          args: { title },
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
