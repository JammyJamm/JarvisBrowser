/**
 * backend/planner/intent-parser.js
 *
 * Ultra Intelligent Intent Parser
 *
 * Responsibilities
 * ----------------------------------------------------------
 * ✔ Understand natural-language browser commands
 * ✔ Extract action
 * ✔ Extract target
 * ✔ Extract value
 * ✔ Extract modifiers
 * ✔ Extract entities
 * ✔ Parse multi-step commands
 * ✔ Classify chat vs action
 * ✔ Parse keyboard shortcuts
 * ✔ Parse wait commands
 * ✔ Parse scroll commands
 * ✔ Parse upload commands
 * ✔ Preserve original user wording
 *
 * IMPORTANT
 * ----------------------------------------------------------
 * ❌ NO fuzzy matching
 * ❌ NO spelling correction
 * ❌ NO DOM inspection
 * ❌ NO DOM scoring
 * ❌ NO selector ranking
 * ❌ NO browser execution
 * ❌ NO target guessing
 *
 * Spelling correction / fuzzy matching belongs ONLY to:
 *
 *     scoring-engine.js
 *
 * DOM resolution belongs to:
 *
 *     resolver.js
 *
 * Browser execution belongs to:
 *
 *     executor.js / Playwright / MCP
 *
 * Architecture
 *
 * USER COMMAND
 *      │
 *      ▼
 * Intent Parser
 *      │
 *      ├── action
 *      ├── target
 *      ├── value
 *      ├── modifiers
 *      ├── entities
 *      └── steps
 *      │
 *      ▼
 * Scoring Engine
 *      │
 *      ├── exact match
 *      ├── token match
 *      ├── normalized match
 *      ├── fuzzy match
 *      ├── accessibility
 *      ├── visibility
 *      └── DOM context
 *      │
 *      ▼
 * Resolver
 *      │
 *      ▼
 * Executor
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

  preserveElementTypeInTarget: true,

  maxSteps: 100,
};

//==========================================================
// ACTION DEFINITIONS
//==========================================================

const ACTIONS = {
  click: ["click", "tap", "hit"],

  type: ["type", "enter", "fill", "write", "input", "insert"],

  navigate: ["open", "visit", "goto", "navigate", "launch", "browse"],

  search: ["search", "lookup", "google"],

  scroll: ["scroll", "swipe"],

  hover: ["hover", "mouseover", "move"],

  wait: ["wait", "pause", "sleep", "delay"],

  check: ["check", "tick", "enable"],

  uncheck: ["uncheck", "untick", "disable"],

  upload: ["upload", "attach", "browse"],

  download: ["download", "save"],

  press: ["presskey", "shortcut", "keypress", "key"],

  select: ["select", "choose", "pick"],

  reload: ["reload", "refresh"],

  back: ["back"],

  forward: ["forward"],
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

const STEP_CONNECTORS = ["and then", "after that", "next", "then"];

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

      connector: /\b(and then|after that|next|then)\b/i,

      keyboard: /\b(ctrl|control|shift|alt|meta|cmd|command)\b/gi,

      timeout:
        /(\d+(?:\.\d+)?)\s*(ms|milliseconds|sec|secs|second|seconds|min|minute|minutes)\b/i,

      direction: /\b(up|down|left|right)\b/i,

      rightClick: /\bright\s+click\b/i,

      doubleClick: /\bdouble\s+click\b/i,

      middleClick: /\bmiddle\s+click\b/i,

      exact: /\bexact(?:ly)?\b/i,

      visible: /\bvisible\b/i,

      force: /\bforce\b/i,

      optional: /\boptional\b/i,

      iframe: /\b(?:inside|within|in)\s+(?:the\s+)?(?:iframe|frame)\b/i,

      shadow: /\b(?:inside|within|in)\s+(?:the\s+)?shadow\s+dom\b/i,

      newTab: /\b(?:new|another)\s+tab\b/i,

      currentTab: /\b(?:current|this)\s+tab\b/i,

      first: /\bfirst\b/i,

      last: /\blast\b/i,
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

    console.log("[IntentParser]", ...args);
  }

  //======================================================
  // MAIN PARSER
  //======================================================

  parse(input = "") {
    const rawInput = String(input ?? "");

    const normalizedInput = this.normalize(rawInput);

    if (!normalizedInput) {
      return this.empty();
    }

    this.log("Parsing:", normalizedInput);

    //--------------------------------------------------
    // Split command into logical steps
    //--------------------------------------------------

    const sentences = this.splitIntoSteps(normalizedInput);

    //--------------------------------------------------
    // Parse each step
    //--------------------------------------------------

    const steps = [];

    for (const sentence of sentences) {
      const parsed = this.parseSentence(sentence);

      if (parsed) {
        steps.push(parsed);
      }
    }

    //--------------------------------------------------
    // Build result
    //--------------------------------------------------

    return this.sanitize({
      mode: this.detectMode(steps),

      raw: rawInput,

      normalized: normalizedInput,

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
    text = String(text ?? "");

    //--------------------------------------------------
    // Unicode normalization
    //--------------------------------------------------

    text = text.normalize("NFKC");

    //--------------------------------------------------
    // Normalize whitespace
    //--------------------------------------------------

    if (this.options.normalizeWhitespace) {
      text = text.replace(/\s+/g, " ");
    }

    //--------------------------------------------------
    // Trim
    //--------------------------------------------------

    return text.trim();
  }

  //======================================================
  // MULTI-STEP SPLITTER
  //======================================================

  splitIntoSteps(text = "") {
    if (!text) {
      return [];
    }

    if (!this.options.enableMultiIntent) {
      return [text];
    }

    //--------------------------------------------------
    // Protect quoted strings
    //--------------------------------------------------

    const placeholders = [];

    let protectedText = text.replace(this.patterns.quoted, (match) => {
      const index = placeholders.length;

      placeholders.push(match);

      return `__JARVIS_QUOTE_${index}__`;
    });

    //--------------------------------------------------
    // Protect URLs
    //--------------------------------------------------

    const urls = [];

    protectedText = protectedText.replace(this.patterns.url, (match) => {
      const index = urls.length;

      urls.push(match);

      return `__JARVIS_URL_${index}__`;
    });

    //--------------------------------------------------
    // Split only on strong step connectors
    //
    // IMPORTANT:
    // Do NOT split on plain "and".
    //
    // Example:
    //
    // Click Save and Continue button
    //
    // must remain one command.
    //--------------------------------------------------

    const connectorPattern = /\s+(?:and then|after that|next|then)\s+/gi;

    const parts = protectedText
      .split(connectorPattern)
      .map((part) => part.trim())
      .filter(Boolean);

    //--------------------------------------------------
    // Restore URLs
    //--------------------------------------------------

    const restoredUrls = parts.map((part) =>
      part.replace(
        /__JARVIS_URL_(\d+)__/g,
        (_, index) => urls[Number(index)] || "",
      ),
    );

    //--------------------------------------------------
    // Restore quoted values
    //--------------------------------------------------

    return restoredUrls.map((part) =>
      part.replace(
        /__JARVIS_QUOTE_(\d+)__/g,
        (_, index) => placeholders[Number(index)] || "",
      ),
    );
  }

  //======================================================
  // PARSE SINGLE SENTENCE
  //======================================================

  parseSentence(sentence = "") {
    if (!sentence) {
      return null;
    }

    sentence = sentence.trim();

    if (!sentence) {
      return null;
    }

    const lower = sentence.toLowerCase();

    //--------------------------------------------------
    // Detect action
    //--------------------------------------------------

    const action = this.extractAction(lower);

    //--------------------------------------------------
    // Chat / unknown
    //--------------------------------------------------

    if (!action) {
      return {
        action: "chat",

        target: "",

        value: null,

        modifiers: {},

        entities: {
          url: this.extractURL(sentence),

          email: sentence.match(this.patterns.email)?.[0] || null,

          command: this.extractCommand(sentence),
        },

        message: sentence,

        confidence: 0.35,
      };
    }

    //--------------------------------------------------
    // Extract target
    //--------------------------------------------------

    const target = this.extractTarget(sentence, action);

    //--------------------------------------------------
    // Extract value
    //--------------------------------------------------

    const value = this.extractValue(sentence, action);

    //--------------------------------------------------
    // Build step
    //--------------------------------------------------

    const step = {
      action,

      target,

      value,

      modifiers: this.extractModifiers(sentence),

      entities: this.extractEntities(sentence),

      url: this.extractURL(sentence),

      confidence: this.computeStepConfidence(action, target, value),
    };

    //--------------------------------------------------
    // Wait
    //--------------------------------------------------

    if (action === "wait") {
      const timeout = this.extractTimeout(sentence);

      if (timeout !== null) {
        step.value = timeout;
      }
    }

    //--------------------------------------------------
    // Keyboard
    //--------------------------------------------------

    if (action === "press") {
      step.keys = this.extractKeyboardShortcut(sentence);
    }

    //--------------------------------------------------
    // Scroll
    //--------------------------------------------------

    if (action === "scroll") {
      step.direction = this.extractScrollDirection(sentence);
    }

    //--------------------------------------------------
    // Upload
    //--------------------------------------------------

    if (action === "upload") {
      step.file = this.extractUploadTarget(sentence);
    }

    return step;
  }

  //======================================================
  // CHAT / ACTION CLASSIFIER
  //======================================================

  detectMode(steps = []) {
    if (!Array.isArray(steps) || !steps.length) {
      return "unknown";
    }

    const actionable = steps.filter(
      (step) => step && step.action && step.action !== "chat",
    );

    return actionable.length ? "action" : "chat";
  }

  //======================================================
  // IS ACTIONABLE
  //======================================================

  isActionable(input = "") {
    const result = this.parse(input);

    return result.mode === "action";
  }

  //======================================================
  // ACTION EXTRACTION
  //======================================================

  extractAction(text = "") {
    const normalized = String(text).toLowerCase().trim();

    if (!normalized) {
      return null;
    }

    //--------------------------------------------------
    // Strong phrase detection first
    //--------------------------------------------------

    if (/^go\s+to\b/i.test(normalized)) {
      return "navigate";
    }

    if (/^right\s+click\b/i.test(normalized)) {
      return "click";
    }

    if (/^double\s+click\b/i.test(normalized)) {
      return "click";
    }

    if (/^middle\s+click\b/i.test(normalized)) {
      return "click";
    }

    if (/^press\s+(?:enter|tab|escape|esc|space)\b/i.test(normalized)) {
      return "press";
    }

    if (/^(?:ctrl|control|shift|alt|cmd|command|meta)\+/i.test(normalized)) {
      return "press";
    }

    //--------------------------------------------------
    // First word lookup
    //
    // Action should normally be at the beginning.
    // This avoids detecting words inside targets.
    //--------------------------------------------------

    const firstWord = normalized.split(/\s+/)[0];

    if (this.actionLookup[firstWord]) {
      return this.actionLookup[firstWord];
    }

    //--------------------------------------------------
    // Special multi-word action
    //--------------------------------------------------

    if (/^navigate\s+to\b/i.test(normalized)) {
      return "navigate";
    }

    //--------------------------------------------------
    // Do not scan arbitrary target words.
    //
    // Example:
    //
    // "Click the Search button"
    //
    // Search is target text, not action.
    //--------------------------------------------------

    return null;
  }

  //======================================================
  // TARGET EXTRACTION
  //======================================================

  extractTarget(text = "", action = "") {
    //--------------------------------------------------
    // For navigation, URL is the primary target.
    //--------------------------------------------------

    if (action === "navigate") {
      const url = this.extractURL(text);

      if (url) {
        return url;
      }
    }

    //--------------------------------------------------
    // For quoted commands:
    //
    // Click "Punch In"
    //
    // Fill "Email" with "test@gmail.com"
    //
    // The parser must distinguish target/value.
    //--------------------------------------------------

    const quoted = [...text.matchAll(this.patterns.quoted)];

    if (quoted.length && action !== "type") {
      return this.cleanTarget(quoted[0][1] || quoted[0][2] || "");
    }

    //--------------------------------------------------
    // Remove action prefix
    //--------------------------------------------------

    let target = this.removeActionPrefix(text, action);

    //--------------------------------------------------
    // Remove value phrase
    //--------------------------------------------------

    if (action === "type" || action === "select") {
      target = this.removeValuePhrase(target, text);
    }

    //--------------------------------------------------
    // Remove URL
    //--------------------------------------------------

    const url = this.extractURL(target);

    if (url) {
      target = target.replace(url, "");
    }

    //--------------------------------------------------
    // Remove natural-language connectors
    //
    // IMPORTANT:
    // Do not remove element words.
    //
    // "Punch In button"
    //
    // should remain:
    //
    // target: "Punch In"
    // elementType: "button"
    //
    // The target cleaner below handles this
    // through element metadata.
    //--------------------------------------------------

    target = target.replace(/\b(?:into|using|called|named)\b/gi, "");

    //--------------------------------------------------
    // Remove value-leading phrases
    //--------------------------------------------------

    target = target.replace(/\bwith\s*$/i, "").replace(/\bto\s*$/i, "");

    //--------------------------------------------------
    // Clean target
    //--------------------------------------------------

    return this.cleanTarget(target);
  }

  //======================================================
  // REMOVE ACTION PREFIX
  //======================================================

  removeActionPrefix(text = "", action = "") {
    if (!text) {
      return "";
    }

    let result = text.trim();

    //--------------------------------------------------
    // Special prefixes
    //--------------------------------------------------

    const prefixes = [
      /^go\s+to\b/i,

      /^navigate\s+to\b/i,

      /^open\b/i,

      /^visit\b/i,

      /^goto\b/i,

      /^click\b/i,

      /^tap\b/i,

      /^hit\b/i,

      /^type\b/i,

      /^fill\b/i,

      /^enter\b/i,

      /^write\b/i,

      /^input\b/i,

      /^insert\b/i,

      /^select\b/i,

      /^choose\b/i,

      /^pick\b/i,

      /^search\b/i,

      /^lookup\b/i,

      /^scroll\b/i,

      /^swipe\b/i,

      /^hover\b/i,

      /^wait\b/i,

      /^pause\b/i,

      /^sleep\b/i,

      /^upload\b/i,

      /^attach\b/i,

      /^download\b/i,

      /^save\b/i,

      /^check\b/i,

      /^uncheck\b/i,

      /^untick\b/i,

      /^enable\b/i,

      /^disable\b/i,

      /^presskey\b/i,

      /^keypress\b/i,

      /^shortcut\b/i,

      /^reload\b/i,

      /^refresh\b/i,

      /^back\b/i,

      /^forward\b/i,
    ];

    for (const regex of prefixes) {
      result = result.replace(regex, "");
    }

    return result.trim();
  }

  //======================================================
  // REMOVE ELEMENT WORD
  //
  // IMPORTANT:
  // This function is NOT used to destroy target data.
  //
  // It is only available as a helper for callers that
  // explicitly need a semantic target without the
  // element type.
  //======================================================

  removeElementWords(text = "") {
    if (!text) {
      return "";
    }

    let cleaned = text;

    const sorted = [...ELEMENT_TYPES].sort((a, b) => b.length - a.length);

    for (const type of sorted) {
      const regex = new RegExp(
        `\\b${this.escapeRegex(type).replace(/\s+/g, "\\s+")}\\b`,
        "ig",
      );

      cleaned = cleaned.replace(regex, "");
    }

    return cleaned.replace(/\s+/g, " ").trim();
  }

  //======================================================
  // CLEAN TARGET
  //======================================================

  cleanTarget(target = "") {
    if (!target) {
      return "";
    }

    let text = String(target);

    //--------------------------------------------------
    // Remove leading natural-language punctuation
    //--------------------------------------------------

    text = text.replace(/^[,:;.\- ]+/, "");

    text = text.replace(/[,:;.\- ]+$/, "");

    //--------------------------------------------------
    // Normalize whitespace
    //--------------------------------------------------

    text = text.replace(/\s+/g, " ").trim();

    //--------------------------------------------------
    // Optional stop words
    //--------------------------------------------------

    if (this.options.removeStopWords) {
      text = text
        .split(/\s+/)
        .filter((word) => !this.stopWords.has(word.toLowerCase()))
        .join(" ");
    }

    return text.trim();
  }

  //======================================================
  // VALUE EXTRACTION
  //======================================================

  extractValue(text = "", action = "") {
    //--------------------------------------------------
    // Quoted values
    //--------------------------------------------------

    const quoted = [...text.matchAll(this.patterns.quoted)];

    //--------------------------------------------------
    // Type / Fill
    //
    // Fill email with test@gmail.com
    // Type "hello"
    //--------------------------------------------------

    if (action === "type") {
      const email = text.match(this.patterns.email);

      if (email) {
        return email[0];
      }

      if (quoted.length >= 2) {
        return quoted[1][1] || quoted[1][2];
      }

      if (quoted.length === 1) {
        return quoted[0][1] || quoted[0][2];
      }

      const withValue = text.match(/\b(?:with|as)\s+(.+)$/i);

      if (withValue) {
        return this.cleanValue(withValue[1]);
      }
    }

    //--------------------------------------------------
    // Select
    //
    // Select India from Country dropdown
    //
    // value = India
    // target = Country
    //--------------------------------------------------

    if (action === "select") {
      if (quoted.length >= 1) {
        return quoted[0][1] || quoted[0][2];
      }

      const selectMatch = text.match(/\bselect\s+(.+?)\s+from\s+/i);

      if (selectMatch) {
        return this.cleanValue(selectMatch[1]);
      }

      const chooseMatch = text.match(/\b(?:choose|pick)\s+(.+?)\s+from\s+/i);

      if (chooseMatch) {
        return this.cleanValue(chooseMatch[1]);
      }
    }

    //--------------------------------------------------
    // Navigation URL
    //--------------------------------------------------

    const url = this.extractURL(text);

    if (url && action === "navigate") {
      return url;
    }

    //--------------------------------------------------
    // Wait
    //--------------------------------------------------

    if (action === "wait") {
      return this.extractTimeout(text);
    }

    //--------------------------------------------------
    // Number
    //--------------------------------------------------

    if (action === "scroll") {
      const number = text.match(this.patterns.number);

      if (number) {
        return Number(number[0]);
      }
    }

    return null;
  }

  //======================================================
  // REMOVE VALUE PHRASE
  //======================================================

  removeValuePhrase(target = "", originalText = "") {
    if (!target) {
      return "";
    }

    let result = target;

    //--------------------------------------------------
    // Remove select value
    //--------------------------------------------------

    const selectMatch = originalText.match(
      /\b(?:select|choose|pick)\s+(.+?)\s+from\s+/i,
    );

    if (selectMatch) {
      const value = this.cleanValue(selectMatch[1]);

      result = result.replace(value, "");
    }

    //--------------------------------------------------
    // Remove "with value"
    //--------------------------------------------------

    const withMatch = originalText.match(/\bwith\s+(.+)$/i);

    if (withMatch) {
      const value = this.cleanValue(withMatch[1]);

      result = result.replace(value, "");
    }

    return result.trim();
  }

  //======================================================
  // CLEAN VALUE
  //======================================================

  cleanValue(value = "") {
    if (value === null || value === undefined) {
      return null;
    }

    return String(value)
      .replace(/^[\s,:;]+/, "")
      .replace(/[\s,:;]+$/, "")
      .trim();
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

    const elementType = this.extractElementType(lower);

    if (elementType) {
      modifiers.elementType = elementType;
    }

    //--------------------------------------------------
    // Mouse button
    //--------------------------------------------------

    if (this.patterns.rightClick.test(text)) {
      modifiers.mouseButton = "right";
    } else if (this.patterns.doubleClick.test(text)) {
      modifiers.mouseButton = "double";
    } else if (this.patterns.middleClick.test(text)) {
      modifiers.mouseButton = "middle";
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

    if (this.patterns.first.test(text)) {
      modifiers.position = "first";
    } else if (this.patterns.last.test(text)) {
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

    modifiers.visibleOnly = this.patterns.visible.test(text);

    //--------------------------------------------------
    // Exact
    //--------------------------------------------------

    modifiers.exact =
      this.patterns.exact.test(text) || this.hasQuotedText(text);

    //--------------------------------------------------
    // Force
    //--------------------------------------------------

    modifiers.force = this.patterns.force.test(text);

    //--------------------------------------------------
    // Optional
    //--------------------------------------------------

    modifiers.optional = this.patterns.optional.test(text);

    //--------------------------------------------------
    // Timeout
    //--------------------------------------------------

    const timeout = this.extractTimeout(text);

    if (timeout !== null) {
      modifiers.timeout = timeout;
    }

    //--------------------------------------------------
    // Frame
    //--------------------------------------------------

    if (this.patterns.iframe.test(text)) {
      modifiers.context = "iframe";
    }

    //--------------------------------------------------
    // Shadow DOM
    //--------------------------------------------------

    if (this.patterns.shadow.test(text)) {
      modifiers.context = "shadow-dom";
    }

    //--------------------------------------------------
    // Tab
    //--------------------------------------------------

    if (this.patterns.newTab.test(text)) {
      modifiers.tab = "new";
    } else if (this.patterns.currentTab.test(text)) {
      modifiers.tab = "current";
    }

    return modifiers;
  }

  //======================================================
  // ELEMENT TYPE EXTRACTION
  //======================================================

  extractElementType(text = "") {
    const sorted = [...ELEMENT_TYPES].sort((a, b) => b.length - a.length);

    for (const type of sorted) {
      const regex = new RegExp(
        `\\b${this.escapeRegex(type).replace(/\s+/g, "\\s+")}\\b`,
        "i",
      );

      if (regex.test(text)) {
        return type;
      }
    }

    return null;
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

      email: text.match(this.patterns.email)?.[0] || null,

      command: this.extractCommand(text),

      elementType: this.extractElementType(text),
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

    //--------------------------------------------------
    // Remove common trailing punctuation
    //--------------------------------------------------

    url = url.replace(/[.,!?;:]+$/, "");

    //--------------------------------------------------
    // Add protocol
    //--------------------------------------------------

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
  // UPLOAD TARGET
  //======================================================

  extractUploadTarget(text = "") {
    const quoted = [...text.matchAll(this.patterns.quoted)];

    if (quoted.length) {
      return quoted[0][1] || quoted[0][2];
    }

    const fileMatch = text.match(/\b(?:upload|attach)\s+(.+)$/i);

    if (fileMatch) {
      return this.cleanValue(fileMatch[1]);
    }

    return null;
  }

  //======================================================
  // CONFIDENCE
  //======================================================

  computeConfidence(steps = []) {
    if (!Array.isArray(steps) || !steps.length) {
      return 0;
    }

    let total = 0;

    for (const step of steps) {
      total += this.computeStepConfidence(step.action, step.target, step.value);
    }

    return Number((total / steps.length).toFixed(2));
  }

  //======================================================
  // STEP CONFIDENCE
  //
  // This is intent confidence only.
  //
  // It is NOT DOM confidence.
  //======================================================

  computeStepConfidence(action, target, value) {
    if (!action) {
      return 0;
    }

    if (action === "chat") {
      return 0.35;
    }

    let score = 0.5;

    //--------------------------------------------------
    // Known action
    //--------------------------------------------------

    if (ACTIONS[action]) {
      score += 0.2;
    }

    //--------------------------------------------------
    // Target
    //--------------------------------------------------

    if (target) {
      score += 0.15;
    }

    //--------------------------------------------------
    // Value
    //--------------------------------------------------

    if (value !== null && value !== undefined) {
      score += 0.1;
    }

    //--------------------------------------------------
    // Cap
    //--------------------------------------------------

    return Number(Math.min(score, 1).toFixed(2));
  }

  //======================================================
  // VALIDATE STEP
  //======================================================

  validateStep(step) {
    if (!step || typeof step !== "object") {
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
      case "select":
        return Boolean(step.target || step.value);

      case "type":
        return Boolean(step.target || step.value);

      case "press":
        return Boolean(step.keys?.length || step.value || step.target);

      case "wait":
      case "scroll":
      case "reload":
      case "back":
      case "forward":
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

    //--------------------------------------------------
    // Limit steps
    //--------------------------------------------------

    plan.steps = plan.steps
      .slice(0, this.options.maxSteps)
      .filter((step) => this.validateStep(step));

    //--------------------------------------------------
    // Recalculate intent confidence
    //--------------------------------------------------

    plan.confidence = this.computeConfidence(plan.steps);

    //--------------------------------------------------
    // Mode
    //--------------------------------------------------

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

      normalized: "",

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

    //--------------------------------------------------
    // Special keys
    //--------------------------------------------------

    const special = text.match(
      /\b(tab|enter|escape|esc|space|delete|backspace|home|end|arrowup|arrowdown|arrowleft|arrowright)\b/i,
    );

    if (special) {
      let key = special[1];

      if (key.toLowerCase() === "esc") {
        key = "Escape";
      }

      keys.push(key);
    }

    return [...new Set(keys)];
  }

  //======================================================
  // SCROLL DIRECTION
  //======================================================

  extractScrollDirection(text = "") {
    const lower = text.toLowerCase();

    if (/\bup\b/.test(lower)) {
      return "up";
    }

    if (/\bdown\b/.test(lower)) {
      return "down";
    }

    if (/\bleft\b/.test(lower)) {
      return "left";
    }

    if (/\bright\b/.test(lower)) {
      return "right";
    }

    return "down";
  }

  //======================================================
  // QUOTED TEXT
  //======================================================

  hasQuotedText(text = "") {
    this.patterns.quoted.lastIndex = 0;

    const result = this.patterns.quoted.test(text);

    this.patterns.quoted.lastIndex = 0;

    return result;
  }

  //======================================================
  // ESCAPE REGEX
  //======================================================

  escapeRegex(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
