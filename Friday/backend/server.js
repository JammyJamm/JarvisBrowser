const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(cors());
app.use(express.json());

let browser;
let page;

(async () => {
  browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto("https://example.com");
})();

async function settle() {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

async function smartWait(oldUrl) {
  try {
    await page.waitForURL((u) => u.toString() !== oldUrl, {
      timeout: 2500,
    });

    await settle();
    return;
  } catch {}

  await page.waitForTimeout(400);
}

async function getDOM() {
  await settle();

  return page.evaluate(() => ({
    buttons: [
      ...document.querySelectorAll(
        "button,a,[role='button'],input[type='submit']",
      ),
    ].map((b, i) => ({
      text: (b.innerText || b.value || "").trim(),
      index: i,
    })),

    inputs: [...document.querySelectorAll("input")].map((i, idx) => ({
      type: i.type || "",
      placeholder: i.placeholder || "",
      name: i.name || "",
      index: idx,
    })),
  }));
}

async function clickIndex(index) {
  const oldUrl = page.url();

  const els = await page.$$("button,a,[role='button'],input[type='submit']");

  if (!els[index]) throw new Error("Button not found");

  await els[index].click();

  await smartWait(oldUrl);
}

async function typeIndex(index, value) {
  const els = await page.$$("input");

  if (!els[index]) throw new Error("Input not found");

  await els[index].fill(value);
}

app.post("/navigate", async (req, res) => {
  await page.goto(req.body.url);

  await settle();

  res.json({
    success: true,
    url: page.url(),
  });
});

async function executeSingle(command) {
  const dom = await getDOM();

  const btn = dom.buttons.find((b) =>
    command.toLowerCase().includes(b.text.toLowerCase()),
  );

  if (!btn) throw new Error("No button found");

  await clickIndex(btn.index);

  return {
    action: btn,
    url: page.url(),
  };
}

function makePlan(command) {
  return command
    .split(/\d+\)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

app.post("/ai", async (req, res) => {
  try {
    const { command } = req.body;

    const isPlan = command.includes("\n") || command.includes("1)");

    if (!isPlan) {
      const result = await executeSingle(command);

      return res.json({
        success: true,
        mode: "single",
        ...result,
      });
    }

    res.json({
      success: true,
      mode: "plan",
      steps: makePlan(command),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.post("/step", async (req, res) => {
  try {
    const { instruction } = req.body;

    const dom = await getDOM();

    const lower = instruction.toLowerCase();

    if (lower.includes("click")) {
      const txt = lower.replace("click", "").trim();

      const btn = dom.buttons.find((b) => b.text.toLowerCase().includes(txt));

      if (!btn) throw new Error("Button not found");

      await clickIndex(btn.index);
    }

    if (lower.includes("type")) {
      const match = instruction.match(/type\s+(.+?)\s+as\s+(.+)/i);

      if (!match) throw new Error("Invalid type");

      const field = match[1].toLowerCase();
      const value = match[2];

      const input = dom.inputs.find((i) =>
        (i.placeholder + " " + i.name + " " + i.type)
          .toLowerCase()
          .includes(field),
      );

      if (!input) throw new Error("Input not found");

      await typeIndex(input.index, value);
    }

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

app.listen(3001, () => console.log("AI running :3001"));
