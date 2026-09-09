//==========================================================
//
// backend/utils/snapshot-parser.js
//
// Ultra Intelligent Snapshot Parser
//
// Responsibilities
// ----------------
// ✔ Normalize Playwright/MCP snapshots
// ✔ Extract readable page text
// ✔ Extract interactive elements
// ✔ Extract buttons
// ✔ Extract links
// ✔ Extract inputs
// ✔ Extract selects
// ✔ Extract checkboxes / radios
// ✔ Extract iframe information
// ✔ Extract accessibility information
// ✔ Build compact planner context
// ✔ Generate stable element metadata
// ✔ Support Playwright/MCP snapshot-like structures
// ✔ Preserve DOM attributes for ScoringEngine
//
// Architecture
//
// Playwright MCP
//      │
//      ▼
// Snapshot
//      │
//      ▼
// SnapshotParser
//      │
//      ├── Page Context
//      ├── Interactive Elements
//      ├── Forms
//      ├── Frames
//      ├── Accessibility
//      │
//      ▼
// Intent Parser
//      │
//      ▼
// Scoring Engine
//      │
//      ▼
// Resolver
//
// IMPORTANT
// ---------
// ❌ No fuzzy matching here
// ❌ No action execution here
// ❌ No clicking here
// ❌ No planner decisions here
//
//==========================================================

class SnapshotParser {
  constructor(options = {}) {
    this.options = {
      maxTextLength: 12000,
      maxElements: 1000,
      maxElementTextLength: 500,
      maxAttributeLength: 500,
      maxPlannerElements: 100,
      includeHidden: false,
      includeNonInteractive: true,
      debug: false,
      ...options,
    };

    this.stats = this._createEmptyStats();
  }

  //========================================================
  // STATISTICS FACTORY
  //========================================================

  _createEmptyStats() {
    return {
      parsed: 0,
      elements: 0,
      buttons: 0,
      links: 0,
      inputs: 0,
      selects: 0,
      checkboxes: 0,
      radios: 0,
      frames: 0,
      accessibility: 0,
      errors: 0,
    };
  }

  //========================================================
  // LOGGING
  //========================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[SnapshotParser]", ...args);
    }
  }

  warn(...args) {
    console.warn("[SnapshotParser]", ...args);
  }

  error(...args) {
    console.error("[SnapshotParser]", ...args);
  }

  //========================================================
  // NORMALIZATION
  //========================================================

  normalizeText(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value)
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  truncate(value, max = this.options.maxAttributeLength) {
    const text = this.normalizeText(value);

    if (!text) {
      return "";
    }

    if (text.length <= max) {
      return text;
    }

    return `${text.substring(0, max)}...`;
  }

  normalizeSnapshot(snapshot) {
    if (!snapshot) {
      return {
        html: "",
        text: "",
        title: "",
        url: "",
        timestamp: Date.now(),
        accessibility: null,
      };
    }

    if (typeof snapshot === "string") {
      return {
        html: snapshot,
        text: "",
        title: "",
        url: "",
        timestamp: Date.now(),
        accessibility: null,
      };
    }

    // Support common Playwright/MCP naming variants.
    const html =
      snapshot.html ||
      snapshot.content ||
      snapshot.dom ||
      snapshot.pageContent ||
      "";

    const text =
      snapshot.text || snapshot.pageText || snapshot.visibleText || "";

    const title = snapshot.title || snapshot.pageTitle || "";

    const url = snapshot.url || snapshot.pageUrl || snapshot.location || "";

    return {
      html: typeof html === "string" ? html : "",
      text: this.normalizeText(text),
      title: this.normalizeText(title),
      url: String(url || ""),
      timestamp: snapshot.timestamp || Date.now(),
      accessibility:
        snapshot.accessibility ||
        snapshot.accessibilityTree ||
        snapshot.axTree ||
        null,
    };
  }

  //========================================================
  // HTML PARSING
  //========================================================

  parseHTML(html) {
    const result = {
      elements: [],
      buttons: [],
      links: [],
      inputs: [],
      selects: [],
      checkboxes: [],
      radios: [],
      frames: [],
    };

    if (!html || typeof html !== "string") {
      return result;
    }

    //------------------------------------------------------
    // Lightweight HTML parser.
    //
    // This intentionally avoids external DOM dependencies
    // so it remains fast inside the Node backend.
    //------------------------------------------------------

    const tagRegex =
      /<(button|a|input|textarea|select|option|iframe|frame|[a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/gi;

    let match;

    while ((match = tagRegex.exec(html)) !== null) {
      if (result.elements.length >= this.options.maxElements) {
        break;
      }

      const tag = String(match[1] || "").toLowerCase();

      const attributes = this.parseAttributes(match[2] || "");

      const element = {
        index: result.elements.length,

        tag,

        type: attributes.type || "",

        id: attributes.id || "",

        name: attributes.name || "",

        role: attributes.role || "",

        ariaLabel:
          attributes["aria-label"] || attributes["aria-labelledby"] || "",

        ariaDescribedBy: attributes["aria-describedby"] || "",

        placeholder: attributes.placeholder || "",

        title: attributes.title || "",

        href: attributes.href || "",

        src: attributes.src || "",

        value: attributes.value || "",

        className: attributes.class || "",

        dataTestId:
          attributes["data-testid"] || attributes["data-test-id"] || "",

        disabled:
          "disabled" in attributes || attributes["aria-disabled"] === "true",

        checked:
          "checked" in attributes || attributes["aria-checked"] === "true",

        selected:
          "selected" in attributes || attributes["aria-selected"] === "true",

        required:
          "required" in attributes || attributes["aria-required"] === "true",

        visible:
          !("hidden" in attributes) &&
          attributes["aria-hidden"] !== "true" &&
          attributes.style?.includes("display:none") !== true,

        attributes,
      };

      //----------------------------------------------------
      // Stable metadata
      //----------------------------------------------------

      element.metadata = this.createElementMetadata(element);

      result.elements.push(element);

      //----------------------------------------------------
      // Categorization
      //----------------------------------------------------

      if (tag === "button") {
        result.buttons.push(element);
        continue;
      }

      if (tag === "a") {
        result.links.push(element);
        continue;
      }

      if (tag === "input") {
        result.inputs.push(element);

        const inputType = String(element.type || "")
          .toLowerCase()
          .trim();

        if (inputType === "checkbox") {
          result.checkboxes.push(element);
        }

        if (inputType === "radio") {
          result.radios.push(element);
        }

        continue;
      }

      if (tag === "textarea") {
        result.inputs.push(element);
        continue;
      }

      if (tag === "select") {
        result.selects.push(element);
        continue;
      }

      if (tag === "iframe" || tag === "frame") {
        result.frames.push(element);
      }
    }

    return result;
  }

  //========================================================
  // ATTRIBUTE PARSER
  //========================================================

  parseAttributes(rawAttributes) {
    const attributes = {};

    if (!rawAttributes) {
      return attributes;
    }

    const attributeRegex =
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

    let match;

    while ((match = attributeRegex.exec(rawAttributes)) !== null) {
      const name = String(match[1] || "").toLowerCase();

      const value =
        match[2] !== undefined
          ? match[2]
          : match[3] !== undefined
            ? match[3]
            : match[4] !== undefined
              ? match[4]
              : true;

      attributes[name] =
        value === true
          ? true
          : this.truncate(value, this.options.maxAttributeLength);
    }

    return attributes;
  }

  //========================================================
  // STABLE ELEMENT METADATA
  //========================================================

  createElementMetadata(element) {
    const identityParts = [
      element.tag,
      element.id,
      element.name,
      element.role,
      element.dataTestId,
      element.type,
      element.href,
    ]
      .filter(Boolean)
      .map(String);

    return {
      index: element.index,

      identity: identityParts.join("|"),

      tag: element.tag,

      role: element.role || "",

      id: element.id || "",

      name: element.name || "",

      type: element.type || "",

      testId: element.dataTestId || "",

      href: element.href || "",

      disabled: Boolean(element.disabled),

      visible: Boolean(element.visible),
    };
  }

  //========================================================
  // EXTRACT TEXT
  //========================================================

  extractText(snapshot) {
    const normalized = this.normalizeSnapshot(snapshot);

    let text = normalized.text;

    if (!text && normalized.html) {
      text = this.stripHTML(normalized.html);
    }

    return this.truncate(text, this.options.maxTextLength);
  }

  stripHTML(html) {
    if (!html) {
      return "";
    }

    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<template[\s\S]*?<\/template>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<canvas[\s\S]*?<\/canvas>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  //========================================================
  // ELEMENT TEXT EXTRACTION
  //========================================================

  extractElementTexts(html) {
    if (!html || typeof html !== "string") {
      return [];
    }

    const results = [];

    const regex =
      /<(button|a|label|option|textarea|select)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

    let match;

    while ((match = regex.exec(html)) !== null) {
      const tag = String(match[1] || "").toLowerCase();

      const text = this.stripHTML(match[2] || "");

      if (!text) {
        continue;
      }

      results.push({
        tag,

        text: this.truncate(text, this.options.maxElementTextLength),
      });
    }

    return results;
  }

  //========================================================
  // INTERACTIVE ELEMENTS
  //========================================================

  extractInteractiveElements(snapshot) {
    const normalized = this.normalizeSnapshot(snapshot);

    const parsed = this.parseHTML(normalized.html);

    const textElements = this.extractElementTexts(normalized.html);

    //------------------------------------------------------
    // Maintain independent text indexes by tag.
    //
    // This avoids the old issue where a <button> followed
    // by an <a> could receive the wrong text.
    //------------------------------------------------------

    const textIndexes = new Map();

    for (const item of textElements) {
      if (!textIndexes.has(item.tag)) {
        textIndexes.set(item.tag, 0);
      }
    }

    //------------------------------------------------------
    // Attach best-effort text.
    //------------------------------------------------------

    for (const element of parsed.elements) {
      const interactive =
        element.tag === "button" ||
        element.tag === "a" ||
        element.tag === "input" ||
        element.tag === "textarea" ||
        element.tag === "select" ||
        element.tag === "option";

      if (!interactive) {
        continue;
      }

      //----------------------------------------------------
      // Hidden filtering
      //----------------------------------------------------

      if (!this.options.includeHidden && element.visible === false) {
        continue;
      }

      //----------------------------------------------------
      // Button / link / option / textarea / select text
      //----------------------------------------------------

      if (
        element.tag === "button" ||
        element.tag === "a" ||
        element.tag === "option" ||
        element.tag === "textarea" ||
        element.tag === "select"
      ) {
        const currentIndex = textIndexes.get(element.tag) || 0;

        const candidate = textElements.filter(
          (item) => item.tag === element.tag,
        )[currentIndex];

        if (candidate) {
          element.text = candidate.text;

          textIndexes.set(element.tag, currentIndex + 1);
        }
      }

      //----------------------------------------------------
      // Accessible name
      //----------------------------------------------------

      element.text = this.normalizeText(element.text);

      element.accessibleName = this.normalizeText(
        element.ariaLabel ||
          element.text ||
          element.placeholder ||
          element.title ||
          element.name ||
          element.value ||
          "",
      );

      //----------------------------------------------------
      // Searchable labels
      //----------------------------------------------------

      element.searchText = this.normalizeText(
        [
          element.text,
          element.accessibleName,
          element.placeholder,
          element.title,
          element.name,
          element.id,
          element.role,
        ]
          .filter(Boolean)
          .join(" "),
      );

      //----------------------------------------------------
      // Refresh stable metadata
      //----------------------------------------------------

      element.metadata = this.createElementMetadata(element);
    }

    return parsed;
  }

  //========================================================
  // BUTTON EXTRACTION
  //========================================================

  extractButtons(snapshot) {
    const parsed = this.extractInteractiveElements(snapshot);

    return parsed.buttons
      .filter(
        (button) => this.options.includeHidden || button.visible !== false,
      )
      .map((button) => ({
        ...button,

        text: this.normalizeText(button.text),

        accessibleName: this.normalizeText(button.accessibleName),
      }));
  }

  //========================================================
  // LINK EXTRACTION
  //========================================================

  extractLinks(snapshot) {
    const parsed = this.extractInteractiveElements(snapshot);

    return parsed.links
      .filter((link) => this.options.includeHidden || link.visible !== false)
      .map((link) => ({
        ...link,

        text: this.normalizeText(link.text),

        accessibleName: this.normalizeText(link.accessibleName),
      }));
  }

  //========================================================
  // FORM EXTRACTION
  //========================================================

  extractInputs(snapshot) {
    const parsed = this.extractInteractiveElements(snapshot);

    return parsed.inputs
      .filter((input) => this.options.includeHidden || input.visible !== false)
      .map((input) => ({
        ...input,

        accessibleName: this.normalizeText(input.accessibleName),
      }));
  }

  //========================================================
  // SELECT EXTRACTION
  //========================================================

  extractSelects(snapshot) {
    const parsed = this.extractInteractiveElements(snapshot);

    return parsed.selects.map((select) => ({
      ...select,

      accessibleName: this.normalizeText(select.accessibleName),
    }));
  }

  //========================================================
  // CHECKBOX EXTRACTION
  //========================================================

  extractCheckboxes(snapshot) {
    const parsed = this.extractInteractiveElements(snapshot);

    return parsed.checkboxes.map((checkbox) => ({
      ...checkbox,

      checked: Boolean(checkbox.checked),

      accessibleName: this.normalizeText(checkbox.accessibleName),
    }));
  }

  //========================================================
  // RADIO EXTRACTION
  //========================================================

  extractRadios(snapshot) {
    const parsed = this.extractInteractiveElements(snapshot);

    return parsed.radios.map((radio) => ({
      ...radio,

      checked: Boolean(radio.checked),

      accessibleName: this.normalizeText(radio.accessibleName),
    }));
  }

  //========================================================
  // FRAME EXTRACTION
  //========================================================

  extractFrames(snapshot) {
    const normalized = this.normalizeSnapshot(snapshot);

    const parsed = this.parseHTML(normalized.html);

    return parsed.frames.map((frame, index) => {
      const src = String(frame.src || "");

      const lowerSrc = src.toLowerCase();

      const isEvolution =
        lowerSrc.includes("frontend/evo") ||
        lowerSrc.includes("lifkzibqgat.click");

      return {
        ...frame,

        index,

        url: src,

        src,

        isEvolution,

        frameType: frame.tag === "iframe" ? "iframe" : "frame",

        accessibleName: this.normalizeText(
          frame.ariaLabel || frame.title || frame.name || "",
        ),
      };
    });
  }

  //========================================================
  // EVOLUTION FRAME EXTRACTION
  //========================================================

  getEvolutionFrames(snapshot) {
    return this.extractFrames(snapshot).filter((frame) => frame.isEvolution);
  }

  //========================================================
  // ACCESSIBILITY INFORMATION
  //========================================================

  extractAccessibility(snapshot) {
    const normalized = this.normalizeSnapshot(snapshot);

    const parsed = this.extractInteractiveElements(normalized);

    const accessibility = parsed.elements
      .filter(
        (element) =>
          element.role || element.ariaLabel || element.accessibleName,
      )
      .map((element) => ({
        index: element.index,

        tag: element.tag,

        role: element.role || "",

        name: element.accessibleName || "",

        ariaLabel: element.ariaLabel || "",

        id: element.id || "",

        disabled: Boolean(element.disabled),

        visible: Boolean(element.visible),

        checked: Boolean(element.checked),

        selected: Boolean(element.selected),
      }));

    //------------------------------------------------------
    // Preserve MCP / Playwright accessibility data when
    // already supplied by the caller.
    //------------------------------------------------------

    if (normalized.accessibility) {
      return {
        elements: accessibility,

        tree: normalized.accessibility,
      };
    }

    return {
      elements: accessibility,

      tree: null,
    };
  }

  //========================================================
  // PAGE SUMMARY
  //========================================================

  createSummary(snapshot) {
    const normalized = this.normalizeSnapshot(snapshot);

    const parsed = this.extractInteractiveElements(normalized);

    const frames = this.extractFrames(normalized);

    return {
      url: normalized.url,

      title: normalized.title,

      text: this.extractText(normalized),

      counts: {
        elements: parsed.elements.length,

        buttons: parsed.buttons.length,

        links: parsed.links.length,

        inputs: parsed.inputs.length,

        selects: parsed.selects.length,

        checkboxes: parsed.checkboxes.length,

        radios: parsed.radios.length,

        frames: frames.length,
      },

      evolutionFrames: frames.filter((frame) => frame.isEvolution).length,
    };
  }

  //========================================================
  // PLANNER CONTEXT
  //========================================================

  toPlannerContext(snapshot) {
    const normalized = this.normalizeSnapshot(snapshot);

    const parsed = this.extractInteractiveElements(normalized);

    //------------------------------------------------------
    // Limit context size to protect planner performance.
    //------------------------------------------------------

    const limit = this.options.maxPlannerElements;

    const buttons = parsed.buttons
      .filter(
        (button) => this.options.includeHidden || button.visible !== false,
      )
      .slice(0, limit)
      .map((button) => ({
        index: button.index,

        text: button.text || "",

        name: button.accessibleName || "",

        searchText: button.searchText || "",

        role: button.role || "button",

        id: button.id || "",

        testId: button.dataTestId || "",

        disabled: Boolean(button.disabled),

        visible: Boolean(button.visible),

        metadata: button.metadata,
      }));

    const links = parsed.links
      .filter((link) => this.options.includeHidden || link.visible !== false)
      .slice(0, limit)
      .map((link) => ({
        index: link.index,

        text: link.text || "",

        name: link.accessibleName || "",

        searchText: link.searchText || "",

        href: link.href || "",

        id: link.id || "",

        testId: link.dataTestId || "",

        disabled: Boolean(link.disabled),

        visible: Boolean(link.visible),

        metadata: link.metadata,
      }));

    const inputs = parsed.inputs
      .filter((input) => this.options.includeHidden || input.visible !== false)
      .slice(0, limit)
      .map((input) => ({
        index: input.index,

        type: input.type || "text",

        name: input.accessibleName || "",

        searchText: input.searchText || "",

        id: input.id || "",

        testId: input.dataTestId || "",

        placeholder: input.placeholder || "",

        value: input.value || "",

        disabled: Boolean(input.disabled),

        visible: Boolean(input.visible),

        checked: Boolean(input.checked),

        metadata: input.metadata,
      }));

    const selects = parsed.selects.slice(0, limit).map((select) => ({
      index: select.index,

      name: select.accessibleName || "",

      id: select.id || "",

      value: select.value || "",

      disabled: Boolean(select.disabled),

      visible: Boolean(select.visible),

      metadata: select.metadata,
    }));

    const checkboxes = parsed.checkboxes.slice(0, limit).map((checkbox) => ({
      index: checkbox.index,

      name: checkbox.accessibleName || "",

      id: checkbox.id || "",

      checked: Boolean(checkbox.checked),

      disabled: Boolean(checkbox.disabled),

      visible: Boolean(checkbox.visible),

      metadata: checkbox.metadata,
    }));

    const radios = parsed.radios.slice(0, limit).map((radio) => ({
      index: radio.index,

      name: radio.accessibleName || "",

      id: radio.id || "",

      checked: Boolean(radio.checked),

      disabled: Boolean(radio.disabled),

      visible: Boolean(radio.visible),

      metadata: radio.metadata,
    }));

    const frames = this.extractFrames(normalized);

    return {
      page: {
        url: normalized.url,

        title: normalized.title,

        text: this.extractText(normalized),
      },

      buttons,

      links,

      inputs,

      selects,

      checkboxes,

      radios,

      frames: frames.map((frame) => ({
        index: frame.index,

        src: frame.src || "",

        url: frame.url || "",

        name: frame.name || "",

        title: frame.title || "",

        isEvolution: frame.isEvolution,
      })),

      counts: {
        elements: parsed.elements.length,

        buttons: parsed.buttons.length,

        links: parsed.links.length,

        inputs: parsed.inputs.length,

        selects: parsed.selects.length,

        checkboxes: parsed.checkboxes.length,

        radios: parsed.radios.length,

        frames: frames.length,
      },
    };
  }

  //========================================================
  // COMPACT CONTEXT
  //========================================================

  toCompactText(snapshot) {
    const context = this.toPlannerContext(snapshot);

    const lines = [];

    //------------------------------------------------------
    // Page
    //------------------------------------------------------

    lines.push(`URL: ${context.page.url || ""}`);

    lines.push(`TITLE: ${context.page.title || ""}`);

    if (context.page.text) {
      lines.push("");

      lines.push("PAGE TEXT:");

      lines.push(context.page.text);
    }

    //------------------------------------------------------
    // Buttons
    //------------------------------------------------------

    if (context.buttons.length) {
      lines.push("");

      lines.push("BUTTONS:");

      for (const button of context.buttons) {
        const name = button.name || button.text || "(unnamed)";

        lines.push(
          `- [${button.index}] ${name}${button.disabled ? " [DISABLED]" : ""}`,
        );
      }
    }

    //------------------------------------------------------
    // Links
    //------------------------------------------------------

    if (context.links.length) {
      lines.push("");

      lines.push("LINKS:");

      for (const link of context.links) {
        const name = link.name || link.text || "(unnamed)";

        lines.push(
          `- [${link.index}] ${name}${link.href ? ` -> ${link.href}` : ""}`,
        );
      }
    }

    //------------------------------------------------------
    // Inputs
    //------------------------------------------------------

    if (context.inputs.length) {
      lines.push("");

      lines.push("INPUTS:");

      for (const input of context.inputs) {
        const name = input.name || input.placeholder || input.id || "(unnamed)";

        lines.push(`- [${input.index}] ${input.type}: ${name}`);
      }
    }

    //------------------------------------------------------
    // Selects
    //------------------------------------------------------

    if (context.selects.length) {
      lines.push("");

      lines.push("SELECTS:");

      for (const select of context.selects) {
        const name = select.name || select.id || "(unnamed)";

        lines.push(`- [${select.index}] ${name}`);
      }
    }

    //------------------------------------------------------
    // Checkboxes
    //------------------------------------------------------

    if (context.checkboxes.length) {
      lines.push("");

      lines.push("CHECKBOXES:");

      for (const checkbox of context.checkboxes) {
        const name = checkbox.name || checkbox.id || "(unnamed)";

        lines.push(
          `- [${checkbox.index}] ${name} [${
            checkbox.checked ? "checked" : "unchecked"
          }]`,
        );
      }
    }

    //------------------------------------------------------
    // Radios
    //------------------------------------------------------

    if (context.radios.length) {
      lines.push("");

      lines.push("RADIOS:");

      for (const radio of context.radios) {
        const name = radio.name || radio.id || "(unnamed)";

        lines.push(
          `- [${radio.index}] ${name} [${
            radio.checked ? "selected" : "unselected"
          }]`,
        );
      }
    }

    //------------------------------------------------------
    // Frames
    //------------------------------------------------------

    if (context.frames.length) {
      lines.push("");

      lines.push("FRAMES:");

      for (const frame of context.frames) {
        lines.push(
          `- [${frame.index}] ${frame.src || frame.url || "about:blank"}${
            frame.isEvolution ? " [EVOLUTION]" : ""
          }`,
        );
      }
    }

    return lines.join("\n");
  }

  //========================================================
  // FULL PARSE
  //========================================================

  parse(snapshot) {
    try {
      const normalized = this.normalizeSnapshot(snapshot);

      const interactive = this.extractInteractiveElements(normalized);

      const frames = this.extractFrames(normalized);

      const accessibility = this.extractAccessibility(normalized);

      const result = {
        url: normalized.url,

        title: normalized.title,

        text: this.extractText(normalized),

        html: normalized.html,

        timestamp: normalized.timestamp,

        elements: interactive.elements,

        buttons: interactive.buttons,

        links: interactive.links,

        inputs: interactive.inputs,

        selects: interactive.selects,

        checkboxes: interactive.checkboxes,

        radios: interactive.radios,

        frames,

        accessibility,
      };

      //----------------------------------------------------
      // Statistics
      //----------------------------------------------------

      this.stats.parsed++;

      this.stats.elements += result.elements.length;

      this.stats.buttons += result.buttons.length;

      this.stats.links += result.links.length;

      this.stats.inputs += result.inputs.length;

      this.stats.selects += result.selects.length;

      this.stats.checkboxes += result.checkboxes.length;

      this.stats.radios += result.radios.length;

      this.stats.frames += result.frames.length;

      this.stats.accessibility += Array.isArray(accessibility.elements)
        ? accessibility.elements.length
        : 0;

      this.log("Parsed snapshot:", {
        url: result.url,
        elements: result.elements.length,
        buttons: result.buttons.length,
        links: result.links.length,
        inputs: result.inputs.length,
        frames: result.frames.length,
      });

      return result;
    } catch (err) {
      this.stats.errors++;

      this.error("Snapshot parsing failed:", err.message);

      return {
        url: "",

        title: "",

        text: "",

        html: "",

        timestamp: Date.now(),

        elements: [],

        buttons: [],

        links: [],

        inputs: [],

        selects: [],

        checkboxes: [],

        radios: [],

        frames: [],

        accessibility: {
          elements: [],
          tree: null,
        },
      };
    }
  }

  //========================================================
  // STATIC HELPERS
  //========================================================

  static normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  static parse(snapshot, options = {}) {
    const parser = new SnapshotParser(options);

    return parser.parse(snapshot);
  }

  static plannerContext(snapshot, options = {}) {
    const parser = new SnapshotParser(options);

    return parser.toPlannerContext(snapshot);
  }

  static compactText(snapshot, options = {}) {
    const parser = new SnapshotParser(options);

    return parser.toCompactText(snapshot);
  }

  //========================================================
  // STATISTICS
  //========================================================

  resetStatistics() {
    this.stats = this._createEmptyStats();
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

const snapshotParser = new SnapshotParser();

export default snapshotParser;

export { SnapshotParser };
