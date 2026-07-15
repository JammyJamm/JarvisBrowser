/**
 * ==========================================================
 *
 * backend/planner/intent-parser.js
 *
 * Ultra Intelligent Intent Parser
 *
 * Architecture
 *
 * User Input
 *      │
 *      ▼
 * Normalizer
 *      │
 *      ▼
 * Multi-Step Splitter
 *      │
 *      ▼
 * Intent Parser
 *      │
 *      ├── Action
 *      ├── Target
 *      ├── Value
 *      ├── Modifiers
 *      ├── Entities
 *      └── Confidence
 *      │
 *      ▼
 * Resolver
 *
 * ----------------------------------------------------------
 * Responsibilities
 * ----------------------------------------------------------
 * ✔ Extract actions
 * ✔ Extract targets
 * ✔ Extract values
 * ✔ Extract modifiers
 * ✔ Parse multi-step commands
 * ✔ Chat / Action classification
 * ✔ Keyboard shortcut parsing
 * ✔ Wait parsing
 * ✔ Scroll parsing
 * ✔ Upload parsing
 *
 * IMPORTANT
 * ----------------------------------------------------------
 * NEVER performs fuzzy matching.
 * NEVER fixes spelling.
 * NEVER guesses targets.
 *
 * Spelling correction belongs ONLY to ScoringEngine.
 *
 * ==========================================================
 */

const DEFAULT_OPTIONS = {
  debug: false,

  enableMultiIntent: true,

  confidenceThreshold: 0.75,

  removeStopWords: false,

  normalizeWhitespace: true,

  enableCommandParsing: true,

  enableEntityExtraction: true,
};

//==========================================================
// ACTION DEFINITIONS
//==========================================================

const ACTIONS = {
  click: ["click", "press", "tap", "choose", "select", "hit"],

  type: ["type", "enter", "fill", "write", "input", "insert"],

  navigate: ["open", "visit", "goto", "go", "navigate", "launch"],

  search: ["search", "find", "lookup", "google"],

  scroll: ["scroll", "swipe"],

  hover: ["hover", "move"],

  wait: ["wait", "pause", "sleep"],

  check: ["check", "tick", "enable"],

  uncheck: ["uncheck", "untick", "disable"],

  upload: ["upload", "attach", "browse"],

  download: ["download", "save"],

  press: ["presskey", "shortcut"],
};

//==========================================================
// FAST ACTION LOOKUP
// O(1)
//==========================================================

const ACTION_LOOKUP = Object.create(null);

for (const [action, words] of Object.entries(ACTIONS)) {
  for (const word of words) {
    ACTION_LOOKUP[word] = action;
  }
}

//==========================================================
// ELEMENT TYPES
//==========================================================

const ELEMENT_TYPES = [
  "button",

  "link",

  "textbox",

  "input",

  "field",

  "text field",

  "password",

  "email",

  "search",

  "checkbox",

  "radio",

  "dropdown",

  "combobox",

  "select",

  "tab",

  "menu",

  "menuitem",

  "option",

  "card",

  "row",

  "cell",

  "table",

  "image",

  "icon",

  "dialog",

  "modal",

  "popup",

  "toast",

  "label",

  "heading",
];

//==========================================================
// STOP WORDS
//==========================================================

const STOP_WORDS = new Set([
  "the",

  "a",

  "an",

  "please",

  "kindly",

  "into",

  "to",

  "in",

  "on",

  "at",

  "of",

  "for",

  "from",

  "my",

  "your",

  "our",

  "this",

  "that",
]);

//==========================================================
// CONNECTORS
//==========================================================

const STEP_CONNECTORS = [
  "and then",

  "after that",

  "after",

  "next",

  "then",

  "and",
];

//==========================================================
// PARSER
//==========================================================

export default class IntentParser {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,

      ...options,
    };

    //--------------------------------------------------
    // Regex Library
    //--------------------------------------------------

    this.patterns = {
      url: /(https?:\/\/[^\s]+)|(www\.[^\s]+)/i,

      quoted: /"([^"]+)"|'([^']+)'/g,

      email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,

      number: /\b\d+(?:\.\d+)?\b/,

      ordinal: /\b(\d+)(st|nd|rd|th)\b/i,

      command: /^\/([a-zA-Z0-9_-]+)/,

      connector: /\b(and then|after that|after|next|then|and)\b/i,

      keyboard: /\b(ctrl|control|shift|alt|meta|cmd|command)\b/gi,

      timeout:
        /(\d+)\s*(ms|milliseconds|sec|secs|second|seconds|min|minute|minutes)/i,
    };

    //--------------------------------------------------
    // Cached lookups
    //--------------------------------------------------

    this.actionLookup = ACTION_LOOKUP;

    this.elementLookup = new Set(ELEMENT_TYPES);

    this.stopWords = STOP_WORDS;
  }

  //======================================================
  // DEBUG LOGGER
  //======================================================

  log(...args) {
    if (!this.options.debug) {
      return;
    }

    console.log(
      "[IntentParser]",

      ...args,
    );
  }

  //======================================================
  // PART 2
  //
  // • Main parse()
  // • normalize()
  // • splitIntoSteps()
  // • parseSentence()
  // • Chat / Action classifier
  //
  //======================================================

  //======================================================
  // MAIN PARSER
  //======================================================

  parse(input = "") {
    input = this.normalize(input);

    if (!input) {
      return this.empty();
    }

    this.log("Parsing:", input);

    const steps = [];

    const sentences = this.splitIntoSteps(input);

    for (const sentence of sentences) {
      const parsed = this.parseSentence(sentence);

      if (parsed) {
        steps.push(parsed);
      }
    }

    return this.sanitize({
      mode: this.detectMode(steps),

      raw: input,

      confidence: this.computeConfidence(steps),

      steps,
    });
  }

  //======================================================
  // RECOMMENDED PUBLIC ENTRY
  //======================================================

  parseIntent(input = "") {
    return this.parse(input);
  }

  //======================================================
  // NORMALIZER
  //======================================================

  normalize(text = "") {
    text = String(text);

    //--------------------------------------------------
    // Unicode
    //--------------------------------------------------

    text = text.normalize("NFKC");

    //--------------------------------------------------
    // Collapse whitespace
    //--------------------------------------------------

    if (this.options.normalizeWhitespace) {
      text = text.replace(/\s+/g, " ");
    }

    //--------------------------------------------------
    // Trim
    //--------------------------------------------------

    text = text.trim();

    return text;
  }

  //======================================================
  // MULTI STEP SPLITTER
  //======================================================

  splitIntoSteps(text) {
    if (!this.options.enableMultiIntent) {
      return [text];
    }

    //--------------------------------------------------
    // Preserve quoted text
    //--------------------------------------------------

    const placeholders = [];

    text = text.replace(
      this.patterns.quoted,

      (match) => {
        placeholders.push(match);

        return `__Q${placeholders.length - 1}__`;
      },
    );

    //--------------------------------------------------
    // Split
    //--------------------------------------------------

    const regex = new RegExp(
      "\\b(" + STEP_CONNECTORS.join("|") + ")\\b",

      "i",
    );

    const parts = text

      .split(regex)

      .map((part) => part.trim())

      .filter((part) => {
        if (!part) return false;

        return !STEP_CONNECTORS.includes(part.toLowerCase());
      });

    //--------------------------------------------------
    // Restore quotes
    //--------------------------------------------------

    return parts.map((step) =>
      step.replace(
        /__Q(\d+)__/g,

        (_, index) => placeholders[Number(index)],
      ),
    );
  }

  //======================================================
  // PARSE SINGLE SENTENCE
  //======================================================

  parseSentence(sentence) {
    if (!sentence) return null;

    sentence = sentence.trim();

    const lower = sentence.toLowerCase();

    //--------------------------------------------------
    // Detect Action
    //--------------------------------------------------

    const action = this.extractAction(lower);

    //--------------------------------------------------
    // Chat
    //--------------------------------------------------

    if (!action) {
      return {
        action: "chat",

        message: sentence,

        confidence: 0.35,
      };
    }

    //--------------------------------------------------
    // Build Step
    //--------------------------------------------------

    const step = {
      action,

      target: this.extractTarget(
        sentence,

        action,
      ),

      value: this.extractValue(
        sentence,

        action,
      ),

      modifiers: this.extractModifiers(sentence),

      entities: this.extractEntities(sentence),

      url: this.extractURL(sentence),

      confidence: 1,
    };

    //--------------------------------------------------
    // Wait parsing
    //--------------------------------------------------

    if (action === "wait") {
      const timeout = this.extractTimeout(sentence);

      if (timeout) {
        step.value = timeout;
      }
    }

    //--------------------------------------------------
    // Keyboard shortcut
    //--------------------------------------------------

    if (action === "press") {
      step.keys = this.extractKeyboardShortcut(sentence);
    }

    //--------------------------------------------------
    // Scroll direction
    //--------------------------------------------------

    if (action === "scroll") {
      step.direction = this.extractScrollDirection(sentence);
    }

    return step;
  }

  //======================================================
  // CHAT / ACTION CLASSIFIER
  //======================================================

  detectMode(steps = []) {
    if (!steps.length) {
      return "unknown";
    }

    const actionable = steps.filter((step) => step.action !== "chat");

    return actionable.length ? "action" : "chat";
  }

  //======================================================
  // IS ACTIONABLE
  //======================================================

  isActionable(input) {
    const result = this.parse(input);

    return result.mode === "action";
  }

  //======================================================
  // PART 3
  //
  // • extractAction()
  // • extractTarget()
  // • removeActionPrefix()
  // • removeElementWords()
  // • cleanTarget()
  //
  //======================================================
  //======================================================
  // ACTION EXTRACTION
  //======================================================

  extractAction(text = "") {
    text = text.toLowerCase().trim();

    //--------------------------------------------------
    // Exact first-word lookup
    //--------------------------------------------------

    const firstWord = text.split(/\s+/)[0];

    if (this.actionLookup[firstWord]) {
      return this.actionLookup[firstWord];
    }

    //--------------------------------------------------
    // Search every token
    //--------------------------------------------------

    const words = text.split(/\s+/);

    for (const word of words) {
      if (this.actionLookup[word]) {
        return this.actionLookup[word];
      }
    }

    //--------------------------------------------------
    // Phrase detection
    //--------------------------------------------------

    if (/go\s+to/i.test(text)) return "navigate";

    if (/right\s+click/i.test(text)) return "click";

    if (/double\s+click/i.test(text)) return "click";

    if (/press\s+enter/i.test(text)) return "press";

    if (/press\s+tab/i.test(text)) return "press";

    if (/press\s+escape/i.test(text)) return "press";

    if (/ctrl\+/i.test(text)) return "press";

    if (/command\+/i.test(text)) return "press";

    if (/shift\+/i.test(text)) return "press";

    return null;
  }

  //======================================================
  // TARGET EXTRACTION
  //======================================================

  extractTarget(text = "", action = "") {
    //--------------------------------------------------
    // Quoted target
    //--------------------------------------------------

    const quoted = [...text.matchAll(this.patterns.quoted)];

    if (quoted.length) {
      return this.cleanTarget(quoted[0][1] || quoted[0][2]);
    }

    //--------------------------------------------------
    // Remove action prefix
    //--------------------------------------------------

    let target = this.removeActionPrefix(text, action);

    //--------------------------------------------------
    // Remove extracted value
    //--------------------------------------------------

    const value = this.extractValue(text);

    if (value && target.includes(value)) {
      target = target.replace(value, "");
    }

    //--------------------------------------------------
    // Remove URL
    //--------------------------------------------------

    const url = this.extractURL(target);

    if (url) {
      target = target.replace(url, "");
    }

    //--------------------------------------------------
    // Remove connector words
    //--------------------------------------------------

    target = target

      .replace(/\binto\b/gi, "")

      .replace(/\bwith\b/gi, "")

      .replace(/\busing\b/gi, "")

      .replace(/\bcalled\b/gi, "")

      .replace(/\bnamed\b/gi, "");

    //--------------------------------------------------
    // Remove element words
    //--------------------------------------------------

    target = this.removeElementWords(target);

    //--------------------------------------------------
    // Cleanup
    //--------------------------------------------------

    return this.cleanTarget(target);
  }

  //======================================================
  // REMOVE ACTION PREFIX
  //======================================================

  removeActionPrefix(text, action) {
    if (!text) return "";

    let result = text.trim();

    const aliases = ACTIONS[action] || [];

    //--------------------------------------------------
    // Remove aliases
    //--------------------------------------------------

    for (const alias of aliases) {
      const regex = new RegExp(
        "^" +
          alias.replace(
            /\s+/g,

            "\\s+",
          ) +
          "\\b",

        "i",
      );

      result = result.replace(regex, "");
    }

    //--------------------------------------------------
    // Common prefixes
    //--------------------------------------------------

    result = result

      .replace(/^go\s+to\b/i, "")

      .replace(/^navigate\s+to\b/i, "")

      .replace(/^open\b/i, "")

      .replace(/^visit\b/i, "")

      .replace(/^click\b/i, "")

      .replace(/^press\b/i, "")

      .replace(/^tap\b/i, "")

      .replace(/^type\b/i, "")

      .replace(/^fill\b/i, "")

      .replace(/^enter\b/i, "")

      .trim();

    return result;
  }

  //======================================================
  // REMOVE ELEMENT WORDS
  //======================================================

  removeElementWords(text) {
    if (!text) return "";

    let cleaned = text;

    //--------------------------------------------------
    // Remove element types
    //--------------------------------------------------

    for (const type of ELEMENT_TYPES) {
      const regex = new RegExp(
        "\\b" +
          type.replace(
            /\s+/g,

            "\\s+",
          ) +
          "\\b",

        "ig",
      );

      cleaned = cleaned.replace(regex, "");
    }

    //--------------------------------------------------
    // Remove duplicate spaces
    //--------------------------------------------------

    cleaned = cleaned.replace(/\s+/g, " ");

    return cleaned.trim();
  }

  //======================================================
  // CLEAN TARGET
  //======================================================

  cleanTarget(target = "") {
    if (!target) return "";

    let text = target;

    //--------------------------------------------------
    // Remove punctuation
    //--------------------------------------------------

    text = text.replace(
      /^[,:;.\- ]+/,

      "",
    );

    text = text.replace(
      /[,:;.\- ]+$/,

      "",
    );

    //--------------------------------------------------
    // Normalize whitespace
    //--------------------------------------------------

    text = text

      .replace(/\s+/g, " ")

      .trim();

    //--------------------------------------------------
    // Optional stop word removal
    //--------------------------------------------------

    if (this.options.removeStopWords) {
      text = text

        .split(" ")

        .filter((word) => !this.stopWords.has(word.toLowerCase()))

        .join(" ");
    }

    return text.trim();
  }

  //======================================================
  // PART 4
  //
  // • extractValue()
  // • extractModifiers()
  // • extractEntities()
  // • extractURL()
  // • extractCommand()
  //
  //======================================================
  //======================================================
  // VALUE EXTRACTION
  //======================================================

  extractValue(text = "", action = "") {
    //--------------------------------------------------
    // Quoted strings
    //--------------------------------------------------

    const quoted = [...text.matchAll(this.patterns.quoted)];

    if (quoted.length) {
      return quoted[0][1] || quoted[0][2];
    }

    //--------------------------------------------------
    // Email
    //--------------------------------------------------

    const email = text.match(this.patterns.email);

    if (email) {
      return email[0];
    }

    //--------------------------------------------------
    // URL
    //--------------------------------------------------

    const url = this.extractURL(text);

    if (url && action === "navigate") {
      return url;
    }

    //--------------------------------------------------
    // Number
    //--------------------------------------------------

    const number = text.match(this.patterns.number);

    if (number) {
      return Number(number[0]);
    }

    return null;
  }

  //======================================================
  // MODIFIER EXTRACTION
  //======================================================

  extractModifiers(text = "") {
    const modifiers = {};

    const lower = text.toLowerCase();

    //--------------------------------------------------
    // Element type
    //--------------------------------------------------

    for (const type of ELEMENT_TYPES) {
      if (lower.includes(type)) {
        modifiers.elementType = type;

        break;
      }
    }

    //--------------------------------------------------
    // Mouse button
    //--------------------------------------------------

    if (/\bright click\b/i.test(text)) {
      modifiers.mouseButton = "right";
    } else if (/\bdouble click\b/i.test(text)) {
      modifiers.mouseButton = "double";
    } else {
      modifiers.mouseButton = "left";
    }

    //--------------------------------------------------
    // Keyboard modifiers
    //--------------------------------------------------

    modifiers.keys = [];

    if (/\bctrl\b|\bcontrol\b/i.test(text)) {
      modifiers.keys.push("Control");
    }

    if (/\bshift\b/i.test(text)) {
      modifiers.keys.push("Shift");
    }

    if (/\balt\b/i.test(text)) {
      modifiers.keys.push("Alt");
    }

    if (/\bmeta\b|\bcmd\b|\bcommand\b/i.test(text)) {
      modifiers.keys.push("Meta");
    }

    //--------------------------------------------------
    // Position
    //--------------------------------------------------

    if (/\bfirst\b/i.test(text)) {
      modifiers.position = "first";
    } else if (/\blast\b/i.test(text)) {
      modifiers.position = "last";
    } else {
      const ordinal = lower.match(this.patterns.ordinal);

      if (ordinal) {
        modifiers.position = Number(ordinal[1]);
      }
    }

    //--------------------------------------------------
    // Visibility
    //--------------------------------------------------

    modifiers.visibleOnly = /\bvisible\b/i.test(text);

    //--------------------------------------------------
    // Exact match
    //--------------------------------------------------

    modifiers.exact = this.patterns.quoted.test(text);

    this.patterns.quoted.lastIndex = 0;

    //--------------------------------------------------
    // Force
    //--------------------------------------------------

    modifiers.force = /\bforce\b/i.test(text);

    //--------------------------------------------------
    // Optional
    //--------------------------------------------------

    modifiers.optional = /\boptional\b/i.test(text);

    //--------------------------------------------------
    // Timeout
    //--------------------------------------------------

    const timeout = this.extractTimeout(text);

    if (timeout) {
      modifiers.timeout = timeout;
    }

    return modifiers;
  }

  //======================================================
  // ENTITY EXTRACTION
  //======================================================

  extractEntities(text = "") {
    if (!this.options.enableEntityExtraction) {
      return {};
    }

    return {
      url: this.extractURL(text),

      value: this.extractValue(text),

      command: this.extractCommand(text),

      email: text.match(this.patterns.email)?.[0] || null,
    };
  }

  //======================================================
  // URL EXTRACTION
  //======================================================

  extractURL(text = "") {
    const match = text.match(this.patterns.url);

    if (!match) {
      return null;
    }

    let url = match[0];

    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    return url;
  }

  //======================================================
  // COMMAND EXTRACTION
  //======================================================

  extractCommand(text = "") {
    if (!this.options.enableCommandParsing) {
      return null;
    }

    const match = text.match(this.patterns.command);

    if (!match) {
      return null;
    }

    return match[1];
  }

  //======================================================
  // PART 5
  //
  // • computeConfidence()
  // • validateStep()
  // • sanitize()
  // • empty()
  // • classify()
  //
  //======================================================
  //======================================================
  // CONFIDENCE
  //======================================================

  computeConfidence(steps = []) {
    if (!steps.length) {
      return 0;
    }

    let total = 0;

    for (const step of steps) {
      let score = 0.4;

      if (step.action && step.action !== "chat") {
        score += 0.25;
      }

      if (step.target) {
        score += 0.15;
      }

      if (step.value !== null && step.value !== undefined) {
        score += 0.05;
      }

      if (step.modifiers?.elementType) {
        score += 0.05;
      }

      if (step.url) {
        score += 0.05;
      }

      if (step.entities?.email) {
        score += 0.03;
      }

      if (step.entities?.command) {
        score += 0.02;
      }

      total += Math.min(score, 1);
    }

    return Number((total / steps.length).toFixed(2));
  }

  //======================================================
  // VALIDATE STEP
  //======================================================

  validateStep(step) {
    if (!step) {
      return false;
    }

    if (!step.action) {
      return false;
    }

    switch (step.action) {
      case "navigate":
        return Boolean(step.url || step.target);

      case "click":

      case "hover":

      case "check":

      case "uncheck":

      case "search":

      case "upload":

      case "download":
        return Boolean(step.target);

      case "type":
        return Boolean(step.target || step.value);

      case "press":
        return Boolean(step.keys?.length || step.value || step.target);

      case "wait":

      case "scroll":
        return true;

      case "chat":
        return true;

      default:
        return true;
    }
  }

  //======================================================
  // SANITIZE PLAN
  //======================================================

  sanitize(plan) {
    if (!plan) {
      return this.empty();
    }

    if (!Array.isArray(plan.steps)) {
      plan.steps = [];
    }

    plan.steps = plan.steps.filter((step) => this.validateStep(step));

    plan.confidence = this.computeConfidence(plan.steps);

    if (!plan.mode) {
      plan.mode = this.detectMode(plan.steps);
    }

    return plan;
  }

  //======================================================
  // EMPTY RESULT
  //======================================================

  empty() {
    return {
      mode: "unknown",

      raw: "",

      confidence: 0,

      steps: [],
    };
  }

  //======================================================
  // CLASSIFIER
  //======================================================

  classify(input = "") {
    const parsed = this.parse(input);

    return {
      mode: parsed.mode,

      confidence: parsed.confidence,

      actionable: parsed.mode === "action",

      steps: parsed.steps,
    };
  }

  //======================================================
  // TIMEOUT EXTRACTION
  //======================================================

  extractTimeout(text = "") {
    const match = text.match(this.patterns.timeout);

    if (!match) {
      return null;
    }

    const value = Number(match[1]);

    const unit = match[2].toLowerCase();

    if (unit.startsWith("ms")) {
      return value;
    }

    if (unit.startsWith("sec")) {
      return value * 1000;
    }

    if (unit.startsWith("min")) {
      return value * 60000;
    }

    return value;
  }

  //======================================================
  // KEYBOARD SHORTCUT
  //======================================================

  extractKeyboardShortcut(text = "") {
    const keys = [];

    const matches = text.match(this.patterns.keyboard);

    if (matches) {
      for (const key of matches) {
        switch (key.toLowerCase()) {
          case "ctrl":

          case "control":
            keys.push("Control");
            break;

          case "shift":
            keys.push("Shift");
            break;

          case "alt":
            keys.push("Alt");
            break;

          case "cmd":

          case "command":

          case "meta":
            keys.push("Meta");
            break;
        }
      }
    }

    const special = text.match(
      /\b(tab|enter|escape|esc|space|delete|backspace|home|end|arrowup|arrowdown|arrowleft|arrowright)\b/i,
    );

    if (special) {
      keys.push(special[1]);
    }

    return [...new Set(keys)];
  }

  //======================================================
  // SCROLL DIRECTION
  //======================================================

  extractScrollDirection(text = "") {
    const lower = text.toLowerCase();

    if (lower.includes("up")) {
      return "up";
    }

    if (lower.includes("down")) {
      return "down";
    }

    if (lower.includes("left")) {
      return "left";
    }

    if (lower.includes("right")) {
      return "right";
    }

    return "down";
  }

  //======================================================
  // PARSER STATS
  //======================================================

  stats() {
    return {
      actions: Object.keys(ACTIONS),

      actionCount: Object.keys(ACTIONS).length,

      supportedElements: [...ELEMENT_TYPES],

      stopWords: this.stopWords.size,

      multiIntent: this.options.enableMultiIntent,

      confidenceThreshold: this.options.confidenceThreshold,
    };
  }
}
