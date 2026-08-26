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
// PERFORMANCE / STABILITY
// -----------------------
// ✔ Single /run execution lock
// ✔ Duplicate request protection
// ✔ No networkidle waits
// ✔ No snapshot before deterministic fast path
// ✔ Browser connection is lazy
// ✔ Browser connection is not required for chat
// ✔ Sequential action execution
// ✔ Fast browser recovery
// ✔ DevTools page protection
// ✔ Navigation invalidates DOM cache
// ✔ Detailed execution timing
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
import { fastPath } from "./planner/fast-path.js";

import aiEngine from "./aiEngine.js";
import {
  getFrameSVGs,
  getAllSVGsFromFrames,
  getSVGDataFromIframe,
  getFrameContainerData,
  getIframeContainerData,
  findFramesWithSVGs,
  getAllFrames,
} from "./utils/iframeContent.js";

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

  fastPath: process.env.FAST_PATH !== "false",

  endpoint:
    process.env.OLLAMA_ENDPOINT || "http://localhost:11434/api/generate",

  debug: process.env.DEBUG === "true",

  requestTimeout: Number(process.env.REQUEST_TIMEOUT || 120000),

  //========================================================
  // BROWSER / MCP
  //========================================================

  autoReconnect: process.env.AUTO_RECONNECT !== "false",

  cacheSnapshots: process.env.CACHE_SNAPSHOTS !== "false",

  navigationWaitUntil: "domcontentloaded",

  navigationTimeout: Number(process.env.NAVIGATION_TIMEOUT || 30000),

  pageReadyTimeout: Number(process.env.PAGE_READY_TIMEOUT || 5000),

  //========================================================
  // EXECUTION
  //========================================================

  allowParallelRuns: false,
};

//==========================================================
// CORE COMPONENTS
//==========================================================

//----------------------------------------------------------
// Playwright MCP
//----------------------------------------------------------

const MCP_CONFIG = {
  debug: CONFIG.debug,

  autoReconnect: CONFIG.autoReconnect,

  navigationWaitUntil: CONFIG.navigationWaitUntil,

  navigationTimeout: CONFIG.navigationTimeout,

  pageReadyTimeout: CONFIG.pageReadyTimeout,
};

const mcp = new PlaywrightMCPClient(MCP_CONFIG);

//----------------------------------------------------------
// Defensive MCP configuration.
//
// Some versions of mcp-client.js use `options`,
// while others use `config`.
// Make sure neither is undefined.
//----------------------------------------------------------

if (!mcp.options || typeof mcp.options !== "object") {
  mcp.options = {};
}

Object.assign(mcp.options, MCP_CONFIG);

if (!mcp.config || typeof mcp.config !== "object") {
  mcp.config = {};
}

Object.assign(mcp.config, MCP_CONFIG);

mcp.options.autoReconnect = CONFIG.autoReconnect;

mcp.config.autoReconnect = CONFIG.autoReconnect;

//----------------------------------------------------------
// Resolver
//----------------------------------------------------------

const resolver = new Resolver(mcp, {
  debug: CONFIG.debug,

  autoReconnect: CONFIG.autoReconnect,

  autoRefreshDOM: false,

  navigationTimeout: CONFIG.navigationTimeout,

  pageReadyTimeout: CONFIG.pageReadyTimeout,
});

if (!resolver.options || typeof resolver.options !== "object") {
  resolver.options = {};
}

resolver.options.autoReconnect = CONFIG.autoReconnect;

resolver.options.autoRefreshDOM = false;

resolver.options.navigationTimeout = CONFIG.navigationTimeout;

resolver.options.pageReadyTimeout = CONFIG.pageReadyTimeout;

//----------------------------------------------------------
// Tool Map
//----------------------------------------------------------

const toolMap = new ToolMap(resolver);

//----------------------------------------------------------
// Planner
//----------------------------------------------------------

const planner = new Planner({
  model: CONFIG.model,

  endpoint: CONFIG.endpoint,
});

//----------------------------------------------------------
// AI Engine
//----------------------------------------------------------

const chatAI = aiEngine;

//----------------------------------------------------------
// Command Router
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

  activeRun: null,

  runLocked: false,

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

  duplicateRuns: 0,

  routerCalls: 0,

  chatCalls: 0,

  plannerCalls: 0,

  fastPathCalls: 0,

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

//----------------------------------------------------------
// Sleep
//----------------------------------------------------------

function sleep(ms = 100) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

//----------------------------------------------------------
// Is DevTools URL?
//----------------------------------------------------------

function isDevToolsURL(url) {
  const value = String(url || "")
    .trim()
    .toLowerCase();

  return (
    value.startsWith("devtools:") ||
    value.startsWith("chrome:") ||
    value.startsWith("chrome-extension:") ||
    value.startsWith("edge:") ||
    value.startsWith("about:")
  );
}

//----------------------------------------------------------
// Validate automation page
//----------------------------------------------------------

function validateAutomationPage(page) {
  if (!page) {
    throw new Error("Playwright page is not available.");
  }

  if (typeof page.isClosed === "function" && page.isClosed()) {
    throw new Error("Playwright page is closed.");
  }

  const url = typeof page.url === "function" ? page.url() : "";

  if (isDevToolsURL(url)) {
    throw new Error(`Invalid automation page selected: ${url}`);
  }

  return page;
}

//==========================================================
// BROWSER READY
//==========================================================
//
// IMPORTANT
//
// Browser is NOT connected for chat.
//
// Browser is connected only when an ACTION needs it.
//
//==========================================================

//==========================================================
// BROWSER READY
//==========================================================

async function ensureBrowserReady() {
  //--------------------------------------------------------
  // Prevent browser access during shutdown
  //--------------------------------------------------------

  if (serverState.shuttingDown) {
    throw new Error("Jarvis server is shutting down.");
  }

  //--------------------------------------------------------
  // Validate MCP
  //--------------------------------------------------------

  if (!mcp) {
    throw new Error("Playwright MCP client is not initialized.");
  }

  //--------------------------------------------------------
  // Make sure MCP configuration exists
  //--------------------------------------------------------

  if (!mcp.options || typeof mcp.options !== "object") {
    mcp.options = {};
  }

  if (!mcp.config || typeof mcp.config !== "object") {
    mcp.config = {};
  }

  mcp.options.autoReconnect = CONFIG.autoReconnect;

  mcp.config.autoReconnect = CONFIG.autoReconnect;

  //--------------------------------------------------------
  // FIRST ATTEMPT
  //--------------------------------------------------------

  try {
    await mcp.ensureConnected();

    const page = await mcp.getPage();

    validateAutomationPage(page);

    serverState.browserConnected = true;

    serverState.mcpReady = true;

    serverState.lastBrowserError = null;

    return page;
  } catch (firstError) {
    serverState.browserConnected = false;

    serverState.lastBrowserError = firstError?.message || String(firstError);

    if (!CONFIG.autoReconnect) {
      throw firstError;
    }

    //------------------------------------------------------
    // PREVENT DUPLICATE RECONNECT
    //------------------------------------------------------

    if (serverState.reconnecting) {
      throw new Error("Browser reconnection already in progress.");
    }

    serverState.reconnecting = true;

    stats.reconnects++;

    try {
      serverState.lastReconnectAt = Date.now();

      //----------------------------------------------------
      // Force reconnect
      //----------------------------------------------------

      if (typeof mcp.connect === "function") {
        await mcp.connect(true);
      } else {
        await mcp.ensureConnected();
      }

      //----------------------------------------------------
      // Get real automation page
      //----------------------------------------------------

      const page = await mcp.getPage();

      validateAutomationPage(page);

      serverState.browserConnected = true;

      serverState.mcpReady = true;

      serverState.lastBrowserError = null;

      serverState.startupError = null;

      return page;
    } catch (reconnectError) {
      serverState.browserConnected = false;

      serverState.lastBrowserError =
        reconnectError?.message || String(reconnectError);

      throw new Error(
        `Playwright browser connection failed: ${
          reconnectError?.message || String(reconnectError)
        }`,
      );
    } finally {
      serverState.reconnecting = false;
    }
  }
}

//==========================================================
// SNAPSHOT
//==========================================================

async function captureSnapshot() {
  if (!CONFIG.cacheSnapshots) {
    return await mcp.snapshot();
  }

  const snapshot = await mcp.snapshot();

  serverState.lastSnapshot = snapshot;

  stats.snapshots++;

  return snapshot;
}

//==========================================================
// HTML
//==========================================================

async function captureHTML() {
  stats.htmlRequests++;

  return await mcp.html();
}

//==========================================================
// RESPONSE HELPERS
//==========================================================

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
// ROUTER
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

  if (typeof commandRouter.route === "function") {
    return await commandRouter.route(command, context);
  }

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
// CHAT
//==========================================================

async function handleChat(command, context = {}) {
  if (!chatAI || typeof chatAI.chat !== "function") {
    throw new Error("AI Engine is not available.");
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
// NORMALIZE ROUTE
//==========================================================

function normalizeRoute(route) {
  const rawMode = String(
    route?.mode ?? route?.type ?? route?.route ?? route?.intent ?? "",
  )
    .trim()
    .toLowerCase();

  let mode = rawMode;

  //--------------------------------------------------------
  // CHAT
  //--------------------------------------------------------

  if (
    ["chat", "conversation", "general", "question", "casual"].includes(mode)
  ) {
    mode = "chat";
  }

  //--------------------------------------------------------
  // ACTION
  //--------------------------------------------------------

  if (
    ["action", "browser", "automation", "command", "execute"].includes(mode)
  ) {
    mode = "action";
  }

  return {
    ...(route || {}),

    mode,

    type: route?.type || mode,
  };
}

//==========================================================
// NORMALIZE PLAN
//==========================================================
//
// Keeps Planner output compatible with ToolMap.
//
//==========================================================

function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) {
    return null;
  }

  const steps = plan.steps.filter(Boolean).map((step, index) => {
    const rawTool = step.tool || step.action || step.type || "";

    const tool = String(rawTool).trim().toLowerCase();

    const args = {
      ...(step.args || {}),
    };

    //------------------------------------------------
    // CLICK
    //------------------------------------------------

    if (tool === "clicksmart" || tool === "click-smart") {
      return {
        ...step,

        tool: "click",

        args: {
          ...args,

          target:
            args.target ??
            args.text ??
            args.label ??
            args.selector ??
            step.target ??
            step.text ??
            step.label ??
            "",
        },

        index,
      };
    }

    //------------------------------------------------
    // FILL / TYPE
    //------------------------------------------------

    if (tool === "fill" || tool === "input") {
      return {
        ...step,

        tool: "type",

        args: {
          ...args,

          field:
            args.field ??
            args.target ??
            args.label ??
            args.selector ??
            step.field ??
            step.target ??
            "",

          value: args.value ?? step.value ?? args.text ?? "",
        },

        index,
      };
    }

    //------------------------------------------------
    // NAVIGATE
    //------------------------------------------------

    if (tool === "goto" || tool === "open" || tool === "visit") {
      return {
        ...step,

        tool: "navigate",

        args: {
          ...args,

          url:
            args.url ??
            args.target ??
            args.value ??
            step.url ??
            step.target ??
            step.value ??
            "",
        },

        index,
      };
    }

    //------------------------------------------------
    // SUBMIT
    //
    // Keep planner output if your ToolMap supports it.
    // Otherwise Resolver can handle it.
    //------------------------------------------------

    if (tool === "submit" || tool === "submit-form") {
      return {
        ...step,

        tool: "submit",

        args: {
          ...args,

          target: args.target ?? step.target ?? "",
        },

        index,
      };
    }

    //------------------------------------------------
    // NORMAL
    //------------------------------------------------

    return {
      ...step,

      tool,

      args,

      index,
    };
  });

  return {
    ...plan,

    steps,
  };
}

//==========================================================
// FAST PATH
//==========================================================
//
// IMPORTANT
//
// fastPath() gets the first chance.
//
// Snapshot + Qwen only happens when fastPath cannot
// understand the command.
//
//==========================================================

function getFastPlan(command) {
  if (!CONFIG.fastPath || typeof fastPath !== "function") {
    return null;
  }

  try {
    const plan = fastPath(command);

    if (plan && Array.isArray(plan.steps) && plan.steps.length) {
      stats.fastPathCalls++;

      return normalizePlan(plan);
    }
  } catch (err) {
    if (CONFIG.debug) {
      warn("[FAST PATH] Failed:", err.message);
    }
  }

  return null;
}

//==========================================================
// EXECUTE PLAN
//==========================================================
//
// Strictly sequential.
//
// Step 1 completes.
// Then Step 2.
// Then Step 3.
//
// NEVER Promise.all() here.
//
//==========================================================

async function executePlan(plan, page) {
  const normalized = normalizePlan(plan);

  if (!normalized || !normalized.steps.length) {
    throw new Error("Planner returned an empty execution plan.");
  }

  const results = [];

  for (let index = 0; index < normalized.steps.length; index++) {
    const step = normalized.steps[index];

    if (!step) {
      continue;
    }

    const stepNumber = index + 1;

    if (CONFIG.debug) {
      console.log(`[RUN] Step ${stepNumber}/${normalized.steps.length}`);

      console.dir(step, {
        depth: null,
      });
    }

    const started = startTimer();

    try {
      stats.toolExecutions++;

      //----------------------------------------------------
      // Execute ONLY ONE step.
      //----------------------------------------------------

      const result = await toolMap.execute(step);

      const duration = performance.now() - started;

      const stepSuccess = result?.success !== false;

      const item = {
        index,

        step: stepNumber,

        tool: step.tool,

        args: step.args,

        success: stepSuccess,

        result,

        duration,
      };

      results.push(item);

      //----------------------------------------------------
      // Navigation completed.
      //
      // Do NOT wait for networkidle.
      //----------------------------------------------------

      if (step.tool === "navigate" || result?.action === "navigate") {
        try {
          await page
            .waitForLoadState("domcontentloaded", {
              timeout: CONFIG.navigationTimeout,
            })
            .catch(() => {});

          //------------------------------------------------
          // Small SPA stabilization.
          //------------------------------------------------

          await sleep(150);

          //------------------------------------------------
          // DOM changed.
          //------------------------------------------------

          resolver.invalidateDOMCache?.();
        } catch (err) {
          if (CONFIG.debug) {
            warn("[RUN] Navigation stabilization:", err.message);
          }
        }
      }

      //----------------------------------------------------
      // If resolver supports automatic DOM refresh,
      // refresh only when explicitly enabled.
      //----------------------------------------------------

      if (resolver.options?.autoRefreshDOM) {
        try {
          await resolver.ensureFreshDOM?.();
        } catch (err) {
          if (CONFIG.debug) {
            warn("[RUN] DOM refresh:", err.message);
          }
        }
      }

      //----------------------------------------------------
      // STOP IMMEDIATELY ON FAILURE
      //----------------------------------------------------

      if (!stepSuccess) {
        return {
          success: false,

          results,

          failedStep: item,

          error: result?.error || `Step ${stepNumber} failed.`,
        };
      }

      //----------------------------------------------------
      // Verify browser after each step.
      //
      // This catches page/CDP death before the next step.
      //----------------------------------------------------

      try {
        const currentPage = await mcp.getPage();

        validateAutomationPage(currentPage);

        page = currentPage;
      } catch (healthError) {
        return {
          success: false,

          results,

          failedStep: item,

          error: `Browser became unavailable after step ${stepNumber}: ${healthError.message}`,
        };
      }
    } catch (err) {
      const duration = performance.now() - started;

      const failed = {
        index,

        step: stepNumber,

        tool: step.tool,

        args: step.args,

        success: false,

        error: err.message,

        duration,
      };

      results.push(failed);

      return {
        success: false,

        results,

        failedStep: failed,

        error: err.message,
      };
    }
  }

  return {
    success: true,

    results,
  };
}

//==========================================================
// RUN LOCK
//==========================================================
//
// This is critical.
//
// If the frontend accidentally sends:
//
// POST /run
// POST /run
//
// only ONE browser automation task is allowed to run.
//
//==========================================================

function acquireRunLock(requestId, command) {
  if (CONFIG.allowParallelRuns) {
    return true;
  }

  if (serverState.runLocked) {
    stats.duplicateRuns++;

    return false;
  }

  serverState.runLocked = true;

  serverState.activeRun = {
    requestId,

    command,

    startedAt: Date.now(),
  };

  return true;
}

function releaseRunLock() {
  serverState.runLocked = false;

  serverState.activeRun = null;
}

//==========================================================
// STATUS
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

      execution: {
        locked: Boolean(serverState.runLocked),

        activeRun: serverState.activeRun,
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

  //------------------------------------------------------
  // VALIDATE
  //------------------------------------------------------

  if (!command) {
    stopTimer(started);

    return res.status(400).json({
      success: false,

      mode: "unknown",

      error: "Missing command.",
    });
  }

  //------------------------------------------------------
  // DUPLICATE PROTECTION
  //------------------------------------------------------

  if (!acquireRunLock(req.requestId, command)) {
    stopTimer(started);

    return res.status(409).json({
      success: false,

      mode: "busy",

      error: "Another browser automation command is already running.",

      activeRun: serverState.activeRun,

      hint: "Wait for the current command to finish before sending another /run request.",
    });
  }

  try {
    //----------------------------------------------------
    // STORE COMMAND
    //----------------------------------------------------

    serverState.lastCommand = command;

    if (CONFIG.debug) {
      console.log("\n================================================");

      console.log("[RUN] Command:", command);

      console.log("================================================\n");
    }

    //----------------------------------------------------
    // ROUTER
    //----------------------------------------------------

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

          duration: stats.lastRequestTime,
        },
      });
    }

    //----------------------------------------------------
    // NORMALIZE ROUTE
    //----------------------------------------------------

    route = normalizeRoute(route);

    serverState.lastRoute = route;

    if (CONFIG.debug) {
      console.log("[RUN] Normalized Route:");

      console.dir(route, {
        depth: null,
      });
    }

    //----------------------------------------------------
    // CHAT
    //
    // IMPORTANT:
    //
    // Browser is NOT touched.
    //
    //----------------------------------------------------

    if (route.mode === "chat") {
      try {
        stats.chatCalls++;

        const chatResult = await handleChat(command, {
          route,

          requestId: req.requestId,
        });

        stopTimer(started);

        return res.json(
          success({
            mode: "chat",

            command,

            reply: chatResult.reply,

            route,

            statistics: {
              routerCalls: stats.routerCalls,

              chatCalls: stats.chatCalls,

              plannerCalls: stats.plannerCalls,

              duration: stats.lastRequestTime,
            },
          }),
        );
      } catch (err) {
        error("[RUN] Chat Error:", err.message);

        stopTimer(started);

        return res.status(500).json({
          success: false,

          mode: "chat",

          command,

          route,

          error: `Chat AI failed: ${err.message}`,
        });
      }
    }

    //----------------------------------------------------
    // UNKNOWN MODE
    //----------------------------------------------------

    if (route.mode !== "action") {
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

    //----------------------------------------------------
    // ACTION
    //----------------------------------------------------

    const page = await ensureBrowserReady();

    validateAutomationPage(page);

    //----------------------------------------------------
    // FAST PATH FIRST
    //
    // This is BEFORE snapshot.
    //
    // Therefore simple commands don't wait for Qwen.
    //----------------------------------------------------

    let plan = getFastPlan(command);

    let plannerSource = plan ? "fast-path" : null;

    //----------------------------------------------------
    // FALLBACK TO LLM PLANNER
    //----------------------------------------------------

    if (!plan) {
      let pageText = "";

      //--------------------------------------------------
      // Snapshot only when planner is actually needed.
      //--------------------------------------------------

      try {
        const snapshot = await captureSnapshot();

        pageText = String(snapshot?.text || "");

        if (CONFIG.debug) {
          console.log("[RUN] Snapshot:", pageText.length, "characters");
        }
      } catch (err) {
        warn("[RUN] Snapshot unavailable:", err.message);
      }

      //--------------------------------------------------
      // Qwen
      //--------------------------------------------------

      stats.plannerCalls++;

      try {
        plan = await planner.plan(command, pageText);

        plannerSource = "qwen";
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
            plannerCalls: stats.plannerCalls,

            duration: stats.lastRequestTime,
          },
        });
      }
    }

    //----------------------------------------------------
    // NORMALIZE PLAN
    //----------------------------------------------------

    plan = normalizePlan(plan);

    serverState.lastPlan = plan;

    //----------------------------------------------------
    // VALIDATE PLAN
    //----------------------------------------------------

    if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
      stopTimer(started);

      return res.status(500).json({
        success: false,

        mode: "action",

        command,

        route,

        plan,

        error: "Planner returned an empty or invalid execution plan.",

        plannerSource,
      });
    }

    //----------------------------------------------------
    // NEVER ALLOW CHAT PLAN
    //----------------------------------------------------

    if (
      String(plan.mode || "")
        .trim()
        .toLowerCase() === "chat"
    ) {
      stopTimer(started);

      return res.status(500).json({
        success: false,

        mode: "action",

        command,

        route,

        plan,

        error: "Planner returned chat mode for an action command.",

        plannerSource,
      });
    }

    //----------------------------------------------------
    // DEBUG PLAN
    //----------------------------------------------------

    if (CONFIG.debug) {
      console.log("[RUN] Planner Source:", plannerSource);

      console.log(`[RUN] Executing ${plan.steps.length} step(s) sequentially.`);

      console.dir(plan, {
        depth: null,
      });
    }

    //----------------------------------------------------
    // EXECUTE
    //----------------------------------------------------

    const execution = await executePlan(plan, page);

    //----------------------------------------------------
    // FAILURE
    //----------------------------------------------------

    if (!execution.success) {
      stopTimer(started);

      return res.status(500).json({
        success: false,

        mode: "action",

        command,

        route,

        plan,

        plannerSource,

        steps: execution.results,

        failedStep: execution.failedStep,

        error: execution.error || "Action execution failed.",

        statistics: {
          routerCalls: stats.routerCalls,

          plannerCalls: stats.plannerCalls,

          fastPathCalls: stats.fastPathCalls,

          toolExecutions: stats.toolExecutions,

          duration: stats.lastRequestTime,
        },
      });
    }

    //----------------------------------------------------
    // SUCCESS
    //----------------------------------------------------

    stopTimer(started);

    return res.json(
      success({
        mode: "action",

        command,

        route,

        plan,

        plannerSource,

        steps: execution.results,

        statistics: {
          routerCalls: stats.routerCalls,

          chatCalls: stats.chatCalls,

          plannerCalls: stats.plannerCalls,

          fastPathCalls: stats.fastPathCalls,

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

        plannerCalls: stats.plannerCalls,

        fastPathCalls: stats.fastPathCalls,

        toolExecutions: stats.toolExecutions,

        duration: stats.lastRequestTime,
      },
    });
  } finally {
    //----------------------------------------------------
    // ALWAYS RELEASE LOCK
    //----------------------------------------------------

    releaseRunLock();
  }
});

//==========================================================
// INIT
//==========================================================

//==========================================================
// INIT
//==========================================================

app.post("/init", async (req, res) => {
  const started = startTimer();

  try {
    const requestedURL = String(req.body?.url || "").trim();

    log(
      "[INIT] Browser initialization requested",
      requestedURL ? `URL: ${requestedURL}` : "",
    );

    //----------------------------------------------------
    // Attach to Playwright
    //----------------------------------------------------

    const page = await ensureBrowserReady();

    //----------------------------------------------------
    // Optional navigation
    //
    // The Electron frontend already navigates, so we
    // normally don't navigate again here.
    //----------------------------------------------------

    validateAutomationPage(page);

    serverState.initialized = true;

    serverState.browserConnected = true;

    serverState.mcpReady = true;

    serverState.startupError = null;

    const url = page.url();

    let title = "";

    try {
      title = await page.title();
    } catch {}

    stopTimer(started);

    return res.json(
      success({
        message: "Playwright attached successfully.",

        url,

        title,

        browserConnected: true,

        initialized: true,

        duration: stats.lastRequestTime,
      }),
    );
  } catch (err) {
    stopTimer(started);

    serverState.initialized = false;

    serverState.browserConnected = false;

    serverState.startupError = err?.message || String(err);

    serverState.lastBrowserError = err?.message || String(err);

    error("[INIT] Browser initialization failed:", err);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// HEALTH
//==========================================================

app.get("/health", async (req, res) => {
  try {
    const page = await ensureBrowserReady();

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

        execution: {
          locked: serverState.runLocked,

          activeRun: serverState.activeRun,
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
// SVG / IFRAME SVG
//==========================================================

app.get("/svg", async (req, res) => {
  try {
    const page = await ensureBrowserReady();

    const options = {
      selector: req.query.selector || "svg",
      frameUrl: req.query.frameUrl || undefined,
      frameName: req.query.frameName || undefined,
      framePattern: req.query.framePattern || undefined,
      frameIndex:
        req.query.frameIndex !== undefined
          ? Number(req.query.frameIndex)
          : undefined,
      onlyIframes: req.query.onlyIframes === "true",
      includeHTML: req.query.includeHTML !== "false",
      includePaths: req.query.includePaths !== "false",
      includeShapes: req.query.includeShapes !== "false",
      includeText: req.query.includeText !== "false",
      includeBBox: req.query.includeBBox !== "false",
      includeAttributes: req.query.includeAttributes !== "false",
      onlyVisible: req.query.onlyVisible === "true",
      filter: req.query.filter || undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    };

    let result;
    if (options.onlyIframes) {
      result = await getSVGDataFromIframe(page, options);
    } else {
      const framesData = await getAllSVGsFromFrames(page, options);
      const totalSVGs = framesData.reduce((sum, f) => sum + f.svgCount, 0);
      result = {
        success: true,
        totalFrames: framesData.length,
        totalSVGs,
        frames: framesData,
      };
    }

    return res.json(success(result));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.post("/svg", async (req, res) => {
  try {
    const page = await ensureBrowserReady();
    const body = req.body || {};

    const options = {
      selector: body.selector || "svg",
      frameUrl: body.frameUrl || undefined,
      frameName: body.frameName || undefined,
      framePattern: body.framePattern || undefined,
      frameIndex:
        body.frameIndex !== undefined ? Number(body.frameIndex) : undefined,
      onlyIframes: Boolean(body.onlyIframes),
      includeHTML: body.includeHTML !== false,
      includePaths: body.includePaths !== false,
      includeShapes: body.includeShapes !== false,
      includeText: body.includeText !== false,
      includeBBox: body.includeBBox !== false,
      includeAttributes: body.includeAttributes !== false,
      onlyVisible: Boolean(body.onlyVisible),
      filter: body.filter || undefined,
      limit: body.limit ? Number(body.limit) : 100,
    };

    let result;
    if (options.onlyIframes) {
      result = await getSVGDataFromIframe(page, options);
    } else {
      const framesData = await getAllSVGsFromFrames(page, options);
      const totalSVGs = framesData.reduce((sum, f) => sum + f.svgCount, 0);
      result = {
        success: true,
        totalFrames: framesData.length,
        totalSVGs,
        frames: framesData,
      };
    }

    return res.json(success(result));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.get("/iframe/svg", async (req, res) => {
  try {
    const page = await ensureBrowserReady();

    const options = {
      selector: req.query.selector || "svg",
      parentClass:
        req.query.parentClass ||
        req.query.class ||
        req.query.className ||
        undefined,
      container:
        req.query.container ||
        req.query.parentSelector ||
        req.query.containerSelector ||
        undefined,
      frameUrl: req.query.frameUrl || undefined,
      frameName: req.query.frameName || undefined,
      framePattern: req.query.framePattern || undefined,
      frameIndex:
        req.query.frameIndex !== undefined
          ? Number(req.query.frameIndex)
          : undefined,
      onlyIframes: true,
      includeHTML: req.query.includeHTML !== "false",
      includePaths: req.query.includePaths !== "false",
      includeShapes: req.query.includeShapes !== "false",
      includeText: req.query.includeText !== "false",
      includeBBox: req.query.includeBBox !== "false",
      includeAttributes: req.query.includeAttributes !== "false",
      onlyVisible: req.query.onlyVisible === "true",
      filter: req.query.filter || undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    };

    const result = await getSVGDataFromIframe(page, options);
    return res.json(success(result));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.post("/iframe/svg", async (req, res) => {
  try {
    const page = await ensureBrowserReady();
    const body = req.body || {};

    const options = {
      selector: body.selector || "svg",
      parentClass:
        body.parentClass ||
        body.class ||
        body.className ||
        undefined,
      container:
        body.container ||
        body.parentSelector ||
        body.containerSelector ||
        undefined,
      frameUrl: body.frameUrl || undefined,
      frameName: body.frameName || undefined,
      framePattern: body.framePattern || undefined,
      frameIndex:
        body.frameIndex !== undefined ? Number(body.frameIndex) : undefined,
      onlyIframes: true,
      includeHTML: body.includeHTML !== false,
      includePaths: body.includePaths !== false,
      includeShapes: body.includeShapes !== false,
      includeText: body.includeText !== false,
      includeBBox: body.includeBBox !== false,
      includeAttributes: body.includeAttributes !== false,
      onlyVisible: Boolean(body.onlyVisible),
      filter: body.filter || undefined,
      limit: body.limit ? Number(body.limit) : 100,
    };

    const result = await getSVGDataFromIframe(page, options);
    return res.json(success(result));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// CONTAINER DATA FROM IFRAME (e.g. .dGBOyn)
//==========================================================

app.get("/iframe/data", async (req, res) => {
  try {
    const page = await ensureBrowserReady();
    const target =
      req.query.class ||
      req.query.className ||
      req.query.selector ||
      req.query.container ||
      req.query.target ||
      req.query.parentClass ||
      "";

    if (!target) {
      return res.status(400).json(
        failure(
          new Error(
            "Target class or selector is required (e.g., ?class=dGBOyn or ?selector=.dGBOyn)",
          ),
        ),
      );
    }

    const options = {
      target,
      frameUrl: req.query.frameUrl || undefined,
      frameName: req.query.frameName || undefined,
      framePattern: req.query.framePattern || undefined,
      frameIndex:
        req.query.frameIndex !== undefined
          ? Number(req.query.frameIndex)
          : undefined,
      onlyIframes: req.query.onlyIframes !== "false",
      includeHTML: req.query.includeHTML !== "false",
      includeSVGs: req.query.includeSVGs !== "false",
      includeChildren: req.query.includeChildren !== "false",
      includeBBox: req.query.includeBBox !== "false",
      limit: req.query.limit ? Number(req.query.limit) : 50,
    };

    const result = await getIframeContainerData(page, target, options);
    return res.json(success(result));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.post("/iframe/data", async (req, res) => {
  try {
    const page = await ensureBrowserReady();
    const body = req.body || {};
    const target =
      body.class ||
      body.className ||
      body.selector ||
      body.container ||
      body.target ||
      body.parentClass ||
      ".tzQn0o";

    const options = {
      target,
      frameUrl: body.frameUrl || undefined,
      frameName: body.frameName || undefined,
      framePattern: body.framePattern || undefined,
      frameIndex:
        body.frameIndex !== undefined ? Number(body.frameIndex) : undefined,
      onlyIframes: body.onlyIframes !== false,
      includeHTML: body.includeHTML !== false,
      includeSVGs: body.includeSVGs !== false,
      includeChildren: body.includeChildren !== false,
      includeBBox: body.includeBBox !== false,
      limit: body.limit ? Number(body.limit) : 50,
    };

    const result = await getIframeContainerData(page, target, options);
    return res.json(success(result));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// LIVE IFRAME STREAM (Server-Sent Events)
//==========================================================

app.get("/iframe/stream", async (req, res) => {
  const target = String(
    req.query.target ||
      req.query.class ||
      req.query.selector ||
      req.query.container ||
      ".tzQn0o",
  ).trim();

  const intervalMs = Math.max(
    200,
    parseInt(req.query.interval || req.query.every || "1500", 10),
  );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let active = true;
  let tick = 0;

  async function sendTick() {
    if (!active) return;
    tick++;
    try {
      const page = await ensureBrowserReady();
      const result = await getIframeContainerData(page, target, {
        onlyIframes: true,
        includeSVGs: true,
        includeChildren: true,
      });

      const payload = {
        tick,
        timestamp: new Date().toISOString(),
        intervalMs,
        target,
        ...result,
      };

      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (err) {
      res.write(
        `data: ${JSON.stringify({ tick, success: false, target, error: err.message, timestamp: new Date().toISOString() })}\n\n`,
      );
    }
  }

  // Send initial data immediately
  await sendTick();

  const timer = setInterval(sendTick, intervalMs);

  req.on("close", () => {
    active = false;
    clearInterval(timer);
    res.end();
  });
});

app.get("/iframes", async (req, res) => {
  try {
    const page = await ensureBrowserReady();
    const frames = await getAllFrames(page);
    const mainFrame = page.mainFrame();

    const result = [];
    for (const [index, frame] of frames.entries()) {
      let svgCount = 0;
      try {
        svgCount = await frame.locator("svg").count();
      } catch {}

      result.push({
        index,
        url: frame.url(),
        name: frame.name(),
        isMainFrame: frame === mainFrame,
        parentUrl: frame.parentFrame()?.url() || null,
        svgCount,
      });
    }

    return res.json(
      success({
        totalFrames: frames.length,
        iframesCount: frames.filter((f) => f !== mainFrame).length,
        frames: result,
      }),
    );
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

//==========================================================
// DIRECT TOOL
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

    const page = await ensureBrowserReady();

    stats.toolExecutions++;

    const result = await toolMap.execute({
      tool,
      args,
    });

    //----------------------------------------------------
    // Navigation
    //
    // No networkidle.
    //----------------------------------------------------

    if (tool === "navigate" || result?.action === "navigate") {
      await page
        .waitForLoadState("domcontentloaded", {
          timeout: CONFIG.navigationTimeout,
        })
        .catch(() => {});

      await sleep(150);

      resolver.invalidateDOMCache?.();
    }

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

    error("[TOOL ERROR]", err.message);

    return res.status(500).json(failure(err));
  }
});

//==========================================================
// MULTIPLE TOOLS
//==========================================================
//
// Always sequential.
//
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

    const page = await ensureBrowserReady();

    const results = [];

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];

      try {
        stats.toolExecutions++;

        const result = await toolMap.execute(step);

        results.push({
          index,

          step: index + 1,

          tool: step.tool,

          success: result?.success !== false,

          result,
        });

        //------------------------------------------------
        // Navigation
        //------------------------------------------------

        if (step.tool === "navigate" || result?.action === "navigate") {
          await page
            .waitForLoadState("domcontentloaded", {
              timeout: CONFIG.navigationTimeout,
            })
            .catch(() => {});

          await sleep(150);

          resolver.invalidateDOMCache?.();
        }

        //------------------------------------------------
        // STOP ON FAILURE
        //------------------------------------------------

        if (result?.success === false) {
          break;
        }
      } catch (err) {
        results.push({
          index,

          step: index + 1,

          tool: step.tool,

          success: false,

          error: err.message,
        });

        break;
      }
    }

    stopTimer(started);

    const allSuccessful =
      results.length === steps.length &&
      results.every((item) => item.success !== false);

    return res.json(
      success({
        executed: results.length,

        total: steps.length,

        success: allSuccessful,

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

      activeRun: serverState.activeRun,

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

      execution: {
        locked: serverState.runLocked,

        activeRun: serverState.activeRun,
      },

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
//==========================================================
//
// IMPORTANT:
//
// This monitor does NOT reconnect.
//
// It only reports the current state.
//
// Browser reconnect happens when:
//   /init
//   /run
//   /tool
//   /snapshot
//   /html
//   /page
//
// actually requires the browser.
//
//==========================================================

const healthMonitor = setInterval(async () => {
  if (serverState.shuttingDown) {
    return;
  }

  try {
    if (!mcp || typeof mcp.getPage !== "function") {
      return;
    }

    const page = await mcp.getPage();

    validateAutomationPage(page);

    serverState.browserConnected = true;

    serverState.mcpReady = true;

    serverState.lastBrowserError = null;
  } catch (err) {
    serverState.browserConnected = false;

    serverState.lastBrowserError = err?.message || String(err);

    if (CONFIG.debug) {
      warn("[Health] Browser unavailable:", err?.message || String(err));
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
//==========================================================
//
// HTTP starts first.
//
// Browser connection happens asynchronously.
//
// Ollama is NOT started here.
//
// Your Ollama service is already running separately.
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

    console.log(`⚡ Fast Path: ${CONFIG.fastPath ? "ENABLED" : "DISABLED"}`);

    console.log("==========================================");

    console.log("");

    //------------------------------------------------
    // Browser connection is NON-BLOCKING.
    //------------------------------------------------

    Promise.resolve()
      .then(async () => {
        try {
          log("Connecting to Playwright...");

          const page = await ensureBrowserReady();

          serverState.initialized = true;

          serverState.browserConnected = true;

          serverState.mcpReady = true;

          serverState.startupError = null;

          log("Playwright attached successfully.");

          log("Current URL:", page.url());
        } catch (err) {
          serverState.initialized = false;

          serverState.browserConnected = false;

          serverState.startupError = err.message;

          serverState.lastBrowserError = err.message;

          warn("Browser attach failed:", err.message);

          warn("HTTP server remains available.");
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
//------------------------------------------------
// Browser connection is intentionally lazy.
//
// Electron calls POST /init after the browser
// window has been created.
//------------------------------------------------

log("HTTP server ready. Waiting for browser initialization...");
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

  releaseRunLock();

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
