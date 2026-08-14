//==========================================================
//
// backend/resolver.js
//
// Intelligent DOM Resolver
//
// Pipeline
//
// User Command
//      │
//      ▼
// Intent Parser
//      │
//      ├── action
//      └── target
//      │
//      ▼
// Resolver
//      │
//      ├── Exact normalized match
//      ├── Tab / Label / Span parent resolution
//      ├── ScoringEngine fuzzy/spelling match
//      ├── Planner fallback
//      └── Playwright execution
//
// IMPORTANT
// ----------------------------------------------------------
// IntentParser  = Understand command
// ScoringEngine = Rank / fuzzy / spelling candidates
// Resolver      = DOM resolution + execution
// Planner       = Only fallback for ambiguity
//
//==========================================================

import IntentParser from "./planner/intent-parser.js";
import Planner from "./planner/planner.js";
import ScoringEngine from "./planner/scoring-engine.js";
import { SelfHealing } from "./planner/self-healing.js";

import { clickInsideEvolutionFrame } from "./utils/iframeContent.js";

export default class Resolver {
  constructor(mcp, options = {}) {
    this.mcp = mcp;

    this.options = {
      domCacheTTL: 5000,

      autoRefreshDOM: true,

      enableLearning: true,

      debug: false,

      plannerThreshold: 80,

      minimumConfidence: 60,

      exactMatchConfidence: 100,

      maxExecutionAttempts: 3,

      //====================================================
      // NEW
      // Time allowed for dynamically rendered targets
      // after navigation / SPA transitions.
      //====================================================
      targetWaitTimeout: 8000,

      targetWaitInterval: 150,

      navigationRenderDelay: 300,

      ...options,
    };

    //------------------------------------------------------
    // AI components
    //------------------------------------------------------

    this.intentParser =
      options.intentParser ||
      new IntentParser({
        debug: this.options.debug,
      });

    this.scoringEngine =
      options.scoringEngine ||
      new ScoringEngine({
        debug: this.options.debug,
      });

    this.planner =
      options.planner ||
      new Planner({
        useLLM: true,
      });

    this.selfHealing = options.selfHealing || new SelfHealing();

    //------------------------------------------------------
    // DOM cache
    //------------------------------------------------------

    this.domCache = {
      page: null,
      elements: [],
      frames: [],
      timestamp: 0,
      url: "",
    };

    this.frameCache = [];

    //------------------------------------------------------
    // Learning
    //------------------------------------------------------

    this.learningCache = new Map();

    //------------------------------------------------------
    // Statistics
    //------------------------------------------------------

    this.stats = {
      clicks: 0,
      types: 0,

      plannerCalls: 0,
      plannerRecoveries: 0,

      healedExecutions: 0,

      cacheHits: 0,
      cacheMisses: 0,

      exactMatches: 0,
      fuzzyMatches: 0,

      frameMatches: 0,

      averageResolveTime: 0,
      lastResolveTime: 0,
    };

    this.isBuildingIndex = false;

    this.lastURL = "";
  }

  //==========================================================
  // LOGGING
  //==========================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[Resolver]", ...args);
    }
  }

  warn(...args) {
    console.warn("[Resolver]", ...args);
  }

  error(...args) {
    console.error("[Resolver]", ...args);
  }

  //==========================================================
  // TIMER
  //==========================================================

  startTimer() {
    return performance.now();
  }

  stopTimer(start) {
    const elapsed = performance.now() - start;

    this.stats.lastResolveTime = elapsed;

    this.stats.averageResolveTime =
      this.stats.averageResolveTime === 0
        ? elapsed
        : this.stats.averageResolveTime * 0.9 + elapsed * 0.1;

    return elapsed;
  }

  //==========================================================
  // TEXT NORMALIZATION
  //
  // Handles:
  //
  // "By Email / ID"
  // "by email / id"
  // " BY EMAIL / ID "
  // "By   Email   /   ID"
  //
  // This is NOT fuzzy matching.
  //==========================================================

  normalizeText(value = "") {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  normalizeForComparison(value = "") {
    return this.normalizeText(value)
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s*-\s*/g, "-")
      .replace(/[“”‘’]/g, "'")
      .trim();
  }

  //==========================================================
  // CACHE
  //==========================================================

  clearCaches() {
    this.clearDOMCache();

    this.learningCache.clear();
  }

  clearDOMCache() {
    this.domCache = {
      page: null,
      elements: [],
      frames: [],
      timestamp: 0,
      url: "",
    };

    this.frameCache = [];
  }

  invalidateDOMCache() {
    if (this.domCache) {
      this.domCache.timestamp = 0;
    }
  }

  isDOMCacheValid() {
    if (!this.domCache) {
      return false;
    }

    return Date.now() - this.domCache.timestamp < this.options.domCacheTTL;
  }

  //==========================================================
  // LEARNING
  //==========================================================

  remember(query, candidate) {
    if (!this.options.enableLearning) {
      return;
    }

    if (!query || !candidate) {
      return;
    }

    this.learningCache.set(this.normalizeText(query), candidate);

    if (this.scoringEngine?.remember) {
      this.scoringEngine.remember(query, candidate);
    }
  }

  getRemembered(query) {
    return this.learningCache.get(this.normalizeText(query));
  }

  forget(query) {
    if (!query) {
      return;
    }

    this.learningCache.delete(this.normalizeText(query));
  }

  //==========================================================
  // BUILD DOM INDEX
  //==========================================================

  async buildDOMIndex(force = false) {
    if (!force && this.isDOMCacheValid()) {
      this.stats.cacheHits++;

      return this.domCache;
    }

    this.stats.cacheMisses++;

    if (this.isBuildingIndex) {
      return this.domCache;
    }

    this.isBuildingIndex = true;

    try {
      const page = await this.mcp.getPage();

      await page.waitForLoadState("domcontentloaded").catch(() => {});

      const frames = page.frames();

      const allElements = [];
      const frameIndex = [];

      for (const frame of frames) {
        try {
          const elements = await this.extractFrameElements(frame);

          frameIndex.push({
            frame,

            url: frame.url(),

            name: frame.name?.() || "",

            count: elements.length,
          });

          for (const element of elements) {
            element.frame = frame;

            element.frameUrl = frame.url();

            element.frameName = frame.name?.() || "";

            allElements.push(element);
          }
        } catch (error) {
          this.log("Frame indexing failed:", frame.url(), error.message);
        }
      }

      //----------------------------------------------------
      // Build scoring index
      //----------------------------------------------------

      if (this.scoringEngine?.buildIndex) {
        this.scoringEngine.buildIndex(allElements);
      }

      this.frameCache = frameIndex;

      this.domCache = {
        page,

        elements: allElements,

        frames: frameIndex,

        count: allElements.length,

        timestamp: Date.now(),

        url: page.url(),
      };

      this.lastURL = page.url();

      this.log(
        `Indexed ${allElements.length} elements across ${frameIndex.length} frame(s)`,
      );

      return this.domCache;
    } finally {
      this.isBuildingIndex = false;
    }
  }

  //==========================================================
  // EXTRACT DOM ELEMENTS
  //==========================================================

  async extractFrameElements(frame) {
    return await frame.evaluate(() => {
      const selectors = [
        "button",

        "a",

        "input",

        "textarea",

        "select",

        "label",

        "span",

        "[role='button']",

        "[role='tab']",

        "[role='link']",

        "[role='menuitem']",

        "[role='checkbox']",

        "[role='radio']",

        "[role='option']",

        "[role='combobox']",

        "[contenteditable]",

        "[onclick]",

        "[data-testid]",

        "[aria-label]",
      ];

      const elements = [];

      const seen = new WeakSet();

      document.querySelectorAll(selectors.join(",")).forEach((el) => {
        if (seen.has(el)) {
          return;
        }

        seen.add(el);

        const rect = el.getBoundingClientRect();

        const style = window.getComputedStyle(el);

        const text = (el.innerText || el.textContent || "")
          .replace(/\s+/g, " ")
          .trim();

        const ariaLabel = el.getAttribute("aria-label") || "";

        const title = el.getAttribute("title") || "";

        const placeholder = el.getAttribute("placeholder") || "";

        const name = el.getAttribute("name") || "";

        const testid = el.getAttribute("data-testid") || "";

        //------------------------------------------------
        // Detect clickable parent
        //------------------------------------------------

        let parentClickable = null;

        let parent = el.parentElement;

        for (let level = 0; parent && level < 6; level++) {
          const parentRole = parent.getAttribute("role") || "";

          const parentTag = parent.tagName.toLowerCase();

          const parentClass = String(parent.className || "").toLowerCase();

          const clickable =
            parentTag === "button" ||
            parentTag === "a" ||
            parentTag === "label" ||
            parentRole === "button" ||
            parentRole === "tab" ||
            parentRole === "link" ||
            parentRole === "menuitem" ||
            parentRole === "option" ||
            parent.hasAttribute("onclick") ||
            parent.hasAttribute("tabindex") ||
            parentClass.includes("tab") ||
            parentClass.includes("button") ||
            parentClass.includes("btn") ||
            parentClass.includes("click");

          if (clickable) {
            parentClickable = {
              tag: parentTag,

              id: parent.id || "",

              role: parentRole,

              className:
                typeof parent.className === "string" ? parent.className : "",

              text: (parent.innerText || parent.textContent || "")
                .replace(/\s+/g, " ")
                .trim(),
            };

            break;
          }

          parent = parent.parentElement;
        }

        elements.push({
          tag: el.tagName.toLowerCase(),

          tagName: el.tagName.toLowerCase(),

          id: el.id || "",

          role: el.getAttribute("role") || "",

          text,

          innerText: el.innerText || "",

          textContent: el.textContent || "",

          aria: ariaLabel,

          ariaLabel,

          placeholder,

          title,

          alt: el.getAttribute("alt") || "",

          testid,

          name,

          type: el.getAttribute("type") || "",

          value: el.value || "",

          href: el.getAttribute("href") || "",

          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none",

          enabled: !el.disabled && el.getAttribute("aria-disabled") !== "true",

          x: rect.x,

          y: rect.y,

          width: rect.width,

          height: rect.height,

          parentClickable,
        });
      });

      return elements;
    });
  }

  //==========================================================
  // DOM POOL
  //==========================================================

  async getDOMPool(force = false) {
    const cache = await this.buildDOMIndex(force);

    return cache?.elements || [];
  }

  async refreshDOM() {
    this.clearDOMCache();

    return await this.buildDOMIndex(true);
  }

  //==========================================================
  // FRESH DOM
  //==========================================================

  async ensureFreshDOM() {
    const page = await this.mcp.getPage();

    const url = page.url();

    if (this.lastURL !== url) {
      this.lastURL = url;

      this.invalidateDOMCache();
    }

    if (this.options.autoRefreshDOM && !this.isDOMCacheValid()) {
      await this.buildDOMIndex(true);
    }
  }

  //==========================================================
  // WAIT FOR TARGET
  //
  // IMPORTANT
  // --------------------------------------------------------
  // DOMContentLoaded does NOT guarantee that a SPA has
  // rendered the target element.
  //
  // This is specifically important for:
  //
  // 1) Navigate
  // 2) Click "By email / ID"
  //
  // The page may be loaded while the React/Vue/etc.
  // component is still being rendered.
  //==========================================================

  async waitForTarget(query, timeout = this.options.targetWaitTimeout) {
    const page = await this.mcp.getPage();

    const target = this.normalizeForComparison(query);

    if (!target) {
      return false;
    }

    const started = Date.now();

    this.log("Waiting for target:", query);

    while (Date.now() - started < timeout) {
      for (const frame of page.frames()) {
        try {
          const interactive = frame.locator(
            [
              "button",
              "a",
              "label",
              "[role='button']",
              "[role='tab']",
              "[role='link']",
              "[role='menuitem']",
              "[role='option']",
              "input[type='radio']",
              "input[type='checkbox']",
              "span",
              "div",
            ].join(","),
          );

          const count = Math.min(await interactive.count(), 500);

          for (let i = 0; i < count; i++) {
            const element = interactive.nth(i);

            if (!(await element.isVisible().catch(() => false))) {
              continue;
            }

            const text = await element.innerText().catch(() => "");

            const aria = await element
              .getAttribute("aria-label")
              .catch(() => "");

            const title = await element.getAttribute("title").catch(() => "");

            if (
              this.normalizeForComparison(text) === target ||
              this.normalizeForComparison(aria) === target ||
              this.normalizeForComparison(title) === target
            ) {
              this.log("Target appeared:", {
                query,

                frame: frame.url(),
              });

              return true;
            }
          }
        } catch (error) {
          this.log(
            "Target wait frame check failed:",
            frame.url(),
            error.message,
          );
        }
      }

      await page.waitForTimeout(this.options.targetWaitInterval);
    }

    this.log("Target did not appear within timeout:", query);

    return false;
  }

  //==========================================================
  // CLICKABLE ELEMENT
  //==========================================================

  isClickableCandidate(candidate) {
    if (!candidate) {
      return false;
    }

    const tag = String(candidate.tag || candidate.tagName || "").toLowerCase();

    const role = String(candidate.role || "").toLowerCase();

    //------------------------------------------------------
    // Direct interactive elements
    //------------------------------------------------------

    if (
      tag === "button" ||
      tag === "a" ||
      tag === "label" ||
      role === "button" ||
      role === "link" ||
      role === "tab" ||
      role === "menuitem" ||
      role === "option"
    ) {
      return true;
    }

    //------------------------------------------------------
    // Input controls
    //------------------------------------------------------

    if (
      tag === "input" &&
      ["button", "submit", "radio", "checkbox"].includes(
        String(candidate.type || "").toLowerCase(),
      )
    ) {
      return true;
    }

    //------------------------------------------------------
    // Span / div / text node with clickable parent
    //------------------------------------------------------

    if (candidate.parentClickable) {
      return true;
    }

    //------------------------------------------------------
    // Explicit clickable attributes
    //------------------------------------------------------

    if (candidate.onclick || candidate.testid) {
      return true;
    }

    return false;
  }

  //==========================================================
  // EXACT NORMALIZED MATCH
  //==========================================================

  findExactClickCandidates(query, elements = []) {
    const target = this.normalizeForComparison(query);

    if (!target) {
      return [];
    }

    return elements
      .filter((element) => this.isClickableCandidate(element))
      .filter((element) => {
        const values = [
          element.text,

          element.innerText,

          element.ariaLabel,

          element.aria,

          element.title,

          element.placeholder,

          element.name,

          element.testid,

          element.id,

          element.parentClickable?.text,
        ];

        return values.some(
          (value) => this.normalizeForComparison(value) === target,
        );
      })
      .map((element) => ({
        ...element,

        score: 100,

        matchType: "exact",
      }));
  }

  //==========================================================
  // SELECT BEST CANDIDATE
  //==========================================================

  selectBestClickCandidate(candidates = []) {
    if (!candidates.length) {
      return null;
    }

    return [...candidates].sort((a, b) => {
      if (a.visible !== b.visible) {
        return a.visible ? -1 : 1;
      }

      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }

      const aDirect =
        ["button", "a", "label"].includes(String(a.tag).toLowerCase()) ||
        ["button", "tab", "link"].includes(String(a.role).toLowerCase());

      const bDirect =
        ["button", "a", "label"].includes(String(b.tag).toLowerCase()) ||
        ["button", "tab", "link"].includes(String(b.role).toLowerCase());

      if (aDirect !== bDirect) {
        return aDirect ? -1 : 1;
      }

      return 0;
    })[0];
  }

  //==========================================================
  // CLICK TEXT / LABEL / SPAN
  //==========================================================

  async clickExactTextOrParent(query) {
    const page = await this.mcp.getPage();

    const target = this.normalizeForComparison(query);

    if (!target) {
      return null;
    }

    for (const frame of page.frames()) {
      try {
        //----------------------------------------------------
        // 1. Search potentially clickable elements
        //----------------------------------------------------

        const elements = frame.locator(
          [
            "button",
            "a",
            "label",
            "[role='button']",
            "[role='tab']",
            "[role='link']",
            "[role='menuitem']",
            "[role='option']",
            "input[type='radio']",
            "input[type='checkbox']",
          ].join(","),
        );

        const count = Math.min(await elements.count(), 500);

        for (let i = 0; i < count; i++) {
          const element = elements.nth(i);

          if (!(await element.isVisible().catch(() => false))) {
            continue;
          }

          const text = await element.innerText().catch(() => "");

          const aria = await element.getAttribute("aria-label").catch(() => "");

          const title = await element.getAttribute("title").catch(() => "");

          const candidates = [text, aria, title];

          const exact = candidates.some(
            (value) => this.normalizeForComparison(value) === target,
          );

          if (!exact) {
            continue;
          }

          const tag = await element
            .evaluate((el) => el.tagName.toLowerCase())
            .catch(() => "");

          //--------------------------------------------------
          // Radio
          //--------------------------------------------------

          if (
            tag === "input" &&
            (await element.getAttribute("type").catch(() => "")) === "radio"
          ) {
            const checked = await element.isChecked().catch(() => false);

            if (!checked) {
              await element.check({
                force: true,

                timeout: 3000,
              });
            }

            return {
              success: true,

              strategy: "exact-radio",

              frameUrl: frame.url(),
            };
          }

          //--------------------------------------------------
          // Click actual element
          //--------------------------------------------------

          await element.scrollIntoViewIfNeeded().catch(() => {});

          try {
            await element.click({
              timeout: 3000,

              force: false,
            });
          } catch {
            await element.click({
              timeout: 3000,

              force: true,
            });
          }

          return {
            success: true,

            strategy: tag === "label" ? "exact-label" : "exact-interactive",

            frameUrl: frame.url(),
          };
        }

        //----------------------------------------------------
        // 2. Search text nodes
        //----------------------------------------------------

        const textNodes = frame.locator("span, div, label");

        const textCount = Math.min(await textNodes.count(), 500);

        for (let i = 0; i < textCount; i++) {
          const node = textNodes.nth(i);

          if (!(await node.isVisible().catch(() => false))) {
            continue;
          }

          const text = await node.innerText().catch(() => "");

          if (this.normalizeForComparison(text) !== target) {
            continue;
          }

          //------------------------------------------------
          // Find closest clickable parent
          //------------------------------------------------

          const parent = node
            .locator(
              `xpath=ancestor::*[
                self::button
                or self::a
                or self::label
                or @role="button"
                or @role="tab"
                or @role="link"
                or @role="menuitem"
                or @role="option"
                or @onclick
                or @tabindex
                or contains(
                  translate(
                    @class,
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                    "abcdefghijklmnopqrstuvwxyz"
                  ),
                  "tab"
                )
                or contains(
                  translate(
                    @class,
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                    "abcdefghijklmnopqrstuvwxyz"
                  ),
                  "button"
                )
                or contains(
                  translate(
                    @class,
                    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                    "abcdefghijklmnopqrstuvwxyz"
                  ),
                  "btn"
                )
              ][1]`,
            )
            .first();

          if (!(await parent.count())) {
            continue;
          }

          if (!(await parent.isVisible().catch(() => false))) {
            continue;
          }

          const parentText = await parent.innerText().catch(() => "");

          if (!this.normalizeForComparison(parentText).includes(target)) {
            continue;
          }

          await parent.scrollIntoViewIfNeeded().catch(() => {});

          try {
            await parent.click({
              timeout: 3000,

              force: false,
            });
          } catch {
            await parent.click({
              timeout: 3000,

              force: true,
            });
          }

          const parentTag = await parent
            .evaluate((el) => el.tagName.toLowerCase())
            .catch(() => "");

          const parentRole = await parent.getAttribute("role").catch(() => "");

          //------------------------------------------------
          // Radio inside label
          //------------------------------------------------

          if (parentTag === "label") {
            const radio = parent.locator('input[type="radio"]');

            if (await radio.count()) {
              const checked = await radio.isChecked().catch(() => false);

              if (!checked) {
                await radio
                  .check({
                    force: true,

                    timeout: 2000,
                  })
                  .catch(() => {});
              }
            }
          }

          return {
            success: true,

            strategy:
              parentRole === "tab"
                ? "exact-tab-parent"
                : parentTag === "label"
                  ? "exact-label-parent"
                  : "exact-text-parent",

            frameUrl: frame.url(),

            parentTag,

            parentRole,
          };
        }
      } catch (error) {
        this.log("Exact text search failed:", frame.url(), error.message);
      }
    }

    return null;
  }

  //==========================================================
  // SCORING ENGINE CLICK
  //==========================================================

  async resolveByScoring(query, elements) {
    let ranked = this.scoringEngine.rankCandidates(query);

    if (!ranked?.length) {
      return null;
    }

    ranked = ranked.filter((candidate) => this.isClickableCandidate(candidate));

    if (!ranked.length) {
      return null;
    }

    ranked.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const candidate = ranked[0];

    this.log("Scoring result:", {
      query,

      text: candidate.text,

      score: candidate.score,

      role: candidate.role,

      tag: candidate.tag,
    });

    return {
      candidate,

      ranked,
    };
  }

  //==========================================================
  // EXECUTE CLICK
  //==========================================================

  async executeClickCandidate(candidate, query) {
    if (!candidate) {
      return {
        success: false,

        verified: false,
      };
    }

    //------------------------------------------------------
    // Preferred frame
    //------------------------------------------------------

    if (candidate.frame) {
      const result = await this.clickCandidateInScope(
        candidate.frame,
        candidate,
      );

      if (result.success) {
        return result;
      }
    }

    //------------------------------------------------------
    // Current page
    //------------------------------------------------------

    const page = await this.mcp.getPage();

    let result = await this.clickCandidateInScope(page, candidate);

    if (result.success) {
      return result;
    }

    //------------------------------------------------------
    // All frames
    //------------------------------------------------------

    for (const frame of page.frames()) {
      result = await this.clickCandidateInScope(frame, candidate);

      if (result.success) {
        this.stats.frameMatches++;

        return result;
      }
    }

    //------------------------------------------------------
    // Evolution frame fallback
    //------------------------------------------------------

    try {
      const text =
        candidate.text || candidate.aria || candidate.ariaLabel || query;

      const clicked = await clickInsideEvolutionFrame(page, text);

      if (clicked) {
        return {
          success: true,

          verified: true,

          method: "evolution-frame",
        };
      }
    } catch (error) {
      this.log("Evolution fallback failed:", error.message);
    }

    return {
      success: false,

      verified: false,
    };
  }

  //==========================================================
  // CLICK CANDIDATE IN SCOPE
  //==========================================================

  async clickCandidateInScope(scope, candidate) {
    //------------------------------------------------------
    // 1. Role + accessible name
    //------------------------------------------------------

    if (candidate.role && candidate.text) {
      try {
        const locator = scope
          .getByRole(candidate.role, {
            name: candidate.text,

            exact: true,
          })
          .first();

        if (await locator.count()) {
          if (await locator.isVisible().catch(() => false)) {
            await locator.scrollIntoViewIfNeeded().catch(() => {});

            await locator.click({
              timeout: 3000,
            });

            return {
              success: true,

              verified: true,

              method: "role",
            };
          }
        }
      } catch {
        // Continue
      }
    }

    //------------------------------------------------------
    // 2. Direct text
    //------------------------------------------------------

    if (candidate.text) {
      try {
        const locator = scope
          .getByText(candidate.text, {
            exact: true,
          })
          .first();

        if (await locator.count()) {
          if (await locator.isVisible().catch(() => false)) {
            const tag = await locator
              .evaluate((el) => el.tagName.toLowerCase())
              .catch(() => "");

            //------------------------------------------------
            // Direct interactive
            //------------------------------------------------

            if (["button", "a", "label"].includes(tag)) {
              await locator.click({
                timeout: 3000,
              });

              return {
                success: true,

                verified: true,

                method: "text-direct",
              };
            }

            //------------------------------------------------
            // Parent
            //------------------------------------------------

            const parent = locator
              .locator(
                `xpath=ancestor::*[
                    self::button
                    or self::a
                    or self::label
                    or @role="button"
                    or @role="tab"
                    or @role="link"
                    or @role="menuitem"
                    or @role="option"
                    or @onclick
                    or @tabindex
                  ][1]`,
              )
              .first();

            if (await parent.count()) {
              await parent.click({
                timeout: 3000,
              });

              return {
                success: true,

                verified: true,

                method: "text-parent",
              };
            }
          }
        }
      } catch {
        // Continue
      }
    }

    //------------------------------------------------------
    // 3. Candidate selectors
    //------------------------------------------------------

    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();

        if (!(await locator.count())) {
          continue;
        }

        if (!(await locator.isVisible().catch(() => false))) {
          continue;
        }

        await locator.scrollIntoViewIfNeeded().catch(() => {});

        await locator.click({
          timeout: 3000,

          force: false,
        });

        return {
          success: true,

          verified: true,

          method: "selector",

          selector,
        };
      } catch {
        // Try next
      }
    }

    //------------------------------------------------------
    // 4. Span / label parent fallback
    //------------------------------------------------------

    if (candidate.text) {
      try {
        const text = scope
          .getByText(candidate.text, {
            exact: true,
          })
          .first();

        if (await text.count()) {
          const parent = text.locator(
            `xpath=ancestor::*[
                self::button
                or self::a
                or self::label
                or @role="button"
                or @role="tab"
                or @role="link"
                or @role="menuitem"
                or @role="option"
                or @onclick
                or @tabindex
              ][1]`,
          );

          if (await parent.count()) {
            await parent.scrollIntoViewIfNeeded().catch(() => {});

            await parent.click({
              timeout: 3000,
            });

            return {
              success: true,

              verified: true,

              method: "parent-fallback",
            };
          }
        }
      } catch {
        // Continue
      }
    }

    return {
      success: false,

      verified: false,
    };
  }

  //==========================================================
  // CLICK SMART
  //
  // MAIN CLICK API
  //
  // IMPORTANT:
  // --------------------------------------------------------
  // The target-aware wait happens BEFORE DOM resolution.
  //
  // This fixes:
  //
  // Navigate
  //    ↓
  // Click immediately
  //
  // where the page is technically loaded but the SPA UI
  // has not rendered the requested target yet.
  //==========================================================

  async clickSmart(input) {
    const started = this.startTimer();

    return await this.executeWithHealing("clickSmart", input, async (ctx) => {
      //--------------------------------------------------
      // Validate
      //--------------------------------------------------

      if (
        input === undefined ||
        input === null ||
        String(input).trim() === ""
      ) {
        throw new Error("clickSmart requires a target");
      }

      const query = String(input).trim();

      this.log("==========================================");

      this.log("CLICK SMART:", query);

      this.log("==========================================");

      //--------------------------------------------------
      // 1. WAIT FOR TARGET
      //
      // Critical for multi-step navigation.
      //--------------------------------------------------

      await this.waitForTarget(query, this.options.targetWaitTimeout);

      //--------------------------------------------------
      // 2. FORCE FRESH DOM
      //--------------------------------------------------

      await this.ensureFreshDOM();

      //--------------------------------------------------
      // 3. EXACT NORMALIZED DOM CLICK
      //--------------------------------------------------

      const exact = await this.clickExactTextOrParent(query);

      if (exact?.success) {
        this.stats.clicks++;

        this.stats.exactMatches++;

        this.stopTimer(started);

        return {
          success: true,

          action: "click",

          confidence: 100,

          matchType: exact.strategy,

          verified: true,

          frameUrl: exact.frameUrl,

          candidate: {
            text: query,

            score: 100,
          },
        };
      }

      //--------------------------------------------------
      // 4. BUILD DOM INDEX
      //--------------------------------------------------

      const dom = await this.buildDOMIndex(ctx?.retry > 0);

      const elements = dom?.elements || [];

      if (!elements.length) {
        throw new Error(`No DOM elements found while searching for '${query}'`);
      }

      //--------------------------------------------------
      // 5. EXACT INDEX MATCH
      //--------------------------------------------------

      const exactCandidates = this.findExactClickCandidates(query, elements);

      if (exactCandidates.length) {
        const candidate = this.selectBestClickCandidate(exactCandidates);

        const execution = await this.executeClickCandidate(candidate, query);

        if (execution.success) {
          this.remember(query, candidate);

          this.stats.clicks++;

          this.stats.exactMatches++;

          this.stopTimer(started);

          return {
            success: true,

            action: "click",

            confidence: 100,

            matchType: "exact-index",

            verified: execution.verified,

            candidate: {
              text: candidate.text,

              role: candidate.role,

              tag: candidate.tag,

              score: 100,
            },
          };
        }
      }

      //--------------------------------------------------
      // 6. SCORING ENGINE
      //--------------------------------------------------

      const scored = await this.resolveByScoring(query, elements);

      if (!scored) {
        throw new Error(`Unable to locate clickable element '${query}'`);
      }

      let finalCandidate = scored.candidate;

      this.log("Scoring candidate:", {
        requested: query,

        matched: finalCandidate.text,

        score: finalCandidate.score,

        matchType: finalCandidate.matchType,
      });

      //--------------------------------------------------
      // Count fuzzy match
      //--------------------------------------------------

      if (!finalCandidate.exactMatch && finalCandidate.score < 100) {
        this.stats.fuzzyMatches++;
      }

      //--------------------------------------------------
      // 7. LOW CONFIDENCE
      //
      // Planner only for genuine ambiguity.
      //--------------------------------------------------

      if (Number(finalCandidate.score || 0) < this.options.plannerThreshold) {
        this.stats.plannerCalls++;

        this.log("Low scoring match. Planner fallback.");

        const plan = await this.planner.plan(`Click "${query}"`, {
          action: "click",

          target: query,

          ranked: scored.ranked,

          dom: elements,
        });

        if (plan?.steps?.length) {
          const step = plan.steps[0];

          const plannerTarget = step.target || step.text || query;

          this.log("Planner target:", plannerTarget);

          const plannerScored = await this.resolveByScoring(
            plannerTarget,
            elements,
          );

          if (
            plannerScored?.candidate &&
            Number(plannerScored.candidate.score || 0) >
              Number(finalCandidate.score || 0)
          ) {
            finalCandidate = plannerScored.candidate;

            this.stats.plannerRecoveries++;
          }
        }
      }

      //--------------------------------------------------
      // 8. CONFIDENCE
      //--------------------------------------------------

      const score = Number(finalCandidate?.score || 0);

      if (!finalCandidate || score < this.options.minimumConfidence) {
        throw new Error(
          `Low confidence click match for '${query}': ${score.toFixed(1)}%`,
        );
      }

      //--------------------------------------------------
      // 9. EXECUTE
      //--------------------------------------------------

      const execution = await this.executeClickCandidate(finalCandidate, query);

      if (!execution.success) {
        throw new Error(`Playwright could not click '${query}'`);
      }

      //--------------------------------------------------
      // 10. LEARN
      //--------------------------------------------------

      this.remember(query, finalCandidate);

      this.stats.clicks++;

      this.stopTimer(started);

      //--------------------------------------------------
      // 11. RETURN
      //--------------------------------------------------

      return {
        success: true,

        action: "click",

        confidence: Number(score.toFixed(2)),

        matchType: finalCandidate.matchType || "scored",

        verified: execution.verified,

        candidate: {
          text: finalCandidate.text,

          role: finalCandidate.role,

          tag: finalCandidate.tag,

          score,
        },
      };
    });
  }

  //==========================================================
  // TYPE SMART
  //==========================================================
  /**
   * Find an input using its visible label.
   *
   * IMPORTANT:
   * - Does NOT use findSemanticInputCandidate()
   * - Does NOT depend on input type
   * - Does NOT depend on autocomplete
   * - Does NOT depend on input id/name
   *
   * Strategy:
   *   label text
   *      ↓
   *   walk N parents
   *      ↓
   *   find input inside parent
   */
  /**
   * Find an input by its associated/visible label.
   *
   * Strategy:
   *
   *   Label
   *     ↓
   *   parent
   *     ↓
   *   parent / field container
   *     ↓
   *   input inside container
   *
   * This intentionally does NOT use findSemanticInputCandidate().
   */
  async findInputByLabel(labelText) {
    if (!labelText) {
      return null;
    }

    if (!this.page || this.page.isClosed()) {
      throw new Error("Browser controller is closed");
    }

    const target = String(labelText).trim().toLowerCase();

    const labelNodes = this.page.locator(
      ".field-base__label, " +
        ".field-base-label, " +
        ".field-base-label-text, " +
        "label, " +
        "[class*='label']",
    );

    const count = await labelNodes.count();

    for (let i = 0; i < count; i++) {
      const label = labelNodes.nth(i);

      try {
        if (!(await label.isVisible())) {
          continue;
        }

        const text = (await label.textContent())?.trim();

        if (!text) {
          continue;
        }

        const normalized = text.toLowerCase();

        /*
         * Exact label match.
         *
         * Example:
         *
         * query = "email"
         * DOM   = "E-mail or ID"
         */
        const matches =
          normalized === target ||
          normalized.includes(target) ||
          target.includes(normalized);

        if (!matches) {
          continue;
        }

        /*
         * Find the nearest ancestor that contains
         * an INPUT.
         *
         * This is the important part.
         *
         * label
         *   ↑ parent
         *   ↑ parent
         *   ↑ field container
         *       ↓
         *      input
         */

        const field = label.locator("xpath=ancestor::*[.//input][1]");

        if (await field.count()) {
          const inputs = field.locator(
            "input:not([type='hidden']):not([disabled])",
          );

          const inputCount = await inputs.count();

          for (let j = 0; j < inputCount; j++) {
            const input = inputs.nth(j);

            if (!(await input.isVisible())) {
              continue;
            }

            return {
              input,
              label,
              labelText: text,
              strategy: "label-parent-input",
              score: 100,
            };
          }
        }

        /*
         * Explicit parent fallback.
         * Useful for Material UI/custom wrappers.
         */
        for (let parentLevel = 1; parentLevel <= 6; parentLevel++) {
          const parent = label.locator(`xpath=${"../".repeat(parentLevel)}`);

          if (!(await parent.count())) {
            continue;
          }

          const inputs = parent.locator(
            "input:not([type='hidden']):not([disabled])",
          );

          const inputCount = await inputs.count();

          for (let j = 0; j < inputCount; j++) {
            const input = inputs.nth(j);

            if (await input.isVisible()) {
              return {
                input,
                label,
                labelText: text,
                strategy: `label-parent-${parentLevel}`,
                score: 100,
              };
            }
          }
        }
      } catch (error) {
        // DOM changed; continue scanning labels.
      }
    }

    return null;
  }
  async typeSmart(input, explicitValue = null) {
    const started = this.startTimer();

    return await this.executeWithHealing("typeSmart", input, async (ctx) => {
      if (!input) {
        throw new Error("typeSmart requires input");
      }

      const parsed = this.intentParser.parse(input);

      const step = parsed.steps?.[0];

      if (!step) {
        throw new Error("Unable to parse type action");
      }

      if (step.action !== "type") {
        throw new Error(`Expected type action but received '${step.action}'`);
      }

      const query = step.target || input;

      const value = explicitValue ?? step.value;

      if (value === undefined || value === null) {
        throw new Error("No typing value provided");
      }

      await this.ensureFreshDOM();

      /*
       * ======================================================
       * 1. LABEL-FIRST RESOLUTION
       * ======================================================
       *
       * Do NOT use:
       *
       * findSemanticInputCandidate()
       *
       * Do NOT depend on:
       *
       * input[type="email"]
       * input[name="email"]
       * input[type="username"]
       *
       * The visible label is the semantic source.
       */

      const labelCandidate = await this.findInputByLabel(query);

      if (labelCandidate) {
        console.log(`[typeSmart] Label match: "${labelCandidate.labelText}"`);

        console.log(`[typeSmart] Strategy: ${labelCandidate.strategy}`);

        const typed = await this.typeIntoInput(labelCandidate.input, value);

        if (!typed) {
          throw new Error(`Unable to type into label '${query}'`);
        }

        this.stats.types++;

        this.stopTimer(started);

        return {
          success: true,

          action: "type",

          value,

          confidence: 100,

          candidate: {
            text: labelCandidate.labelText,

            role: "textbox",

            tag: "input",

            score: 100,

            strategy: labelCandidate.strategy,
          },
        };
      }

      /*
       * ======================================================
       * 2. FALLBACK TO EXISTING SCORING ENGINE
       * ======================================================
       *
       * Only use scoring when label resolution failed.
       */

      const dom = await this.buildDOMIndex(ctx.retry > 0);

      const elements = dom?.elements || [];

      let ranked = this.scoringEngine
        .rankCandidates(query)
        .filter((candidate) => this.isInputCandidate(candidate));

      if (!ranked.length) {
        throw new Error(`Unable to locate input '${query}'`);
      }

      let candidate = ranked[0];

      /*
       * Planner is still fallback only.
       */
      if (candidate.score < this.options.plannerThreshold) {
        this.stats.plannerCalls++;

        const plan = await this.planner.plan(input, {
          parsed,

          ranked,

          query,

          dom: elements,
        });

        if (plan?.steps?.[0]?.target) {
          const rescored = this.scoringEngine
            .rankCandidates(plan.steps[0].target)
            .filter((x) => this.isInputCandidate(x));

          if (rescored.length && rescored[0].score > candidate.score) {
            candidate = rescored[0];
          }
        }
      }

      if (!candidate || candidate.score < this.options.minimumConfidence) {
        throw new Error(`Low confidence input match for '${query}'`);
      }

      const typed = await this.executeCandidateType(candidate, value);

      if (!typed) {
        throw new Error(`Unable to type into '${query}'`);
      }

      this.remember(query, candidate);

      this.stats.types++;

      this.stopTimer(started);

      return {
        success: true,

        action: "type",

        value,

        confidence: Number(candidate.score.toFixed(2)),

        candidate: {
          text: candidate.text,

          role: candidate.role,

          tag: candidate.tag,

          score: candidate.score,
        },
      };
    });
  }
  async typeIntoInput(input, value) {
    if (!input) {
      return false;
    }

    if (!this.page || this.page.isClosed()) {
      throw new Error("Browser controller is closed");
    }

    try {
      await input.scrollIntoViewIfNeeded();

      await input.click();

      await input.fill(String(value));

      /*
       * Some Vue / React / MUI-style applications listen
       * to keyboard/input/change events.
       *
       * Pressing Tab also causes blur/change handling.
       */
      await input.press("Tab");

      return true;
    } catch (error) {
      console.error("[typeIntoInput] Failed:", error.message);

      return false;
    }
  }
  //==========================================================
  // INPUT CANDIDATE
  //==========================================================

  isInputCandidate(candidate) {
    if (!candidate) {
      return false;
    }

    const tag = String(candidate.tag || candidate.tagName || "").toLowerCase();

    const role = String(candidate.role || "").toLowerCase();

    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      candidate.contenteditable === true ||
      role === "textbox" ||
      role === "combobox" ||
      Boolean(candidate.placeholder)
    );
  }

  //==========================================================
  // TYPE EXECUTION
  //==========================================================

  async executeCandidateType(candidate, value) {
    if (candidate.frame) {
      if (await this.typeCandidate(candidate.frame, candidate, value)) {
        return true;
      }
    }

    const page = await this.mcp.getPage();

    if (await this.typeCandidate(page, candidate, value)) {
      return true;
    }

    for (const frame of page.frames()) {
      if (await this.typeCandidate(frame, candidate, value)) {
        return true;
      }
    }

    return false;
  }

  //==========================================================
  // TYPE CANDIDATE
  //==========================================================

  async typeCandidate(scope, candidate, value) {
    if (!scope || !candidate) {
      return false;
    }

    //------------------------------------------------------
    // Placeholder
    //------------------------------------------------------

    if (candidate.placeholder) {
      try {
        const locator = scope.getByPlaceholder(candidate.placeholder, {
          exact: true,
        });

        if (await locator.count()) {
          await locator.first().fill(String(value));

          return true;
        }
      } catch {}
    }

    //------------------------------------------------------
    // Label
    //------------------------------------------------------

    if (candidate.text) {
      try {
        const locator = scope.getByLabel(candidate.text, {
          exact: true,
        });

        if (await locator.count()) {
          await locator.first().fill(String(value));

          return true;
        }
      } catch {}
    }

    //------------------------------------------------------
    // Selectors
    //------------------------------------------------------

    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();

        if (!(await locator.count())) {
          continue;
        }

        await locator.scrollIntoViewIfNeeded().catch(() => {});

        await locator.fill(String(value));

        return true;
      } catch {
        // Continue
      }
    }

    return false;
  }

  //==========================================================
  // SELECTOR BUILDER
  //==========================================================

  buildCandidateSelectors(candidate) {
    const selectors = [];

    const escapeCSS = (value) => {
      const text = String(value ?? "");

      return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    };

    //------------------------------------------------------
    // Test ID
    //------------------------------------------------------

    if (candidate.testid) {
      selectors.push(`[data-testid="${escapeCSS(candidate.testid)}"]`);
    }

    //------------------------------------------------------
    // ID
    //------------------------------------------------------

    if (candidate.id) {
      selectors.push(`#${escapeCSS(candidate.id)}`);
    }

    //------------------------------------------------------
    // ARIA
    //------------------------------------------------------

    const aria = candidate.aria || candidate.ariaLabel;

    if (aria) {
      selectors.push(`[aria-label="${escapeCSS(aria)}"]`);
    }

    //------------------------------------------------------
    // Placeholder
    //------------------------------------------------------

    if (candidate.placeholder) {
      selectors.push(`[placeholder="${escapeCSS(candidate.placeholder)}"]`);
    }

    //------------------------------------------------------
    // Title
    //------------------------------------------------------

    if (candidate.title) {
      selectors.push(`[title="${escapeCSS(candidate.title)}"]`);
    }

    //------------------------------------------------------
    // Name
    //------------------------------------------------------

    if (candidate.name) {
      selectors.push(`[name="${escapeCSS(candidate.name)}"]`);
    }

    //------------------------------------------------------
    // Role
    //------------------------------------------------------

    if (candidate.role && candidate.text) {
      selectors.push(
        `[role="${escapeCSS(candidate.role)}"]:has-text("${escapeCSS(
          candidate.text,
        )}")`,
      );
    }

    //------------------------------------------------------
    // Tag + text
    //------------------------------------------------------

    if (
      candidate.tag &&
      candidate.text &&
      ["button", "a", "label"].includes(String(candidate.tag).toLowerCase())
    ) {
      selectors.push(
        `${candidate.tag}:has-text("${escapeCSS(candidate.text)}")`,
      );
    }

    return [...new Set(selectors.filter(Boolean))];
  }

  //==========================================================
  // HEALING CONTEXT
  //==========================================================

  createHealingContext(action, query, candidate = null) {
    return {
      action,

      query,

      candidate,

      resolver: this,

      retry: 0,

      timestamp: Date.now(),

      validate(result) {
        return !!result?.success;
      },

      patch: async (error, ctx) => {
        ctx.retry = (ctx.retry || 0) + 1;

        this.recordHealing();

        const message = error?.message || "";

        this.log(`Healing attempt ${ctx.retry}:`, message);

        if (
          /timeout|not found|unable|detached|stale|low confidence/i.test(
            message,
          )
        ) {
          await this.refreshDOM().catch(() => {});
        }

        if (/not found|unable|low confidence/i.test(message)) {
          this.forget(ctx.query);
        }

        if (ctx.retry >= 2) {
          await this.buildDOMIndex(true).catch(() => {});
        }

        return ctx;
      },
    };
  }

  //==========================================================
  // HEALING EXECUTION
  //==========================================================

  async executeWithHealing(action, query, executor) {
    const context = this.createHealingContext(action, query);

    return await this.selfHealing.execute(action, executor, context);
  }

  recordHealing() {
    this.stats.healedExecutions++;
  }

  //==========================================================
  // EXECUTE PLAN
  //==========================================================

  async execute(plan) {
    if (!plan?.steps?.length) {
      return {
        success: false,

        error: "Empty execution plan",
      };
    }

    const results = [];

    for (const step of plan.steps) {
      switch (step.action || step.type) {
        //--------------------------------------------------
        // CLICK
        //--------------------------------------------------

        case "click":
          results.push(
            await this.clickSmart(step.target || step.text || step.value),
          );

          break;

        //--------------------------------------------------
        // TYPE
        //--------------------------------------------------

        case "type":
          results.push(
            await this.typeSmart(step.target || step.text, step.value),
          );

          break;

        //--------------------------------------------------
        // NAVIGATE
        //--------------------------------------------------

        case "navigate": {
          const page = await this.mcp.getPage();

          const url = step.url || step.target || step.value;

          if (!url) {
            results.push({
              success: false,

              action: "navigate",

              error: "Navigation URL missing",
            });

            break;
          }

          this.log("NAVIGATE:", url);

          await page.goto(url, {
            waitUntil: "domcontentloaded",
          });

          //------------------------------------------------
          // IMPORTANT:
          // Navigation replaces the DOM.
          //------------------------------------------------

          this.clearDOMCache();

          this.lastURL = page.url();

          //------------------------------------------------
          // Allow SPA/framework rendering
          // to begin.
          //------------------------------------------------

          await page.waitForTimeout(this.options.navigationRenderDelay);

          await page.waitForLoadState("load").catch(() => {});

          this.log("Navigation ready:", page.url());

          results.push({
            success: true,

            action: "navigate",

            url: page.url(),
          });

          break;
        }

        //--------------------------------------------------
        // WAIT
        //--------------------------------------------------

        case "wait": {
          const page = await this.mcp.getPage();

          await page.waitForTimeout(step.value || step.time || 1000);

          results.push({
            success: true,

            action: "wait",
          });

          break;
        }

        //--------------------------------------------------
        // RELOAD
        //--------------------------------------------------

        case "reload": {
          const page = await this.mcp.getPage();

          await page.reload({
            waitUntil: "domcontentloaded",
          });

          this.clearDOMCache();

          this.lastURL = page.url();

          await page.waitForTimeout(this.options.navigationRenderDelay);

          results.push({
            success: true,

            action: "reload",
          });

          break;
        }

        //--------------------------------------------------
        // BACK
        //--------------------------------------------------

        case "back": {
          const page = await this.mcp.getPage();

          await page.goBack({
            waitUntil: "domcontentloaded",
          });

          this.clearDOMCache();

          this.lastURL = page.url();

          await page.waitForTimeout(this.options.navigationRenderDelay);

          results.push({
            success: true,

            action: "back",
          });

          break;
        }

        //--------------------------------------------------
        // FORWARD
        //--------------------------------------------------

        case "forward": {
          const page = await this.mcp.getPage();

          await page.goForward({
            waitUntil: "domcontentloaded",
          });

          this.clearDOMCache();

          this.lastURL = page.url();

          await page.waitForTimeout(this.options.navigationRenderDelay);

          results.push({
            success: true,

            action: "forward",
          });

          break;
        }

        //--------------------------------------------------
        // UNSUPPORTED
        //--------------------------------------------------

        default:
          results.push({
            success: false,

            action: step.action || step.type,

            error: "Unsupported action",
          });
      }
    }

    return {
      success: results.every((result) => result.success),

      results,
    };
  }

  //==========================================================
  // RESOLVE
  //==========================================================

  async resolve(input) {
    return this.safeExecute(async () => {
      if (!input) {
        throw new Error("Resolver input is empty");
      }

      //--------------------------------------------------
      // Parse command once
      //--------------------------------------------------

      const parsed = this.intentParser.parse(input);

      this.log("Parsed intent:", JSON.stringify(parsed, null, 2));

      if (!parsed.steps?.length) {
        throw new Error(`Unable to understand command '${input}'`);
      }

      const results = [];

      for (const step of parsed.steps) {
        //------------------------------------------------
        // CLICK
        //------------------------------------------------

        if (step.action === "click") {
          const target = step.target || step.value;

          if (!target) {
            throw new Error("Click target is missing");
          }

          results.push(await this.clickSmart(target));

          continue;
        }

        //------------------------------------------------
        // TYPE
        //------------------------------------------------

        if (step.action === "type") {
          results.push(
            await this.typeSmart(step.target || step.value, step.value),
          );

          continue;
        }

        //------------------------------------------------
        // NAVIGATE
        //------------------------------------------------

        if (step.action === "navigate") {
          const page = await this.mcp.getPage();

          const url = step.url || step.target || step.value;

          if (!url) {
            throw new Error("Navigation URL missing");
          }

          this.log("NAVIGATE:", url);

          await page.goto(url, {
            waitUntil: "domcontentloaded",
          });

          //------------------------------------------------
          // Navigation invalidates all cached DOM data.
          //------------------------------------------------

          this.clearDOMCache();

          this.lastURL = page.url();

          //------------------------------------------------
          // Give SPA/framework UI time to render.
          //------------------------------------------------

          await page.waitForTimeout(this.options.navigationRenderDelay);

          await page.waitForLoadState("load").catch(() => {});

          this.log("Navigation ready:", page.url());

          results.push({
            success: true,

            action: "navigate",

            url: page.url(),
          });

          continue;
        }

        //------------------------------------------------
        // WAIT
        //------------------------------------------------

        if (step.action === "wait") {
          const page = await this.mcp.getPage();

          await page.waitForTimeout(step.value || step.time || 1000);

          results.push({
            success: true,

            action: "wait",
          });

          continue;
        }

        //------------------------------------------------
        // UNSUPPORTED
        //------------------------------------------------

        results.push({
          success: false,

          action: step.action,

          error: "Unsupported action",
        });
      }

      return {
        success: results.every((result) => result.success),

        results,
      };
    });
  }

  //==========================================================
  // SAFE EXECUTION
  //==========================================================

  async safeExecute(fn) {
    try {
      return await fn();
    } catch (error) {
      this.error(error);

      return {
        success: false,

        error: error?.message || String(error),
      };
    }
  }

  //==========================================================
  // STATISTICS
  //==========================================================

  getStatistics() {
    return {
      ...this.stats,

      cacheEntries: this.learningCache.size,

      domCached: this.isDOMCacheValid(),
    };
  }

  resetStatistics() {
    this.stats = {
      clicks: 0,

      types: 0,

      plannerCalls: 0,

      plannerRecoveries: 0,

      healedExecutions: 0,

      cacheHits: 0,

      cacheMisses: 0,

      exactMatches: 0,

      fuzzyMatches: 0,

      frameMatches: 0,

      averageResolveTime: 0,

      lastResolveTime: 0,
    };
  }

  dumpStatistics() {
    console.table(this.getStatistics());
  }

  //==========================================================
  // DEBUG
  //==========================================================

  printDOMSummary() {
    console.table({
      Elements: this.domCache.elements?.length || 0,

      Frames: this.frameCache.length,

      URL: this.domCache.url,

      Cached: this.isDOMCacheValid(),
    });
  }

  printTopCandidates(query, limit = 10) {
    const ranked = this.scoringEngine.rankCandidates(query);

    console.table(
      ranked.slice(0, limit).map((x) => ({
        text: x.text,

        role: x.role,

        tag: x.tag,

        score: Number(x.score).toFixed(2),
      })),
    );
  }
}
