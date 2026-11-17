// backend/planner/parser.js
//
// Ultra Intelligent Intent Parser for Jarvis Browser Planner
// ------------------------------------------------------------
//
// Architecture
//
// User Input
//      │
//      ▼
// Normalizer
//      │
//      ▼
// Multi-Step Splitter
//      │
//      ▼
// Intent Parser
//      │
//      ├── Navigate
//      ├── Click
//      ├── Type / Fill
//      ├── Select
//      ├── Checkbox
//      ├── Scroll
//      ├── Wait
//      ├── Screenshot
//      ├── Extract
//      ├── Search
//      ├── Login
//      └── Unknown
//      │
//      ▼
// Structured Plan
//      │
//      ▼
// Scoring Engine
//      │
//      ├── Exact Matching
//      ├── Token Matching
//      ├── Fuzzy Matching
//      ├── Semantic Matching
//      └── Candidate Ranking
//      │
//      ▼
// Planner Fallback
//      │
//      ▼
// Executor
//
// IMPORTANT
// ------------------------------------------------------------
// Parser NEVER performs fuzzy matching.
//
// The parser:
// ✔ Detects user intent
// ✔ Extracts action
// ✔ Extracts target
// ✔ Extracts value
// ✔ Extracts field
// ✔ Splits multi-step commands
//
// The Scoring Engine:
// ✔ Finds DOM candidates
// ✔ Performs fuzzy matching
// ✔ Ranks candidates
// ✔ Calculates confidence
//
// The Planner:
// ✔ Handles ambiguity
// ✔ Repairs complex instructions
// ✔ Resolves difficult intent
//
// ------------------------------------------------------------
// Version 4.0
// ------------------------------------------------------------

export default class IntentParser {
  constructor(options = {}) {
    this.options = {
      enableLLMFallback: true,

      debug: false,

      maxSteps: 50,

      ...options,
    };

    //==========================================================
    // ACTION ALIASES
    //==========================================================

    this.actionAliases = {
      navigate: ["navigate", "go", "goto", "open", "visit", "browse"],

      click: ["click", "press", "tap", "hit"],

      type: ["type", "enter", "write", "input", "fill"],

      select: ["select", "choose", "pick"],

      check: ["check", "tick", "enable"],

      uncheck: ["uncheck", "untick", "disable"],

      scroll: ["scroll", "swipe"],

      wait: ["wait", "pause", "sleep"],

      screenshot: ["screenshot", "capture", "snapshot"],

      extract: ["extract", "scrape", "get", "read"],

      search: ["search", "find", "look", "lookup"],
    };

    //==========================================================
    // INTENT PATTERNS
    //
    // FAST LAYER
    //
    // No LLM
    // No fuzzy matching
    //==========================================================

    this.patterns = [
      {
        type: "navigate",
        regex:
          /^(?:navigate\s+to|go\s+to|goto|open|visit|browse)\s+(?:https?:\/\/|www\.)/i,
      },

      {
        type: "search",
        regex: /^(?:search(?:\s+for)?|find|look\s+for|lookup)\s+/i,
      },

      {
        type: "click",
        regex: /^(?:click|press|tap|hit)\s+(?:on\s+)?/i,
      },

      {
        type: "type",
        regex: /^(?:type|enter|write|input|fill)\s+/i,
      },

      {
        type: "select",
        regex: /^(?:select|choose|pick)\s+/i,
      },

      {
        type: "check",
        regex: /^(?:check|tick|enable)\s+/i,
      },

      {
        type: "uncheck",
        regex: /^(?:uncheck|untick|disable)\s+/i,
      },

      {
        type: "scroll",
        regex: /^scroll\s+(?:up|down|top|bottom)/i,
      },

      {
        type: "wait",
        regex: /^(?:wait|pause|sleep)\s+\d+/i,
      },

      {
        type: "screenshot",
        regex: /^(?:take\s+)?(?:a\s+)?screenshot/i,
      },

      {
        type: "extract",
        regex:
          /^(?:extract|scrape|get|read)\s+(?:data|text|content|headings|links)?/i,
      },

      {
        type: "login",
        regex: /^(?:login|log\s+in|sign\s+in)/i,
      },
    ];

    //==========================================================
    // QUICK MAP
    //==========================================================

    this.quickMap = {
      youtube: "navigate",
      google: "search",
    };

    //==========================================================
    // FIELD ALIASES
    //==========================================================

    this.fieldAliases = {
      email: ["email", "email address", "mail", "username"],

      password: ["password", "passcode", "pass"],

      username: ["username", "user name", "user id"],

      search: ["search", "search box", "search field", "search input"],
    };
  }

  //==========================================================
  // MAIN ENTRY
  //==========================================================

  parse(input) {
    if (input === null || input === undefined || typeof input !== "string") {
      return this._empty("Invalid input");
    }

    const rawInput = input;

    const normalizedInput = this._normalizeInput(input);

    if (!normalizedInput) {
      return this._empty("Empty input");
    }

    //==========================================================
    // SPLIT MULTI-STEP COMMAND
    //==========================================================

    const lines = this._splitInstructions(normalizedInput);

    const steps = [];

    //==========================================================
    // PARSE EACH STEP
    //==========================================================

    for (const line of lines) {
      if (steps.length >= this.options.maxSteps) {
        this.log(`Maximum step limit reached: ${this.options.maxSteps}`);

        break;
      }

      const step = this._parseStep(line);

      if (step) {
        steps.push(step);
      }
    }

    //==========================================================
    // NO DIRECT STEP
    //==========================================================

    if (!steps.length) {
      const regexResult = this._regexMatch(normalizedInput);

      if (regexResult) {
        return {
          ...regexResult,

          raw: rawInput,
        };
      }

      const quickResult = this._quickMatch(normalizedInput);

      if (quickResult) {
        return {
          ...quickResult,

          raw: rawInput,
        };
      }

      return this._fallbackParse(rawInput);
    }

    //==========================================================
    // DETERMINE PRIMARY INTENT
    //==========================================================

    const primaryIntent =
      steps.length === 1 ? this._stepToIntent(steps[0]) : "multi_step";

    //==========================================================
    // FINAL STRUCTURED OUTPUT
    //==========================================================

    return {
      intent: primaryIntent,

      confidence: this._calculateIntentConfidence(steps),

      raw: rawInput,

      normalized: normalizedInput,

      multiStep: steps.length > 1,

      stepCount: steps.length,

      steps,
    };
  }

  //==========================================================
  // NORMALIZE INPUT
  //==========================================================

  _normalizeInput(input) {
    return String(input)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .trim();
  }

  //==========================================================
  // SPLIT INSTRUCTIONS
  //
  // Supports:
  //
  // 1) Open Google
  // 2) Search for Jarvis
  //
  // Also:
  //
  // Open Google and search for Jarvis
  //
  // Also:
  //
  // Click Login, type email, click Submit
  //==========================================================

  _splitInstructions(input) {
    let text = input.trim();

    //==========================================================
    // NUMBERED LIST
    //==========================================================

    if (/\n/.test(text)) {
      return text
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\d+\s*[\.\):\-]\s*/, "").trim())
        .filter(Boolean);
    }

    //==========================================================
    // SEMICOLON SEPARATION
    //==========================================================

    if (text.includes(";")) {
      return text
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
    }

    //==========================================================
    // COMMON "AND THEN" SEPARATOR
    //==========================================================

    if (/\s+and\s+then\s+/i.test(text)) {
      return text
        .split(/\s+and\s+then\s+/i)
        .map((part) => part.trim())
        .filter(Boolean);
    }

    //==========================================================
    // ACTION-AWARE "AND" SPLITTER
    //
    // Avoid blindly splitting:
    //
    // "Click Punch In and continue"
    //
    // But split:
    //
    // "Click Login and type email"
    //==========================================================

    const parts = text.split(
      /\s+and\s+(?=(?:click|press|tap|type|enter|write|fill|select|choose|pick|check|uncheck|scroll|wait|open|visit|navigate|go|search|find|take)\b)/i,
    );

    if (parts.length > 1) {
      return parts.map((part) => part.trim()).filter(Boolean);
    }

    return [text];
  }

  //==========================================================
  // PARSE SINGLE STEP
  //==========================================================

  _parseStep(line) {
    if (!line) {
      return null;
    }

    //==========================================================
    // NAVIGATE
    //==========================================================

    let match = line.match(
      /^(?:navigate\s+to|go\s+to|goto|open|visit|browse)\s+(.+)$/i,
    );

    if (match) {
      const target = match[1].trim();

      const url = this._extractURL(target);

      if (this._looksLikeURL(url)) {
        return {
          action: "navigate",

          url,

          target: url,

          confidence: 1,
        };
      }

      // "Open login button" should not become navigation
      if (
        /^(?:the\s+)?(?:login|sign\s+in|menu|settings|button|tab)\b/i.test(
          target,
        )
      ) {
        return {
          action: "click",

          target: this._cleanTarget(target),

          text: this._cleanTarget(target),

          confidence: 0.95,
        };
      }

      return {
        action: "navigate",

        url: target,

        target,

        confidence: 0.9,
      };
    }

    //==========================================================
    // CLICK
    //
    // Examples:
    //
    // Click Punch In
    // Click the Punch In button
    // Click on Login
    // Press Submit
    //==========================================================

    match = line.match(
      /^(?:click|press|tap|hit)\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
    );

    if (match) {
      const target = this._cleanTarget(match[1]);

      return {
        action: "click",

        target,

        text: target,

        value: target,

        confidence: 1,
      };
    }

    //==========================================================
    // TYPE / FILL WITH FIELD
    //
    // Examples:
    //
    // Type email "test@gmail.com"
    // Type password "1234"
    // Fill email with "test@gmail.com"
    //==========================================================

    match = line.match(
      /^(?:type|enter|write|input|fill)\s+(email|password|username|search)\s+(?:with\s+)?["'](.+?)["']$/i,
    );

    if (match) {
      return {
        action: "type",

        field: this._normalizeField(match[1]),

        target: this._normalizeField(match[1]),

        value: match[2],

        text: match[2],

        confidence: 1,
      };
    }

    //==========================================================
    // TYPE / FILL INTO TARGET
    //
    // Examples:
    //
    // Type "hello" in search
    // Enter "hello" into username
    // Fill "hello" in email
    //==========================================================

    match = line.match(
      /^(?:type|enter|write|input|fill)\s+["'](.+?)["']\s+(?:in|into)\s+(?:the\s+)?(.+)$/i,
    );

    if (match) {
      const value = match[1];

      const target = this._cleanTarget(match[2]);

      return {
        action: "type",

        value,

        text: value,

        target,

        field: this._inferField(target),

        confidence: 1,
      };
    }

    //==========================================================
    // TYPE / FILL VALUE ONLY
    //
    // Examples:
    //
    // Type "hello"
    // Enter "hello"
    // Fill "hello"
    //==========================================================

    match = line.match(/^(?:type|enter|write|input|fill)\s+["'](.+?)["']$/i);

    if (match) {
      return {
        action: "type",

        value: match[1],

        text: match[1],

        target: "active_input",

        field: "active_input",

        confidence: 0.95,
      };
    }

    //==========================================================
    // TYPE WITHOUT QUOTES
    //
    // Example:
    //
    // Type hello in search box
    //==========================================================

    match = line.match(
      /^(?:type|enter|write|input|fill)\s+(.+?)\s+(?:in|into)\s+(?:the\s+)?(.+)$/i,
    );

    if (match) {
      const value = this._cleanValue(match[1]);

      const target = this._cleanTarget(match[2]);

      return {
        action: "type",

        value,

        text: value,

        target,

        field: this._inferField(target),

        confidence: 0.9,
      };
    }

    //==========================================================
    // SELECT
    //==========================================================

    match = line.match(
      /^(?:select|choose|pick)\s+(?:the\s+)?(.+?)\s+(?:from|in)\s+(?:the\s+)?(.+)$/i,
    );

    if (match) {
      return {
        action: "select",

        value: this._cleanValue(match[1]),

        text: this._cleanValue(match[1]),

        target: this._cleanTarget(match[2]),

        confidence: 1,
      };
    }

    //==========================================================
    // SIMPLE SELECT
    //==========================================================

    match = line.match(/^(?:select|choose|pick)\s+(?:the\s+)?(.+)$/i);

    if (match) {
      const target = this._cleanTarget(match[1]);

      return {
        action: "select",

        target,

        text: target,

        value: target,

        confidence: 0.95,
      };
    }

    //==========================================================
    // CHECK
    //==========================================================

    match = line.match(/^(?:check|tick|enable)\s+(?:the\s+)?(.+)$/i);

    if (match) {
      const target = this._cleanTarget(match[1]);

      return {
        action: "check",

        target,

        text: target,

        confidence: 1,
      };
    }

    //==========================================================
    // UNCHECK
    //==========================================================

    match = line.match(/^(?:uncheck|untick|disable)\s+(?:the\s+)?(.+)$/i);

    if (match) {
      const target = this._cleanTarget(match[1]);

      return {
        action: "uncheck",

        target,

        text: target,

        confidence: 1,
      };
    }

    //==========================================================
    // SCROLL
    //==========================================================

    match = line.match(/^scroll\s+(up|down|top|bottom)(?:\s+(\d+))?/i);

    if (match) {
      return {
        action: "scroll",

        direction: match[1].toLowerCase(),

        amount: match[2] ? Number(match[2]) : undefined,

        confidence: 1,
      };
    }

    //==========================================================
    // WAIT
    //==========================================================

    match = line.match(
      /^(?:wait|pause|sleep)\s+(\d+)\s*(ms|milliseconds?|s|sec|seconds?)?$/i,
    );

    if (match) {
      let amount = Number(match[1]);

      const unit = (match[2] || "ms").toLowerCase();

      if (
        unit === "s" ||
        unit === "sec" ||
        unit === "second" ||
        unit === "seconds"
      ) {
        amount *= 1000;
      }

      return {
        action: "wait",

        ms: amount,

        value: amount,

        confidence: 1,
      };
    }

    //==========================================================
    // SCREENSHOT
    //==========================================================

    if (/^(?:take\s+)?(?:a\s+)?(?:screenshot|snapshot|capture)/i.test(line)) {
      return {
        action: "screenshot",

        confidence: 1,
      };
    }

    //==========================================================
    // SEARCH
    //==========================================================

    match = line.match(
      /^(?:search(?:\s+for)?|find|look\s+for|lookup)\s+(.+)$/i,
    );

    if (match) {
      const query = this._cleanValue(match[1]);

      return {
        action: "search",

        query,

        value: query,

        text: query,

        confidence: 1,
      };
    }

    //==========================================================
    // EXTRACT
    //==========================================================

    match = line.match(
      /^(?:extract|scrape|get|read)(?:\s+(?:the\s+)?)?(.+)?$/i,
    );

    if (match) {
      const target = this._cleanTarget(match[1] || "page content");

      return {
        action: "extract",

        target,

        text: target,

        value: target,

        confidence: 0.95,
      };
    }

    //==========================================================
    // LOGIN
    //==========================================================

    if (/^(?:login|log\s+in|sign\s+in)$/i.test(line)) {
      return {
        action: "login",

        target: "login",

        text: "login",

        confidence: 1,
      };
    }

    //==========================================================
    // SUBMIT
    //==========================================================

    if (/^(?:submit|submit\s+form|confirm)$/i.test(line)) {
      return {
        action: "click",

        target: "submit",

        text: "submit",

        value: "submit",

        confidence: 0.95,
      };
    }

    //==========================================================
    // UNKNOWN
    //==========================================================

    return null;
  }

  //==========================================================
  // QUICK MATCH LAYER
  //==========================================================

  _quickMatch(input) {
    const lower = input.toLowerCase();

    for (const key in this.quickMap) {
      if (lower.includes(key)) {
        return {
          intent: this.quickMap[key],

          confidence: 0.6,

          raw: input,

          multiStep: false,

          stepCount: 1,

          steps: [
            {
              action: this.quickMap[key],

              value: input,

              text: input,

              target: input,

              confidence: 0.6,
            },
          ],
        };
      }
    }

    return null;
  }

  //==========================================================
  // REGEX MATCH LAYER
  //==========================================================

  _regexMatch(input) {
    for (const pattern of this.patterns) {
      // Reset global regex state safely
      pattern.regex.lastIndex = 0;

      if (pattern.regex.test(input)) {
        const steps = this._buildSteps(pattern.type, input);

        return {
          intent: pattern.type,

          confidence: steps.length > 0 ? 0.85 : 0.7,

          raw: input,

          normalized: input,

          multiStep: steps.length > 1,

          stepCount: steps.length,

          steps,
        };
      }
    }

    return null;
  }

  //==========================================================
  // STEP BUILDER
  //==========================================================

  _buildSteps(type, input) {
    switch (type) {
      case "navigate":
        return [
          {
            action: "navigate",

            url: this._extractURL(input),

            target: this._extractURL(input),

            confidence: 0.9,
          },
        ];

      case "search": {
        const query = input
          .replace(/^(?:search(?:\s+for)?|find|look\s+for|lookup)\s+/i, "")
          .trim();

        return [
          {
            action: "search",

            query,

            value: query,

            text: query,

            confidence: 0.9,
          },
        ];
      }

      case "click": {
        const target = this._cleanTarget(
          input.replace(
            /^(?:click|press|tap|hit)\s+(?:on\s+)?(?:the\s+)?/i,
            "",
          ),
        );

        return [
          {
            action: "click",

            target,

            text: target,

            value: target,

            confidence: 0.9,
          },
        ];
      }

      case "type":
        return [
          {
            action: "type",

            value: this._extractQuoted(input),

            text: this._extractQuoted(input),

            target: "active_input",

            field: "active_input",

            confidence: 0.85,
          },
        ];

      case "scroll":
        return [
          {
            action: "scroll",

            direction: /\bup\b/i.test(input) ? "up" : "down",

            confidence: 0.9,
          },
        ];

      case "wait":
        return [
          {
            action: "wait",

            ms: Number(input.match(/\d+/)?.[0] || 1000),

            confidence: 0.9,
          },
        ];

      case "screenshot":
        return [
          {
            action: "screenshot",

            confidence: 0.9,
          },
        ];

      case "extract":
        return [
          {
            action: "extract",

            target: input,

            text: input,

            confidence: 0.8,
          },
        ];

      case "login":
        return [
          {
            action: "login",

            target: "login",

            text: "login",

            confidence: 0.9,
          },
        ];

      default:
        return [
          {
            action: type,

            value: input,

            text: input,

            confidence: 0.5,
          },
        ];
    }
  }

  //==========================================================
  // FALLBACK PARSER
  //==========================================================

  _fallbackParse(input) {
    return {
      intent: "unknown",

      confidence: 0.3,

      raw: input,

      normalized: this._normalizeInput(input),

      multiStep: false,

      stepCount: 1,

      plannerRequired: true,

      steps: [
        {
          action: "analyze",

          value: input,

          text: input,

          target: input,

          confidence: 0.3,
        },
      ],
    };
  }

  //==========================================================
  // DETERMINE INTENT FROM STEP
  //==========================================================

  _stepToIntent(step) {
    if (!step) {
      return "unknown";
    }

    return step.action || "unknown";
  }

  //==========================================================
  // CONFIDENCE
  //==========================================================

  _calculateIntentConfidence(steps) {
    if (!steps.length) {
      return 0;
    }

    const total = steps.reduce(
      (sum, step) => sum + Number(step.confidence || 0.5),
      0,
    );

    return Number((total / steps.length).toFixed(2));
  }

  //==========================================================
  // URL EXTRACTION
  //==========================================================

  _extractURL(text) {
    const match = String(text).match(/https?:\/\/[^\s]+|www\.[^\s]+/i);

    if (match) {
      return match[0].replace(/[.,!?;:]+$/, "");
    }

    return String(text).trim();
  }

  //==========================================================
  // URL CHECK
  //==========================================================

  _looksLikeURL(text) {
    return (
      /^https?:\/\//i.test(text) ||
      /^www\./i.test(text) ||
      /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(text)
    );
  }

  //==========================================================
  // QUOTED TEXT
  //==========================================================

  _extractQuoted(text) {
    const match = String(text).match(/["'](.*?)["']/);

    return match ? match[1] : String(text).trim();
  }

  //==========================================================
  // CLEAN TARGET
  //
  // IMPORTANT:
  // Do NOT fuzzy match here.
  //
  // The Scoring Engine receives this target
  // and performs candidate matching.
  //==========================================================

  _cleanTarget(text) {
    if (!text) {
      return "";
    }

    return String(text)
      .trim()
      .replace(/^(?:the|a|an)\s+/i, "")
      .replace(/\s+(?:button|link|tab|menu|option|item)$/i, "")
      .trim();
  }

  //==========================================================
  // CLEAN VALUE
  //==========================================================

  _cleanValue(text) {
    if (!text) {
      return "";
    }

    return String(text).trim().replace(/^["']/, "").replace(/["']$/, "").trim();
  }

  //==========================================================
  // FIELD NORMALIZATION
  //==========================================================

  _normalizeField(field) {
    if (!field) {
      return "";
    }

    const normalized = String(field).toLowerCase().trim();

    for (const [canonical, aliases] of Object.entries(this.fieldAliases)) {
      if (aliases.includes(normalized)) {
        return canonical;
      }
    }

    return normalized;
  }

  //==========================================================
  // FIELD INFERENCE
  //==========================================================

  _inferField(target) {
    if (!target) {
      return "";
    }

    const normalized = String(target).toLowerCase().trim();

    for (const [canonical, aliases] of Object.entries(this.fieldAliases)) {
      if (aliases.some((alias) => normalized.includes(alias))) {
        return canonical;
      }
    }

    return "";
  }

  //==========================================================
  // SAFE JSON PARSER
  //
  // Supports:
  // ✔ Valid JSON
  // ✔ Single quotes
  // ✔ Trailing commas
  // ✔ Markdown code fences
  //==========================================================

  safeJSONParse(str) {
    if (str === null || str === undefined) {
      return null;
    }

    if (typeof str === "object") {
      return str;
    }

    if (typeof str !== "string") {
      return null;
    }

    let input = str.trim();

    if (!input) {
      return null;
    }

    //==========================================================
    // DIRECT PARSE
    //==========================================================

    try {
      return JSON.parse(input);
    } catch {
      // Continue repair
    }

    //==========================================================
    // REMOVE MARKDOWN CODE FENCES
    //==========================================================

    input = input
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    //==========================================================
    // EXTRACT JSON OBJECT
    //==========================================================

    const objectStart = input.indexOf("{");

    const objectEnd = input.lastIndexOf("}");

    const arrayStart = input.indexOf("[");

    const arrayEnd = input.lastIndexOf("]");

    if (objectStart !== -1 && objectEnd > objectStart) {
      input = input.slice(objectStart, objectEnd + 1);
    } else if (arrayStart !== -1 && arrayEnd > arrayStart) {
      input = input.slice(arrayStart, arrayEnd + 1);
    }

    //==========================================================
    // BASIC REPAIR
    //==========================================================

    try {
      const fixed = input
        // Convert simple single-quoted strings
        .replace(/'([^']*)'/g, '"$1"')

        // Remove trailing commas
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]");

      return JSON.parse(fixed);
    } catch (error) {
      this.log("safeJSONParse failed:", error.message);

      return null;
    }
  }

  //==========================================================
  // EMPTY RESULT
  //==========================================================

  _empty(message) {
    return {
      intent: "error",

      confidence: 0,

      error: message,

      raw: "",

      normalized: "",

      multiStep: false,

      stepCount: 0,

      plannerRequired: false,

      steps: [],
    };
  }

  //==========================================================
  // DEBUG MODE
  //==========================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[IntentParser]", ...args);
    }
  }

  //==========================================================
  // DEBUG PARSE
  //==========================================================

  debugParse(input) {
    const result = this.parse(input);

    this.log("Input:", input);

    this.log("Parsed:", result);

    return result;
  }
}
