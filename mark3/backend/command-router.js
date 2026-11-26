//==========================================================
//
// backend/command-router.js
//
// Ultra Intelligent Command Router
//
// Responsibilities
// ----------------
// 1. Receive user input
// 2. Classify CHAT vs ACTION
// 3. Return normalized route
//
// IMPORTANT
// ----------
// CommandRouter does NOT:
//
// ❌ Execute browser actions
// ❌ Call Resolver
// ❌ Call Planner
// ❌ Perform DOM matching
// ❌ Perform fuzzy matching
// ❌ Call AI for chat responses
//
// Server.js owns the execution pipeline.
//
// CHAT
// -----
// CommandRouter
//      ↓
// server.js
//      ↓
// aiEngine.js
//      ↓
// Ollama
//      ↓
// Reply
//
// ACTION
// -------
// CommandRouter
//      ↓
// server.js
//      ↓
// Browser Ready
//      ↓
// Snapshot
//      ↓
// Planner
//      ↓
// ToolMap
//      ↓
// Resolver
//      ↓
// Playwright
//
//==========================================================

export default class CommandRouter {
  constructor({ debug = false } = {}) {
    this.debug = debug;
  }

  //========================================================
  // LOGGER
  //========================================================

  log(...args) {
    if (this.debug) {
      console.log("[CommandRouter]", ...args);
    }
  }

  //========================================================
  // MAIN ROUTER
  //
  // IMPORTANT
  //
  // Always return:
  //
  // {
  //   success: true,
  //   mode: "chat"
  // }
  //
  // OR
  //
  // {
  //   success: true,
  //   mode: "action"
  // }
  //
  // Never return:
  //
  // type: "chat"
  //
  // because server.js expects mode.
  //========================================================

  async route(input, context = {}) {
    if (input === undefined || input === null || String(input).trim() === "") {
      return {
        success: false,

        mode: "unknown",

        input: "",

        error: "Input is empty",
      };
    }

    const text = String(input).trim();

    this.log("Received:", text);

    //------------------------------------------------------
    // CLASSIFY
    //------------------------------------------------------

    const classification = this.classify(text);

    this.log("Classification:", classification);

    //------------------------------------------------------
    // NORMALIZED ROUTE
    //------------------------------------------------------

    const route = {
      success: true,

      mode: classification.type,

      intentType: classification.intentType || null,

      normalizedInput: classification.normalizedInput || text,

      confidence: classification.confidence,

      input: text,

      source: "command-router",

      requestId: context?.requestId || null,
    };

    this.log("Route:", route);

    return route;
  }

  //========================================================
  // UNWRAP POLITE / CONVERSATIONAL ACTION REQUESTS
  //
  // Examples:
  //   "can you buy iphone 18 in flipcart ?" -> "buy iphone 18 in flipcart"
  //   "could you please open google.com?"   -> "open google.com"
  //   "i want to order shoes on amazon"     -> "order shoes on amazon"
  //   "can you explain how this works?"     -> kept as chat (knowledge verb)
  //========================================================

  unwrapRequestPrefix(text) {
    let cleaned = String(text || "").trim();
    if (!cleaned) return "";

    // Pure knowledge / explanation requests stay chat.
    if (/^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:explain|tell\s+me|describe|define|clarify|answer|chat|talk)\b/i.test(cleaned)) {
      return cleaned;
    }

    cleaned = cleaned
      .replace(/^(?:hey\s+|ok\s+|okay\s+|hi\s+)?(?:jarvis|friday)[,:\s]+/i, "")
      .replace(/^(?:please|kindly)\s+/i, "")
      .replace(/^(?:can|could|would|will)\s+(?:you|we)\s+(?:please\s+|kindly\s+|help\s+me\s+(?:to\s+)?)?/i, "")
      .replace(/^(?:i\s+(?:want|need|would\s+like)|i['’]d\s+like|i['’]?m\s+trying|help\s+me\s+(?:to\s+)?|try\s+to)\s+(?:you\s+)?(?:to\s+)?/i, "")
      .replace(/[?!.]+$/g, "")
      .trim();

    return cleaned;
  }

  //========================================================
  // CLASSIFY
  //========================================================

  classify(input) {
    const raw = String(input || "").trim();
    const text = raw.toLowerCase();

    //------------------------------------------------------
    // EMPTY
    //------------------------------------------------------

    if (!text) {
      return {
        type: "unknown",

        confidence: 1,
      };
    }

    const unwrapped = this.unwrapRequestPrefix(raw).toLowerCase();

    //------------------------------------------------------
    // MULTI-STEP BROWSER ACTIONS
    //
    // Commands such as:
    // 1. Navigate to https://...
    // 2. Click the "Login" button
    //
    // must never be sent to Chat AI.
    //------------------------------------------------------

    const lines = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\s*(?:\d+|[a-zA-Z])\s*[.)-]\s*/, "").trim());

    if (lines.length > 1) {
      const allActions = lines.every((line) =>
        /^(click|press|tap|type|enter|fill|write|go(?:\s+to)?|goto|navigate|move|open|visit|browse|select|choose|check|uncheck|scroll|upload|refresh|reload|back|go\s+back|forward|go\s+forward|wait|close|switch|download|submit|login|log\s+in|sign\s+in|logout|log\s+out|sign\s+out|search|find|buy|purchase|order|book|shop|checkout|pay)\b/i.test(line)
      );

      if (allActions) {
        return {
          type: "action",
          confidence: 0.99,
          matchedPattern: "multi-step-action",
        };
      }
    }

    //------------------------------------------------------
    // CODE HEALING & COMMENT-TO-CODE UPDATE ACTIONS
    //
    // Requests to update/fix/heal code or apply a comment
    // to project files route to SystemAgent ("system").
    //------------------------------------------------------

    const isCodeHealRequest =
      /^(?:code\s*heal|heal\s*code|update\s+(?:our\s+|the\s+)?code|fix\s+(?:our\s+|the\s+)?code|apply\s+comment|code\s+comment)\b/i.test(
        text,
      ) ||
      /^(?:code\s*heal|heal\s*code|update\s+(?:our\s+|the\s+)?code|fix\s+(?:our\s+|the\s+)?code)\b/i.test(
        unwrapped,
      ) ||
      (/\b(?:update|edit|modify|change|refactor|patch|heal|fix)\b/i.test(unwrapped) &&
        /\b(?:code|source\s*code|file|files|planner|agent|ui|renderer|server|backend|script|function|bug|error|styles?|css|html|js)\b/i.test(
          unwrapped,
        ) &&
        !/^(?:what|why|how|when|where|who|which|is|are|do|does|did)\b/i.test(text));

    if (isCodeHealRequest) {
      return {
        type: "system",
        intentType: "code_heal",
        normalizedInput: raw,
        confidence: 0.99,
        matchedPattern: "code-heal-agent",
      };
    }

    //------------------------------------------------------
    // SYSTEM / PROJECT / CLI INSTALL ACTIONS
    //
    // Local project folder access, package/CLI/software installs,
    // GitHub repo installs, and explicit shell commands.
    //------------------------------------------------------

    const hasGithubUrl = /https?:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+/i.test(raw);
    const isBrowserNavStart = /^(?:go(?:\s+to)?|goto|navigate|open|visit|browse)\b/i.test(unwrapped);

    const systemPatterns = [
      /^(?:cli-hub|cli-anything-[a-z0-9_-]+)\b/i,
      /^(?:pip3?|npm|npx|winget|choco)\s+(?:install|i|add|uninstall|update|upgrade|search|list|test|run)\b/i,
      /^git\s+(?:clone|pull|status|log|branch|checkout)\b/i,
      /^(?:please\s+)?(?:auto[-\s]?)?(?:install|heal|repair|fix)\b/i,
      /\b(?:auto[-\s]?install|install|setup|clone|integrate)\b.*\b(?:cli-anything|cli-hub|github\.com|software|app|package|packages|dependencies|tool|cli)\b/i,
      /^(?:run\s+(?:all\s+)?tests?|test\s+suite|check\s+project\s+(?:errors|health))$/i,
      /^(?:check|show|get)?\s*(?:system\s*info|environment|env|cli\s*status|python\s*version|node\s*version)$/i,
      /^(?:list|show|open|browse|ls|dir)\s+(?:project\s+(?:folder|files|directory)|files\s+in\s+|folder\s+|directory\s+|dir\s+)/i,
      /^(?:list\s+(?:project\s+)?files|show\s+project\s+(?:folder|files)|ls|dir)(?:\s+.+)?$/i,
      /^(?:read\s+file|open\s+file|show\s+file|cat|view\s+file)\s+.+$/i,
      /^(?:run\s+(?:command|cmd|shell|powershell)|exec|execute|powershell|terminal)\s+.+$/i,
    ];

    if (
      (hasGithubUrl && !isBrowserNavStart) ||
      systemPatterns.some((pattern) => pattern.test(text) || pattern.test(unwrapped))
    ) {
      return {
        type: "system",
        confidence: 0.99,
        matchedPattern: "system-agent",
      };
    }

    //------------------------------------------------------
    // COMMON CHAT (checked before unwrapped action matching
    // so "what can you do?" or "how are you?" stays chat)
    //------------------------------------------------------

    const chatPatterns = [
      /^(hi|hello|hey)\b/,

      /^(good morning)\b/,

      /^(good afternoon)\b/,

      /^(good evening)\b/,

      /^(how are you)\b/,

      /^(who are you)\b/,

      /^(what are you)\b/,

      /^(what can you do)\b/,

      /^(thanks|thank you)\b/,

      /^(bye|goodbye)\b/,
    ];

    const matchedChat = chatPatterns.find((pattern) => pattern.test(text));

    if (matchedChat) {
      return {
        type: "chat",

        confidence: 0.99,

        matchedPattern: matchedChat.source,
      };
    }

    //------------------------------------------------------
    // BROWSER ACTIONS & INTERACTIVE GOALS
    //------------------------------------------------------

    const actionPatterns = [
      /^(click|press|tap)\b/,

      /^(type|enter|write|fill)\b/,

      /^(open|go|navigate|move|visit|browse)\b/,

      /^(select|choose)\b/,

      /^(check|uncheck)\b/,

      /^(scroll)\b/,

      /^(upload)\b/,

      /^(refresh|reload)\b/,

      /^(back|go back)\b/,

      /^(forward|go forward)\b/,

      /^(wait|wait for)\b/,

      /^(close|exit)\b/,

      /^(switch|change)\b/,

      /^(download)\b/,

      /^(submit)\b/,

      /^(login|log in|sign in)\b/,

      /^(logout|log out|sign out)\b/,

      /^(search|find)\b/,

      /^(get|extract|fetch|read|scrape|inspect|summarize)\b/,

      /^(watch|stream|track|monitor|convert|start\s+interval|stop\s+interval|cancel\s+interval)\b/,

      /^(buy|purchase|order|shop|book|reserve|checkout|pay|subscribe|apply|compare|add\s+to\s+cart|register|sign\s+up|signup)\b/,

      /\b(?:buy|purchase|order|shop|book|add\s+to\s+cart|checkout)\b.*\b(?:on|in|from|at)\s+[a-z0-9.-]+/i,

      /\bsvg\b/i,

      /\btzQn0o\b/i,

      /\bdGBOyn\b/i,
    ];

    // Prevent pure knowledge questions like "what is buyback" or "how does checkout work"
    // from being misclassified as browser actions.
    const isPureKnowledgeQuestion =
      /^(?:what|why|how|when|where|who|which|is|are|do|does|did)\b/i.test(text) &&
      !/^(?:how\s+to\s+(?:buy|order)|can\s+you|could\s+you|would\s+you)\b/i.test(text);

    const matchedAction = !isPureKnowledgeQuestion
      ? actionPatterns.find((pattern) => pattern.test(text) || pattern.test(unwrapped))
      : null;

    if (matchedAction) {
      const isInteractiveGoal =
        /^(?:buy|purchase|order|shop|book|reserve|checkout|pay|subscribe|apply|compare|add\s+to\s+cart)\b/i.test(
          unwrapped,
        ) ||
        /\b(?:buy|purchase|order|shop|book|reserve|checkout|pay|add\s+to\s+cart)\b/i.test(unwrapped);

      return {
        type: "action",

        intentType: isInteractiveGoal ? "interactive_goal" : "direct_action",

        normalizedInput: unwrapped || raw,

        confidence: 0.99,

        matchedPattern: matchedAction.source,
      };
    }

    //------------------------------------------------------
    // QUESTIONS
    //
    // Examples:
    //
    // What is AI?
    // Explain Playwright
    // How does JavaScript work?
    //
    // These are CHAT.
    //------------------------------------------------------

    const questionPatterns = [
      /^(what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/,
    ];

    const matchedQuestion = questionPatterns.find((pattern) =>
      pattern.test(text),
    );

    if (matchedQuestion) {
      return {
        type: "chat",

        confidence: 0.9,

        matchedPattern: matchedQuestion.source,
      };
    }

    //------------------------------------------------------
    // DEFAULT
    //
    // Unknown natural-language input goes to CHAT.
    //
    // This prevents accidental browser automation.
    //------------------------------------------------------

    return {
      type: "chat",

      confidence: 0.7,

      reason: "Natural language input defaults to chat",
    };
  }

  //========================================================
  // CLASSIFY ALIAS
  //
  // server.js can use:
  //
  // commandRouter.classify()
  //
  //========================================================

  async classifyCommand(input) {
    return this.classify(input);
  }
}
