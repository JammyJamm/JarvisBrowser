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

      confidence: classification.confidence,

      input: text,

      source: "command-router",

      requestId: context?.requestId || null,
    };

    this.log("Route:", route);

    return route;
  }

  //========================================================
  // CLASSIFY
  //========================================================

  classify(input) {
    const text = String(input || "")
      .trim()
      .toLowerCase();

    //------------------------------------------------------
    // EMPTY
    //------------------------------------------------------

    if (!text) {
      return {
        type: "unknown",

        confidence: 1,
      };
    }

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
        /^(click|press|tap|type|enter|fill|write|go\s+to|goto|navigate\s+to|open|select|choose|check|uncheck|scroll|upload|refresh|reload|back|go\s+back|forward|go\s+forward|wait|close|switch|download|submit|login|log\s+in|sign\s+in|logout|log\s+out|sign\s+out|search|find)\b/i.test(line)
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
    // BROWSER ACTIONS
    //------------------------------------------------------

    const actionPatterns = [
      /^(click|press|tap)\b/,

      /^(type|enter|write|fill)\b/,

      /^(open|go to|navigate|visit)\b/,

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

      /^(get|extract|fetch|read|scrape|inspect)\b/,

      /\bsvg\b/i,
    ];

    const matchedAction = actionPatterns.find((pattern) => pattern.test(text));

    if (matchedAction) {
      return {
        type: "action",

        confidence: 0.99,

        matchedPattern: matchedAction.source,
      };
    }

    //------------------------------------------------------
    // COMMON CHAT
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
