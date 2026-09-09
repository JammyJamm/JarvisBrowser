/**
 * backend/planner/normalizer.js
 *
 * Ultra Intelligent Planner Normalizer
 *
 * Phase 1 — Understanding Layer
 *
 * Responsibilities
 * ----------------
 * ✔ Normalize planner / LLM / regex output
 * ✔ Normalize raw user command structures
 * ✔ Normalize action names
 * ✔ Normalize payload fields
 * ✔ Normalize target / value / element type
 * ✔ Normalize modifiers
 * ✔ Normalize entities
 * ✔ Normalize browser context
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
 * Normalizer
 *      │
 *      ├── action
 *      ├── target
 *      ├── value
 *      ├── elementType
 *      ├── modifiers
 *      ├── entities
 *      ├── context
 *      ├── selector
 *      └── multi-step
 *      │
 *      ▼
 * Intent Parser
 *      │
 *      ▼
 * Scoring Engine
 *      │
 *      ▼
 * Resolver
 *      │
 *      ▼
 * Executor
 *
 * IMPORTANT
 * ---------
 * ❌ No fuzzy matching
 * ❌ No DOM scoring
 * ❌ No browser execution
 * ❌ No selector ranking
 * ❌ No Playwright calls
 *
 * Fuzzy matching belongs to:
 *     scoring-engine.js
 *
 * Browser resolution belongs to:
 *     resolver.js
 *
 * Browser execution belongs to:
 *     executor.js
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

      preserveUnknownFields: true,

      debug: false,

      ...options,
    };

    this.stats = {
      normalized: 0,

      commands: 0,

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

      const data =
        typeof input === "string"
          ? (this._safeParse(input) ?? this._normalizeRawCommand(input))
          : input;

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
          .map((item, index) => this._normalizeItem(item, index));

        this.stats.steps += steps.length;

        return this._createPlanResult(steps);
      }

      //----------------------------------------------------
      // Explicit steps
      //----------------------------------------------------

      if (Array.isArray(data.steps)) {
        const steps = data.steps
          .slice(0, this.options.maxSteps)
          .map((item, index) => this._normalizeItem(item, index));

        this.stats.steps += steps.length;

        return {
          type: "plan",

          steps,

          confidence: this._normalizeConfidence(
            data.confidence ??
              data.score ??
              data.probability ??
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

      const result = this._normalizeItem(data);

      this.stats.commands++;

      return result;
    } catch (err) {
      this.stats.errors++;

      this.error("Normalization failed:", err.message);

      return this._empty("exception", err.message);
    }
  }

  //========================================================
  // RAW NATURAL LANGUAGE COMMAND
  //========================================================
  //
  // IMPORTANT:
  //
  // This method does NOT perform fuzzy matching.
  //
  // It only performs lightweight structural extraction.
  //
  // Example:
  //
  // "Click Punch In button"
  //
  // becomes:
  //
  // {
  //   action: "click",
  //   target: "Punch In",
  //   elementType: "button"
  // }
  //
  // The Scoring Engine later decides whether:
  //
  // "Punh In"
  //
  // matches:
  //
  // "Punch In"
  //
  //========================================================

  _normalizeRawCommand(command) {
    if (typeof command !== "string") {
      return null;
    }

    const text = this._cleanText(command);

    if (!text) {
      return null;
    }

    const lower = text.toLowerCase();

    //------------------------------------------------------
    // Detect action
    //------------------------------------------------------

    let action = "";

    const actionPatterns = [
      ["navigate", /^(open|go to|goto|visit|navigate to|browse to)\b/i],
      ["click", /^(click|press|tap)\b/i],
      ["type", /^(type|write|enter|input)\b/i],
      ["type", /^(fill)\b/i],
      ["select", /^(select|choose)\b/i],
      ["checkbox", /^(check)\b/i],
      ["uncheck", /^(uncheck)\b/i],
      ["hover", /^(hover|mouseover)\b/i],
      ["scroll", /^(scroll)\b/i],
      ["wait", /^(wait|sleep|pause|delay)\b/i],
      ["reload", /^(reload|refresh)\b/i],
      ["back", /^(back|go back)\b/i],
      ["forward", /^(forward|go forward)\b/i],
      ["screenshot", /^(screenshot|capture)\b/i],
    ];

    for (const [candidateAction, pattern] of actionPatterns) {
      if (pattern.test(text)) {
        action = candidateAction;
        break;
      }
    }

    //------------------------------------------------------
    // Remove command verb
    //------------------------------------------------------

    let remainder = text;

    if (action) {
      remainder = remainder
        .replace(
          /^(open|go\s+to|goto|visit|navigate\s+to|browse\s+to|click|press|tap|type|write|enter|input|fill|select|choose|check|uncheck|hover|mouseover|scroll|wait|sleep|pause|delay|reload|refresh|back|go\s+back|forward|go\s+forward|screenshot|capture)\b/i,
          "",
        )
        .trim();
    }

    //------------------------------------------------------
    // Extract value
    //
    // Example:
    //
    // Fill email with test@gmail.com
    //
    //------------------------------------------------------

    let value = null;

    const valueMatch = remainder.match(/^(.*?)\s+(?:with|as|to)\s+(.+)$/i);

    if (valueMatch && ["type", "select"].includes(action)) {
      remainder = valueMatch[1].trim();

      value = this._stripQuotes(valueMatch[2].trim());
    }

    //------------------------------------------------------
    // Extract element type
    //------------------------------------------------------

    const elementTypes = [
      "button",
      "link",
      "input",
      "textbox",
      "text field",
      "field",
      "checkbox",
      "radio",
      "dropdown",
      "select",
      "menu",
      "tab",
      "image",
      "heading",
      "icon",
    ];

    let elementType = null;

    for (const type of elementTypes) {
      const pattern = new RegExp(`\\s+${this._escapeRegExp(type)}$`, "i");

      if (pattern.test(remainder)) {
        elementType = type;

        remainder = remainder.replace(pattern, "").trim();

        break;
      }
    }

    //------------------------------------------------------
    // Extract browser context
    //------------------------------------------------------

    const context = this._extractContext(text);

    //------------------------------------------------------
    // Clean target
    //------------------------------------------------------

    let target = remainder;

    if (action === "navigate") {
      target = remainder;
    }

    if (
      action === "scroll" ||
      action === "wait" ||
      action === "reload" ||
      action === "back" ||
      action === "forward" ||
      action === "screenshot"
    ) {
      target = null;
    }

    //------------------------------------------------------
    // Build normalized command
    //------------------------------------------------------

    return {
      action: this._mapType(this._normalizeActionName(action)),

      target: target ? this._cleanText(target) : null,

      value,

      elementType: elementType ? this._normalizeElementType(elementType) : null,

      modifiers: this._extractModifiers(text),

      entities: this._extractEntities(text),

      context,

      rawCommand: text,
    };
  }

  //========================================================
  // CREATE PLAN RESULT
  //========================================================

  _createPlanResult(steps) {
    return {
      type: "plan",

      steps,

      confidence: this._calculatePlanConfidence(steps),

      payload: {
        steps,
      },
    };
  }

  //========================================================
  // NORMALIZE SINGLE ITEM
  //========================================================

  _normalizeItem(item, index = 0) {
    //------------------------------------------------------
    // Raw string step
    //------------------------------------------------------

    if (typeof item === "string") {
      const rawCommand = this._normalizeRawCommand(item);

      if (!rawCommand) {
        this.stats.invalid++;

        return this._empty("invalid_command");
      }

      return this._normalizeItem(rawCommand, index);
    }

    //------------------------------------------------------
    // Invalid item
    //------------------------------------------------------

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
    // Normalize payload
    //------------------------------------------------------

    const payload = this._normalizePayload(item);

    //------------------------------------------------------
    // Ensure normalized core fields
    //------------------------------------------------------

    const normalized = {
      type,

      action: type,

      target:
        payload.target ?? payload.text ?? payload.label ?? payload.name ?? null,

      value: payload.value ?? payload.inputValue ?? null,

      elementType: payload.elementType ?? payload.role ?? null,

      modifiers: payload.modifiers ?? [],

      entities: payload.entities ?? {},

      context: payload.context ?? {},

      payload,

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
    } else if (index !== undefined) {
      normalized.step = index;
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

    //------------------------------------------------------
    // Preserve raw input
    //------------------------------------------------------

    if (this.options.preserveUnknownFields) {
      normalized.raw = {
        ...item,
      };
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
      // Upload
      //----------------------------------------------------

      upload: "upload",

      upload_file: "upload",

      attach: "upload",

      attach_file: "upload",

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
    // Merge payload containers
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
    // Element Type
    //------------------------------------------------------

    const elementType =
      payload.elementType ??
      payload.element_type ??
      payload.element ??
      item.elementType ??
      item.element_type;

    if (elementType !== undefined && elementType !== null) {
      normalized.elementType = this._normalizeElementType(elementType);
    }

    //------------------------------------------------------
    // Modifiers
    //------------------------------------------------------

    if (Array.isArray(payload.modifiers)) {
      normalized.modifiers = payload.modifiers
        .map((modifier) => this._cleanText(modifier))
        .filter(Boolean);
    } else if (typeof payload.modifiers === "string") {
      normalized.modifiers = payload.modifiers
        .split(/[,\s]+/)
        .map((modifier) => this._cleanText(modifier))
        .filter(Boolean);
    }

    //------------------------------------------------------
    // Entities
    //------------------------------------------------------

    if (payload.entities && typeof payload.entities === "object") {
      normalized.entities = payload.entities;
    }

    //------------------------------------------------------
    // Context
    //------------------------------------------------------

    if (payload.context && typeof payload.context === "object") {
      normalized.context = this._normalizeContext(payload.context);
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
    // File
    //------------------------------------------------------

    const file =
      payload.file ??
      payload.filePath ??
      payload.file_path ??
      item.file ??
      item.filePath ??
      item.file_path;

    if (file !== undefined && file !== null) {
      normalized.file = String(file).trim();
    }

    //------------------------------------------------------
    // Preserve raw payload
    //------------------------------------------------------

    normalized.raw = {
      ...payload,
    };

    return normalized;
  }

  //========================================================
  // CONTEXT NORMALIZATION
  //========================================================

  _normalizeContext(context = {}) {
    if (!context || typeof context !== "object") {
      return {};
    }

    const normalized = {};

    //------------------------------------------------------
    // Frame
    //------------------------------------------------------

    if (context.frame !== undefined) {
      normalized.frame = this._normalizeFrame(context.frame);
    }

    //------------------------------------------------------
    // Tab
    //------------------------------------------------------

    if (context.tab !== undefined) {
      normalized.tab = this._toNumber(context.tab, 0);
    }

    //------------------------------------------------------
    // Shadow DOM
    //------------------------------------------------------

    if (
      context.shadowDom !== undefined ||
      context.shadowDOM !== undefined ||
      context.shadow_dom !== undefined
    ) {
      normalized.shadowDom = Boolean(
        context.shadowDom ?? context.shadowDOM ?? context.shadow_dom,
      );
    }

    //------------------------------------------------------
    // Popup
    //------------------------------------------------------

    if (context.popup !== undefined) {
      normalized.popup = Boolean(context.popup);
    }

    //------------------------------------------------------
    // New tab
    //------------------------------------------------------

    if (context.newTab !== undefined || context.new_tab !== undefined) {
      normalized.newTab = Boolean(context.newTab ?? context.new_tab);
    }

    //------------------------------------------------------
    // Active tab
    //------------------------------------------------------

    if (context.activeTab !== undefined || context.active_tab !== undefined) {
      normalized.activeTab = Boolean(context.activeTab ?? context.active_tab);
    }

    //------------------------------------------------------
    // Parent
    //------------------------------------------------------

    if (context.parent !== undefined) {
      normalized.parent = this._cleanText(context.parent);
    }

    //------------------------------------------------------
    // Section
    //------------------------------------------------------

    if (context.section !== undefined) {
      normalized.section = this._cleanText(context.section);
    }

    //------------------------------------------------------
    // Preserve unknown context fields
    //------------------------------------------------------

    if (this.options.preserveUnknownFields) {
      normalized.raw = {
        ...context,
      };
    }

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
  // ELEMENT TYPE NORMALIZATION
  //========================================================

  _normalizeElementType(type) {
    if (type === null || type === undefined) {
      return null;
    }

    const value = String(type)
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, " ");

    const map = {
      button: "button",

      btn: "button",

      link: "link",

      anchor: "link",

      input: "input",

      textbox: "textbox",

      "text field": "textbox",

      field: "textbox",

      checkbox: "checkbox",

      check: "checkbox",

      radio: "radio",

      dropdown: "select",

      select: "select",

      menu: "menu",

      tab: "tab",

      image: "image",

      img: "image",

      heading: "heading",

      icon: "icon",
    };

    return map[value] || value;
  }

  //========================================================
  // CONTEXT EXTRACTION
  //========================================================

  _extractContext(text) {
    const context = {};

    if (
      /\binside\s+(?:the\s+)?iframe\b/i.test(text) ||
      /\bwithin\s+(?:the\s+)?iframe\b/i.test(text)
    ) {
      context.frame = {
        target: "iframe",
      };
    }

    if (/\bshadow\s+dom\b/i.test(text) || /\bshadow\s+root\b/i.test(text)) {
      context.shadowDom = true;
    }

    if (/\bpopup\b/i.test(text) || /\bpop-up\b/i.test(text)) {
      context.popup = true;
    }

    if (/\bnew\s+tab\b/i.test(text)) {
      context.newTab = true;
    }

    if (/\bcurrent\s+tab\b/i.test(text) || /\bactive\s+tab\b/i.test(text)) {
      context.activeTab = true;
    }

    return context;
  }

  //========================================================
  // MODIFIER EXTRACTION
  //========================================================

  _extractModifiers(text) {
    const modifiers = [];

    const modifierPatterns = [
      ["first", /\bfirst\b/i],
      ["last", /\blast\b/i],
      ["next", /\bnext\b/i],
      ["previous", /\bprevious\b/i],
      ["visible", /\bvisible\b/i],
      ["enabled", /\benabled\b/i],
      ["disabled", /\bdisabled\b/i],
      ["exact", /\bexact(?:ly)?\b/i],
      ["inside", /\binside\b/i],
      ["within", /\bwithin\b/i],
      ["below", /\bbelow\b/i],
      ["above", /\babove\b/i],
      ["near", /\bnear\b/i],
    ];

    for (const [modifier, pattern] of modifierPatterns) {
      if (pattern.test(text)) {
        modifiers.push(modifier);
      }
    }

    return modifiers;
  }

  //========================================================
  // ENTITY EXTRACTION
  //========================================================

  _extractEntities(text) {
    const entities = {};

    //------------------------------------------------------
    // Email
    //------------------------------------------------------

    const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

    if (emailMatch) {
      entities.email = emailMatch[0];
    }

    //------------------------------------------------------
    // URL
    //------------------------------------------------------

    const urlMatch = text.match(/https?:\/\/[^\s]+/i);

    if (urlMatch) {
      entities.url = urlMatch[0];
    }

    //------------------------------------------------------
    // File path
    //------------------------------------------------------

    const fileMatch = text.match(/(?:[A-Z]:\\|\/)[^\s]+/i);

    if (fileMatch) {
      entities.filePath = fileMatch[0];
    }

    return entities;
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
      number /= 100;
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

  _stripQuotes(value) {
    if (!value || value.length < 2) {
      return value;
    }

    const first = value[0];

    const last = value[value.length - 1];

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }

    return value;
  }

  _escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

      action: "unknown",

      target: null,

      value: null,

      elementType: null,

      modifiers: [],

      entities: {},

      context: {},

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

      commands: 0,

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
