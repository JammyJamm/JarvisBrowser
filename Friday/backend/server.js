const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();
app.use(cors());
app.use(express.json());

let browser;
let page;

(async () => {
  browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext();
  page = await context.newPage();

  await page.goto("https://example.com");
})();

// =========================
// MIRROR STATE
// =========================
app.get("/state", async (req, res) => {
  res.json({
    url: page.url(),
  });
});

// =========================
// NAVIGATION
// =========================
app.post("/navigate", async (req, res) => {
  const { url } = req.body;

  await page.goto(url);

  res.json({
    success: true,
    url: page.url(),
  });
});

// =========================
// AI ACTION
// =========================
app.post("/ai", async (req, res) => {
  try {
    const { command } = req.body;
    const cmd = command.toLowerCase();

    const buttons = await page.$$eval("button,a,[role='button']", (els) =>
      els.map((b, i) => ({
        text: (b.innerText || "").trim(),
        index: i,
      })),
    );

    let match = buttons.find((b) => cmd.includes(b.text.toLowerCase()));

    if (!match) {
      match = buttons.find((b) =>
        b.text.toLowerCase().includes(cmd.replace("click ", "").trim()),
      );
    }

    // -------------------------
    // LLM fallback
    // -------------------------
    if (!match) {
      const prompt = `
Pick best button.

Command: "${command}"

Buttons:
${buttons.map((b) => `${b.index}: ${b.text}`).join("\n")}

Return ONLY JSON:
{"index":number}
`;

      const ollamaRes = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen3:0.6b",
          prompt,
          stream: false,
        }),
      });

      const json = await ollamaRes.json();

      const clean = json.response.match(/\{[\s\S]*\}/);

      if (clean) {
        const parsed = JSON.parse(clean[0]);
        match = buttons[parsed.index];
      }
    }

    if (!match) {
      return res.json({
        success: false,
        error: "No match found",
      });
    }

    const els = await page.$$("button,a,[role='button']");

    await els[match.index].click();

    await page
      .waitForLoadState("networkidle", {
        timeout: 5000,
      })
      .catch(() => {});

    res.json({
      success: true,
      url: page.url(),
      action: match,
    });
  } catch (err) {
    console.error("AI ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.listen(3001, () => {
  console.log("AI server running :3001");
});
