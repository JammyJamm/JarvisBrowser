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
// Command Router
//     │
//     ├─────────────── CHAT ───────────────► AI Engine
//     │                                      │
//     │                                      ▼
//     │                                    Ollama
//     │                                      │
//     │                                      ▼
//     │                                    Reply
//     │
//     └──────────── ACTION ───────────────► Planner
//                                            │
//                                            ▼
//                                          ToolMap
//                                            │
//                                            ▼
//                                          Resolver
//                                            │
//                                            ▼
//                                      Playwright MCP
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

import CommandRouter from "./command-router.js";

// IMPORTANT:
// aiEngine.js exports:
// export default { chat }
//
// Therefore import the default export.
import aiEngine from "./aiEngine.js";

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

const HOST = process.env.HOST || "127.0.0.1";

const PORT = Number(process.env.PORT || 9000);

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

//----------------------------------------------------------
// Playwright MCP
//----------------------------------------------------------

const mcp = new PlaywrightMCPClient({
  debug: CONFIG.debug,
});

//----------------------------------------------------------
// Resolver
//----------------------------------------------------------

const resolver = new Resolver(mcp, {
  debug: CONFIG.debug,
});

//----------------------------------------------------------
// Tool Map
//----------------------------------------------------------

const toolMap = new ToolMap(resolver);

//----------------------------------------------------------
// Browser Planner
//----------------------------------------------------------

const planner = new Planner({
  model: CONFIG.model,

  endpoint: CONFIG.endpoint,
});

//----------------------------------------------------------
// AI ENGINE
//
// aiEngine.js:
//
// export default {
//   chat
// }
//
// CommandRouter calls:
//
// aiEngine.chat(command)
//
//----------------------------------------------------------

const chatAI = aiEngine;

//----------------------------------------------------------
// Command Router
//
// IMPORTANT
//
// CommandRouter constructor expects:
//
// {
//   aiEngine,
//   resolver,
//   debug
// }
//
// NOT:
//
// {
//   model,
//   endpoint,
//   debug
// }
//----------------------------------------------------------

const commandRouter = new CommandRouter({
  aiEngine: chatAI,

  resolver,

  debug: CONFIG.debug,
});

//----------------------------------------------------------
// Managers
//----------------------------------------------------------

const credentialManager = new CredentialManager();

const profileManager = new ProfileManager();

//==========================================================
// SERVER STATE
//==========================================================

const serverState = {
  startedAt: Date.now(),

  initialized: false,

  httpReady: false,

  shuttingDown: false,

  lastCommand: null,

  lastRoute: null,

  lastPlan: null,

  lastSnapshot: null,

  activeRequests: 0,

  routerReady: true,

  plannerReady: true,

  resolverReady: true,

  toolMapReady: true,

  mcpReady: true,

  browserConnected: false,

  credentialsReady: true,

  profileReady: true,

  chatAIReady: Boolean(chatAI && typeof chatAI.chat === "function"),

  reconnecting: false,

  lastBrowserError: null,

  lastReconnectAt: null,

  startupError: null,
};

//==========================================================
// PERFORMANCE
//==========================================================

const stats = {
  requests: 0,

  successfulRequests: 0,

  failedRequests: 0,

  routerCalls: 0,

  chatCalls: 0,

  plannerCalls: 0,

  resolverCalls: 0,

  toolExecutions: 0,

  reconnects: 0,

  snapshots: 0,

  htmlRequests: 0,

  averageRequestTime: 0,

  lastRequestTime: 0,

  uptime: 0,
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

    serverState.browserConnected = true;

    serverState.mcpReady = true;

    serverState.lastBrowserError = null;

    return true;
  } catch (err) {
    serverState.browserConnected = false;

    serverState.lastBrowserError = err.message;

    if (!CONFIG.autoReconnect) {
      throw err;
    }

    stats.reconnects++;

    serverState.reconnecting = true;

    try {
      await mcp.connect(true);

      serverState.browserConnected = true;

      serverState.mcpReady = true;

      serverState.lastReconnectAt = Date.now();

      serverState.lastBrowserError = null;

      return true;
    } catch (reconnectError) {
      serverState.browserConnected = false;

      serverState.lastBrowserError = reconnectError.message;

      throw reconnectError;
    } finally {
      serverState.reconnecting = false;
    }
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
// CHAT AI
//==========================================================
//
// IMPORTANT
//
// Chat flow:
//
// User
//   ↓
// CommandRouter
//   ↓
// classify()
//   ↓
// handleChat()
//   ↓
// aiEngine.chat()
//   ↓
// Ollama
//   ↓
// reply
//
// Browser is NOT initialized.
//
//==========================================================

async function handleChat(command, context = {}) {
  if (!chatAI || typeof chatAI.chat !== "function") {
    throw new Error(
      "AI Engine is not available. Expected aiEngine.js to export a default object with chat() method.",
    );
  }

  if (CONFIG.debug) {
    console.log("[CHAT] Sending to AI Engine:", command);
  }

  const result = await chatAI.chat(command, {
    route: context.route,

    requestId: context.requestId,

    debug: CONFIG.debug,

    onStream: context.onStream,
  });

  return {
    success: result?.success !== false,

    reply:
      result?.reply ||
      result?.message ||
      result?.response ||
      String(result || "I don't have a response for that."),

    model: result?.model || CONFIG.model,
  };
}

//==========================================================
// ROUTING
//==========================================================

async function routeCommand(command, context = {}) {
  stats.routerCalls++;

  if (CONFIG.debug) {
    console.log("\n========== COMMAND ROUTER ==========");

    console.log("[ROUTER] Command:", command);

    console.log("====================================\n");
  }

  if (!commandRouter) {
    throw new Error("CommandRouter is not initialized.");
  }

  //--------------------------------------------------------
  // Preferred route()
  //--------------------------------------------------------

  if (typeof commandRouter.route === "function") {
    return await commandRouter.route(command, context);
  }

  //--------------------------------------------------------
  // Alternative classify()
  //--------------------------------------------------------

  if (typeof commandRouter.classify === "function") {
    const classification = commandRouter.classify(command);

    return {
      ...classification,

      mode: classification?.mode || classification?.type || "unknown",
    };
  }

  throw new Error("CommandRouter does not provide route() or classify().");
}

//==========================================================
// STATUS
//
// IMPORTANT:
//
// This endpoint NEVER calls:
//
//   ensureBrowserReady()
//   mcp.getPage()
//   mcp.connect()
//
// Therefore Electron can connect to:
//
// GET http://localhost:9000/status
//
// even when Playwright is disconnected.
//
//==========================================================

app.get("/status", (req, res) => {
  const now = Date.now();

  const uptime = serverState.startedAt
    ? Math.max(0, now - serverState.startedAt)
    : 0;

  stats.uptime = uptime;

  return res.status(200).json(
    success({
      requestId: req.requestId,

      status: "online",

      server: {
        host: HOST,

        port: PORT,

        httpReady: Boolean(serverState.httpReady),

        initialized: Boolean(serverState.initialized),

        uptime,

        activeRequests: Number(serverState.activeRequests) || 0,

        shuttingDown: Boolean(serverState.shuttingDown),
      },

      components: {
        commandRouter: Boolean(serverState.routerReady),

        chatAI: Boolean(serverState.chatAIReady),

        planner: Boolean(serverState.plannerReady),

        resolver: Boolean(serverState.resolverReady),

        toolMap: Boolean(serverState.toolMapReady),

        mcp: Boolean(serverState.mcpReady),

        browserConnected: Boolean(serverState.browserConnected),

        credentials: Boolean(serverState.credentialsReady),

        profile: Boolean(serverState.profileReady),
      },

      browser: {
        connected: Boolean(serverState.browserConnected),

        reconnecting: Boolean(serverState.reconnecting),

        lastError: serverState.lastBrowserError || null,

        lastReconnectAt: serverState.lastReconnectAt || null,
      },

      startupError: serverState.startupError || null,

      statistics: {
        ...stats,
      },

      timestamp: now,
    }),
  );
});

//==========================================================
// RUN COMMAND
//==========================================================

app.post("/run", async (req, res) => {
  const started = startTimer();

  const command = String(req.body?.command || "").trim();

  try {
    //------------------------------------------------------
    // 1. VALIDATE
    //------------------------------------------------------

    if (!command) {
      stopTimer(started);

      return res.status(400).json({
        success: false,

        mode: "unknown",

        error: "Missing command.",
      });
    }

    serverState.lastCommand = command;

    //------------------------------------------------------
    // 2. ROUTER
    //------------------------------------------------------

    let route;

    try {
      route = await routeCommand(command, {
        requestId: req.requestId,

        page: null,
      });
    } catch (err) {
      error("[RUN] Router Error:", err.message);

      stopTimer(started);

      return res.status(500).json({
        success: false,

        mode: "unknown",

        command,

        error: `Command Router failed: ${err.message}`,

        statistics: {
          routerCalls: stats.routerCalls,

          chatCalls: stats.chatCalls,

          plannerCalls: stats.plannerCalls,

          duration: stats.lastRequestTime,
        },
      });
    }

    //------------------------------------------------------
    // 3. NORMALIZE ROUTE
    //
    // CommandRouter currently returns:
    //
    // {
    //   type: "chat"
    // }
    //
    // Server pipeline expects:
    //
    // {
    //   mode: "chat"
    // }
    //
    //------------------------------------------------------

    const rawMode = String(
      route?.mode ?? route?.type ?? route?.route ?? route?.intent ?? "",
    )
      .trim()
      .toLowerCase();

    let mode = rawMode;

    //------------------------------------------------------
    // CHAT ALIASES
    //------------------------------------------------------

    if (
      ["chat", "conversation", "general", "question", "casual"].includes(mode)
    ) {
      mode = "chat";
    }

    //------------------------------------------------------
    // ACTION ALIASES
    //------------------------------------------------------

    if (
      ["action", "browser", "automation", "command", "execute"].includes(mode)
    ) {
      mode = "action";
    }

    route = {
      ...(route || {}),

      mode,

      type: route?.type || mode,
    };

    serverState.lastRoute = route;

    if (CONFIG.debug) {
      console.log("[RUN] Normalized Route:");

      console.dir(route, {
        depth: null,
      });
    }

    //------------------------------------------------------
    // 4. CHAT
    //------------------------------------------------------

    if (mode === "chat") {
      let chatResult;

      try {
        chatResult = await handleChat(command, {
          route,

          requestId: req.requestId,
        });

        stats.chatCalls++;
      } catch (err) {
        error("[RUN] Chat AI Error:", err.message);

        stopTimer(started);

        return res.status(500).json({
          success: false,

          mode: "chat",

          command,

          route,

          error: `Chat AI failed: ${err.message}`,

          statistics: {
            routerCalls: stats.routerCalls,

            chatCalls: stats.chatCalls,

            plannerCalls: stats.plannerCalls,

            duration: stats.lastRequestTime,
          },
        });
      }

      stopTimer(started);

      return res.json(
        success({
          mode: "chat",

          command,

          reply: chatResult?.reply || "I don't have a response for that.",

          route,

          statistics: {
            routerCalls: stats.routerCalls,

            chatCalls: stats.chatCalls,

            plannerCalls: stats.plannerCalls,

            resolverCalls: stats.resolverCalls,

            toolExecutions: stats.toolExecutions,

            duration: stats.lastRequestTime,
          },
        }),
      );
    }

    //------------------------------------------------------
    // 5. UNKNOWN
    //------------------------------------------------------

    if (mode !== "action") {
      stopTimer(started);

      return res.status(400).json({
        success: false,

        mode: "unknown",

        command,

        route,

        error: "Command Router returned an unknown mode.",

        expectedModes: ["chat", "action"],
      });
    }

    //------------------------------------------------------
    // 6. ACTION
    //------------------------------------------------------

    await ensureBrowserReady();

    const page = await mcp.getPage();

    if (!page) {
      throw new Error("Playwright page is not available.");
    }

    //------------------------------------------------------
    // 7. SNAPSHOT
    //------------------------------------------------------

    let snapshot = null;

    let pageText = "";

    try {
      snapshot = await captureSnapshot();

      pageText = String(snapshot?.text || "");
    } catch (err) {
      warn("[RUN] Snapshot unavailable:", err.message);
    }

    //------------------------------------------------------
    // 8. PLANNER
    //------------------------------------------------------

    stats.plannerCalls++;

    let plan;

    try {
      plan = await planner.plan(command, pageText);
    } catch (err) {
      error("[RUN] Planner Error:", err.message);

      stopTimer(started);

      return res.status(500).json({
        success: false,

        mode: "action",

        command,

        route,

        error: `Planner failed: ${err.message}`,

        statistics: {
          routerCalls: stats.routerCalls,

          plannerCalls: stats.plannerCalls,

          resolverCalls: stats.resolverCalls,

          toolExecutions: stats.toolExecutions,

          duration: stats.lastRequestTime,
        },
      });
    }

    serverState.lastPlan = plan;

    //------------------------------------------------------
    // 9. VALIDATE PLAN
    //------------------------------------------------------

    if (!plan || !Array.isArray(plan.steps)) {
      stopTimer(started);

      return res.status(500).json({
        success: false,

        mode: "action",

        command,

        route,

        plan,

        error: "Planner returned an invalid execution plan.",
      });
    }

    //------------------------------------------------------
    // 10. EXECUTE
    //------------------------------------------------------

    const results = [];

    for (let index = 0; index < plan.steps.length; index++) {
      const step = plan.steps[index];

      if (!step) {
        continue;
      }

      let result;

      try {
        stats.toolExecutions++;

        result = await toolMap.execute(step);
      } catch (err) {
        error(`[RUN] Step ${index + 1} failed:`, err.message);

        const failedResult = {
          index,

          tool: step.tool,

          args: step.args,

          success: false,

          error: err.message,
        };

        results.push(failedResult);

        stopTimer(started);

        return res.status(500).json({
          success: false,

          mode: "action",

          command,

          route,

          plan,

          steps: results,

          failedStep: failedResult,

          error: err.message,
        });
      }

      //----------------------------------------------------
      // NAVIGATION
      //----------------------------------------------------

      if (step.tool === "navigate" || result?.action === "navigate") {
        try {
          await page.waitForLoadState("domcontentloaded");

          await page.waitForLoadState("networkidle").catch(() => {});

          resolver.invalidateDOMCache?.();
        } catch (err) {
          if (CONFIG.debug) {
            warn("[RUN] Navigation wait:", err.message);
          }
        }
      }

      //----------------------------------------------------
      // REFRESH DOM
      //----------------------------------------------------

      if (resolver.options?.autoRefreshDOM) {
        try {
          await resolver.ensureFreshDOM?.();
        } catch {}
      }

      //----------------------------------------------------
      // STORE RESULT
      //----------------------------------------------------

      const stepSuccess = result?.success !== false;

      results.push({
        index,

        tool: step.tool,

        args: step.args,

        success: stepSuccess,

        result,
      });

      //----------------------------------------------------
      // STOP ON FAILURE
      //----------------------------------------------------

      if (!stepSuccess) {
        stopTimer(started);

        return res.status(500).json({
          success: false,

          mode: "action",

          command,

          route,

          plan,

          steps: results,

          error: result?.error || `Step ${index + 1} failed.`,
        });
      }
    }

    //------------------------------------------------------
    // COMPLETE
    //------------------------------------------------------

    stopTimer(started);

    return res.json(
      success({
        mode: "action",

        command,

        route,

        plan,

        steps: results,

        statistics: {
          routerCalls: stats.routerCalls,

          chatCalls: stats.chatCalls,

          plannerCalls: stats.plannerCalls,

          resolverCalls: stats.resolverCalls,

          toolExecutions: stats.toolExecutions,

          duration: stats.lastRequestTime,
        },
      }),
    );
  } catch (err) {
    stopTimer(started);

    error("[RUN] UNHANDLED ERROR:", err);

    return res.status(500).json({
      success: false,

      mode: serverState.lastRoute?.mode || "unknown",

      command,

      route: serverState.lastRoute || null,

      error: err?.message || "Unknown server error.",

      statistics: {
        routerCalls: stats.routerCalls,

        chatCalls: stats.chatCalls,

        plannerCalls: stats.plannerCalls,

        resolverCalls: stats.resolverCalls,

        toolExecutions: stats.toolExecutions,

        duration: stats.lastRequestTime,
      },
    });
  }
});

//==========================================================
// INIT
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
    error("[INIT]", err);

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

    return res.json(
      success({
        status: "connected",

        page: {
          url: page.url(),

          title: await page.title(),
        },

        components: {
          chatAI: serverState.chatAIReady,

          browser: serverState.browserConnected,
        },

        statistics: stats,
      }),
    );
  } catch (err) {
    return res.status(503).json({
      success: false,

      status: "disconnected",

      error: err.message,

      chatAI: serverState.chatAIReady,
    });
  }
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
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// PAGE
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
// TOOLS
//==========================================================

app.post("/tool", async (req, res) => {
  const started = startTimer();

  try {
    const { tool, args = {} } = req.body || {};

    if (!tool) {
      return res.status(400).json({
        success: false,

        error: "Tool name is required.",
      });
    }

    await ensureBrowserReady();

    stats.toolExecutions++;

    const result = await toolMap.execute({
      tool,

      args,
    });

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

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// MULTIPLE TOOLS
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
// HISTORY
//==========================================================

app.get("/history", (req, res) => {
  return res.json(
    success({
      lastCommand: serverState.lastCommand,

      lastRoute: serverState.lastRoute,

      lastPlan: serverState.lastPlan,

      lastSnapshot: Boolean(serverState.lastSnapshot),

      statistics: stats,
    }),
  );
});

//==========================================================
// RESET
//==========================================================

app.post("/reset", async (req, res) => {
  try {
    serverState.lastCommand = null;

    serverState.lastRoute = null;

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
// METRICS
//==========================================================

app.get("/metrics", (req, res) => {
  return res.json(
    success({
      server: stats,

      resolver: resolver.getStatistics?.() || {},

      browser: mcp.stats || {},

      uptime: Date.now() - serverState.startedAt,
    }),
  );
});

//==========================================================
// CACHE CLEAR
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
// ERROR HANDLER
//==========================================================

app.use((err, req, res, next) => {
  error("UNHANDLED ERROR:", err);

  return res.status(500).json({
    success: false,

    error: err.message || "Internal Server Error",

    stack: CONFIG.debug ? err.stack : undefined,

    timestamp: Date.now(),
  });
});

//==========================================================
// HEALTH MONITOR
//
// IMPORTANT:
//
// This runs AFTER HTTP server starts.
// It must NEVER prevent /status from working.
//==========================================================

const healthMonitor = setInterval(async () => {
  if (serverState.shuttingDown) {
    return;
  }

  try {
    await mcp.ensureConnected();

    serverState.browserConnected = true;

    serverState.mcpReady = true;

    serverState.lastBrowserError = null;
  } catch (err) {
    serverState.browserConnected = false;

    serverState.lastBrowserError = err.message;

    if (CONFIG.debug) {
      warn("[Health] Browser disconnected:", err.message);
    }
  }
}, 30000);

//==========================================================
// MEMORY CLEANUP
//==========================================================

const cleanupMonitor = setInterval(
  () => {
    serverState.lastSnapshot = null;

    try {
      resolver.invalidateDOMCache?.();
    } catch {}
  },
  5 * 60 * 1000,
);

//==========================================================
// SERVER STARTUP
//
// IMPORTANT:
//
// HTTP starts FIRST.
//
// Browser connection happens AFTER.
//
// Therefore:
//
// http://localhost:9000/status
//
// is available even if Playwright
// or browser connection fails.
//
//==========================================================

let server;

try {
  server = app.listen(PORT, HOST, () => {
    serverState.httpReady = true;

    console.log("");

    console.log("==========================================");

    console.log("🚀 Ultra Intelligent AI Server Started");

    console.log(`🌐 http://${HOST}:${PORT}`);

    console.log(`🤖 Model: ${CONFIG.model}`);

    console.log(`🔌 Ollama: ${CONFIG.endpoint}`);

    console.log(
      `💬 Chat AI: ${serverState.chatAIReady ? "READY" : "NOT READY"}`,
    );

    console.log("==========================================");

    console.log("");

    //------------------------------------------------
    // Browser connection is NON-BLOCKING.
    //------------------------------------------------

    Promise.resolve()
      .then(async () => {
        try {
          log("Connecting to Playwright...");

          await mcp.connect();

          serverState.initialized = true;

          serverState.browserConnected = true;

          serverState.mcpReady = true;

          serverState.startupError = null;

          log("Playwright attached successfully.");

          try {
            const page = await mcp.getPage();

            log("Current URL:", page.url());
          } catch {}
        } catch (err) {
          serverState.initialized = false;

          serverState.browserConnected = false;

          serverState.startupError = err.message;

          serverState.lastBrowserError = err.message;

          warn("Browser attach failed:", err.message);

          warn("HTTP server remains available.");

          warn("GET /status is still available.");
        }
      })
      .catch((err) => {
        error("Background startup error:", err);
      });
  });

  server.on("error", (err) => {
    serverState.httpReady = false;

    serverState.startupError = err.message;

    if (err.code === "EADDRINUSE") {
      error(`Port ${PORT} is already in use.`);
    } else {
      error("HTTP server error:", err);
    }
  });
} catch (err) {
  serverState.httpReady = false;

  serverState.startupError = err.message;

  error("Failed to start HTTP server:", err);
}

//==========================================================
// GRACEFUL SHUTDOWN
//==========================================================

async function shutdown(signal) {
  if (serverState.shuttingDown) {
    return;
  }

  serverState.shuttingDown = true;

  console.log("");

  console.log(`Received ${signal}.`);

  console.log("Shutting down...");

  clearInterval(healthMonitor);

  clearInterval(cleanupMonitor);

  try {
    await mcp.disconnect?.();
  } catch {}

  if (server) {
    server.close(() => {
      log("HTTP server closed.");

      process.exit(0);
    });
  } else {
    process.exit(0);
  }

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

export {
  app,
  server,
  commandRouter,
  chatAI,
  planner,
  resolver,
  toolMap,
  mcp,
  stats,
  serverState,
};
