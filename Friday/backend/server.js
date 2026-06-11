import express from "express";
import cors from "cors";

import PlaywrightMCPClient from "./mcp-client.js";
import Planner from "./planner.js";
import Resolver from "./resolver.js";
import ToolMap from "./tool-map.js";
const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});
// =====================================================
// CORE INSTANCES
// =====================================================

const mcp = new PlaywrightMCPClient("http://localhost:8931/mcp");
const resolver = new Resolver(mcp);
const toolMap = new ToolMap(resolver);

const planner = new Planner({
  model: "qwen3:8b",
  endpoint: "http://localhost:11434/api/generate",
});

// =====================================================
// MCP INIT
// =====================================================

app.post("/init", async (req, res) => {
  try {
    await mcp.connect();

    const tools = await mcp.listTools();

    res.json({
      success: true,
      message: "MCP connected",
      tools,
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
// SNAPSHOT (debug helper)
// =====================================================

app.get("/snapshot", async (req, res) => {
  try {
    const snapshot = await mcp.snapshot();

    res.json({
      success: true,
      snapshot,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================================================
// MAIN AI EXECUTOR
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

    let pageText = "";

    try {
      const snap = await mcp.snapshot();
      pageText =
        typeof snap === "string"
          ? snap
          : snap?.content?.map((x) => x.text).join("\n") || "";
    } catch (e) {
      console.warn("Snapshot failed:", e.message);
    }

    const plan = await planner.plan(command, pageText);

    if (plan.mode === "chat") {
      return res.json({
        success: true,
        mode: "chat",
        reply: plan.reply,
      });
    }

    const results = [];

    for (const step of plan.steps) {
      try {
        const result = await toolMap.execute(step);

        results.push({
          tool: step.tool,
          args: step.args,
          result,
          success: true,
        });
      } catch (err) {
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
// app.post("/step", async (req, res) => {
//   try {
//     const step = req.body;

//     // ❌ WRONG: raw MCP call
//     // const result = await toolMap.execute(step);

//     // ✅ FIX: resolve text → real target first
//     const result = await toolMap.execute(step);

//     res.json({
//       success: true,
//       result,
//     });
//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       error: err.message,
//     });
//   }
// });
// =====================================================
// DIRECT TOOL EXECUTION (debug/manual control)
// =====================================================

// =====================================================
// MCP TOOL LIST
// =====================================================

app.get("/tools", async (req, res) => {
  try {
    const tools = await mcp.listTools();

    res.json({
      success: true,
      tools,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================================================
// SERVER START
// =====================================================

const PORT = 3001;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  try {
    await mcp.connect();
    console.log("✅ MCP auto-connected on startup");
  } catch (err) {
    console.warn("⚠️ MCP auto-connect failed:", err.message);
  }
});
