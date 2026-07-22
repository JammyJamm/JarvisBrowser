/**
 * backend/planner/normalizer.js
 *
 * Ultra Intelligent Planner Normalizer
 *
 * Responsibilities
 * ----------------
 * ✔ Normalize planner / LLM / regex output
 * ✔ Normalize action names
 * ✔ Normalize payload fields
 * ✔ Normalize confidence scores
 * ✔ Normalize steps
 * ✔ Normalize aliases
 * ✔ Repair common malformed JSON
 * ✔ Extract JSON from LLM responses
 * ✔ Preserve unknown fields safely
 * ✔ Support ES Modules
 *
 * Architecture
 *
 * User Command
 *      │
 *      ▼
 * Intent Parser
 *      │
 *      ▼
 * Normalizer
 *      │
 *      ├── action
 *      ├── target
 *      ├── value
 *      ├── selector
 *      ├── confidence
 *      │
 *      ▼
 * Scoring Engine
 *      │
 *      ▼
 * Planner / ToolMap
 *
 * IMPORTANT
 * ---------
 * ❌ No fuzzy matching
 * ❌ No DOM scoring
 * ❌ No browser execution
 * ❌ No selector ranking
 *
 * Fuzzy matching belongs to:
 *     scoring-engine.js
 *
 * Browser execution belongs to:
 *     resolver.js
 *
 *==========================================================
 */

class Normalizer {
  constructor(options = {}) {
    this.options = {
      strict: false,

      defaultConfidence: 0.5,

      maxConfidence: 1,

      minConfidence: 0,

      maxSteps: 100,

      debug: false,

      ...options,
    };

    this.stats = {
      normalized: 0,

      arrays: 0,

      steps: 0,

      repairedJson: 0,

      extractedJson: 0,

      invalid: 0,

      errors: 0,
    };
  }

  //========================================================
  // LOGGING
  //========================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[Normalizer]", ...args);
    }
  }

  warn(...args) {
    console.warn("[Normalizer]", ...args);
  }

  error(...args) {
    console.error("[Normalizer]", ...args);
  }

  //========================================================
  // PUBLIC ENTRY
  //========================================================

  normalize(input) {
    try {
      if (input === null || input === undefined || input === "") {
        this.stats.invalid++;

        return this._empty("empty_input");
      }

      //----------------------------------------------------
      // Parse input
      //----------------------------------------------------

      const data = typeof input === "string" ? this._safeParse(input) : input;

      if (data === null || data === undefined) {
        this.stats.invalid++;

        return this._empty("parse_failed");
      }

      //----------------------------------------------------
      // Array / steps
      //----------------------------------------------------

      if (Array.isArray(data)) {
        this.stats.arrays++;

        const steps = data
          .slice(0, this.options.maxSteps)
          .map((item) => this._normalizeItem(item));

        this.stats.steps += steps.length;

        return {
          type: "plan",

          steps,

          confidence: this._calculatePlanConfidence(steps),

          payload: {
            steps,
          },
        };
      }

      //----------------------------------------------------
      // Explicit steps
      //----------------------------------------------------

      if (Array.isArray(data.steps)) {
        const steps = data.steps
          .slice(0, this.options.maxSteps)
          .map((item) => this._normalizeItem(item));

        this.stats.steps += steps.length;

        return {
          type: "plan",

          steps,

          confidence: this._normalizeConfidence(
            data.confidence ??
              data.score ??
              this._calculatePlanConfidence(steps),
          ),

          payload: {
            ...this._normalizePayload(data),

            steps,
          },
        };
      }

      //----------------------------------------------------
      // Single item
      //----------------------------------------------------

      this.stats.normalized++;

      return this._normalizeItem(data);
    } catch (err) {
      this.stats.errors++;

      this.error("Normalization failed:", err.message);

      return this._empty("exception", err.message);
    }
  }

  //========================================================
  // NORMALIZE SINGLE ITEM
  //========================================================

  _normalizeItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      this.stats.invalid++;

      return this._empty("invalid_item");
    }

    //------------------------------------------------------
    // Detect action
    //------------------------------------------------------

    const rawType =
      item.type ||
      item.action ||
      item.intent ||
      item.tool ||
      item.operation ||
      "";

    const type = this._mapType(this._normalizeActionName(rawType));

    //------------------------------------------------------
    // Base result
    //------------------------------------------------------

    const normalized = {
      type,

      payload: this._normalizePayload(item),

      confidence: this._normalizeConfidence(
        item.confidence ?? item.score ?? item.probability,
      ),
    };

    //------------------------------------------------------
    // Preserve optional metadata
    //------------------------------------------------------

    if (item.id !== undefined) {
      normalized.id = item.id;
    }

    if (item.step !== undefined) {
      normalized.step = item.step;
    }

    if (item.reason !== undefined) {
      normalized.reason = item.reason;
    }

    if (item.explanation !== undefined) {
      normalized.explanation = item.explanation;
    }

    if (item.requiresPlanner !== undefined) {
      normalized.requiresPlanner = Boolean(item.requiresPlanner);
    }

    if (item.requiresConfirmation !== undefined) {
      normalized.requiresConfirmation = Boolean(item.requiresConfirmation);
    }

    return normalized;
  }

  //========================================================
  // ACTION NORMALIZATION
  //========================================================

  _normalizeActionName(action) {
    if (action === null || action === undefined) {
      return "";
    }

    return String(action)
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  }

  //========================================================
  // TYPE MAPPING
  //========================================================

  _mapType(type) {
    const map = {
      //----------------------------------------------------
      // Navigation
      //----------------------------------------------------

      open: "navigate",

      go: "navigate",

      goto: "navigate",

      go_to: "navigate",

      navigate: "navigate",

      navigation: "navigate",

      visit: "navigate",

      browse: "navigate",

      open_url: "navigate",

      url: "navigate",

      //----------------------------------------------------
      // Click
      //----------------------------------------------------

      click: "click",

      press: "click",

      tap: "click",

      select_button: "click",

      click_button: "click",

      click_link: "click",

      //----------------------------------------------------
      // Typing
      //----------------------------------------------------

      type: "type",

      input: "type",

      write: "type",

      enter: "type",

      fill: "type",

      fill_input: "type",

      type_text: "type",

      //----------------------------------------------------
      // Select
      //----------------------------------------------------

      select: "select",

      select_option: "select",

      choose: "select",

      dropdown: "select",

      //----------------------------------------------------
      // Checkbox
      //----------------------------------------------------

      checkbox: "checkbox",

      check: "checkbox",

      uncheck: "uncheck",

      toggle: "checkbox",

      //----------------------------------------------------
      // Hover
      //----------------------------------------------------

      hover: "hover",

      mouseover: "hover",

      //----------------------------------------------------
      // Keyboard
      //----------------------------------------------------

      keypress: "press",

      key_press: "press",

      press_key: "press",

      keyboard: "press",

      shortcut: "shortcut",

      //----------------------------------------------------
      // Wait
      //----------------------------------------------------

      wait: "wait",

      delay: "wait",

      sleep: "wait",

      pause: "wait",

      //----------------------------------------------------
      // Scroll
      //----------------------------------------------------

      scroll: "scroll",

      scroll_down: "scroll",

      scroll_up: "scroll",

      //----------------------------------------------------
      // Extract
      //----------------------------------------------------

      extract: "extract",

      scrape: "extract",

      get: "extract",

      read: "extract",

      inspect: "extract",

      find: "extract",

      //----------------------------------------------------
      // Screenshot
      //----------------------------------------------------

      screenshot: "screenshot",

      capture: "screenshot",

      //----------------------------------------------------
      // Browser
      //----------------------------------------------------

      reload: "reload",

      refresh: "reload",

      back: "back",

      forward: "forward",

      //----------------------------------------------------
      // Chat
      //----------------------------------------------------

      chat: "chat",

      message: "chat",

      say: "chat",

      respond: "chat",

      conversation: "chat",

      //----------------------------------------------------
      // System
      //----------------------------------------------------

      unknown: "unknown",

      error: "error",
    };

    return map[type] || type || "unknown";
  }

  //========================================================
  // PAYLOAD NORMALIZATION
  //========================================================

  _normalizePayload(item) {
    if (!item || typeof item !== "object") {
      return {};
    }

    //------------------------------------------------------
    // Merge possible payload containers
    //------------------------------------------------------

    const payload = {
      ...(item.data && typeof item.data === "object" ? item.data : {}),

      ...(item.payload && typeof item.payload === "object" ? item.payload : {}),
    };

    const normalized = {};

    //------------------------------------------------------
    // URL
    //------------------------------------------------------

    const url = payload.url ?? item.url;

    if (url !== undefined && url !== null) {
      normalized.url = this._cleanUrl(url);
    }

    //------------------------------------------------------
    // Target
    //------------------------------------------------------

    const target =
      payload.target ?? item.target ?? payload.element ?? item.element;

    if (target !== undefined && target !== null) {
      normalized.target = this._cleanText(target);
    }

    //------------------------------------------------------
    // Selector
    //------------------------------------------------------

    const selector = payload.selector ?? item.selector;

    if (selector !== undefined && selector !== null) {
      normalized.selector = this._cleanSelector(selector);
    }

    //------------------------------------------------------
    // Text
    //------------------------------------------------------

    const text = payload.text ?? item.text;

    if (text !== undefined && text !== null) {
      normalized.text = String(text);
    }

    //------------------------------------------------------
    // Value
    //------------------------------------------------------

    const value = payload.value ?? item.value;

    if (value !== undefined && value !== null) {
      normalized.value = value;
    }

    //------------------------------------------------------
    // Input value
    //------------------------------------------------------

    const inputValue =
      payload.inputValue ??
      payload.input_value ??
      item.inputValue ??
      item.input_value;

    if (inputValue !== undefined && inputValue !== null) {
      normalized.inputValue = String(inputValue);
    }

    //------------------------------------------------------
    // Label
    //------------------------------------------------------

    const label = payload.label ?? item.label;

    if (label !== undefined && label !== null) {
      normalized.label = this._cleanText(label);
    }

    //------------------------------------------------------
    // Name
    //------------------------------------------------------

    const name = payload.name ?? item.name;

    if (name !== undefined && name !== null) {
      normalized.name = this._cleanText(name);
    }

    //------------------------------------------------------
    // Role
    //------------------------------------------------------

    const role = payload.role ?? item.role;

    if (role !== undefined && role !== null) {
      normalized.role = this._cleanText(role);
    }

    //------------------------------------------------------
    // Wait time
    //------------------------------------------------------

    const milliseconds =
      payload.ms ??
      payload.milliseconds ??
      payload.time ??
      payload.timeout ??
      item.ms ??
      item.milliseconds ??
      item.time ??
      item.timeout;

    if (milliseconds !== undefined && milliseconds !== null) {
      normalized.ms = this._toNumber(milliseconds, 1000);
    }

    //------------------------------------------------------
    // Key
    //------------------------------------------------------

    const key = payload.key ?? item.key;

    if (key !== undefined && key !== null) {
      normalized.key = String(key).trim();
    }

    //------------------------------------------------------
    // Direction
    //------------------------------------------------------

    const direction = payload.direction ?? item.direction;

    if (direction !== undefined && direction !== null) {
      normalized.direction = String(direction).trim().toLowerCase();
    }

    //------------------------------------------------------
    // Amount / distance
    //------------------------------------------------------

    const amount =
      payload.amount ?? payload.distance ?? item.amount ?? item.distance;

    if (amount !== undefined && amount !== null) {
      normalized.amount = this._toNumber(amount, 0);
    }

    //------------------------------------------------------
    // Frame
    //------------------------------------------------------

    const frame = payload.frame ?? item.frame;

    if (frame !== undefined && frame !== null) {
      normalized.frame = this._normalizeFrame(frame);
    }

    //------------------------------------------------------
    // Tab
    //------------------------------------------------------

    const tab = payload.tab ?? payload.tabIndex ?? item.tab ?? item.tabIndex;

    if (tab !== undefined && tab !== null) {
      normalized.tab = this._toNumber(tab, 0);
    }

    //------------------------------------------------------
    // Index
    //------------------------------------------------------

    const index = payload.index ?? item.index;

    if (index !== undefined && index !== null) {
      normalized.index = this._toNumber(index, 0);
    }

    //------------------------------------------------------
    // Options
    //------------------------------------------------------

    if (payload.options && typeof payload.options === "object") {
      normalized.options = payload.options;
    }

    //------------------------------------------------------
    // Preserve raw payload
    //
    // This is useful for future tools while keeping
    // normalized fields at the top level.
    //------------------------------------------------------

    normalized.raw = {
      ...payload,
    };

    return normalized;
  }

  //========================================================
  // FRAME NORMALIZATION
  //========================================================

  _normalizeFrame(frame) {
    if (typeof frame === "string") {
      return {
        target: frame.trim(),
      };
    }

    if (typeof frame === "number") {
      return {
        index: frame,
      };
    }

    if (frame && typeof frame === "object") {
      return {
        name: frame.name || undefined,

        url: frame.url || undefined,

        index:
          frame.index !== undefined
            ? this._toNumber(frame.index, 0)
            : undefined,

        target: frame.target || undefined,
      };
    }

    return {};
  }

  //========================================================
  // SAFE JSON PARSER
  //========================================================

  _safeParse(input) {
    if (typeof input !== "string") {
      return input;
    }

    let str = input.trim();

    if (!str) {
      return null;
    }

    //------------------------------------------------------
    // Remove markdown code fences
    //------------------------------------------------------

    str = str
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    //------------------------------------------------------
    // Direct JSON parse
    //------------------------------------------------------

    try {
      return JSON.parse(str);
    } catch {}

    //------------------------------------------------------
    // Extract JSON object
    //------------------------------------------------------

    const objectStart = str.indexOf("{");

    const objectEnd = str.lastIndexOf("}");

    if (objectStart !== -1 && objectEnd > objectStart) {
      const candidate = str.substring(objectStart, objectEnd + 1);

      try {
        this.stats.extractedJson++;

        return JSON.parse(candidate);
      } catch {}

      //----------------------------------------------------
      // Attempt repair
      //----------------------------------------------------

      try {
        const repaired = this._repairJson(candidate);

        const parsed = JSON.parse(repaired);

        this.stats.repairedJson++;

        return parsed;
      } catch {}
    }

    //------------------------------------------------------
    // Extract JSON array
    //------------------------------------------------------

    const arrayStart = str.indexOf("[");

    const arrayEnd = str.lastIndexOf("]");

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      const candidate = str.substring(arrayStart, arrayEnd + 1);

      try {
        this.stats.extractedJson++;

        return JSON.parse(candidate);
      } catch {}

      try {
        const repaired = this._repairJson(candidate);

        const parsed = JSON.parse(repaired);

        this.stats.repairedJson++;

        return parsed;
      } catch {}
    }

    return null;
  }

  //========================================================
  // JSON REPAIR
  //========================================================

  _repairJson(str) {
    if (typeof str !== "string") {
      return str;
    }

    let result = str.trim();

    //------------------------------------------------------
    // Remove markdown fences
    //------------------------------------------------------

    result = result
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    //------------------------------------------------------
    // Convert smart quotes
    //------------------------------------------------------

    result = result.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

    //------------------------------------------------------
    // Quote unquoted object keys
    //------------------------------------------------------

    result = result.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');

    //------------------------------------------------------
    // Remove trailing commas
    //------------------------------------------------------

    result = result.replace(/,\s*([}\]])/g, "$1");

    //------------------------------------------------------
    // Convert simple single-quoted strings
    //------------------------------------------------------

    result = result.replace(
      /'([^'\\]*(?:\\.[^'\\]*)*)'/g,
      (_, content) => `"${content.replace(/"/g, '\\"').replace(/\\'/g, "'")}"`,
    );

    //------------------------------------------------------
    // Remove control characters
    //------------------------------------------------------

    result = result.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

    return result;
  }

  //========================================================
  // CONFIDENCE
  //========================================================

  _normalizeConfidence(value) {
    if (value === undefined || value === null || value === "") {
      return this.options.defaultConfidence;
    }

    let number = Number(value);

    if (Number.isNaN(number)) {
      return this.options.defaultConfidence;
    }

    //------------------------------------------------------
    // Handle percentage scores
    //
    // 95 -> 0.95
    //------------------------------------------------------

    if (number > 1 && number <= 100) {
      number = number / 100;
    }

    return Math.max(
      this.options.minConfidence,
      Math.min(this.options.maxConfidence, number),
    );
  }

  //========================================================
  // PLAN CONFIDENCE
  //========================================================

  _calculatePlanConfidence(steps) {
    if (!Array.isArray(steps) || !steps.length) {
      return 0;
    }

    const values = steps.map((step) =>
      this._normalizeConfidence(step.confidence),
    );

    //------------------------------------------------------
    // Conservative confidence:
    // weakest step controls the plan.
    //------------------------------------------------------

    return Math.min(...values);
  }

  //========================================================
  // STRING HELPERS
  //========================================================

  _cleanText(value) {
    if (value === null || value === undefined) {
      return null;
    }

    return String(value).replace(/\s+/g, " ").trim();
  }

  _cleanUrl(url) {
    if (url === null || url === undefined) {
      return null;
    }

    const value = String(url).trim();

    if (!value) {
      return null;
    }

    return value;
  }

  _cleanSelector(selector) {
    if (selector === null || selector === undefined) {
      return null;
    }

    return String(selector).trim();
  }

  _toNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
  }

  //========================================================
  // EMPTY RESULT
  //========================================================

  _empty(reason, message = "") {
    return {
      type: "unknown",

      payload: {
        reason,

        message,
      },

      confidence: 0,
    };
  }

  //========================================================
  // VALIDATION
  //========================================================

  isValid(result) {
    if (!result || typeof result !== "object") {
      return false;
    }

    if (!result.type || result.type === "unknown") {
      return false;
    }

    if (typeof result.confidence !== "number") {
      return false;
    }

    if (result.confidence < 0 || result.confidence > 1) {
      return false;
    }

    return true;
  }

  //========================================================
  // STATISTICS
  //========================================================

  resetStatistics() {
    this.stats = {
      normalized: 0,

      arrays: 0,

      steps: 0,

      repairedJson: 0,

      extractedJson: 0,

      invalid: 0,

      errors: 0,
    };
  }

  getStatistics() {
    return {
      ...this.stats,
    };
  }
}

//==========================================================
// DEFAULT INSTANCE
//==========================================================

const normalizer = new Normalizer();

export default normalizer;

export { Normalizer };
