//==========================================================
//
// backend/server.js
//
// Ultra Intelligent AI Automation Server
//
// Architecture
//
// Client
//     │
// Express API
//     │
// Planner
//     │
// Resolver
//     │
// ToolMap
//     │
// Playwright MCP
//     │
// Electron Browser
//
// Features
// --------
// ✔ Intelligent Planner Pipeline
// ✔ Self-Healing Execution
// ✔ Automatic Browser Recovery
// ✔ Session Management
// ✔ Credential Management
// ✔ Performance Monitoring
// ✔ Request Logging
// ✔ Statistics
// ✔ Graceful Error Handling
// ✔ Debug APIs
// ✔ Health Monitoring
//
//==========================================================

import express from "express";
import cors from "cors";
import crypto from "crypto";

import CredentialManager from "./auth/credential-manager.js";
import ProfileManager from "./auth/profile-manager.js";

import PlaywrightMCPClient from "./mcp-client.js";
import Planner from "./planner.js";
import Resolver from "./resolver.js";
import ToolMap from "./tool-map.js";

//==========================================================
// EXPRESS
//==========================================================

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "25mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "25mb",
  }),
);

//==========================================================
// CONFIGURATION
//==========================================================

const PORT = process.env.PORT || 3001;

const CONFIG = {
  model: process.env.AI_MODEL || "qwen3:8b",

  endpoint:
    process.env.OLLAMA_ENDPOINT || "http://localhost:11434/api/generate",

  debug: process.env.DEBUG === "true",

  requestTimeout: 120000,

  autoReconnect: true,

  cacheSnapshots: true,
};

//==========================================================
// CORE COMPONENTS
//==========================================================

const mcp = new PlaywrightMCPClient({
  debug: CONFIG.debug,
});

const resolver = new Resolver(
  mcp,

  {
    debug: CONFIG.debug,
  },
);

const toolMap = new ToolMap(resolver);

const planner = new Planner({
  model: CONFIG.model,

  endpoint: CONFIG.endpoint,
});

const credentialManager = new CredentialManager();

const profileManager = new ProfileManager();

//==========================================================
// SERVER STATE
//==========================================================

const serverState = {
  startedAt: Date.now(),

  initialized: false,

  lastCommand: null,

  lastPlan: null,

  lastSnapshot: null,

  activeRequests: 0,
};

//==========================================================
// PERFORMANCE
//==========================================================

const stats = {
  requests: 0,

  successfulRequests: 0,

  failedRequests: 0,

  plannerCalls: 0,

  resolverCalls: 0,

  toolExecutions: 0,

  reconnects: 0,

  snapshots: 0,

  htmlRequests: 0,

  averageRequestTime: 0,

  lastRequestTime: 0,
};

//==========================================================
// LOGGER
//==========================================================

function log(...args) {
  console.log("[Server]", ...args);
}

function warn(...args) {
  console.warn("[Server]", ...args);
}

function error(...args) {
  console.error("[Server]", ...args);
}

//==========================================================
// TIMER
//==========================================================

function startTimer() {
  return performance.now();
}

function stopTimer(start) {
  const elapsed = performance.now() - start;

  stats.lastRequestTime = elapsed;

  stats.averageRequestTime =
    stats.averageRequestTime === 0
      ? elapsed
      : stats.averageRequestTime * 0.9 + elapsed * 0.1;

  return elapsed;
}

//==========================================================
// REQUEST LOGGER
//==========================================================

app.use((req, res, next) => {
  const started = startTimer();

  const id = crypto.randomUUID();

  stats.requests++;

  serverState.activeRequests++;

  req.requestId = id;

  log(`${req.method} ${req.url}`, id);

  res.on("finish", () => {
    stopTimer(started);

    serverState.activeRequests--;

    if (res.statusCode < 400) {
      stats.successfulRequests++;
    } else {
      stats.failedRequests++;
    }

    if (CONFIG.debug) {
      log(
        `${req.method} ${req.url}`,

        res.statusCode,

        `${stats.lastRequestTime.toFixed(1)}ms`,
      );
    }
  });

  next();
});

//==========================================================
// HELPERS
//==========================================================

async function ensureBrowserReady() {
  try {
    await mcp.ensureConnected();

    return true;
  } catch (err) {
    stats.reconnects++;

    await mcp.connect(true);

    return true;
  }
}

async function captureSnapshot() {
  if (!CONFIG.cacheSnapshots) {
    return await mcp.snapshot();
  }

  const snapshot = await mcp.snapshot();

  serverState.lastSnapshot = snapshot;

  stats.snapshots++;

  return snapshot;
}

async function captureHTML() {
  stats.htmlRequests++;

  return await mcp.html();
}

function success(data = {}) {
  return {
    success: true,

    timestamp: Date.now(),

    ...data,
  };
}

function failure(err) {
  return {
    success: false,

    timestamp: Date.now(),

    error: err?.message || String(err),
  };
}

//==========================================================
// PART 2
// Initialization
// Health APIs
// Snapshot
// HTML
// Debug
// Diagnostics
//==========================================================
//==========================================================
// INITIALIZE MCP
//==========================================================

app.post("/init", async (req, res) => {
  try {
    await ensureBrowserReady();

    serverState.initialized = true;

    const page = await mcp.getPage();

    return res.json(
      success({
        message: "Playwright attached successfully.",

        url: page.url(),

        title: await page.title(),
      }),
    );
  } catch (err) {
    error("INIT ERROR:", err);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// HEALTH
//==========================================================

app.get("/health", async (req, res) => {
  try {
    await ensureBrowserReady();

    const page = await mcp.getPage();

    const browser = await mcp.inspectPage();

    return res.json(
      success({
        status: "connected",

        initialized: serverState.initialized,

        uptime: Math.floor((Date.now() - serverState.startedAt) / 1000),

        browser,

        statistics: {
          requests: stats.requests,

          reconnects: stats.reconnects,

          plannerCalls: stats.plannerCalls,

          resolverCalls: stats.resolverCalls,
        },

        page: {
          url: page.url(),

          title: await page.title(),
        },
      }),
    );
  } catch (err) {
    return res.status(500).json({
      success: false,

      status: "disconnected",

      error: err.message,
    });
  }
});

//==========================================================
// SERVER STATUS
//==========================================================

app.get("/status", async (req, res) => {
  return res.json(
    success({
      server: {
        initialized: serverState.initialized,

        startedAt: serverState.startedAt,

        uptime: Date.now() - serverState.startedAt,

        activeRequests: serverState.activeRequests,
      },

      statistics: stats,
    }),
  );
});

//==========================================================
// SNAPSHOT
//==========================================================

app.get("/snapshot", async (req, res) => {
  try {
    await ensureBrowserReady();

    const snapshot = await captureSnapshot();

    return res.json(
      success({
        snapshot,
      }),
    );
  } catch (err) {
    error("SNAPSHOT:", err);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// HTML
//==========================================================

app.get("/html", async (req, res) => {
  try {
    await ensureBrowserReady();

    const html = await captureHTML();

    return res.json(
      success({
        html,
      }),
    );
  } catch (err) {
    error("HTML:", err);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// PAGE INFO
//==========================================================

app.get("/page", async (req, res) => {
  try {
    await ensureBrowserReady();

    const info = await mcp.inspectPage();

    return res.json(
      success({
        page: info,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// DEBUG
//==========================================================

app.get("/debug", async (req, res) => {
  try {
    await ensureBrowserReady();

    const page = await mcp.getPage();

    const info = await mcp.inspectPage();

    const links = await page.locator("a").allTextContents();

    const buttons = await page.locator("button").allTextContents();

    const inputs = await page.locator("input").count();

    const frames = page.frames();

    return res.json(
      success({
        page: info,

        buttons,

        links,

        inputCount: inputs,

        frames: frames.map((frame) => ({
          name: frame.name(),

          url: frame.url(),
        })),
      }),
    );
  } catch (err) {
    error("DEBUG:", err);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// DIAGNOSTICS
//==========================================================

app.get("/diagnostics", async (req, res) => {
  try {
    await ensureBrowserReady();

    const page = await mcp.getPage();

    const diagnostics = {
      url: page.url(),

      title: await page.title(),

      readyState: await page.evaluate(() => document.readyState),

      viewport: page.viewportSize(),

      frames: page.frames().length,

      cookies: (await mcp.getCookies()).length,

      storage: await mcp.getStorageState(),

      lastSnapshot: !!serverState.lastSnapshot,

      lastCommand: serverState.lastCommand,
    };

    return res.json(
      success({
        diagnostics,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// TEST CLICK
//==========================================================

app.get("/test-click", async (req, res) => {
  try {
    await ensureBrowserReady();

    const page = await mcp.getPage();

    await page.locator("a").first().click();

    return res.json(
      success({
        action: "test-click",
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// PART 3
// AI Planner Pipeline
// /run
// Planner → Resolver → ToolMap
// Self-Healing Execution
//==========================================================

//==========================================================
// RUN AI
// Planner → Resolver → ToolMap → Self Healing
//==========================================================

app.post("/run", async (req, res) => {
  const started = startTimer();

  try {
    //--------------------------------------------------
    // Validate
    //--------------------------------------------------

    const command = String(req.body?.command || "").trim();

    if (!command) {
      return res.status(400).json({
        success: false,

        error: "Missing command.",
      });
    }

    serverState.lastCommand = command;

    //--------------------------------------------------
    // Browser
    //--------------------------------------------------

    await ensureBrowserReady();

    const page = await mcp.getPage();

    //--------------------------------------------------
    // Capture Snapshot
    //--------------------------------------------------

    let snapshot = null;

    let pageText = "";

    try {
      snapshot = await captureSnapshot();

      pageText = snapshot.text || "";
    } catch (err) {
      warn("Snapshot unavailable:", err.message);
    }

    //--------------------------------------------------
    // Planner
    //--------------------------------------------------

    stats.plannerCalls++;

    const plan = await planner.plan(
      command,

      pageText,
    );

    serverState.lastPlan = plan;

    if (CONFIG.debug) {
      console.log("\n========== PLAN ==========");

      console.dir(plan, {
        depth: null,
      });

      console.log("==========================\n");
    }

    //--------------------------------------------------
    // Chat Mode
    //--------------------------------------------------

    if (plan?.mode === "chat") {
      stopTimer(started);

      return res.json(
        success({
          mode: "chat",

          reply: plan.reply,

          planningTime: stats.lastRequestTime,
        }),
      );
    }

    //--------------------------------------------------
    // Validate Plan
    //--------------------------------------------------

    if (!plan || !Array.isArray(plan.steps)) {
      throw new Error("Planner returned an invalid execution plan.");
    }

    //--------------------------------------------------
    // Execute Steps
    //--------------------------------------------------

    const results = [];

    for (let index = 0; index < plan.steps.length; index++) {
      const step = plan.steps[index];

      if (!step) continue;

      if (CONFIG.debug) {
        console.log(`Executing Step ${index + 1}`);

        console.dir(step, {
          depth: null,
        });
      }

      //--------------------------------------------------
      // Execute
      //--------------------------------------------------

      let result;

      try {
        stats.toolExecutions++;

        result = await toolMap.execute(step);
      } catch (err) {
        error("Execution Error:", err.message);

        results.push({
          index,

          tool: step.tool,

          args: step.args,

          success: false,

          error: err.message,
        });

        throw err;
      }

      //--------------------------------------------------
      // Navigation Handling
      //--------------------------------------------------

      if (step.tool === "navigate" || result?.action === "navigate") {
        try {
          await page.waitForLoadState("domcontentloaded");

          await page.waitForLoadState("networkidle").catch(() => {});

          await page.waitForFunction(() => document.readyState === "complete");
        } catch {}

        resolver.invalidateDOMCache?.();
      }

      //--------------------------------------------------
      // Refresh DOM Cache
      //--------------------------------------------------

      if (resolver.options?.autoRefreshDOM) {
        try {
          await resolver.ensureFreshDOM?.();
        } catch {}
      }

      //--------------------------------------------------
      // Store Result
      //--------------------------------------------------

      results.push({
        index,

        tool: step.tool,

        args: step.args,

        success: result?.success !== false,

        result,
      });
    }

    //--------------------------------------------------
    // Finish
    //--------------------------------------------------

    stopTimer(started);

    return res.json(
      success({
        mode: "action",

        command,

        plan,

        steps: results,

        statistics: {
          plannerCalls: stats.plannerCalls,

          resolverCalls: stats.resolverCalls,

          toolExecutions: stats.toolExecutions,

          duration: stats.lastRequestTime,
        },
      }),
    );
  } catch (err) {
    stopTimer(started);

    error("RUN ERROR:", err);

    return res.status(500).json({
      success: false,

      mode: "action",

      error: err.message,

      statistics: {
        plannerCalls: stats.plannerCalls,

        resolverCalls: stats.resolverCalls,

        toolExecutions: stats.toolExecutions,

        duration: stats.lastRequestTime,
      },
    });
  }
});

//==========================================================
// PART 4
// Direct Tool Execution
// Executor
// Navigation Helpers
// Response Formatter
//==========================================================
//==========================================================
// DIRECT TOOL EXECUTION
//==========================================================

app.post("/tool", async (req, res) => {
  const started = startTimer();

  try {
    //--------------------------------------------------
    // Validate
    //--------------------------------------------------

    const {
      tool,

      args = {},
    } = req.body || {};

    if (!tool) {
      return res.status(400).json({
        success: false,

        error: "Tool name is required.",
      });
    }

    //--------------------------------------------------
    // Browser Ready
    //--------------------------------------------------

    await ensureBrowserReady();

    //--------------------------------------------------
    // Execute
    //--------------------------------------------------

    stats.toolExecutions++;

    const result = await toolMap.execute({
      tool,

      args,
    });

    //--------------------------------------------------
    // Navigation Recovery
    //--------------------------------------------------

    if (tool === "navigate" || result?.action === "navigate") {
      try {
        const page = await mcp.getPage();

        await page.waitForLoadState("domcontentloaded");

        await page.waitForLoadState("networkidle").catch(() => {});

        resolver.invalidateDOMCache?.();
      } catch {}
    }

    //--------------------------------------------------
    // Refresh DOM
    //--------------------------------------------------

    try {
      await resolver.ensureFreshDOM?.();
    } catch {}

    stopTimer(started);

    return res.json(
      success({
        tool,

        args,

        result,

        duration: stats.lastRequestTime,
      }),
    );
  } catch (err) {
    stopTimer(started);

    error("TOOL ERROR:", err);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// EXECUTE MULTIPLE TOOLS
//==========================================================

app.post("/tools", async (req, res) => {
  const started = startTimer();

  try {
    const steps = req.body?.steps || [];

    if (!Array.isArray(steps) || !steps.length) {
      return res.status(400).json({
        success: false,

        error: "steps[] is required.",
      });
    }

    await ensureBrowserReady();

    const results = [];

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];

      try {
        stats.toolExecutions++;

        const result = await toolMap.execute(step);

        results.push({
          index,

          tool: step.tool,

          success: true,

          result,
        });
      } catch (err) {
        results.push({
          index,

          tool: step.tool,

          success: false,

          error: err.message,
        });
      }
    }

    stopTimer(started);

    return res.json(
      success({
        executed: results.length,

        results,

        duration: stats.lastRequestTime,
      }),
    );
  } catch (err) {
    stopTimer(started);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// AVAILABLE TOOLS
//==========================================================

app.get("/tools", async (req, res) => {
  try {
    const tools = await mcp.listTools();

    return res.json(
      success({
        count: tools.length,

        tools,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// EXECUTION HISTORY
//==========================================================

app.get("/history", async (req, res) => {
  return res.json(
    success({
      lastCommand: serverState.lastCommand,

      lastPlan: serverState.lastPlan,

      lastSnapshot: !!serverState.lastSnapshot,

      statistics: stats,
    }),
  );
});

//==========================================================
// RESET SERVER STATE
//==========================================================

app.post("/reset", async (req, res) => {
  try {
    serverState.lastCommand = null;

    serverState.lastPlan = null;

    serverState.lastSnapshot = null;

    resolver.clearCaches?.();

    return res.json(
      success({
        message: "Server state reset successfully.",
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// PART 5
// Credential Manager
// Profile Manager
// Session Management
//==========================================================
//==========================================================
// BROWSER UTILITIES
//==========================================================

app.get("/browser", async (req, res) => {
  try {
    await ensureBrowserReady();

    const info = await mcp.inspectPage();

    const pages = await mcp.getPages();

    const browser = await mcp.getBrowser();

    return res.json(
      success({
        browserConnected: !!browser,

        pageCount: pages.length,

        currentPage: info,

        pages: await Promise.all(
          pages.map(async (page) => ({
            url: page.url(),

            title: await page.title().catch(() => ""),

            closed: page.isClosed(),
          })),
        ),
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// SCREENSHOT
//==========================================================

app.get("/screenshot", async (req, res) => {
  try {
    await ensureBrowserReady();

    const image = await mcp.screenshot({
      type: "png",

      fullPage: true,
    });

    res.setHeader("Content-Type", "image/png");

    return res.send(image);
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// DOWNLOAD STATUS
//==========================================================

app.get("/downloads", async (req, res) => {
  try {
    const download = mcp.getLastDownload();

    return res.json(
      success({
        active: !!download,

        download,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.delete("/downloads", async (req, res) => {
  mcp.clearDownload();

  return res.json(
    success({
      message: "Download cache cleared.",
    }),
  );
});

//==========================================================
// DIALOG STATUS
//==========================================================

app.get("/dialogs", async (req, res) => {
  try {
    const dialog = mcp.getLastDialog();

    return res.json(
      success({
        active: !!dialog,

        dialog,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.post("/dialogs/accept", async (req, res) => {
  try {
    const result = await mcp.acceptDialog(req.body?.text);

    return res.json(
      success({
        result,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.post("/dialogs/dismiss", async (req, res) => {
  try {
    const result = await mcp.dismissDialog();

    return res.json(
      success({
        result,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// DOM INSPECTION
//==========================================================

app.get("/dom", async (req, res) => {
  try {
    await ensureBrowserReady();

    const page = await mcp.getPage();

    const dom = await page.evaluate(() => ({
      title: document.title,

      url: location.href,

      readyState: document.readyState,

      links: document.links.length,

      forms: document.forms.length,

      buttons: document.querySelectorAll("button").length,

      inputs: document.querySelectorAll("input").length,

      images: document.images.length,

      iframes: document.querySelectorAll("iframe").length,
    }));

    return res.json(
      success({
        dom,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// EXECUTION METRICS
//==========================================================

app.get("/metrics", async (req, res) => {
  try {
    return res.json(
      success({
        server: stats,

        resolver: resolver.getStatistics?.() || {},

        browser: mcp.stats || {},

        uptime: Date.now() - serverState.startedAt,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// MEMORY / CACHE
//==========================================================

app.post("/cache/clear", async (req, res) => {
  try {
    resolver.clearCaches?.();

    mcp.clearSnapshot?.();

    serverState.lastSnapshot = null;

    return res.json(
      success({
        message: "All runtime caches cleared.",
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// PART 7
// Error Handler
// Graceful Shutdown
// Server Startup
// Auto Reconnect
//==========================================================
//==========================================================
// GLOBAL ERROR HANDLER
//==========================================================

app.use((err, req, res, next) => {
  error("UNHANDLED ERROR:", err);

  stats.failedRequests++;

  return res.status(500).json({
    success: false,

    error: err.message || "Internal Server Error",

    stack: CONFIG.debug ? err.stack : undefined,

    timestamp: Date.now(),
  });
});

//==========================================================
// NOT FOUND
//==========================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,

    error: `Route '${req.originalUrl}' not found.`,

    timestamp: Date.now(),
  });
});

//==========================================================
// HEALTH MONITOR
//==========================================================

const healthMonitor = setInterval(async () => {
  try {
    await mcp.ensureConnected();
  } catch (err) {
    warn("Health monitor detected disconnected browser.");

    try {
      await mcp.connect(true);

      stats.reconnects++;

      log("Browser reconnected.");
    } catch (connectError) {
      error(
        "Reconnect failed:",

        connectError.message,
      );
    }
  }
}, 30000);

//==========================================================
// MEMORY CLEANUP
//==========================================================

const cleanupMonitor = setInterval(
  () => {
    //--------------------------------------------------
    // Clear cached snapshot every 5 minutes
    //--------------------------------------------------

    serverState.lastSnapshot = null;

    //--------------------------------------------------
    // Refresh DOM cache periodically
    //--------------------------------------------------

    try {
      resolver.invalidateDOMCache?.();
    } catch {}
  },
  5 * 60 * 1000,
);

//==========================================================
// SERVER STARTUP
//==========================================================

const server = app.listen(PORT, async () => {
  console.log("");

  console.log("==========================================");

  console.log("🚀 Ultra Intelligent AI Server Started");

  console.log(`🌐 http://localhost:${PORT}`);

  console.log(`🤖 Model : ${CONFIG.model}`);

  console.log(`🔌 Ollama: ${CONFIG.endpoint}`);

  console.log("==========================================");

  console.log("");

  //--------------------------------------------------
  // Connect Browser
  //--------------------------------------------------

  try {
    await mcp.connect();

    serverState.initialized = true;

    log("Playwright attached successfully.");

    try {
      const page = await mcp.getPage();

      log("Current URL:", page.url());
    } catch {}
  } catch (err) {
    warn("Browser attach failed:", err.message);
  }
});

//==========================================================
// GRACEFUL SHUTDOWN
//==========================================================

async function shutdown(signal) {
  console.log("");

  console.log("==========================================");

  console.log(`Received ${signal}.`);

  console.log("Shutting down...");

  console.log("==========================================");

  clearInterval(healthMonitor);

  clearInterval(cleanupMonitor);

  //--------------------------------------------------
  // Disconnect Browser
  //--------------------------------------------------

  try {
    await mcp.disconnect?.();
  } catch {}

  //--------------------------------------------------
  // Close HTTP Server
  //--------------------------------------------------

  server.close(() => {
    log("HTTP server closed.");

    process.exit(0);
  });

  //--------------------------------------------------
  // Force Exit
  //--------------------------------------------------

  setTimeout(() => {
    warn("Force exiting.");

    process.exit(1);
  }, 5000);
}

//==========================================================
// PROCESS EVENTS
//==========================================================

process.on("SIGINT", () => shutdown("SIGINT"));

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  error("Unhandled Rejection:", err);
});

//==========================================================
// EXPORTS
//==========================================================

export { app, server, planner, resolver, toolMap, mcp, stats, serverState };
