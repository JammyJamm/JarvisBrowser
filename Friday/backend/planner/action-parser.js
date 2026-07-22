// ==========================================================
//
// backend/planner/action-parser.js
//
// Ultra Intelligent Action Parser for Jarvis Browser
//
// Pipeline
//
// User Command
//      │
//      ▼
// IntentParser
//      │
//      ▼
// ActionParser
//      │
//      ├── navigate
//      ├── click
//      ├── type
//      ├── search
//      ├── scroll
//      ├── wait
//      ├── hover
//      ├── check
//      ├── uncheck
//      ├── select
//      ├── upload
//      ├── download
//      ├── press
//      ├── reload
//      ├── back
//      ├── forward
//      ├── screenshot
//      └── sequence
//      │
//      ▼
// ScoringEngine
//      │
//      ▼
// Resolver
//
// IMPORTANT
// ----------------------------------------------------------
// ❌ NEVER performs fuzzy matching
// ❌ NEVER performs spelling correction
// ❌ NEVER guesses target elements
// ❌ NEVER calls an LLM
//
// Responsibilities
// ----------------------------------------------------------
// ✔ Fast deterministic action parsing
// ✔ Consistent action schema
// ✔ Multi-step command parsing
// ✔ Target/value extraction
// ✔ Modifier extraction
// ✔ Keyboard shortcut parsing
// ✔ URL normalization
// ✔ Wait duration normalization
// ✔ Safe parsing
// ✔ Extensible rule registry
//
// ==========================================================

class ActionParser {
  constructor(options = {}) {
    //======================================================
    // CONFIGURATION
    //======================================================

    this.options = {
      debug: false,

      enableSequences: true,

      maxSequenceDepth: 20,

      defaultConfidence: 0.95,

      fallbackConfidence: 0.35,

      ...options,
    };

    this.debug = this.options.debug;

    //======================================================
    // ACTION ALIASES
    //======================================================

    this.actionAliases = {
      navigate: ["open", "visit", "goto", "go", "navigate", "launch"],

      click: ["click", "press", "tap", "hit", "choose"],

      type: ["type", "enter", "fill", "write", "input", "insert"],

      search: ["search", "google", "find", "lookup"],

      scroll: ["scroll", "swipe"],

      hover: ["hover", "move"],

      wait: ["wait", "pause", "sleep", "delay"],

      check: ["check", "tick", "enable"],

      uncheck: ["uncheck", "untick", "disable"],

      select: ["select", "choose"],

      upload: ["upload", "attach", "browse"],

      download: ["download", "save"],

      press: ["presskey", "shortcut"],

      reload: ["reload", "refresh"],

      back: ["back"],

      forward: ["forward"],

      screenshot: ["screenshot", "capture"],
    };

    //======================================================
    // FAST ACTION LOOKUP
    //======================================================

    this.actionLookup = Object.create(null);

    for (const [action, aliases] of Object.entries(this.actionAliases)) {
      for (const alias of aliases) {
        this.actionLookup[alias] = action;
      }
    }

    //======================================================
    // INTENT RULES
    //======================================================

    this.intentRules = this.createDefaultRules();
  }

  //========================================================
  // LOGGING
  //========================================================

  log(...args) {
    if (this.debug) {
      console.log("[ActionParser]", ...args);
    }
  }

  warn(...args) {
    if (this.debug) {
      console.warn("[ActionParser]", ...args);
    }
  }

  //========================================================
  // DEFAULT RULES
  //========================================================

  createDefaultRules() {
    return [
      //====================================================
      // NAVIGATION
      //====================================================

      {
        name: "navigate",

        patterns: [
          /^(?:go\s+to)\s+(.+)$/i,
          /^(?:navigate\s+to)\s+(.+)$/i,
          /^(?:open)\s+(.+)$/i,
          /^(?:visit)\s+(.+)$/i,
          /^(?:goto)\s+(.+)$/i,
          /^(?:launch)\s+(.+)$/i,
        ],

        build: (match) => {
          const target = this.cleanTarget(match[1]);

          return {
            url: this.normalizeUrl(target),
            target,
          };
        },
      },

      //====================================================
      // SEARCH
      //====================================================

      {
        name: "search",

        patterns: [
          /^(?:search\s+for)\s+(.+)$/i,
          /^(?:search)\s+(.+)$/i,
          /^(?:google)\s+(.+)$/i,
          /^(?:find)\s+(.+)$/i,
          /^(?:look\s+up)\s+(.+)$/i,
          /^(?:lookup)\s+(.+)$/i,
        ],

        build: (match) => ({
          query: this.cleanTarget(match[1]),
        }),
      },

      //====================================================
      // CLICK
      //====================================================

      {
        name: "click",

        patterns: [
          /^(?:click)\s+(.+)$/i,
          /^(?:tap)\s+(.+)$/i,
          /^(?:hit)\s+(.+)$/i,
          /^(?:choose)\s+(.+)$/i,
          /^(?:press)\s+(.+)$/i,
        ],

        build: (match, text) => ({
          target: this.cleanTarget(match[1]),

          modifiers: this.extractClickModifiers(text),
        }),
      },

      //====================================================
      // RIGHT CLICK
      //====================================================

      {
        name: "click",

        patterns: [/^(?:right\s+click)\s+(.+)$/i, /^(?:right-click)\s+(.+)$/i],

        build: (match) => ({
          target: this.cleanTarget(match[1]),

          modifiers: {
            mouseButton: "right",
          },
        }),
      },

      //====================================================
      // DOUBLE CLICK
      //====================================================

      {
        name: "click",

        patterns: [
          /^(?:double\s+click)\s+(.+)$/i,
          /^(?:double-click)\s+(.+)$/i,
        ],

        build: (match) => ({
          target: this.cleanTarget(match[1]),

          modifiers: {
            mouseButton: "double",
          },
        }),
      },

      //====================================================
      // TYPE
      //====================================================

      {
        name: "type",

        patterns: [
          /^(?:type)\s+(.+?)\s+(?:in|into)\s+(.+)$/i,
          /^(?:enter)\s+(.+?)\s+(?:in|into)\s+(.+)$/i,
          /^(?:fill)\s+(.+?)\s+(?:in|into)\s+(.+)$/i,
          /^(?:write)\s+(.+?)\s+(?:in|into)\s+(.+)$/i,
          /^(?:input)\s+(.+?)\s+(?:in|into)\s+(.+)$/i,
        ],

        build: (match) => ({
          text: this.cleanValue(match[1]),

          value: this.cleanValue(match[1]),

          target: this.cleanTarget(match[2]),
        }),
      },

      //====================================================
      // TYPE INTO TARGET
      //====================================================

      {
        name: "type",

        patterns: [/^(?:type\s+in)\s+(.+)$/i, /^(?:enter\s+in)\s+(.+)$/i],

        build: (match) => ({
          text: this.cleanValue(match[1]),

          value: this.cleanValue(match[1]),
        }),
      },

      //====================================================
      // SCROLL
      //====================================================

      {
        name: "scroll",

        patterns: [
          /^(?:scroll)\s+(up|down|left|right|top|bottom)(?:\s+(\d+))?$/i,
          /^(?:scroll)\s+(up|down|left|right|top|bottom)$/i,
          /^(?:scroll)$/i,
        ],

        build: (match) => ({
          direction: (match[1] || "down").toLowerCase(),

          amount: match[2] ? Number(match[2]) : 1,
        }),
      },

      //====================================================
      // WAIT
      //====================================================

      {
        name: "wait",

        patterns: [
          /^(?:wait|pause|sleep|delay)\s+(\d+)\s*(ms|milliseconds|s|sec|secs|seconds|m|min|mins|minutes)?$/i,
        ],

        build: (match) => {
          const duration = Number(match[1]);

          const unit = this.normalizeTimeUnit(match[2] || "s");

          return {
            duration,

            unit,

            milliseconds: this.toMilliseconds(duration, unit),
          };
        },
      },

      //====================================================
      // HOVER
      //====================================================

      {
        name: "hover",

        patterns: [
          /^(?:hover)\s+(?:over\s+)?(.+)$/i,
          /^(?:move\s+over)\s+(.+)$/i,
        ],

        build: (match) => ({
          target: this.cleanTarget(match[1]),
        }),
      },

      //====================================================
      // CHECK
      //====================================================

      {
        name: "check",

        patterns: [/^(?:check|tick|enable)\s+(.+)$/i],

        build: (match) => ({
          target: this.cleanTarget(match[1]),
        }),
      },

      //====================================================
      // UNCHECK
      //====================================================

      {
        name: "uncheck",

        patterns: [/^(?:uncheck|untick|disable)\s+(.+)$/i],

        build: (match) => ({
          target: this.cleanTarget(match[1]),
        }),
      },

      //====================================================
      // SELECT
      //====================================================

      {
        name: "select",

        patterns: [/^(?:select|choose)\s+(.+?)\s+(?:from|in)\s+(.+)$/i],

        build: (match) => ({
          value: this.cleanValue(match[1]),

          target: this.cleanTarget(match[2]),
        }),
      },

      //====================================================
      // UPLOAD
      //====================================================

      {
        name: "upload",

        patterns: [/^(?:upload|attach|browse)\s+(.+)$/i],

        build: (match) => ({
          path: this.cleanValue(match[1]),

          target: this.extractUploadTarget(match[1]),
        }),
      },

      //====================================================
      // DOWNLOAD
      //====================================================

      {
        name: "download",

        patterns: [/^(?:download)\s+(.+)$/i, /^(?:save)\s+(.+)$/i],

        build: (match) => ({
          target: this.cleanTarget(match[1]),
        }),
      },

      //====================================================
      // KEYBOARD SHORTCUT
      //====================================================

      {
        name: "press",

        patterns: [
          /^(?:presskey|shortcut)\s+(.+)$/i,
          /^(?:press)\s+(ctrl|control|shift|alt|meta|cmd|command)\s*\+\s*(.+)$/i,
          /^(?:press)\s+(enter|tab|escape|esc|space|delete|backspace|home|end|arrowup|arrowdown|arrowleft|arrowright)$/i,
        ],

        build: (match, text) => ({
          keys: this.extractKeys(match, text),

          value: this.cleanValue(match[1] || ""),
        }),
      },

      //====================================================
      // RELOAD
      //====================================================

      {
        name: "reload",

        patterns: [
          /^reload$/i,
          /^reload\s+page$/i,
          /^refresh$/i,
          /^refresh\s+page$/i,
        ],

        build: () => ({}),
      },

      //====================================================
      // BACK
      //====================================================

      {
        name: "back",

        patterns: [/^back$/i, /^go\s+back$/i, /^previous\s+page$/i],

        build: () => ({}),
      },

      //====================================================
      // FORWARD
      //====================================================

      {
        name: "forward",

        patterns: [/^forward$/i, /^go\s+forward$/i, /^next\s+page$/i],

        build: () => ({}),
      },

      //====================================================
      // SCREENSHOT
      //====================================================

      {
        name: "screenshot",

        patterns: [
          /^take\s+(?:a\s+)?screenshot$/i,
          /^capture\s+(?:the\s+)?screen$/i,
          /^take\s+(?:a\s+)?screen\s*shot$/i,
        ],

        build: () => ({}),
      },
    ];
  }

  //========================================================
  // MAIN PARSER
  //========================================================

  parse(input) {
    if (input === null || input === undefined || typeof input !== "string") {
      return this._unknown(input);
    }

    const raw = input;

    const cleaned = this._clean(input);

    if (!cleaned) {
      return this._unknown(raw);
    }

    this.log("Parsing:", raw);

    //======================================================
    // MULTI-STEP FIRST
    //======================================================

    if (this.options.enableSequences && this.hasSequence(cleaned)) {
      const sequence = this._parseSequence(raw);

      if (sequence && sequence.actions.length > 1) {
        return sequence;
      }
    }

    //======================================================
    // FAST RULE PATH
    //======================================================

    for (const rule of this.intentRules) {
      if (!rule || !Array.isArray(rule.patterns)) {
        continue;
      }

      for (const pattern of rule.patterns) {
        if (!(pattern instanceof RegExp)) {
          continue;
        }

        const match = cleaned.match(pattern);

        if (!match) {
          continue;
        }

        let payload = {};

        try {
          payload = rule.build ? rule.build(match, cleaned) : {};
        } catch (error) {
          this.warn("Rule build failed:", error.message);

          payload = {};
        }

        const action = this.createAction(
          rule.name,
          payload,
          raw,
          this.options.defaultConfidence,
        );

        this.log("FAST MATCH:", action);

        return action;
      }
    }

    //======================================================
    // STRUCTURED FALLBACK
    //======================================================

    return this._fallbackParse(cleaned, raw);
  }

  //========================================================
  // ACTION OBJECT
  //========================================================

  createAction(type, payload = {}, raw = "", confidence = 0.5) {
    return {
      type,

      action: type,

      payload: payload || {},

      raw,

      confidence: this.normalizeConfidence(confidence),
    };
  }

  //========================================================
  // SEQUENCE DETECTION
  //========================================================

  hasSequence(text) {
    if (!text) return false;

    return (
      /\bthen\b/i.test(text) ||
      /\band then\b/i.test(text) ||
      /\bafter that\b/i.test(text) ||
      /\bnext\b/i.test(text)
    );
  }

  //========================================================
  // PARSE SEQUENCE
  //========================================================

  _parseSequence(text, depth = 0) {
    if (depth >= this.options.maxSequenceDepth) {
      return this.createAction(
        "unknown",
        {
          reason: "maximum_sequence_depth",
        },
        text,
        0,
      );
    }

    const parts = this.splitSequence(text);

    if (parts.length <= 1) {
      return null;
    }

    const actions = [];

    for (const part of parts) {
      if (!part) continue;

      const action = this.parse(part);

      actions.push(action);
    }

    return {
      type: "sequence",

      action: "sequence",

      actions,

      payload: {
        steps: actions,
      },

      raw: text,

      confidence: this.computeSequenceConfidence(actions),
    };
  }

  //========================================================
  // SEQUENCE SPLITTER
  //
  // Preserves quoted strings.
  //========================================================

  splitSequence(text) {
    const placeholders = [];

    let protectedText = text.replace(/"([^"]*)"|'([^']*)'/g, (match) => {
      const index = placeholders.length;

      placeholders.push(match);

      return `__QUOTE_${index}__`;
    });

    const parts = protectedText
      .split(/\s+(?:and\s+then|after\s+that|then|next)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.map((part) =>
      part.replace(
        /__QUOTE_(\d+)__/g,
        (_, index) => placeholders[Number(index)],
      ),
    );
  }

  //========================================================
  // FALLBACK PARSER
  //
  // IMPORTANT:
  // This does NOT fuzzy-match.
  // It only detects explicit action keywords.
  //========================================================

  _fallbackParse(cleaned, raw) {
    const tokens = cleaned.split(/\s+/);

    const firstWord = tokens[0] || "";

    //======================================================
    // NAVIGATION
    //======================================================

    if (this.actionLookup[firstWord] === "navigate") {
      const target = tokens.slice(1).join(" ");

      return this.createAction(
        "navigate",
        {
          target,

          url: this.normalizeUrl(target),
        },
        raw,
        0.65,
      );
    }

    //======================================================
    // CLICK
    //======================================================

    if (this.actionLookup[firstWord] === "click") {
      return this.createAction(
        "click",
        {
          target: tokens.slice(1).join(" ").trim(),
        },
        raw,
        0.65,
      );
    }

    //======================================================
    // TYPE
    //======================================================

    if (this.actionLookup[firstWord] === "type") {
      return this.createAction(
        "type",
        {
          text: tokens.slice(1).join(" ").trim(),
        },
        raw,
        0.6,
      );
    }

    //======================================================
    // SEARCH
    //======================================================

    if (this.actionLookup[firstWord] === "search") {
      return this.createAction(
        "search",
        {
          query: tokens.slice(1).join(" ").trim(),
        },
        raw,
        0.65,
      );
    }

    //======================================================
    // SCROLL
    //======================================================

    if (this.actionLookup[firstWord] === "scroll") {
      return this.createAction(
        "scroll",
        {
          direction: this.extractScrollDirection(cleaned),
        },
        raw,
        0.65,
      );
    }

    //======================================================
    // WAIT
    //======================================================

    if (this.actionLookup[firstWord] === "wait") {
      const timeout = this.extractDuration(cleaned);

      return this.createAction("wait", timeout, raw, 0.65);
    }

    //======================================================
    // EXPLICIT KEYBOARD COMMAND
    //======================================================

    if (
      /\b(ctrl|control|shift|alt|meta|cmd|command)\b/i.test(cleaned) ||
      /\b(enter|tab|escape|esc|space|delete|backspace)\b/i.test(cleaned)
    ) {
      return this.createAction(
        "press",
        {
          keys: this.extractKeys([], cleaned),
        },
        raw,
        0.6,
      );
    }

    //======================================================
    // UNKNOWN
    //======================================================

    return this._unknown(raw, cleaned);
  }

  //========================================================
  // URL NORMALIZER
  //========================================================

  normalizeUrl(url) {
    if (!url) {
      return "";
    }

    let value = String(url).trim();

    // Remove surrounding quotes
    value = value.replace(/^["']|["']$/g, "");

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    if (/^www\./i.test(value)) {
      return `https://${value}`;
    }

    // Domain
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) {
      return `https://${value}`;
    }

    // Search query
    return "https://www.google.com/search?q=" + encodeURIComponent(value);
  }

  //========================================================
  // TARGET CLEANING
  //========================================================

  cleanTarget(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value)
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  //========================================================
  // VALUE CLEANING
  //========================================================

  cleanValue(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value)
      .trim()
      .replace(/^["']|["']$/g, "");
  }

  //========================================================
  // CLICK MODIFIERS
  //========================================================

  extractClickModifiers(text = "") {
    const modifiers = {
      mouseButton: "left",
    };

    if (/\bright\s+click\b/i.test(text)) {
      modifiers.mouseButton = "right";
    }

    if (/\bdouble\s+click\b/i.test(text)) {
      modifiers.mouseButton = "double";
    }

    if (/\bforce\b/i.test(text)) {
      modifiers.force = true;
    }

    if (/\bvisible\b/i.test(text)) {
      modifiers.visibleOnly = true;
    }

    if (/\bfirst\b/i.test(text)) {
      modifiers.position = "first";
    }

    if (/\blast\b/i.test(text)) {
      modifiers.position = "last";
    }

    return modifiers;
  }

  //========================================================
  // UPLOAD TARGET
  //========================================================

  extractUploadTarget(text = "") {
    const match = text.match(/(.+?)\s+(?:to|into)\s+(.+)$/i);

    if (!match) {
      return "";
    }

    return this.cleanTarget(match[2]);
  }

  //========================================================
  // KEY EXTRACTION
  //========================================================

  extractKeys(match = [], text = "") {
    const keys = [];

    const source = typeof text === "string" ? text : "";

    // Modifier keys
    if (/\bctrl\b|\bcontrol\b/i.test(source)) {
      keys.push("Control");
    }

    if (/\bshift\b/i.test(source)) {
      keys.push("Shift");
    }

    if (/\balt\b/i.test(source)) {
      keys.push("Alt");
    }

    if (/\bmeta\b|\bcmd\b|\bcommand\b/i.test(source)) {
      keys.push("Meta");
    }

    // Special keys
    const special = source.match(
      /\b(tab|enter|escape|esc|space|delete|backspace|home|end|arrowup|arrowdown|arrowleft|arrowright)\b/i,
    );

    if (special) {
      let key = special[1];

      if (key.toLowerCase() === "esc") {
        key = "Escape";
      }

      keys.push(key);
    }

    // Shortcut syntax
    if (source.includes("+")) {
      const shortcut = source.split("+").map((key) => key.trim().toLowerCase());

      for (const key of shortcut) {
        const mapped = this.mapKey(key);

        if (mapped) {
          keys.push(mapped);
        }
      }
    }

    return [...new Set(keys)];
  }

  //========================================================
  // KEY MAPPING
  //========================================================

  mapKey(key) {
    const map = {
      ctrl: "Control",

      control: "Control",

      shift: "Shift",

      alt: "Alt",

      meta: "Meta",

      cmd: "Meta",

      command: "Meta",

      enter: "Enter",

      tab: "Tab",

      escape: "Escape",

      esc: "Escape",

      space: "Space",

      delete: "Delete",

      backspace: "Backspace",

      home: "Home",

      end: "End",

      arrowup: "ArrowUp",

      arrowdown: "ArrowDown",

      arrowleft: "ArrowLeft",

      arrowright: "ArrowRight",
    };

    return map[String(key).toLowerCase()] || key;
  }

  //========================================================
  // SCROLL DIRECTION
  //========================================================

  extractScrollDirection(text = "") {
    const lower = text.toLowerCase();

    if (/\btop\b/.test(lower)) {
      return "top";
    }

    if (/\bbottom\b/.test(lower)) {
      return "bottom";
    }

    if (/\bup\b/.test(lower)) {
      return "up";
    }

    if (/\bleft\b/.test(lower)) {
      return "left";
    }

    if (/\bright\b/.test(lower)) {
      return "right";
    }

    return "down";
  }

  //========================================================
  // DURATION EXTRACTION
  //========================================================

  extractDuration(text = "") {
    const match = text.match(
      /(\d+(?:\.\d+)?)\s*(ms|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes)?/i,
    );

    if (!match) {
      return {
        duration: 1000,

        unit: "ms",

        milliseconds: 1000,
      };
    }

    const duration = Number(match[1]);

    const unit = this.normalizeTimeUnit(match[2] || "s");

    return {
      duration,

      unit,

      milliseconds: this.toMilliseconds(duration, unit),
    };
  }

  //========================================================
  // TIME UNIT
  //========================================================

  normalizeTimeUnit(unit = "s") {
    const value = String(unit).toLowerCase();

    if (value === "ms" || value === "millisecond" || value === "milliseconds") {
      return "ms";
    }

    if (
      value === "m" ||
      value === "min" ||
      value === "mins" ||
      value === "minute" ||
      value === "minutes"
    ) {
      return "m";
    }

    return "s";
  }

  //========================================================
  // TO MILLISECONDS
  //========================================================

  toMilliseconds(duration, unit) {
    const value = Number(duration);

    if (Number.isNaN(value)) {
      return 0;
    }

    switch (unit) {
      case "ms":
        return value;

      case "m":
        return value * 60000;

      case "s":
      default:
        return value * 1000;
    }
  }

  //========================================================
  // CLEAN INPUT
  //========================================================

  _clean(text) {
    return String(text).normalize("NFKC").trim().replace(/\s+/g, " ");
  }

  //========================================================
  // UNKNOWN
  //========================================================

  _unknown(input, cleaned = "") {
    return {
      type: "unknown",

      action: "unknown",

      payload: {
        input: cleaned || input || "",
      },

      raw: input,

      confidence: 0,
    };
  }

  //========================================================
  // CONFIDENCE
  //========================================================

  normalizeConfidence(value) {
    const number = Number(value);

    if (Number.isNaN(number)) {
      return 0;
    }

    return Math.max(0, Math.min(1, number));
  }

  //========================================================
  // SEQUENCE CONFIDENCE
  //========================================================

  computeSequenceConfidence(actions = []) {
    if (!actions.length) {
      return 0;
    }

    const total = actions.reduce(
      (sum, action) => sum + Number(action.confidence || 0),
      0,
    );

    return this.normalizeConfidence(total / actions.length);
  }

  //========================================================
  // EXTEND RULES
  //========================================================

  addRule(rule) {
    if (!rule || typeof rule !== "object") {
      throw new TypeError("ActionParser.addRule requires a rule object.");
    }

    if (!rule.name || !Array.isArray(rule.patterns)) {
      throw new TypeError("Rule requires name and patterns.");
    }

    this.intentRules.push(rule);

    return true;
  }

  //========================================================
  // REMOVE RULE
  //========================================================

  removeRule(name) {
    const before = this.intentRules.length;

    this.intentRules = this.intentRules.filter((rule) => rule.name !== name);

    return before !== this.intentRules.length;
  }

  //========================================================
  // GET RULES
  //========================================================

  getRules() {
    return [...this.intentRules];
  }

  //========================================================
  // DEBUG
  //========================================================

  printRules() {
    console.log("\n========== ACTION PARSER RULES ==========");

    this.intentRules.forEach((rule, index) => {
      console.log({
        index,

        name: rule.name,

        patterns: rule.patterns.map((pattern) => pattern.toString()),
      });
    });

    console.log("==========================================\n");
  }

  //========================================================
  // STATISTICS
  //========================================================

  stats() {
    return {
      rules: this.intentRules.length,

      actions: Object.keys(this.actionAliases),

      actionCount: Object.keys(this.actionAliases).length,

      sequences: this.options.enableSequences,

      maxSequenceDepth: this.options.maxSequenceDepth,

      fuzzyMatching: false,

      llm: false,
    };
  }
}

//==========================================================
// EXPORT
//==========================================================
//
// Your project currently mixes ES modules and CommonJS.
// This file is kept CommonJS-compatible to match the
// original action-parser.js.
//
// If package.json contains:
//   "type": "module"
//
// change the final export to:
//
// export default ActionParser;
//
//==========================================================

export default ActionParser;
