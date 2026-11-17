/**
 * ==========================================================
 *
 * backend/planner/entity-parser.js
 *
 * Ultra Intelligent Entity Parser for Jarvis Browser AI
 *
 * ==========================================================
 *
 * PIPELINE
 *
 * User Input
 *      │
 *      ▼
 * Normalizer
 *      │
 *      ▼
 * IntentParser
 *      │
 *      ▼
 * ActionParser
 *      │
 *      ▼
 * EntityParser
 *      │
 *      ├── URL
 *      ├── Email
 *      ├── Command
 *      ├── File Path
 *      ├── Number
 *      ├── Date
 *      ├── Time
 *      ├── Quoted Text
 *      ├── Browser Entity
 *      ├── Keyboard Shortcut
 *      ├── CSS Selector
 *      └── Custom Entities
 *      │
 *      ▼
 * ScoringEngine
 *      │
 *      ▼
 * Planner / LLM (fallback only)
 *      │
 *      ▼
 * Resolver
 *
 * ==========================================================
 *
 * RESPONSIBILITIES
 * ==========================================================
 *
 * ✔ Fast deterministic entity extraction
 * ✔ URL extraction
 * ✔ Email extraction
 * ✔ Command extraction
 * ✔ File path extraction
 * ✔ Number extraction
 * ✔ Date extraction
 * ✔ Time extraction
 * ✔ Quoted value extraction
 * ✔ Browser-specific entity extraction
 * ✔ Keyboard shortcut extraction
 * ✔ CSS selector extraction
 * ✔ Custom pattern support
 * ✔ Entity deduplication
 * ✔ Entity metadata
 * ✔ Safe parsing
 * ✔ Entity positions
 * ✔ Entity normalization
 *
 * IMPORTANT
 * ==========================================================
 *
 * ❌ NEVER performs fuzzy matching
 * ❌ NEVER performs spelling correction
 * ❌ NEVER guesses target elements
 * ❌ NEVER calls an LLM
 * ❌ NEVER resolves DOM elements
 *
 * Spelling correction and fuzzy matching belong ONLY
 * to ScoringEngine.
 *
 * ==========================================================
 */

class EntityParser {
  constructor(options = {}) {
    //======================================================
    // CONFIGURATION
    //======================================================

    this.options = {
      debug: false,

      enableUrls: true,

      enableEmails: true,

      enableDates: true,

      enableNumbers: true,

      enableCommands: true,

      enableFilePaths: true,

      enableQuoted: true,

      enableTimes: true,

      enableBrowserEntities: true,

      enableShortcuts: true,

      enableCssSelectors: true,

      enableCustomPatterns: true,

      deduplicate: true,

      includePositions: true,

      includeMetadata: true,

      ...options,
    };

    this.debug = this.options.debug;

    //======================================================
    // REGEX LIBRARY
    //======================================================

    this.patterns = {
      //----------------------------------------------------
      // URL
      //----------------------------------------------------

      url: /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi,

      //----------------------------------------------------
      // EMAIL
      //----------------------------------------------------

      email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,

      //----------------------------------------------------
      // SLASH COMMAND
      //----------------------------------------------------

      command: /(?:^|\s)(\/[a-zA-Z0-9_-]+)\b/g,

      //----------------------------------------------------
      // Windows / Unix file path
      //----------------------------------------------------

      filePath: /(?:[a-zA-Z]:\\[^<>:"|?*\r\n]+|\/(?:[^\/\s]+\/)+[^\/\s]+)/g,

      //----------------------------------------------------
      // Number
      //----------------------------------------------------

      number: /\b\d+(?:\.\d+)?\b/g,

      //----------------------------------------------------
      // Integer
      //----------------------------------------------------

      integer: /\b\d+\b/g,

      //----------------------------------------------------
      // ISO Date
      //----------------------------------------------------

      dateISO: /\b\d{4}-\d{2}-\d{2}\b/g,

      //----------------------------------------------------
      // Human Date
      //----------------------------------------------------

      dateHuman: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g,

      //----------------------------------------------------
      // Month name date
      //----------------------------------------------------

      dateMonth:
        /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/gi,

      //----------------------------------------------------
      // Relative date expressions
      //----------------------------------------------------

      relativeDate:
        /\b(?:today|tomorrow|yesterday|tonight|this\s+(?:morning|afternoon|evening|week|month)|next\s+(?:day|week|month)|last\s+(?:day|week|month))\b/gi,

      //----------------------------------------------------
      // Time
      //----------------------------------------------------

      time: /\b(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/gi,

      //----------------------------------------------------
      // Quoted values
      //
      // Supports:
      // "hello"
      // 'hello'
      // `hello`
      //----------------------------------------------------

      quoted: /(["'`])((?:\\.|(?!\1).)*?)\1/g,

      //----------------------------------------------------
      // Ordinal
      //----------------------------------------------------

      ordinal: /\b\d+(?:st|nd|rd|th)\b/gi,

      //----------------------------------------------------
      // Percentage
      //----------------------------------------------------

      percentage: /\b\d+(?:\.\d+)?\s*%/g,

      //----------------------------------------------------
      // Currency
      //----------------------------------------------------

      currency: /(?:₹|\$|€|£)\s?\d+(?:,\d{3})*(?:\.\d+)?/g,

      //----------------------------------------------------
      // Browser tab
      //----------------------------------------------------

      tab: /\b(?:tab|tabs)(?:\s+(?:number\s+)?\d+)?\b/gi,

      //----------------------------------------------------
      // Browser window
      //----------------------------------------------------

      window: /\b(?:window|windows)(?:\s+(?:number\s+)?\d+)?\b/gi,

      //----------------------------------------------------
      // Keyboard shortcut
      //----------------------------------------------------

      shortcut:
        /\b(?:(?:ctrl|control|shift|alt|meta|cmd|command)\s*\+\s*)+[a-z0-9]+\b/gi,

      //----------------------------------------------------
      // CSS selector
      //----------------------------------------------------

      cssSelector: /(?:#[a-zA-Z_][\w-]*|\.[a-zA-Z_][\w-]*)(?:\[[^\]]+\])?/g,
    };

    //======================================================
    // ENTITY TYPE MAP
    //======================================================

    this.entityTypes = [
      "url",
      "email",
      "command",
      "filePath",
      "number",
      "integer",
      "date",
      "time",
      "quoted",
      "ordinal",
      "percentage",
      "currency",
      "shortcut",
      "cssSelector",
      "tab",
      "window",
      "custom",
    ];

    //======================================================
    // INTERNAL STATE
    //======================================================

    this._currentResult = null;
  }

  //========================================================
  // LOGGING
  //========================================================

  log(...args) {
    if (this.debug) {
      console.log("[EntityParser]", ...args);
    }
  }

  warn(...args) {
    if (this.debug) {
      console.warn("[EntityParser]", ...args);
    }
  }

  //========================================================
  // MAIN PARSER
  //========================================================

  parse(text = "") {
    //======================================================
    // VALIDATE INPUT
    //======================================================

    if (text === null || text === undefined || typeof text !== "string") {
      return this._emptyResult();
    }

    const raw = text;

    //======================================================
    // NORMALIZE INPUT
    //======================================================

    const normalized = this.normalize(text);

    if (!normalized) {
      return this._emptyResult();
    }

    this.log("Parsing:", normalized);

    //======================================================
    // BASE RESULT
    //======================================================

    const result = {
      raw,

      normalized,

      intent: this._detectIntent(normalized),

      entities: [],

      urls: [],

      emails: [],

      commands: [],

      numbers: [],

      dates: [],

      times: [],

      filePaths: [],

      quoted: [],

      ordinals: [],

      percentages: [],

      currencies: [],

      shortcuts: [],

      cssSelectors: [],

      browser: {
        tabs: [],

        windows: [],
      },

      custom: [],

      entityCount: 0,

      hasEntities: false,
    };

    //======================================================
    // SET CURRENT RESULT
    //
    // Required for browser/custom entity helpers.
    //======================================================

    this._currentResult = result;

    try {
      //====================================================
      // URL
      //====================================================

      if (this.options.enableUrls) {
        result.urls = this._match(this.patterns.url, normalized);

        this._addEntities(result, "url", result.urls, "regex");
      }

      //====================================================
      // EMAIL
      //====================================================

      if (this.options.enableEmails) {
        result.emails = this._match(this.patterns.email, normalized);

        this._addEntities(result, "email", result.emails, "regex");
      }

      //====================================================
      // COMMAND
      //====================================================

      if (this.options.enableCommands) {
        result.commands = this._match(this.patterns.command, normalized).map(
          (value) => value.replace(/^\s+/, ""),
        );

        this._addEntities(result, "command", result.commands, "regex");
      }

      //====================================================
      // NUMBERS
      //
      // Keep raw values here.
      // ScoringEngine / Planner can convert when required.
      //====================================================

      if (this.options.enableNumbers) {
        result.numbers = this._match(this.patterns.number, normalized);

        this._addEntities(result, "number", result.numbers, "regex");
      }

      //====================================================
      // DATES
      //====================================================

      if (this.options.enableDates) {
        const isoDates = this._match(this.patterns.dateISO, normalized);

        const humanDates = this._match(this.patterns.dateHuman, normalized);

        const monthDates = this._match(this.patterns.dateMonth, normalized);

        const relativeDates = this._match(
          this.patterns.relativeDate,
          normalized,
        );

        result.dates = this._unique([
          ...isoDates,
          ...humanDates,
          ...monthDates,
          ...relativeDates,
        ]);

        this._addEntities(result, "date", result.dates, "regex");
      }

      //====================================================
      // TIME
      //====================================================

      if (this.options.enableTimes) {
        result.times = this._match(this.patterns.time, normalized);

        this._addEntities(result, "time", result.times, "regex");
      }

      //====================================================
      // FILE PATHS
      //====================================================

      if (this.options.enableFilePaths) {
        result.filePaths = this._match(this.patterns.filePath, normalized);

        this._addEntities(result, "filePath", result.filePaths, "regex");
      }

      //====================================================
      // QUOTED VALUES
      //====================================================

      if (this.options.enableQuoted) {
        result.quoted = this.extractQuoted(normalized);

        this._addEntities(result, "quoted", result.quoted, "quoted");
      }

      //====================================================
      // ORDINALS
      //====================================================

      result.ordinals = this._match(this.patterns.ordinal, normalized);

      this._addEntities(result, "ordinal", result.ordinals, "regex");

      //====================================================
      // PERCENTAGES
      //====================================================

      result.percentages = this._match(this.patterns.percentage, normalized);

      this._addEntities(result, "percentage", result.percentages, "regex");

      //====================================================
      // CURRENCIES
      //====================================================

      result.currencies = this._match(this.patterns.currency, normalized);

      this._addEntities(result, "currency", result.currencies, "regex");

      //====================================================
      // KEYBOARD SHORTCUTS
      //====================================================

      if (this.options.enableShortcuts) {
        result.shortcuts = this._match(this.patterns.shortcut, normalized);

        this._addEntities(result, "shortcut", result.shortcuts, "regex");
      }

      //====================================================
      // CSS SELECTORS
      //====================================================

      if (this.options.enableCssSelectors) {
        result.cssSelectors = this._match(
          this.patterns.cssSelector,
          normalized,
        );

        this._addEntities(result, "cssSelector", result.cssSelectors, "regex");
      }

      //====================================================
      // BROWSER ENTITIES
      //====================================================

      if (this.options.enableBrowserEntities) {
        result.browser = this._extractBrowserEntities(normalized, result);
      }

      //====================================================
      // CUSTOM PATTERNS
      //====================================================

      if (
        this.options.enableCustomPatterns &&
        Array.isArray(this.options.customPatterns) &&
        this.options.customPatterns.length > 0
      ) {
        result.custom = this._parseCustom(normalized, result);
      }

      //====================================================
      // DEDUPLICATION
      //====================================================

      if (this.options.deduplicate) {
        this._deduplicateResult(result);
      }

      //====================================================
      // ENTITY SUMMARY
      //====================================================

      result.entities = this._uniqueEntities(result.entities);

      result.entityCount = result.entities.length;

      result.hasEntities = result.entityCount > 0;

      //====================================================
      // SORT BY POSITION
      //====================================================

      if (this.options.includePositions) {
        result.entities.sort(
          (a, b) => Number(a.start ?? 0) - Number(b.start ?? 0),
        );
      }

      return result;
    } finally {
      //====================================================
      // CLEAR INTERNAL STATE
      //====================================================

      this._currentResult = null;
    }
  }

  //========================================================
  // NORMALIZE
  //========================================================

  normalize(text) {
    return String(text).normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  //========================================================
  // INTENT DETECTION
  //
  // Lightweight only.
  //
  // Actual intent extraction belongs to IntentParser.
  //========================================================

  _detectIntent(text) {
    const lower = text.toLowerCase();

    if (!lower) {
      return "unknown";
    }

    if (/^\/[a-z0-9_-]+/i.test(lower)) {
      return "command";
    }

    if (/\b(open|visit|goto|go to|navigate|launch)\b/i.test(lower)) {
      return "navigation";
    }

    if (/\b(search|google|lookup|look up)\b/i.test(lower)) {
      return "search";
    }

    if (/\b(click|tap|press|hit)\b/i.test(lower)) {
      return "ui_click";
    }

    if (/\b(scroll|swipe)\b/i.test(lower)) {
      return "ui_scroll";
    }

    if (/\b(type|enter|fill|write|input)\b/i.test(lower)) {
      return "ui_type";
    }

    if (/\b(download|save)\b/i.test(lower)) {
      return "download";
    }

    if (/\b(upload|attach|browse)\b/i.test(lower)) {
      return "upload";
    }

    if (/\b(login|log in|sign in|signin)\b/i.test(lower)) {
      return "auth";
    }

    if (/\b(error|failed|failure|exception)\b/i.test(lower)) {
      return "error";
    }

    return "general";
  }

  //========================================================
  // QUOTED EXTRACTION
  //========================================================

  extractQuoted(text = "") {
    const values = [];

    const regex = this.patterns.quoted;

    regex.lastIndex = 0;

    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match[2] !== undefined && match[2] !== "") {
        values.push(match[2]);
      }
    }

    regex.lastIndex = 0;

    return this._unique(values);
  }

  //========================================================
  // BROWSER ENTITY EXTRACTION
  //========================================================

  _extractBrowserEntities(text, result = this._currentResult) {
    const browser = {
      tabs: [],

      windows: [],
    };

    if (!text) {
      return browser;
    }

    //======================================================
    // TAB REFERENCES
    //======================================================

    const tabMatches = this._match(this.patterns.tab, text);

    if (tabMatches.length) {
      browser.tabs = this._unique(tabMatches);

      this._addEntities(result, "tab", browser.tabs, "browser");
    }

    //======================================================
    // WINDOW REFERENCES
    //======================================================

    const windowMatches = this._match(this.patterns.window, text);

    if (windowMatches.length) {
      browser.windows = this._unique(windowMatches);

      this._addEntities(result, "window", browser.windows, "browser");
    }

    return browser;
  }

  //========================================================
  // ENTITY ADDER
  //========================================================

  _addEntities(result, type, values, source = "regex") {
    if (!result || !Array.isArray(values)) {
      return;
    }

    for (const value of values) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      const stringValue = String(value);

      const entity = this._createEntity(
        result.raw || result.normalized || "",
        type,
        stringValue,
        source,
      );

      result.entities.push(entity);
    }
  }

  //========================================================
  // ENTITY FACTORY
  //========================================================

  _createEntity(text, type, value, source = "regex") {
    const entity = {
      type,

      value,

      normalized: this._normalizeEntityValue(value),

      source,

      confidence: 1,
    };

    //======================================================
    // POSITION METADATA
    //======================================================

    if (this.options.includePositions) {
      const position = this._findEntityPosition(text, value);

      if (position) {
        entity.start = position.start;

        entity.end = position.end;
      }
    }

    //======================================================
    // TYPE METADATA
    //======================================================

    if (this.options.includeMetadata) {
      entity.metadata = this._buildMetadata(type, value);
    }

    return entity;
  }

  //========================================================
  // ENTITY VALUE NORMALIZATION
  //========================================================

  _normalizeEntityValue(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value).trim().toLowerCase();
  }

  //========================================================
  // ENTITY METADATA
  //========================================================

  _buildMetadata(type, value) {
    const metadata = {};

    switch (type) {
      case "number":
        metadata.numericValue = Number(value);

        metadata.isInteger = Number.isInteger(Number(value));

        break;

      case "percentage":
        metadata.numericValue = Number(String(value).replace("%", "").trim());

        break;

      case "currency":
        metadata.symbol = String(value).match(/₹|\$|€|£/)?.[0] || "";

        break;

      case "url":
        metadata.protocol = /^https:\/\//i.test(value)
          ? "https"
          : /^http:\/\//i.test(value)
            ? "http"
            : "unknown";

        break;

      case "command":
        metadata.command = String(value).replace(/^\//, "");

        break;

      case "shortcut":
        metadata.keys = String(value)
          .split("+")
          .map((key) => key.trim())
          .filter(Boolean);

        break;

      case "tab":
        metadata.index = this._extractIndex(value);

        break;

      case "window":
        metadata.index = this._extractIndex(value);

        break;

      default:
        break;
    }

    return metadata;
  }

  //========================================================
  // EXTRACT TAB / WINDOW INDEX
  //========================================================

  _extractIndex(value) {
    const match = String(value).match(/\b(\d+)\b/);

    return match ? Number(match[1]) : null;
  }

  //========================================================
  // FIND ENTITY POSITION
  //========================================================

  _findEntityPosition(text, value) {
    if (!text || !value) {
      return null;
    }

    const index = text.indexOf(value);

    if (index === -1) {
      return null;
    }

    return {
      start: index,

      end: index + String(value).length,
    };
  }

  //========================================================
  // CUSTOM PATTERNS
  //========================================================

  _parseCustom(text, result) {
    const results = [];

    for (const pattern of this.options.customPatterns) {
      if (!pattern || typeof pattern !== "object" || !pattern.regex) {
        continue;
      }

      try {
        const regex = new RegExp(pattern.regex, pattern.flags || "gi");

        const matches = this._match(regex, text);

        if (!matches.length) {
          continue;
        }

        const name = pattern.name || "custom";

        const item = {
          name,

          matches,
        };

        results.push(item);

        this._addEntities(result, name, matches, "custom");
      } catch (error) {
        this.warn("Invalid custom pattern:", error.message);
      }
    }

    return results;
  }

  //========================================================
  // MATCH HELPER
  //========================================================

  _match(regex, text) {
    if (!(regex instanceof RegExp)) {
      return [];
    }

    regex.lastIndex = 0;

    const matches = text.match(regex) || [];

    regex.lastIndex = 0;

    return matches.map((value) => String(value).trim()).filter(Boolean);
  }

  //========================================================
  // UNIQUE ARRAY
  //========================================================

  _unique(values = []) {
    return [
      ...new Set(
        values.filter(
          (value) => value !== null && value !== undefined && value !== "",
        ),
      ),
    ];
  }

  //========================================================
  // UNIQUE ENTITY OBJECTS
  //========================================================

  _uniqueEntities(entities = []) {
    const seen = new Set();

    const result = [];

    for (const entity of entities) {
      if (!entity) {
        continue;
      }

      const key = `${entity.type}::${String(entity.value).toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      result.push(entity);
    }

    return result;
  }

  //========================================================
  // DEDUPLICATE RESULT
  //========================================================

  _deduplicateResult(result) {
    result.urls = this._unique(result.urls);

    result.emails = this._unique(result.emails);

    result.commands = this._unique(result.commands);

    result.numbers = this._unique(result.numbers);

    result.dates = this._unique(result.dates);

    result.times = this._unique(result.times);

    result.filePaths = this._unique(result.filePaths);

    result.quoted = this._unique(result.quoted);

    result.ordinals = this._unique(result.ordinals);

    result.percentages = this._unique(result.percentages);

    result.currencies = this._unique(result.currencies);

    result.shortcuts = this._unique(result.shortcuts);

    result.cssSelectors = this._unique(result.cssSelectors);

    result.browser.tabs = this._unique(result.browser.tabs);

    result.browser.windows = this._unique(result.browser.windows);

    result.entities = this._uniqueEntities(result.entities);
  }

  //========================================================
  // EMPTY RESULT
  //========================================================

  _emptyResult() {
    return {
      raw: "",

      normalized: "",

      intent: "unknown",

      entities: [],

      urls: [],

      emails: [],

      commands: [],

      numbers: [],

      dates: [],

      times: [],

      filePaths: [],

      quoted: [],

      ordinals: [],

      percentages: [],

      currencies: [],

      shortcuts: [],

      cssSelectors: [],

      browser: {
        tabs: [],

        windows: [],
      },

      custom: [],

      entityCount: 0,

      hasEntities: false,
    };
  }

  //========================================================
  // STATISTICS
  //========================================================

  stats() {
    return {
      entityTypes: [...this.entityTypes],

      entityTypeCount: this.entityTypes.length,

      urls: this.options.enableUrls,

      emails: this.options.enableEmails,

      dates: this.options.enableDates,

      numbers: this.options.enableNumbers,

      commands: this.options.enableCommands,

      filePaths: this.options.enableFilePaths,

      quoted: this.options.enableQuoted,

      times: this.options.enableTimes,

      browserEntities: this.options.enableBrowserEntities,

      shortcuts: this.options.enableShortcuts,

      cssSelectors: this.options.enableCssSelectors,

      customPatterns: this.options.enableCustomPatterns,

      deduplicate: this.options.deduplicate,

      positions: this.options.includePositions,

      metadata: this.options.includeMetadata,

      fuzzyMatching: false,

      spellingCorrection: false,

      targetGuessing: false,

      domResolution: false,

      llm: false,
    };
  }
}

//==========================================================
// EXPORT
//==========================================================
//
// ES Module project
//==========================================================

export default EntityParser;
