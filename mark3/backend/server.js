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
// ✔ LLM-planned browser actions
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
import path from "path";
import { fileURLToPath } from "url";

import CredentialManager from "./auth/credential-manager.js";
import ProfileManager from "./auth/profile-manager.js";

import PlaywrightMCPClient from "./mcp-client.js";
import Planner from "./planner.js";
import Resolver from "./resolver.js";
import ToolMap from "./tool-map.js";
import ExecutionEngine from "./executor.js";
import browserController from "./browser-controller.js";

import CommandRouter from "./command-router.js";
import SystemAgent from "./system-agent.js";
import InteractiveAgent from "./interactive-agent.js";

import aiEngine from "./aiEngine.js";
import {
  getFrameSVGs,
  getAllSVGsFromFrames,
  getSVGDataFromIframe,
  getFrameContainerData,
  getIframeContainerData,
  findFramesWithSVGs,
  getAllFrames,
  dismissInactivityPopup,
} from "./utils/iframeContent.js";
import {
  formatTimeToValuesJSON,
} from "../database/gameservice.js";
import {
  getOfficeTimerConfig,
  saveOfficeTimerConfig,
  saveOfficeAttendance,
  getOfficeAttendance,
  getOfficeAttendanceRange,
} from "../database/officeTimerService.js";

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
// Execution Engine (Page-Only Verification Pipeline)
//----------------------------------------------------------

const executionEngine = new ExecutionEngine(browserController, resolver, {
  debug: CONFIG.debug,
});

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

const __serverDirname = path.dirname(fileURLToPath(import.meta.url));
const systemAgent = new SystemAgent({
  projectRoot: path.resolve(__serverDirname, ".."),
  model: CONFIG.model,
  endpoint: CONFIG.endpoint,
  debug: CONFIG.debug,
});

const interactiveAgent = new InteractiveAgent({
  browserController,
  executionEngine,
  model: CONFIG.model,
  endpoint: CONFIG.endpoint,
  debug: CONFIG.debug,
});

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
  const lower = String(url || "").trim().toLowerCase();

  // Allow recoverable WebContentsView states (about:blank or chrome-error:// after a failed navigation)
  // so subsequent navigate/self-healing steps can recover the tab cleanly.
  if (lower === "about:blank" || lower.startsWith("chrome-error://")) {
    return page;
  }

  if (isDevToolsURL(url) || (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url))) {
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

function getInstallResearchQuery(plan, command) {
  const commandText = String(plan.commandText || "").trim();
  const packageManagerCommand = commandText.match(
    /^(npm|npx|pnpm|yarn|bun|pip3?|winget|choco)\s+(?:install|i|add)\s+(.+)$/i,
  );
  const target =
    plan.args?.target ||
    plan.args?.package ||
    plan.args?.repo ||
    packageManagerCommand?.[2]?.replace(/\s+--[\w-]+(?:=\S+)?/g, "") ||
    commandText ||
    command;
  const manager = packageManagerCommand?.[1] || "";
  return `${String(target).replace(/\s+/g, " ").trim()} official installation documentation ${manager}`.trim();
}

async function researchSystemInstall(plan, command, conversationHistory = []) {
  const page = await ensureBrowserReady();
  const query = getInstallResearchQuery(plan, command);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: CONFIG.navigationTimeout,
  });
  const searchResults = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors
      .map((anchor) => {
        const href = anchor.href || "";
        let url = href;
        try {
          const parsed = new URL(href);
          if (parsed.hostname.endsWith("google.com")) {
            url = parsed.searchParams.get("q") || parsed.searchParams.get("url") || "";
          }
        } catch {
          return null;
        }
        const title = (anchor.innerText || anchor.getAttribute("aria-label") || "").trim();
        const excerpt = (
          anchor.closest("div")?.parentElement?.innerText ||
          anchor.parentElement?.innerText ||
          ""
        ).trim();
        return { title, url, excerpt: excerpt.slice(0, 500) };
      })
      .filter((result) => {
        if (!result?.title || !/^https:\/\//i.test(result.url)) return false;
        try {
          const host = new URL(result.url).hostname.toLowerCase();
          return !host.endsWith("google.com") && !host.endsWith("googleusercontent.com");
        } catch {
          return false;
        }
      })
      .slice(0, 12),
  );
  const searchTitle = await page.title();
  const searchPageText = await page.locator("body").innerText({
    timeout: CONFIG.pageReadyTimeout,
  });
  if (!searchPageText.trim() || !searchResults.length) {
    throw new Error(`Browser research page returned no readable results: ${page.url()}`);
  }

  stats.plannerCalls++;
  const sourceChoice = await planner.researchInstallation(
    query,
    searchResults
      .map((result, index) => `${index + 1}. ${result.title}\nURL: ${result.url}\n${result.excerpt}`)
      .join("\n\n"),
    {
      stage: "search",
      platform: process.platform,
      packageManager: plan.commandText?.split(/\s+/)[0] || "",
      conversationHistory,
    },
  );
  const selectedSource = searchResults.find((result) => {
    try {
      return new URL(result.url).href.replace(/\/$/, "") ===
        new URL(sourceChoice?.sourceUrl || "").href.replace(/\/$/, "");
    } catch {
      return false;
    }
  });
  if (!sourceChoice?.found || !selectedSource) {
    throw new Error(
      sourceChoice?.reason ||
        "Jarvis could not verify an official installation source from the browser search results.",
    );
  }

  await page.goto(selectedSource.url, {
    waitUntil: "domcontentloaded",
    timeout: CONFIG.navigationTimeout,
  });
  const docTitle = await page.title();
  const documentationText = await page.locator("body").innerText({
    timeout: CONFIG.pageReadyTimeout,
  });
  if (!documentationText.trim()) {
    throw new Error(`Official documentation page returned no readable text: ${page.url()}`);
  }

  stats.plannerCalls++;
  const installPlan = await planner.researchInstallation(query, documentationText, {
    stage: "documentation",
    platform: process.platform,
    packageManager: plan.commandText?.split(/\s+/)[0] || "",
    sourceUrl: page.url(),
    sourceTitle: docTitle,
    conversationHistory,
  });
  const recommendedCommand = String(installPlan?.command || "").trim();
  const allowedCommand =
    /^(?:npm\s+(?:install|i)|pnpm\s+(?:add|install)|yarn\s+add|bun\s+(?:add|install)|pip3?\s+install|python(?:3)?\s+-m\s+pip\s+install|winget\s+install|choco\s+install|brew\s+install|sudo\s+apt-get\s+install|git\s+clone)\b/i;
  const normalizeEvidence = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedDocs = normalizeEvidence(documentationText);
  const evidenceQuote = String(installPlan?.evidenceQuote || "").trim();
  const quoteIsPresent =
    evidenceQuote.length >= 8 && normalizedDocs.includes(normalizeEvidence(evidenceQuote));
  const commandIsPresent = normalizeEvidence(recommendedCommand)
    ? normalizedDocs.includes(normalizeEvidence(recommendedCommand))
    : false;
  if (
    !installPlan?.found ||
    !recommendedCommand ||
    !allowedCommand.test(recommendedCommand) ||
    !/^[A-Za-z0-9@._/:=+\-[\] ]+$/.test(recommendedCommand) ||
    recommendedCommand.length > 500 ||
    !quoteIsPresent ||
    !commandIsPresent
  ) {
    throw new Error(
      installPlan?.reason ||
        "Jarvis could not verify an exact, safe installation command in the selected official documentation. No installation was run.",
    );
  }

  plan.commandText = recommendedCommand;
  plan.options = [
    {
      id: "official_researched",
      label: "Use command from official documentation",
      commandText: recommendedCommand,
    },
  ];
  plan.summary = `Install ${installPlan.package || plan.args?.target || query} using the command verified in official documentation`;
  plan.args = {
    ...(plan.args || {}),
    browserResearch: {
      query,
      url: page.url(),
      searchUrl,
      searchTitle,
      sourceUrl: page.url(),
      sourceTitle: docTitle,
      sourceExcerpt: documentationText.slice(0, 2200),
      command: recommendedCommand,
      package: installPlan.package || "",
      evidenceQuote,
      reason: installPlan.reason || "",
      steps: Array.isArray(installPlan.steps) ? installPlan.steps.slice(0, 6) : [],
      searchResults: searchResults.slice(0, 6).map(({ title, url }) => ({
        title,
        url,
      })),
      conversationHistory: conversationHistory.slice(-8),
      planner: {
        mode: "installation_research",
        source: "official_documentation",
        reply: installPlan.reason || "",
      },
    },
  };
  serverState.lastPlan = installPlan;
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

function normalizeConversationHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (turn) =>
        ["user", "assistant"].includes(turn?.role) &&
        typeof turn.content === "string" &&
        turn.content.trim(),
    )
    .slice(-24)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.trim().slice(0, 1400),
    }));
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
    const classification = commandRouter.classify(command, context);

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

    conversationHistory: context.conversationHistory,

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

  //--------------------------------------------------------
  // SYSTEM
  //--------------------------------------------------------

  if (["system", "cli", "local", "install", "shell", "files"].includes(mode)) {
    mode = "system";
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
      // Execute step via ExecutionEngine (with retry & verification)
      //----------------------------------------------------

      let execOutcome = await executionEngine.execute(step, page);

      if (!execOutcome.success && toolMap) {
        try {
          const fallbackRes = await toolMap.execute(step);
          if (fallbackRes?.success !== false) {
            execOutcome = {
              success: true,
              tool: step.tool,
              args: step.args,
              result: fallbackRes,
              verification: { verified: true, message: "Executed via ToolMap fallback" },
            };
          }
        } catch (fbErr) {}
      }

      const result = execOutcome.result || execOutcome;
      const stepVerification = execOutcome.verification;
      const effectiveArgs = execOutcome.args || step.args;

      const duration = performance.now() - started;

      const stepSuccess = result?.success !== false;

      let browserUrlAfter = "";
      try {
        browserUrlAfter = page && !page.isClosed() ? page.url() : "";
      } catch {}

      const healedSuffix = execOutcome.healing?.recovered
        ? ` [Auto-Healed: ${(execOutcome.healing.strategies || []).join(", ")}]`
        : "";
      const stepComment = `// Step ${stepNumber}: ${step.tool}${effectiveArgs?.url ? ` -> ${effectiveArgs.url}` : effectiveArgs?.target ? ` "${effectiveArgs.target}"` : ""}${healedSuffix}`;

      const item = {
        index,

        step: stepNumber,

        tool: step.tool,

        args: effectiveArgs,

        comment: step.comment || stepComment,

        browserCheck: {
          url: browserUrlAfter,
          directionAligned: stepSuccess && !String(browserUrlAfter).startsWith("chrome-error://"),
          directionNote: stepSuccess
            ? `Browser verified at ${browserUrlAfter || "active tab"}`
            : `Step verification failed at ${browserUrlAfter || "active tab"}`,
        },

        healing: execOutcome.healing,

        success: stepSuccess,

        result,

        verification: stepVerification,

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
      // DYNAMIC REPLANNING ON FAILURE
      //----------------------------------------------------

      if (!stepSuccess && planner && typeof planner.replan === "function") {
        try {
          if (CONFIG.debug) {
            console.log(`[RUN] Step ${stepNumber} (${step.tool}) failed verification. Triggering dynamic replan...`);
          }
          let pageElements = [];
          if (typeof browserController.getInteractiveElements === "function") {
            pageElements = await browserController.getInteractiveElements().catch(() => []);
          }

          const recoveryPlan = planner.replan({
            failedStep: step,
            error: result?.error || "Step failed verification",
            currentUrl: page.url(),
            pageElements,
            originalGoal: plan.goal || "",
          });

          if (recoveryPlan && recoveryPlan.steps?.length) {
            if (CONFIG.debug) {
              console.log(`[RUN] Executing ${recoveryPlan.steps.length} replanned recovery steps...`);
            }
            for (const recoveryStep of recoveryPlan.steps) {
              const recoveryOutcome = await executionEngine.execute(recoveryStep, page);
              const recItem = {
                index: results.length,
                step: results.length + 1,
                tool: recoveryStep.tool,
                args: recoveryStep.args,
                success: recoveryOutcome.success,
                result: recoveryOutcome.result || recoveryOutcome,
                verification: recoveryOutcome.verification,
                duration: 50,
                isReplan: true,
              };
              results.push(recItem);
              if (recoveryOutcome.success) {
                stepSuccess = true;
                break;
              }
            }
          }
        } catch (replanErr) {
          if (CONFIG.debug) {
            console.warn("[RUN] Replan error:", replanErr.message);
          }
        }
      }

      //----------------------------------------------------
      // STOP ON UNRECOVERED FAILURE
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
// ACTIVE TAB SYNCHRONIZATION
//==========================================================

app.post("/active-tab", (req, res) => {
  const url = String(req.body?.url || "").trim();
  const title = String(req.body?.title || "").trim();
  const tabId = String(req.body?.tabId || "").trim();

  if (tabId) {
    serverState.activeTabId = tabId;
  }
  if (url) {
    serverState.activeTabUrl = url;
    serverState.activeTabTitle = title;
  }

  if (typeof browserController.setActiveTabInfo === "function") {
    browserController.setActiveTabInfo(tabId, url, title);
  } else if (url) {
    browserController.setActiveTargetURL(url);
  }

  if (mcp?.browserController && typeof mcp.browserController.setActiveTabInfo === "function") {
    mcp.browserController.setActiveTabInfo(tabId, url, title);
  }

  return res.json({
    success: true,
    activeTabId: serverState.activeTabId || tabId,
    activeTabUrl: serverState.activeTabUrl || url,
    activeTabTitle: serverState.activeTabTitle || title,
  });
});

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
  const conversationHistory = normalizeConversationHistory(req.body?.conversationHistory);

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

        conversationHistory,
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

          conversationHistory,
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
    // SYSTEM / PROJECT / CLI INSTALL
    //----------------------------------------------------

    if (route.mode === "system") {
      try {
        const plan = await systemAgent.plan(command, { conversationHistory });

        if (plan.requiresConfirmation) {
          if (plan.requiresBrowserResearch) {
            await researchSystemInstall(plan, command, conversationHistory);
          }
          const pendingAction = systemAgent.createPendingAction(plan, command);
          stopTimer(started);
          return res.json(
            success({
              mode: "system",
              status: "pending_confirmation",
              command,
              route,
              plan,
              pendingAction,
              statistics: {
                routerCalls: stats.routerCalls,
                duration: stats.lastRequestTime,
              },
            }),
          );
        }

        const result = await systemAgent.executePlan(plan);
        stopTimer(started);

        return res.json(
          success({
            mode: "system",
            status: "completed",
            command,
            route,
            plan,
            result,
            statistics: {
              routerCalls: stats.routerCalls,
              duration: stats.lastRequestTime,
            },
          }),
        );
      } catch (err) {
        error("[RUN] System Agent Error:", err.message);
        stopTimer(started);
        return res.status(500).json({
          success: false,
          mode: "system",
          command,
          route,
          error: `System Agent failed: ${err.message}`,
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

        expectedModes: ["chat", "action", "system"],
      });
    }

    //----------------------------------------------------
    // ACTION
    //----------------------------------------------------

    if (req.body?.tabId || req.body?.currentUrl) {
      if (typeof browserController.setActiveTabInfo === "function") {
        browserController.setActiveTabInfo(req.body.tabId, req.body.currentUrl);
      } else if (req.body?.currentUrl) {
        browserController.setActiveTargetURL(req.body.currentUrl);
      }
      if (mcp?.browserController && typeof mcp.browserController.setActiveTabInfo === "function") {
        mcp.browserController.setActiveTabInfo(req.body.tabId, req.body.currentUrl);
      }
    }

    const page = await ensureBrowserReady();

    validateAutomationPage(page);

    //----------------------------------------------------
    // OBSERVATION-DRIVEN BROWSER AGENT
    //
    // Observe the active page before choosing each action, then
    // re-observe after execution until the goal is verified.
    //----------------------------------------------------

    if (route.mode === "action") {
      stats.plannerCalls++;
      const agentResult = await interactiveAgent.startSession(command, {
        page,
        route,
        conversationHistory,
      });

      serverState.lastPlan = agentResult.plan || null;
      stopTimer(started);

      return res.json(
        success({
          ...agentResult,
          route,
          plannerSource: "interactive-agent",
          statistics: {
            routerCalls: stats.routerCalls,
            plannerCalls: stats.plannerCalls,
            toolExecutions: stats.toolExecutions,
            duration: stats.lastRequestTime,
          },
        }),
      );
    }

    let pageText = "";
    let pageContext = {
      currentUrl: req.body?.currentUrl || page.url(),
      conversationHistory,
    };

    try {
      const snapshot = await captureSnapshot();
      pageText = String(snapshot?.text || "");

      if (typeof browserController.getInteractiveElements === "function") {
        pageContext.interactiveElements = await browserController.getInteractiveElements();
      }

      if (CONFIG.debug) {
        console.log("[RUN] Snapshot:", pageText.length, "characters");
      }
    } catch (err) {
      warn("[RUN] Snapshot/elements unavailable:", err.message);
    }

    stats.plannerCalls++;
    let plannerResult;
    let plannerSource = "qwen";

    try {
      plannerResult = await planner.plan(command, pageText, pageContext);
      plannerSource = plannerResult?.source || plannerSource;
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

    if (plannerResult?.mode === "chat") {
      stats.chatCalls++;
      stopTimer(started);
      return res.json(
        success({
          mode: "chat",
          command,
          reply: plannerResult.reply || "I couldn't turn that into a browser action.",
          route,
          plan: plannerResult,
          plannerSource,
        }),
      );
    }

    //----------------------------------------------------
    // NORMALIZE PLAN
    //----------------------------------------------------

    const plan = normalizePlan(plannerResult);

    serverState.lastPlan = plan || plannerResult;

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

        plan: plannerResult,

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

      // Automatically dismiss inactivity / pause popup dialogs
      const popupResult = await dismissInactivityPopup(page);

      const result = await getIframeContainerData(page, target, {
        onlyIframes: true,
        includeSVGs: true,
        includeChildren: true,
      });

      const timeItems = formatTimeToValuesJSON(result.text || result);

      const payload = {
        tick,
        timestamp: new Date().toISOString(),
        intervalMs,
        target,
        inactivityDismissed: popupResult.dismissed,
        dismissedCount: popupResult.count,
        timeValues: timeItems,
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

//==========================================================
// DISMISS INACTIVITY POPUP (OK / START / CONTINUE BUTTONS)
//==========================================================

app.post("/api/dismiss-popup", async (req, res) => {
  try {
    const page = await ensureBrowserReady();
    const result = await dismissInactivityPopup(page);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
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
// SYSTEM & PROJECT AGENT ENDPOINTS
//==========================================================

app.get("/system/info", async (req, res) => {
  try {
    const info = await systemAgent.getSystemInfo();
    return res.json(success(info));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.get("/system/files", async (req, res) => {
  try {
    const targetPath = req.query?.path || ".";
    const listing = await systemAgent.listDir(targetPath);
    return res.json(success(listing));
  } catch (err) {
    return res.status(500).json(failure(err));
  }
});

app.post("/system/approve", async (req, res) => {
  try {
    const { actionId, editedCommand } = req.body || {};
    if (!actionId) {
      return res.status(400).json(failure("Missing actionId."));
    }
    const outcome = await systemAgent.approveAction(actionId, editedCommand);
    return res.json(
      success({
        mode: "system",
        status: outcome.success ? "completed" : "failed",
        ...outcome,
      }),
    );
  } catch (err) {
    return res.status(400).json(failure(err));
  }
});

app.post("/system/reject", async (req, res) => {
  try {
    const { actionId } = req.body || {};
    if (!actionId) {
      return res.status(400).json(failure("Missing actionId."));
    }
    const outcome = systemAgent.rejectAction(actionId);
    return res.json(
      success({
        mode: "system",
        status: "cancelled",
        ...outcome,
      }),
    );
  } catch (err) {
    return res.status(400).json(failure(err));
  }
});

//==========================================================
// INTERACTIVE AGENT PERMISSION / CLARIFICATION ENDPOINTS
//==========================================================

app.post("/agent/respond", async (req, res) => {
  const started = startTimer();
  const { sessionId, promptId, choice, customInput, cancelled } = req.body || {};

  if (!sessionId) {
    stopTimer(started);
    return res.status(400).json(failure("Missing sessionId."));
  }

  if (!acquireRunLock(req.requestId, `agent-respond:${sessionId}`)) {
    stopTimer(started);
    return res.status(409).json({
      success: false,
      mode: "busy",
      error: "Another browser automation command is already running.",
    });
  }

  try {
    await ensureBrowserReady();
    const agentResult = await interactiveAgent.respondToSession(sessionId, {
      promptId,
      choice,
      customInput,
      cancelled: Boolean(cancelled),
    });
    stopTimer(started);
    return res.json(
      success({
        ...agentResult,
        statistics: {
          duration: stats.lastRequestTime,
        },
      }),
    );
  } catch (err) {
    stopTimer(started);
    return res.status(400).json(failure(err));
  } finally {
    releaseRunLock();
  }
});

app.post("/agent/cancel", async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json(failure("Missing sessionId."));
    }
    const outcome = interactiveAgent.cancelSession(sessionId);
    return res.json(
      success({
        mode: "action",
        status: "cancelled",
        ...outcome,
      }),
    );
  } catch (err) {
    return res.status(400).json(failure(err));
  }
});

//==========================================================
// OFFICE TIMER & ATTENDANCE (FIREBASE)
//==========================================================

app.get("/api/office-timer/config", async (req, res) => {
  const result = await getOfficeTimerConfig();
  return res.status(result.success ? 200 : 500).json(result);
});

app.post("/api/office-timer/config", async (req, res) => {
  const result = await saveOfficeTimerConfig(req.body || {});
  return res.status(result.success ? 200 : 500).json(result);
});

app.get("/api/office-timer/attendance", async (req, res) => {
  const { date, start, end } = req.query || {};
  if (start || end) {
    const result = await getOfficeAttendanceRange(start, end);
    return res.status(result.success ? 200 : 500).json(result);
  }
  const result = await getOfficeAttendance(date);
  return res.status(result.success ? 200 : 500).json(result);
});

app.post("/api/office-timer/attendance", async (req, res) => {
  const { date, ...payload } = req.body || {};
  const result = await saveOfficeAttendance(date, payload);
  return res.status(result.success ? 200 : 500).json(result);
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

    console.log("🧠 Browser commands: LLM planner → Playwright");

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
  interactiveAgent,
  systemAgent,
};
