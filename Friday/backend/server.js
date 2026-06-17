import express from "express";
import cors from "cors";
import CredentialManager from "./auth/credential-manager.js";
import ProfileManager from "./auth/profile-manager.js";
import PlaywrightMCPClient from "./mcp-client.js";
import Planner from "./planner.js";
import Resolver from "./resolver.js";
import ToolMap from "./tool-map.js";

import crypto from "crypto";
const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.url}`);
  next();
});

// =====================================================
// CORE
// =====================================================

const mcp = new PlaywrightMCPClient();

const resolver = new Resolver(mcp);
const toolMap = new ToolMap(resolver);

const planner = new Planner({
  model: "qwen3:8b",
  endpoint: "http://localhost:11434/api/generate",
});

// =====================================================
// INIT
// =====================================================

app.post("/init", async (req, res) => {
  try {
    await mcp.connect();

    res.json({
      success: true,
      message: "Playwright attached to Electron",
    });
  } catch (err) {
    console.error("INIT ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================================================
// SNAPSHOT
// =====================================================

app.get("/snapshot", async (req, res) => {
  try {
    const snap = await mcp.snapshot();

    res.json({
      success: true,
      snapshot: snap,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================================================
// HTML
// =====================================================

app.get("/html", async (req, res) => {
  try {
    const html = await mcp.html();

    res.json({
      success: true,
      html,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================================================
// RUN AI
// =====================================================

app.post("/run", async (req, res) => {
  try {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({
        success: false,
        error: "Missing command",
      });
    }

    // console.log("\n==================================");
    // console.log("USER COMMAND:", command);
    // console.log("==================================");

    let pageText = "";

    try {
      const html = await mcp.html();

      // console.log("========== HTML ==========");
      // console.log(html.substring(0, 3000));
      // console.log("==========================");
    } catch (e) {
      console.warn("HTML unavailable:", e.message);
    }

    try {
      const snap = await mcp.snapshot();

      // console.log("========== SNAPSHOT ==========");
      // console.dir(snap, { depth: null });
      // console.log("==============================");

      pageText = (snap?.text || "").substring(0, 5000);

      // console.log("========== PAGE TEXT ==========");
      // console.log(pageText.substring(0, 5000));
      // console.log("===============================");
    } catch (e) {
      console.warn("Snapshot failed:", e.message);
    }

    const plan = await planner.plan(command, pageText);

    // console.log("========== PLAN ==========");
    // console.dir(plan, { depth: null });
    // console.log("==========================");

    if (plan.mode === "chat") {
      return res.json({
        success: true,
        mode: "chat",
        reply: plan.reply,
      });
    }

    const results = [];

    for (const step of plan.steps || []) {
      try {
        console.log("Executing Step:");
        console.dir(step, { depth: null });

        let result;

        try {
          result = await toolMap.execute(step);
        } catch (err) {
          console.log("Primary failed. Self-healing...");

          result = await resolver.selfHeal(step);
        }

        results.push({
          tool: step.tool,
          args: step.args,
          success: true,
          result,
        });
      } catch (err) {
        console.error("STEP FAILED:", err);

        results.push({
          tool: step.tool,
          args: step.args,
          success: false,
          error: err.message,
        });
      }
    }

    return res.json({
      success: true,
      mode: "action",
      steps: results,
    });
  } catch (err) {
    console.error("RUN ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================================================
// DIRECT TOOL EXECUTION
// =====================================================

app.post("/tool", async (req, res) => {
  try {
    // console.log("========== TOOL ==========");
    // console.dir(req.body, { depth: null });

    const result = await toolMap.execute({
      tool: req.body.tool,
      args: req.body.args,
    });

    res.json({
      success: true,
      result,
    });
  } catch (err) {
    console.error("TOOL ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", async (req, res) => {
  try {
    await mcp.connect();

    res.json({
      success: true,
      status: "connected",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: "disconnected",
      error: err.message,
    });
  }
});
app.get("/debug", async (req, res) => {
  try {
    const page = await mcp.getPage();

    const url = page.url();
    const title = await page.title();

    const links = await page.locator("a").allTextContents();
    const buttons = await page.locator("button").allTextContents();

    res.json({
      url,
      title,
      links,
      buttons,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});
app.get("/test-click", async (req, res) => {
  try {
    const page = await mcp.getPage();

    console.log(await page.content());

    await page.locator("a").first().click();

    res.json({
      success: true,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});
// =====================================================
// START
// =====================================================
// =====================================================
// SESSION MANAGEMENT
// =====================================================
const credentialManager = new CredentialManager();

const profileManager = new ProfileManager();
app.post("/credentials/save", async (req, res) => {
  const { site, username, password } = req.body;

  credentialManager.save(site, username, password);

  res.json({
    success: true,
  });
});
app.get("/credentials/:site", async (req, res) => {
  res.json({
    success: true,
    credential: credentialManager.get(req.params.site),
  });
});
// =====================================================
// SESSION MANAGEMENT Ends
// =====================================================
const PORT = 3001;

app.listen(PORT, async () => {
  console.log(`🚀 Server started: http://localhost:${PORT}`);

  try {
    await mcp.connect();

    console.log("✅ Playwright attached to Electron");
  } catch (err) {
    console.error("❌ Playwright attach failed:", err.message);
  }
});
