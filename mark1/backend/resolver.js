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

  async clickSmart(input) {
    const started = this.startTimer();

    return await this.executeWithHealing("clickSmart", input, async (ctx) => {
      //--------------------------------------------------
      // VALIDATE
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
      // GET PAGE
      //--------------------------------------------------

      const page = await this.mcp.getPage();

      if (!page || page.isClosed()) {
        throw new Error("Browser page is closed");
      }

      //--------------------------------------------------
      // FRESH DOM
      //--------------------------------------------------

      await this.ensureFreshDOM();

      //--------------------------------------------------
      // NORMALIZE
      //--------------------------------------------------

      const normalizedQuery = this.normalizeResolverText(query);

      this.log("Normalized click query:", normalizedQuery);

      //==================================================
      // DIRECT ID MATCH - MAIN PAGE
      //==================================================

      this.log("==========================================");
      this.log("DIRECT ID SEARCH - MAIN PAGE");
      this.log("TARGET ID:", query);
      this.log("==========================================");

      try {
        const escapedId = query.replace(/"/g, '\\"');

        const idLocator = page.locator(`[id="${escapedId}"]`);

        const idCount = await idLocator.count();

        this.log("Main page direct ID match count:", idCount);

        if (idCount > 0) {
          for (let idIndex = 0; idIndex < idCount; idIndex++) {
            try {
              const candidate = idLocator.nth(idIndex);

              const visible = await candidate.isVisible().catch(() => false);

              if (!visible) {
                this.log("Main page direct ID candidate not visible:", idIndex);
                continue;
              }

              const disabled = await candidate.isDisabled().catch(() => false);

              if (disabled) {
                this.log("Main page direct ID candidate disabled:", idIndex);
                continue;
              }

              const tag = await candidate
                .evaluate((el) => String(el.tagName || "").toLowerCase())
                .catch(() => "");

              const text = await candidate.innerText().catch(() => "");

              const role = await candidate
                .getAttribute("role")
                .catch(() => null);

              const dataRole = await candidate
                .getAttribute("data-role")
                .catch(() => null);

              this.log("Main page ID candidate:", {
                id: query,
                tag,
                role,
                dataRole,
                text,
              });

              await candidate.scrollIntoViewIfNeeded().catch(() => {});

              await candidate.click({
                timeout: 7000,
                force: false,
              });

              this.stats.clicks++;
              this.stats.exactMatches++;

              this.remember(query, {
                text: text || query,
                role: role || "",
                tag,
                id: query,
                dataRole,
                matchType: "direct-id-main-page",
                score: 100,
              });

              this.stopTimer(started);

              this.log("DIRECT ID MAIN PAGE CLICK SUCCESS:", query);

              return {
                success: true,
                action: "click",
                confidence: 100,
                matchType: "direct-id-main-page",
                verified: true,
                candidate: {
                  id: query,
                  text: text || query,
                  role: role || "",
                  tag,
                  dataRole,
                  score: 100,
                },
              };
            } catch (idCandidateError) {
              this.log("Main page ID candidate failed:", {
                index: idIndex,
                id: query,
                error: idCandidateError.message,
              });
            }
          }
        }
      } catch (idError) {
        this.log("Main page direct ID search failed:", {
          id: query,
          error: idError.message,
        });
      }

      //==================================================
      // DIRECT ID MATCH - ALL IFRAMES
      //
      // IMPORTANT:
      //
      // This is the critical fix for:
      //
      // Click "SuperSicBo000001"
      //
      // If the element is inside an iframe/tab section,
      // page.locator() cannot see it from the parent page.
      //
      // We explicitly inspect every Playwright frame.
      //==================================================

      this.log("==========================================");
      this.log("DIRECT ID SEARCH - ALL IFRAMES");
      this.log("TARGET ID:", query);
      this.log("==========================================");

      try {
        const allFrames = page.frames();

        this.log(
          "Total frames available for direct ID search:",
          allFrames.length,
        );

        for (let frameIndex = 0; frameIndex < allFrames.length; frameIndex++) {
          const frame = allFrames[frameIndex];

          try {
            if (!frame || frame.isDetached()) {
              continue;
            }

            this.log("Checking frame for exact ID:", {
              frameIndex,
              url: frame.url(),
            });

            const escapedId = query.replace(/"/g, '\\"');

            const frameIdLocator = frame.locator(`[id="${escapedId}"]`);

            const frameIdCount = await frameIdLocator.count();

            this.log("Frame direct ID match count:", {
              frameIndex,
              id: query,
              count: frameIdCount,
            });

            if (frameIdCount === 0) {
              continue;
            }

            for (let idIndex = 0; idIndex < frameIdCount; idIndex++) {
              try {
                const candidate = frameIdLocator.nth(idIndex);

                const visible = await candidate.isVisible().catch(() => false);

                if (!visible) {
                  this.log("Frame ID candidate not visible:", {
                    frameIndex,
                    idIndex,
                  });

                  continue;
                }

                const disabled = await candidate
                  .isDisabled()
                  .catch(() => false);

                if (disabled) {
                  this.log("Frame ID candidate disabled:", {
                    frameIndex,
                    idIndex,
                  });

                  continue;
                }

                const tag = await candidate
                  .evaluate((el) => String(el.tagName || "").toLowerCase())
                  .catch(() => "");

                const text = await candidate.innerText().catch(() => "");

                const role = await candidate
                  .getAttribute("role")
                  .catch(() => null);

                const dataRole = await candidate
                  .getAttribute("data-role")
                  .catch(() => null);

                const className = await candidate
                  .getAttribute("class")
                  .catch(() => null);

                const title = await candidate
                  .getAttribute("title")
                  .catch(() => null);

                this.log("==========================================");

                this.log("EXACT IFRAME ID CANDIDATE FOUND:", {
                  frameIndex,
                  frameUrl: frame.url(),
                  id: query,
                  tag,
                  text,
                  role,
                  dataRole,
                  className,
                  title,
                });

                this.log("==========================================");

                //--------------------------------------------------
                // SCROLL
                //--------------------------------------------------

                await candidate.scrollIntoViewIfNeeded().catch(() => {});

                //--------------------------------------------------
                // FOCUS
                //--------------------------------------------------

                await candidate.focus().catch(() => {});

                //--------------------------------------------------
                // NORMAL CLICK
                //--------------------------------------------------

                try {
                  await candidate.click({
                    timeout: 7000,
                    force: false,
                  });
                } catch (normalClickError) {
                  this.log(
                    "Normal iframe click failed, trying force click:",
                    normalClickError.message,
                  );

                  //--------------------------------------------------
                  // FORCE CLICK FALLBACK
                  //--------------------------------------------------

                  await candidate.click({
                    timeout: 7000,
                    force: true,
                  });
                }

                this.stats.clicks++;
                this.stats.exactMatches++;

                this.remember(query, {
                  text: text || query,
                  role: role || "",
                  tag,
                  id: query,
                  dataRole,
                  className,
                  title,
                  frameUrl: frame.url(),
                  frameIndex,
                  matchType: "direct-id-iframe",
                  score: 100,
                });

                this.stopTimer(started);

                this.log("==========================================");

                this.log("DIRECT IFRAME ID CLICK SUCCESS:", query);

                this.log("Frame:", frameIndex, frame.url());

                this.log("==========================================");

                return {
                  success: true,
                  action: "click",
                  confidence: 100,
                  matchType: "direct-id-iframe",
                  verified: true,
                  frameUrl: frame.url(),
                  frameIndex,
                  candidate: {
                    id: query,
                    text: text || query,
                    role: role || "",
                    tag,
                    dataRole,
                    className,
                    title,
                    score: 100,
                  },
                };
              } catch (idCandidateError) {
                this.log("Iframe ID candidate failed:", {
                  frameIndex,
                  idIndex,
                  id: query,
                  error: idCandidateError.message,
                });
              }
            }
          } catch (frameError) {
            this.log("Iframe direct ID search failed:", {
              frameIndex,
              url: frame?.url?.() || "",
              error: frameError.message,
            });
          }
        }
      } catch (iframeSearchError) {
        this.log("ALL IFRAME ID SEARCH FAILED:", {
          id: query,
          error: iframeSearchError.message,
        });
      }

      //==================================================
      // LOGIN COMMAND
      //==================================================

      const loginCommand =
        normalizedQuery.includes("login") ||
        normalizedQuery.includes("log in") ||
        normalizedQuery.includes("signin") ||
        normalizedQuery.includes("sign in") ||
        normalizedQuery.includes("submit login") ||
        normalizedQuery.includes("login form");

      //==================================================
      // LOGIN FORM RESOLVER
      //==================================================

      if (loginCommand) {
        this.log("LOGIN COMMAND DETECTED:", query);

        const loginFrames = page.frames();

        for (const frame of loginFrames) {
          try {
            const forms = frame.locator("form");

            const formCount = await forms.count();

            this.log("Login form count:", formCount, "frame:", frame.url());

            for (let formIndex = 0; formIndex < formCount; formIndex++) {
              try {
                const form = forms.nth(formIndex);

                if (!(await form.isVisible().catch(() => false))) {
                  continue;
                }

                const passwordInputs = form.locator('input[type="password"]');

                const passwordCount = await passwordInputs.count();

                if (passwordCount === 0) {
                  continue;
                }

                const identityInputs = form.locator(
                  [
                    'input[type="email"]',
                    'input[name*="email" i]',
                    'input[name*="user" i]',
                    'input[name*="login" i]',
                    'input[name*="username" i]',
                    'input[name*="identifier" i]',
                    'input[id*="email" i]',
                    'input[id*="user" i]',
                    'input[id*="login" i]',
                    'input[id*="username" i]',
                    'input[placeholder*="email" i]',
                    'input[placeholder*="user" i]',
                    'input[placeholder*="login" i]',
                    'input[placeholder*="id" i]',
                  ].join(","),
                );

                const identityCount = await identityInputs.count();

                const submitButtons = form.locator(
                  'button[type="submit"], input[type="submit"]',
                );

                const submitCount = await submitButtons.count();

                if (submitCount === 0) {
                  continue;
                }

                let submitButton = null;

                const submitTexts = [
                  "Log in",
                  "Login",
                  "Sign in",
                  "Signin",
                  "Submit",
                ];

                for (
                  let buttonIndex = 0;
                  buttonIndex < submitCount;
                  buttonIndex++
                ) {
                  const candidate = submitButtons.nth(buttonIndex);

                  if (!(await candidate.isVisible().catch(() => false))) {
                    continue;
                  }

                  const text = await candidate.innerText().catch(() => "");

                  const normalizedText = this.normalizeResolverText(text);

                  if (
                    submitTexts.some(
                      (submitText) =>
                        this.normalizeResolverText(submitText) ===
                        normalizedText,
                    )
                  ) {
                    submitButton = candidate;
                    break;
                  }
                }

                if (!submitButton) {
                  for (
                    let buttonIndex = 0;
                    buttonIndex < submitCount;
                    buttonIndex++
                  ) {
                    const candidate = submitButtons.nth(buttonIndex);

                    if (await candidate.isVisible().catch(() => false)) {
                      submitButton = candidate;
                      break;
                    }
                  }
                }

                if (!submitButton) {
                  continue;
                }

                if (await submitButton.isDisabled().catch(() => false)) {
                  continue;
                }

                const buttonText = await submitButton
                  .innerText()
                  .catch(() => "");

                const buttonTag = await submitButton
                  .evaluate((el) => String(el.tagName || "").toLowerCase())
                  .catch(() => "");

                const buttonType = await submitButton
                  .getAttribute("type")
                  .catch(() => null);

                await submitButton.scrollIntoViewIfNeeded().catch(() => {});

                await submitButton.click({
                  timeout: 7000,
                  force: false,
                });

                this.stats.clicks++;
                this.stats.exactMatches++;

                this.remember(query, {
                  text: buttonText || "Log in",
                  role: "button",
                  tag: buttonTag,
                  type: buttonType,
                  matchType: "login-form-submit",
                  score: 100,
                });

                this.stopTimer(started);

                return {
                  success: true,
                  action: "click",
                  confidence: 100,
                  matchType: "login-form-submit",
                  verified: true,
                  frameUrl: frame.url(),
                  candidate: {
                    text: buttonText || "Log in",
                    role: "button",
                    tag: buttonTag,
                    type: buttonType,
                    score: 100,
                    formIndex,
                    identityInputs: identityCount,
                    passwordInputs: passwordCount,
                    submitButtons: submitCount,
                  },
                };
              } catch (formError) {
                this.log("Login form candidate failed:", formError.message);
              }
            }
          } catch (frameError) {
            this.log("Login frame search failed:", frameError.message);
          }
        }
      }

      //==================================================
      // THIRD-PARTY GAME IFRAME
      //==================================================

      this.log("==========================================");
      this.log("THIRD-PARTY GAME IFRAME SEARCH");
      this.log("TARGET:", query);
      this.log("==========================================");

      const gameFrameResult = await this.clickInsideThirdPartyGameIframe(
        page,
        query,
        normalizedQuery,
      );

      if (gameFrameResult?.success) {
        this.stats.clicks++;
        this.stats.exactMatches++;

        this.stopTimer(started);

        return gameFrameResult;
      }

      //==================================================
      // SECONDARY FRAME SEARCH
      //==================================================

      const allFrames = page.frames();

      this.log("Fallback frame count:", allFrames.length);

      for (let frameIndex = 0; frameIndex < allFrames.length; frameIndex++) {
        const frame = allFrames[frameIndex];

        try {
          this.log("Checking fallback frame:", {
            frameIndex,
            url: frame.url(),
          });

          const result = await this.searchAndClickFrame(
            frame,
            query,
            normalizedQuery,
            page,
            frameIndex,
          );

          if (result?.success) {
            this.stats.clicks++;
            this.stats.exactMatches++;

            this.stopTimer(started);

            return result;
          }
        } catch (frameError) {
          this.log("Fallback frame failed:", {
            frameIndex,
            url: frame.url(),
            error: frameError.message,
          });
        }
      }

      //==================================================
      // WAIT FOR TARGET
      //==================================================

      try {
        await this.waitForTarget(query, this.options.targetWaitTimeout);
      } catch (waitError) {
        this.log("waitForTarget did not find target:", waitError.message);
      }

      //==================================================
      // FRESH DOM
      //==================================================

      await this.ensureFreshDOM();

      //==================================================
      // NORMAL PAGE EXACT CLICK
      //==================================================

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

      //==================================================
      // BUILD DOM INDEX
      //==================================================

      const dom = await this.buildDOMIndex(ctx?.retry > 0);

      const elements = dom?.elements || [];

      if (!elements.length) {
        throw new Error(`No DOM elements found while searching for '${query}'`);
      }

      //==================================================
      // EXACT INDEX
      //==================================================

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

      //==================================================
      // SCORING
      //==================================================

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

      if (!finalCandidate.exactMatch && finalCandidate.score < 100) {
        this.stats.fuzzyMatches++;
      }

      //==================================================
      // PLANNER
      //==================================================

      if (Number(finalCandidate.score || 0) < this.options.plannerThreshold) {
        this.stats.plannerCalls++;

        const plan = await this.planner.plan(`Click "${query}"`, {
          action: "click",
          target: query,
          ranked: scored.ranked,
          dom: elements,
        });

        if (plan?.steps?.length) {
          const step = plan.steps[0];

          const plannerTarget = step.target || step.text || query;

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

      //==================================================
      // CONFIDENCE
      //==================================================

      const score = Number(finalCandidate?.score || 0);

      if (!finalCandidate || score < this.options.minimumConfidence) {
        throw new Error(
          `Low confidence click match for '${query}': ${score.toFixed(1)}%`,
        );
      }

      //==================================================
      // EXECUTE
      //==================================================

      const execution = await this.executeClickCandidate(finalCandidate, query);

      if (!execution.success) {
        throw new Error(`Playwright could not click '${query}'`);
      }

      //==================================================
      // LEARN
      //==================================================

      this.remember(query, finalCandidate);

      this.stats.clicks++;

      this.stopTimer(started);

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

  /* ======================================================
   THIRD-PARTY GAME IFRAME
   ====================================================== */

  async clickInsideThirdPartyGameIframe(page, query, normalizedQuery) {
    const iframeSelector = 'iframe[data-test-id="thirdparty_game_iframe"]';

    this.log("Looking for:", iframeSelector);

    let iframeLocator = page.locator(iframeSelector);

    let iframeCount = await iframeLocator.count().catch(() => 0);

    this.log("thirdparty_game_iframe count:", iframeCount);

    //--------------------------------------------------
    // Wait for iframe to appear.
    //
    // The iframe is often inserted after the casino
    // page itself has already loaded.
    //--------------------------------------------------

    if (iframeCount === 0) {
      try {
        await page.locator(iframeSelector).first().waitFor({
          state: "attached",
          timeout: 15000,
        });

        iframeCount = await page
          .locator(iframeSelector)
          .count()
          .catch(() => 0);
      } catch (error) {
        this.log("Game iframe did not appear:", error.message);

        return null;
      }
    }

    if (iframeCount === 0) {
      return null;
    }

    //--------------------------------------------------
    // Process every matching game iframe.
    //--------------------------------------------------

    for (let iframeIndex = 0; iframeIndex < iframeCount; iframeIndex++) {
      try {
        iframeLocator = page.locator(iframeSelector).nth(iframeIndex);

        //------------------------------------------------
        // Ensure attached
        //------------------------------------------------

        await iframeLocator
          .waitFor({
            state: "attached",
            timeout: 10000,
          })
          .catch(() => {});

        //------------------------------------------------
        // Wait for visible
        //------------------------------------------------

        await iframeLocator
          .waitFor({
            state: "visible",
            timeout: 10000,
          })
          .catch(() => {});

        //------------------------------------------------
        // Read iframe attributes
        //------------------------------------------------

        const src = await iframeLocator.getAttribute("src").catch(() => null);

        const testId = await iframeLocator
          .getAttribute("data-test-id")
          .catch(() => null);

        this.log("GAME IFRAME FOUND:", {
          iframeIndex,
          testId,
          src,
        });

        //------------------------------------------------
        // CRITICAL:
        //
        // Obtain the actual Frame object.
        //
        // Do NOT rely only on page.frames().
        //------------------------------------------------

        let frame = null;

        for (let attempt = 1; attempt <= 20; attempt++) {
          try {
            frame = await iframeLocator.contentFrame();

            if (frame) {
              break;
            }
          } catch (error) {
            this.log("contentFrame attempt failed:", {
              attempt,
              error: error.message,
            });
          }

          await page.waitForTimeout(500).catch(() => {});
        }

        if (!frame) {
          this.log("Unable to obtain contentFrame:", iframeIndex);

          continue;
        }

        this.log("ACTUAL GAME FRAME ATTACHED:", {
          iframeIndex,
          frameUrl: frame.url(),
        });

        //------------------------------------------------
        // Wait for document/body.
        //------------------------------------------------

        try {
          await frame.locator("body").waitFor({
            state: "attached",
            timeout: 15000,
          });
        } catch (error) {
          this.log("Game iframe body wait:", error.message);
        }

        //------------------------------------------------
        // Give SPA game time to render.
        //------------------------------------------------

        await page.waitForTimeout(1000).catch(() => {});

        //------------------------------------------------
        // SEARCH MAIN GAME FRAME
        //------------------------------------------------

        const result = await this.searchAndClickFrame(
          frame,
          query,
          normalizedQuery,
          page,
          `game-${iframeIndex}`,
        );

        if (result?.success) {
          return result;
        }

        //------------------------------------------------
        // SEARCH NESTED FRAMES
        //------------------------------------------------

        const nestedFrames = frame.childFrames();

        this.log("Nested game frames:", nestedFrames.length);

        for (
          let nestedIndex = 0;
          nestedIndex < nestedFrames.length;
          nestedIndex++
        ) {
          const nestedFrame = nestedFrames[nestedIndex];

          try {
            this.log("Checking nested game frame:", {
              iframeIndex,
              nestedIndex,
              url: nestedFrame.url(),
            });

            const nestedResult = await this.searchAndClickFrame(
              nestedFrame,
              query,
              normalizedQuery,
              page,
              `game-${iframeIndex}-${nestedIndex}`,
            );

            if (nestedResult?.success) {
              return nestedResult;
            }

            //------------------------------------------------
            // One more level.
            //------------------------------------------------

            const deepFrames = nestedFrame.childFrames();

            for (
              let deepIndex = 0;
              deepIndex < deepFrames.length;
              deepIndex++
            ) {
              const deepFrame = deepFrames[deepIndex];

              const deepResult = await this.searchAndClickFrame(
                deepFrame,
                query,
                normalizedQuery,
                page,
                `game-${iframeIndex}-${nestedIndex}-${deepIndex}`,
              );

              if (deepResult?.success) {
                return deepResult;
              }
            }
          } catch (nestedError) {
            this.log("Nested game frame failed:", nestedError.message);
          }
        }
      } catch (iframeError) {
        this.log("Third-party iframe processing failed:", {
          iframeIndex,
          error: iframeError.message,
        });
      }
    }

    return null;
  }

  /* ======================================================
   SEARCH ONE FRAME
   ====================================================== */

  async searchAndClickFrame(
    frame,
    query,
    normalizedQuery,
    page,
    frameIdentifier,
  ) {
    if (!frame) {
      return null;
    }

    this.log("==========================================");

    this.log("SEARCHING FRAME:", {
      frameIdentifier,
      url: frame.url(),
      query,
    });

    this.log("==========================================");

    //--------------------------------------------------
    // Wait until frame DOM exists.
    //--------------------------------------------------

    try {
      await frame.locator("body").waitFor({
        state: "attached",
        timeout: 10000,
      });
    } catch (error) {
      this.log("Frame body not ready:", error.message);
    }

    //--------------------------------------------------
    // CATEGORY NAVIGATOR
    //
    // This is the important resolver for:
    //
    // Baccarat & Sic Bo
    //--------------------------------------------------

    const navigator = frame.locator('[data-role="category-navigator"]');

    const navigatorCount = await navigator.count().catch(() => 0);

    this.log("Category navigator count:", {
      frameIdentifier,
      navigatorCount,
    });

    if (navigatorCount > 0) {
      const categories = navigator.locator("li");

      const categoryCount = await categories.count().catch(() => 0);

      this.log("Category count:", {
        frameIdentifier,
        categoryCount,
      });

      for (
        let categoryIndex = 0;
        categoryIndex < categoryCount;
        categoryIndex++
      ) {
        try {
          const category = categories.nth(categoryIndex);

          const rawText = await category.textContent().catch(() => "");

          const categoryText = this.normalizeResolverText(rawText || "");

          this.log("CATEGORY INSIDE GAME FRAME:", {
            categoryIndex,
            rawText,
            categoryText,
            wanted: normalizedQuery,
          });

          if (categoryText !== normalizedQuery) {
            continue;
          }

          if (!(await category.isVisible().catch(() => false))) {
            continue;
          }

          //------------------------------------------------
          // IMPORTANT:
          //
          // The category <li> may not itself have a
          // button/a/role.
          //
          // Your supplied HTML starts with:
          //
          // <li class="zODTqC PgbkKm">
          //   <div class="p6NDON" data-active="false">
          //
          // Therefore we explicitly test the DIV.
          //------------------------------------------------

          const possibleTargets = [
            category.locator("[data-active]").first(),

            category.locator('[role="button"]').first(),

            category.locator("button").first(),

            category.locator("a").first(),

            category.locator("div").first(),

            category,
          ];

          let clickable = null;

          for (const target of possibleTargets) {
            if ((await target.count().catch(() => 0)) === 0) {
              continue;
            }

            if (await target.isVisible().catch(() => false)) {
              clickable = target;
              break;
            }
          }

          if (!clickable) {
            this.log("No visible category target:", categoryIndex);

            continue;
          }

          await clickable.scrollIntoViewIfNeeded().catch(() => {});

          //------------------------------------------------
          // Inspect.
          //------------------------------------------------

          const tagName = await clickable
            .evaluate((el) => String(el.tagName || "").toLowerCase())
            .catch(() => "");

          const role = await clickable.getAttribute("role").catch(() => null);

          const className = await clickable
            .getAttribute("class")
            .catch(() => null);

          const dataActive = await clickable
            .getAttribute("data-active")
            .catch(() => null);

          this.log("GAME CATEGORY TARGET:", {
            query,
            frameIdentifier,
            categoryIndex,
            tagName,
            role,
            className,
            dataActive,
          });

          //------------------------------------------------
          // ATTEMPT 1
          // Normal Playwright click.
          //------------------------------------------------

          try {
            await clickable.click({
              timeout: 5000,
              force: false,
            });

            await page.waitForTimeout(700).catch(() => {});

            this.log("CATEGORY NORMAL CLICK SUCCESS");

            return {
              success: true,
              action: "click",
              confidence: 100,
              matchType: "thirdparty-game-category",
              verified: true,
              frameUrl: frame.url(),
              candidate: {
                text: rawText || query,
                role,
                tag: tagName,
                className,
                dataActive,
                score: 100,
                frameIdentifier,
                categoryIndex,
              },
            };
          } catch (normalClickError) {
            this.log("Normal iframe click failed:", normalClickError.message);
          }

          //------------------------------------------------
          // ATTEMPT 2
          // Force click.
          //------------------------------------------------

          try {
            await clickable.click({
              timeout: 5000,
              force: true,
            });

            await page.waitForTimeout(700).catch(() => {});

            this.log("CATEGORY FORCE CLICK SUCCESS");

            return {
              success: true,
              action: "click",
              confidence: 100,
              matchType: "thirdparty-game-category-force",
              verified: true,
              frameUrl: frame.url(),
              candidate: {
                text: rawText || query,
                role,
                tag: tagName,
                className,
                dataActive,
                score: 100,
                frameIdentifier,
                categoryIndex,
              },
            };
          } catch (forceError) {
            this.log("Force iframe click failed:", forceError.message);
          }

          //------------------------------------------------
          // ATTEMPT 3
          // Native DOM click.
          //
          // This is useful for React/Vue elements where
          // Playwright's pointer action is blocked by an
          // overlay or transformed element.
          //------------------------------------------------

          try {
            await clickable.evaluate((el) => {
              el.scrollIntoView({
                block: "center",
                inline: "center",
              });

              el.click();
            });

            await page.waitForTimeout(700).catch(() => {});

            this.log("CATEGORY DOM CLICK SUCCESS");

            return {
              success: true,
              action: "click",
              confidence: 100,
              matchType: "thirdparty-game-category-dom",
              verified: true,
              frameUrl: frame.url(),
              candidate: {
                text: rawText || query,
                role,
                tag: tagName,
                className,
                dataActive,
                score: 100,
                frameIdentifier,
                categoryIndex,
              },
            };
          } catch (domError) {
            this.log("DOM click failed:", domError.message);
          }

          //------------------------------------------------
          // ATTEMPT 4
          // Dispatch mouse events from inside the frame.
          //------------------------------------------------

          try {
            await clickable.evaluate((el) => {
              const rect = el.getBoundingClientRect();

              const x = rect.left + rect.width / 2;

              const y = rect.top + rect.height / 2;

              const events = [
                "pointerover",
                "pointerenter",
                "mouseover",
                "mousemove",
                "pointerdown",
                "mousedown",
                "pointerup",
                "mouseup",
                "click",
              ];

              for (const type of events) {
                el.dispatchEvent(
                  new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: x,
                    clientY: y,
                    button: 0,
                  }),
                );
              }
            });

            await page.waitForTimeout(700).catch(() => {});

            this.log("CATEGORY EVENT DISPATCH SUCCESS");

            return {
              success: true,
              action: "click",
              confidence: 100,
              matchType: "thirdparty-game-category-events",
              verified: true,
              frameUrl: frame.url(),
              candidate: {
                text: rawText || query,
                role,
                tag: tagName,
                className,
                dataActive,
                score: 100,
                frameIdentifier,
                categoryIndex,
              },
            };
          } catch (eventError) {
            this.log("Event dispatch failed:", eventError.message);
          }

          //------------------------------------------------
          // ATTEMPT 5
          // Coordinate click inside iframe.
          //
          // This is the final pointer-level fallback.
          //------------------------------------------------

          try {
            const box = await clickable.boundingBox();

            const iframeElement = page.locator(
              'iframe[data-test-id="thirdparty_game_iframe"]',
            );

            const iframeBox = await iframeElement
              .boundingBox()
              .catch(() => null);

            if (box && iframeBox) {
              const x = iframeBox.x + box.x + box.width / 2;

              const y = iframeBox.y + box.y + box.height / 2;

              this.log("COORDINATE CLICK:", {
                x,
                y,
                iframeBox,
                elementBox: box,
              });

              await page.mouse.click(x, y);

              await page.waitForTimeout(700).catch(() => {});

              this.log("CATEGORY COORDINATE CLICK SUCCESS");

              return {
                success: true,
                action: "click",
                confidence: 100,
                matchType: "thirdparty-game-category-coordinate",
                verified: true,
                frameUrl: frame.url(),
                candidate: {
                  text: rawText || query,
                  role,
                  tag: tagName,
                  className,
                  dataActive,
                  score: 100,
                  frameIdentifier,
                  categoryIndex,
                },
              };
            }
          } catch (coordinateError) {
            this.log(
              "Coordinate iframe click failed:",
              coordinateError.message,
            );
          }
        } catch (categoryError) {
          this.log("Game category candidate failed:", categoryError.message);
        }
      }
    }

    //--------------------------------------------------
    // GENERIC TEXT SEARCH INSIDE THIS FRAME
    //--------------------------------------------------

    const candidates = frame.locator(
      [
        "button",
        "a",
        '[role="button"]',
        '[role="link"]',
        "li",
        "[tabindex]",
        "div",
        "span",
      ].join(","),
    );

    const candidateCount = await candidates.count().catch(() => 0);

    this.log("Generic frame candidates:", {
      frameIdentifier,
      candidateCount,
    });

    const maxCandidates = Math.min(candidateCount, 2500);

    for (let index = 0; index < maxCandidates; index++) {
      try {
        const candidate = candidates.nth(index);

        if (!(await candidate.isVisible().catch(() => false))) {
          continue;
        }

        const rawText = await candidate.textContent().catch(() => "");

        const candidateText = this.normalizeResolverText(rawText || "");

        if (candidateText !== normalizedQuery) {
          continue;
        }

        let clickable = candidate;

        const tagName = await candidate
          .evaluate((el) => String(el.tagName || "").toLowerCase())
          .catch(() => "");

        const role = await candidate.getAttribute("role").catch(() => null);

        const directClickable =
          tagName === "button" ||
          tagName === "a" ||
          role === "button" ||
          role === "link" ||
          (await candidate.getAttribute("tabindex").catch(() => null)) !== null;

        if (!directClickable) {
          const parent = candidate
            .locator(
              `xpath=ancestor::*[
                self::button
                or self::a
                or @role="button"
                or @role="link"
                or @onclick
                or @tabindex
              ][1]`,
            )
            .first();

          if (await parent.count().catch(() => 0)) {
            clickable = parent;
          }
        }

        if (!(await clickable.isVisible().catch(() => false))) {
          continue;
        }

        await clickable.scrollIntoViewIfNeeded().catch(() => {});

        //------------------------------------------------
        // Normal click.
        //------------------------------------------------

        try {
          await clickable.click({
            timeout: 5000,
            force: false,
          });

          await page.waitForTimeout(500).catch(() => {});

          const finalTag = await clickable
            .evaluate((el) => String(el.tagName || "").toLowerCase())
            .catch(() => "");

          const finalRole = await clickable
            .getAttribute("role")
            .catch(() => null);

          return {
            success: true,
            action: "click",
            confidence: 100,
            matchType: "thirdparty-game-text",
            verified: true,
            frameUrl: frame.url(),
            candidate: {
              text: rawText || query,
              role: finalRole,
              tag: finalTag,
              score: 100,
              frameIdentifier,
              candidateIndex: index,
            },
          };
        } catch (normalError) {
          this.log("Generic normal click failed:", normalError.message);
        }

        //------------------------------------------------
        // Force.
        //------------------------------------------------

        try {
          await clickable.click({
            timeout: 5000,
            force: true,
          });

          await page.waitForTimeout(500).catch(() => {});

          return {
            success: true,
            action: "click",
            confidence: 100,
            matchType: "thirdparty-game-text-force",
            verified: true,
            frameUrl: frame.url(),
            candidate: {
              text: rawText || query,
              role,
              tag: tagName,
              score: 100,
              frameIdentifier,
              candidateIndex: index,
            },
          };
        } catch (forceError) {
          this.log("Generic force click failed:", forceError.message);
        }

        //------------------------------------------------
        // DOM click.
        //------------------------------------------------

        try {
          await clickable.evaluate((el) => {
            el.scrollIntoView({
              block: "center",
              inline: "center",
            });

            el.click();
          });

          await page.waitForTimeout(500).catch(() => {});

          return {
            success: true,
            action: "click",
            confidence: 100,
            matchType: "thirdparty-game-text-dom",
            verified: true,
            frameUrl: frame.url(),
            candidate: {
              text: rawText || query,
              role,
              tag: tagName,
              score: 100,
              frameIdentifier,
              candidateIndex: index,
            },
          };
        } catch (domError) {
          this.log("Generic DOM click failed:", domError.message);
        }
      } catch (candidateError) {
        this.log("Generic frame candidate failed:", candidateError.message);
      }
    }

    return null;
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
  //======================================================
  // TYPE SMART
  //
  // Supports BOTH:
  //
  // 1. Full natural-language command
  //    typeSmart(
  //      'Fill the "E-mail or ID" field with "abc@gmail.com"'
  //    )
  //
  // 2. Tool-level target + value
  //    typeSmart("E-mail or ID", "abc@gmail.com")
  //
  // IMPORTANT
  // ------------------------------------------------------
  // If explicitValue is provided, input is ALREADY the
  // target. Do NOT send the target through IntentParser.
  //
  // This prevents:
  //
  // "E-mail or ID"
  //        ↓
  // IntentParser
  //        ↓
  // chat
  //
  //======================================================
  //==========================================================
  // TYPE COMMAND PARSER
  //
  // Handles simple deterministic type commands BEFORE
  // IntentParser.
  //
  // Examples:
  //
  // Fill the "E-mail or ID" field with "abc@gmail.com"
  // Fill "E-mail or ID" with "abc@gmail.com"
  // Type "abc@gmail.com" into "E-mail or ID"
  // Enter "abc@gmail.com" in "E-mail or ID"
  //
  // This prevents IntentParser from incorrectly returning:
  //
  // action: "chat"
  //
  //==========================================================

  parseTypeCommand(input) {
    const raw = String(input ?? "").trim();

    if (!raw) {
      return null;
    }

    //--------------------------------------------------------
    // Pattern 1
    //
    // Fill the "FIELD" field with "VALUE"
    //
    //--------------------------------------------------------

    let match = raw.match(
      /^(?:fill|type|enter|input|write)\s+(?:the\s+)?["“'](.+?)["”']\s+(?:field\s+)?(?:with|as)\s+["“']([\s\S]*?)["”']$/i,
    );

    if (match) {
      return {
        action: "type",
        target: match[1].trim(),
        value: match[2],
        source: "deterministic",
      };
    }

    //--------------------------------------------------------
    // Pattern 2
    //
    // Fill "FIELD" with "VALUE"
    //
    //--------------------------------------------------------

    match = raw.match(
      /^(?:fill|type|enter|input|write)\s+["“'](.+?)["”']\s+(?:with|as)\s+["“']([\s\S]*?)["”']$/i,
    );

    if (match) {
      return {
        action: "type",
        target: match[1].trim(),
        value: match[2],
        source: "deterministic",
      };
    }

    //--------------------------------------------------------
    // Pattern 3
    //
    // Type "VALUE" into "FIELD"
    //
    //--------------------------------------------------------

    match = raw.match(
      /^(?:type|enter|input|write|fill)\s+["“']([\s\S]*?)["”']\s+(?:into|in)\s+["“'](.+?)["”']$/i,
    );

    if (match) {
      return {
        action: "type",
        target: match[2].trim(),
        value: match[1],
        source: "deterministic",
      };
    }

    //--------------------------------------------------------
    // Pattern 4
    //
    // Unquoted:
    //
    // Fill email with abc@gmail.com
    //
    //--------------------------------------------------------

    match = raw.match(
      /^(?:fill|type|enter|input|write)\s+(?:the\s+)?(.+?)\s+(?:field\s+)?(?:with|as)\s+(.+)$/i,
    );

    if (match) {
      return {
        action: "type",
        target: match[1].trim(),
        value: match[2].trim(),
        source: "deterministic-unquoted",
      };
    }

    return null;
  }
  //==========================================================
  // TYPE SMART
  //
  // Supports:
  //
  // 1. Tool mode:
  //
  // typeSmart(
  //   "E-mail or ID",
  //   "tamiltanishh@gmail.com"
  // )
  //
  // 2. Natural language:
  //
  // typeSmart(
  //   'Fill the "E-mail or ID" field with "tamiltanishh@gmail.com"'
  // )
  //
  // 3. Other natural forms:
  //
  // Type "abc@gmail.com" into "E-mail or ID"
  // Enter "abc@gmail.com" in "E-mail or ID"
  //
  // IMPORTANT
  // ----------------------------------------------------------
  // Deterministic type parsing happens BEFORE IntentParser.
  //
  // IntentParser must NOT be allowed to turn a simple
  // type command into:
  //
  // action: "chat"
  //
  //==========================================================
  //==========================================================
  // FIND INPUT BY LABEL
  //
  // Works across ALL Playwright frames.
  //
  // Example:
  //
  // "E-mail or ID"
  //       ↓
  // <label>E-mail or ID</label>
  //       ↓
  // parent/container
  //       ↓
  // <input>
  //==========================================================

  async findInputByLabelSafe(labelText) {
    if (!labelText) {
      return null;
    }

    const page = await this.mcp.getPage();

    if (!page || page.isClosed()) {
      throw new Error("Browser controller is closed");
    }

    const target = this.normalizeForComparison(labelText);

    if (!target) {
      return null;
    }

    //--------------------------------------------------------
    // Search every frame
    //--------------------------------------------------------

    for (const frame of page.frames()) {
      try {
        //----------------------------------------------------
        // Native labels
        //----------------------------------------------------

        const labels = frame.locator(
          [
            "label",
            ".field-base__label",
            ".field-base-label",
            ".field-base-label-text",
            "[class*='label']",
          ].join(","),
        );

        const count = Math.min(await labels.count(), 500);

        for (let i = 0; i < count; i++) {
          const label = labels.nth(i);

          if (!(await label.isVisible().catch(() => false))) {
            continue;
          }

          const text = (await label.innerText().catch(() => "")).trim();

          if (!text) {
            continue;
          }

          const normalized = this.normalizeForComparison(text);

          //--------------------------------------------------
          // EXACT MATCH ONLY
          //
          // Don't use fuzzy matching here.
          //--------------------------------------------------

          if (normalized !== target) {
            continue;
          }

          //--------------------------------------------------
          // 1. label[for]
          //--------------------------------------------------

          const forId = await label.getAttribute("for").catch(() => null);

          if (forId) {
            const input = frame
              .locator(`#${this.escapeCSSSelector(forId)}`)
              .first();

            if (
              (await input.count()) &&
              (await input.isVisible().catch(() => false))
            ) {
              return {
                input,
                label,
                labelText: text,
                strategy: "label-for",
                frame,
                score: 100,
              };
            }
          }

          //--------------------------------------------------
          // 2. Input inside label
          //--------------------------------------------------

          const nestedInput = label
            .locator(
              "input:not([type='hidden']):not([disabled]), textarea:not([disabled])",
            )
            .first();

          if (
            (await nestedInput.count()) &&
            (await nestedInput.isVisible().catch(() => false))
          ) {
            return {
              input: nestedInput,
              label,
              labelText: text,
              strategy: "label-input",
              frame,
              score: 100,
            };
          }

          //--------------------------------------------------
          // 3. Closest ancestor containing input
          //--------------------------------------------------

          const field = label
            .locator(
              `xpath=ancestor::*[
              .//input[
                not(@type="hidden")
                and not(@disabled)
              ]
              or
              .//textarea[
                not(@disabled)
              ]
            ][1]`,
            )
            .first();

          if (await field.count()) {
            const inputs = field.locator(
              "input:not([type='hidden']):not([disabled]), textarea:not([disabled])",
            );

            const inputCount = await inputs.count();

            for (let j = 0; j < inputCount; j++) {
              const input = inputs.nth(j);

              if (!(await input.isVisible().catch(() => false))) {
                continue;
              }

              return {
                input,
                label,
                labelText: text,
                strategy: "label-parent-input",
                frame,
                score: 100,
              };
            }
          }

          //--------------------------------------------------
          // 4. Parent fallback
          //--------------------------------------------------

          for (let level = 1; level <= 6; level++) {
            const parent = label
              .locator(`xpath=${"../".repeat(level)}`)
              .first();

            if (!(await parent.count())) {
              continue;
            }

            const inputs = parent.locator(
              "input:not([type='hidden']):not([disabled]), textarea:not([disabled])",
            );

            const inputCount = await inputs.count();

            for (let j = 0; j < inputCount; j++) {
              const input = inputs.nth(j);

              if (await input.isVisible().catch(() => false)) {
                return {
                  input,
                  label,
                  labelText: text,
                  strategy: `label-parent-${level}`,
                  frame,
                  score: 100,
                };
              }
            }
          }
        }
      } catch (error) {
        this.log(
          "[findInputByLabelSafe] Frame failed:",
          frame.url(),
          error.message,
        );
      }
    }

    return null;
  }
  //==========================================================
  // ESCAPE CSS SELECTOR
  //==========================================================

  escapeCSSSelector(value) {
    const text = String(value ?? "");

    if (typeof CSS !== "undefined" && CSS.escape) {
      return CSS.escape(text);
    }

    return text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/([ #;?%&,.+*~\':"!^$[\]()=>|/@])/g, "\\$1");
  }

  //==========================================================
  // TYPE INTO RESOLVED INPUT
  //==========================================================

  async typeIntoResolvedInput(input, value) {
    if (!input) {
      return false;
    }

    try {
      await input.scrollIntoViewIfNeeded().catch(() => {});

      await input.click({
        timeout: 3000,
        force: false,
      });

      await input.fill(String(value));

      //------------------------------------------------------
      // Trigger application change/blur handlers
      //------------------------------------------------------

      await input.press("Tab").catch(() => {});

      return true;
    } catch (error) {
      this.log("[typeIntoResolvedInput] Normal fill failed:", error.message);

      //------------------------------------------------------
      // Force fallback
      //------------------------------------------------------

      try {
        await input.fill(String(value), {
          timeout: 3000,
        });

        return true;
      } catch (fallbackError) {
        this.log(
          "[typeIntoResolvedInput] Fallback failed:",
          fallbackError.message,
        );

        return false;
      }
    }
  }

  //==========================================================
  // VERIFY LOCATOR VALUE
  //==========================================================

  async verifyLocatorValue(locator, expectedValue) {
    if (!locator) {
      return false;
    }

    try {
      const actual = await locator.inputValue();

      return String(actual) === String(expectedValue ?? "");
    } catch {
      return false;
    }
  }
  //==========================================================
  // TYPE SMART - FIXED
  //
  // Supports:
  //
  // typeSmart("E-mail or ID", "tamiltanishh@gmail.com")
  // typeSmart("Password", "your-password")
  //
  // IMPORTANT:
  // ----------------------------------------------------------
  // 1. Never call this.resolveInput()
  // 2. First resolve by visible field label.
  // 3. Then fall back to DOM/scoring.
  // 4. Verify the value after typing.
  //==========================================================

  async typeSmart(input, explicitValue = null) {
    const started = this.startTimer();

    return await this.selfHealing.execute(
      "typeSmart",
      async () => {
        //------------------------------------------------------
        // VALIDATE
        //------------------------------------------------------

        if (
          input === undefined ||
          input === null ||
          String(input).trim() === ""
        ) {
          throw new Error("typeSmart requires an input target");
        }

        const query = String(input).trim();

        //------------------------------------------------------
        // VALUE
        //------------------------------------------------------

        let value = explicitValue;

        //------------------------------------------------------
        // PARSE COMPLETE NATURAL-LANGUAGE COMMAND
        //------------------------------------------------------

        const parsedType = this.parseTypeCommand(query);

        if (parsedType?.action === "type") {
          value =
            explicitValue !== null && explicitValue !== undefined
              ? explicitValue
              : parsedType.value;
        }

        const target =
          parsedType?.action === "type" ? parsedType.target : query;

        if (!target) {
          throw new Error("Type target is empty");
        }

        if (value === undefined || value === null) {
          throw new Error(`No typing value provided for '${target}'`);
        }

        //------------------------------------------------------
        // LOG
        //------------------------------------------------------

        this.log("==========================================");
        this.log("TYPE SMART");
        this.log("Target:", target);
        this.log("Value:", value);
        this.log("==========================================");

        //------------------------------------------------------
        // GET CURRENT PAGE
        //------------------------------------------------------

        const page = await this.mcp.getPage();

        if (!page || page.isClosed()) {
          throw new Error("Browser page is closed");
        }

        //------------------------------------------------------
        // IMPORTANT:
        // After clicking "By email / ID", the login form may
        // be dynamically rendered.
        //------------------------------------------------------

        await page.waitForTimeout(300).catch(() => {});

        //------------------------------------------------------
        // 1. LABEL-BASED RESOLUTION
        //
        // This is the primary fix.
        //
        // Example:
        //
        // "E-mail or ID"
        //       ↓
        // visible label
        //       ↓
        // associated input
        //------------------------------------------------------

        const labelResolved = await this.findInputByLabelSafe(target);

        if (labelResolved?.input) {
          this.log(
            "TYPE label resolver matched:",
            target,
            labelResolved.strategy,
            labelResolved.frame?.url?.() || "",
          );

          //----------------------------------------------------
          // TYPE DIRECTLY INTO THE RESOLVED INPUT
          //----------------------------------------------------

          const typed = await this.typeIntoResolvedInput(
            labelResolved.input,
            value,
          );

          if (!typed) {
            throw new Error(
              `Unable to type into label-resolved field '${target}'`,
            );
          }

          //----------------------------------------------------
          // VERIFY DIRECTLY
          //----------------------------------------------------

          const verified = await this.verifyLocatorValue(
            labelResolved.input,
            value,
          );

          if (!verified) {
            //--------------------------------------------------
            // Retry with fill()
            //--------------------------------------------------

            await labelResolved.input
              .fill(String(value), {
                timeout: 3000,
              })
              .catch(() => {});

            const retryVerified = await this.verifyLocatorValue(
              labelResolved.input,
              value,
            );

            if (!retryVerified) {
              throw new Error(
                `Typing completed but verification failed for '${target}'`,
              );
            }
          }

          //----------------------------------------------------
          // SUCCESS
          //----------------------------------------------------

          this.stats.types++;

          this.stopTimer(started);

          return {
            success: true,
            action: "type",
            value,
            confidence: 100,
            matchType: "label-resolver",
            strategy: labelResolved.strategy,
            verified: true,
            candidate: {
              text: labelResolved.labelText || target,
              tag: "input",
              score: 100,
            },
          };
        }

        //------------------------------------------------------
        // 2. REFRESH DOM
        //------------------------------------------------------

        await this.ensureFreshDOM();

        //------------------------------------------------------
        // 3. BUILD DOM INDEX
        //------------------------------------------------------

        const dom = await this.buildDOMIndex(true);

        const elements = dom?.elements || [];

        //------------------------------------------------------
        // 4. SEMANTIC INPUT RESOLUTION
        //
        // "E-mail or ID" should map to username/email.
        //------------------------------------------------------

        let finalCandidate = this.findSemanticInputCandidate(target, elements);

        //------------------------------------------------------
        // 5. SCORING ENGINE FALLBACK
        //------------------------------------------------------

        if (!finalCandidate) {
          let ranked = this.scoringEngine
            .rankCandidates(target)
            .filter((candidate) => this.isInputCandidate(candidate));

          //----------------------------------------------------
          // Exact normalized fallback
          //----------------------------------------------------

          const normalizedTarget = this.normalizeResolverText(target);

          if (!ranked.length) {
            const allCandidates = this.scoringEngine.rankCandidates("");

            ranked = allCandidates.filter((candidate) => {
              if (!this.isInputCandidate(candidate)) {
                return false;
              }

              const values = [
                candidate.text,
                candidate.placeholder,
                candidate.aria,
                candidate.ariaLabel,
                candidate.title,
                candidate.name,
                candidate.id,
              ];

              return values.some(
                (candidateValue) =>
                  this.normalizeResolverText(candidateValue) ===
                  normalizedTarget,
              );
            });
          }

          if (ranked.length) {
            finalCandidate = ranked[0];
          }
        }

        //------------------------------------------------------
        // 6. NO INPUT FOUND
        //------------------------------------------------------

        if (!finalCandidate) {
          throw new Error(`Unable to locate input '${target}'`);
        }

        //------------------------------------------------------
        // 7. CONFIDENCE
        //------------------------------------------------------

        const confidence = Number(finalCandidate.score || 0);

        this.log(
          "TYPE candidate:",
          JSON.stringify({
            text: finalCandidate.text,
            placeholder: finalCandidate.placeholder,
            aria: finalCandidate.aria,
            name: finalCandidate.name,
            id: finalCandidate.id,
            type: finalCandidate.type,
            score: confidence,
          }),
        );

        //------------------------------------------------------
        // 8. EXECUTE TYPE
        //------------------------------------------------------

        const typed = await this.executeCandidateType(finalCandidate, value);

        if (!typed) {
          throw new Error(`Unable to type into '${target}'`);
        }

        //------------------------------------------------------
        // 9. VERIFY
        //------------------------------------------------------

        const pageAfterType = await this.mcp.getPage();

        const verified = await this.verifyTypedValue(
          pageAfterType,
          finalCandidate,
          value,
        );

        if (!verified) {
          throw new Error(
            `Typing completed but value verification failed for '${target}'`,
          );
        }

        //------------------------------------------------------
        // 10. LEARN
        //------------------------------------------------------

        this.remember(target, finalCandidate);

        //------------------------------------------------------
        // 11. STATISTICS
        //------------------------------------------------------

        this.stats.types++;

        this.stopTimer(started);

        //------------------------------------------------------
        // SUCCESS
        //------------------------------------------------------

        return {
          success: true,
          action: "type",
          value,
          confidence,
          matchType: finalCandidate.matchType || "scored-input",
          verified: true,
          candidate: {
            text: finalCandidate.text || "",
            placeholder: finalCandidate.placeholder || "",
            aria: finalCandidate.aria || finalCandidate.ariaLabel || "",
            name: finalCandidate.name || "",
            id: finalCandidate.id || "",
            type: finalCandidate.type || "",
            tag: finalCandidate.tag || "",
            score: confidence,
          },
        };
      },
      this.createHealingContext("typeSmart", input),
    );
  }
  //=====================================================
  // INPUT CANDIDATE
  //=====================================================

  isInputCandidate(candidate) {
    if (!candidate) {
      return false;
    }

    const tag = String(candidate.tag || candidate.tagName || "").toLowerCase();

    const role = String(candidate.role || "").toLowerCase();

    const type = String(
      candidate.type || candidate.element?.type || "",
    ).toLowerCase();

    //--------------------------------------------------
    // Native inputs
    //--------------------------------------------------

    if (tag === "input" || tag === "textarea") {
      //------------------------------------------------
      // Do not treat hidden inputs as user fields
      //------------------------------------------------

      if (type === "hidden" || candidate.visible === false) {
        return false;
      }

      return true;
    }

    //--------------------------------------------------
    // ARIA textbox
    //--------------------------------------------------

    if (role === "textbox" || role === "searchbox") {
      return candidate.visible !== false;
    }

    //--------------------------------------------------
    // Content editable
    //--------------------------------------------------

    if (candidate.contenteditable === true || candidate.editable === true) {
      return candidate.visible !== false;
    }

    return false;
  }
  //======================================================
  // VERIFY TYPED VALUE
  //======================================================

  async verifyTypedValue(candidate, expectedValue) {
    if (!candidate) {
      return false;
    }

    const expected = String(expectedValue ?? "");

    //----------------------------------------------------
    // Preferred frame
    //----------------------------------------------------

    const scopes = [];

    if (candidate.frame) {
      scopes.push(candidate.frame);
    }

    //----------------------------------------------------
    // Current page
    //----------------------------------------------------

    const page = await this.mcp.getPage();

    scopes.push(page);

    //----------------------------------------------------
    // Try every scope
    //----------------------------------------------------

    for (const scope of scopes) {
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

          const actual = await locator.inputValue();

          if (String(actual) === expected) {
            return true;
          }
        } catch {
          // Try next selector
        }
      }
    }

    return false;
  }
  //======================================================
  // SEMANTIC INPUT RESOLVER
  //
  // Converts human field names into strong DOM matches.
  //
  // Example:
  //
  // "E-mail or ID"
  //      ↓
  // autocomplete="username"
  //      ↓
  // #username
  //
  // "Password"
  //      ↓
  // type="password"
  //      ↓
  // #username-password
  //
  //======================================================

  findSemanticInputCandidate(query = "", elements = []) {
    const normalized = this.normalizeText(query);

    if (!normalized) {
      return null;
    }

    //----------------------------------------------------
    // FIELD SEMANTIC GROUPS
    //----------------------------------------------------

    const groups = {
      username: [
        "email",
        "e-mail",
        "email or id",
        "email/id",
        "e-mail or id",
        "user",
        "user id",
        "userid",
        "username",
        "login",
        "login id",
        "id",
      ],

      password: [
        "password",
        "pass",
        "pwd",
        "current password",
        "current-password",
        "new password",
        "new-password",
      ],

      phone: ["phone", "phone number", "mobile", "mobile number", "telephone"],

      otp: [
        "otp",
        "verification code",
        "verification",
        "code",
        "one time password",
      ],
    };

    //----------------------------------------------------
    // Determine semantic type
    //----------------------------------------------------

    let semanticType = null;

    for (const [type, aliases] of Object.entries(groups)) {
      if (aliases.some((alias) => normalized === this.normalizeText(alias))) {
        semanticType = type;
        break;
      }
    }

    //----------------------------------------------------
    // If not a known semantic field,
    // don't guess.
    //----------------------------------------------------

    if (!semanticType) {
      return null;
    }

    //----------------------------------------------------
    // Candidate scoring
    //----------------------------------------------------

    const candidates = elements.filter((candidate) => {
      const tag = this.normalizeText(candidate.tag || candidate.tagName || "");

      if (tag !== "input" && tag !== "textarea" && tag !== "select") {
        return false;
      }

      if (candidate.visible === false || candidate.enabled === false) {
        return false;
      }

      if (
        candidate.type === "hidden" ||
        candidate.type === "checkbox" ||
        candidate.type === "radio" ||
        candidate.type === "submit" ||
        candidate.type === "button"
      ) {
        return false;
      }

      return true;
    });

    if (!candidates.length) {
      return null;
    }

    //----------------------------------------------------
    // Score candidates
    //----------------------------------------------------

    const ranked = candidates.map((candidate) => {
      let score = 0;

      const id = this.normalizeText(candidate.id);

      const name = this.normalizeText(candidate.name);

      const type = this.normalizeText(candidate.type);

      const autocomplete = this.normalizeText(candidate.autocomplete);

      const placeholder = this.normalizeText(candidate.placeholder);

      const aria = this.normalizeText(candidate.aria || candidate.ariaLabel);

      //------------------------------------------------
      // USERNAME
      //------------------------------------------------

      if (semanticType === "username") {
        if (autocomplete === "username") {
          score += 100;
        }

        if (id === "username") {
          score += 100;
        }

        if (name === "username") {
          score += 90;
        }

        if (id.includes("username")) {
          score += 80;
        }

        if (name.includes("username")) {
          score += 70;
        }

        if (autocomplete.includes("email")) {
          score += 70;
        }

        if (type === "email") {
          score += 60;
        }
      }

      //------------------------------------------------
      // PASSWORD
      //------------------------------------------------

      if (semanticType === "password") {
        if (type === "password") {
          score += 100;
        }

        if (autocomplete === "current-password") {
          score += 100;
        }

        if (id.includes("password")) {
          score += 90;
        }

        if (name.includes("password")) {
          score += 90;
        }

        if (autocomplete.includes("password")) {
          score += 80;
        }
      }

      //------------------------------------------------
      // PHONE
      //------------------------------------------------

      if (semanticType === "phone") {
        if (type === "tel") {
          score += 100;
        }

        if (autocomplete === "tel") {
          score += 90;
        }

        if (id.includes("phone")) {
          score += 80;
        }

        if (name.includes("phone")) {
          score += 80;
        }

        if (placeholder.includes("phone")) {
          score += 60;
        }
      }

      //------------------------------------------------
      // OTP
      //------------------------------------------------

      if (semanticType === "otp") {
        if (id.includes("otp") || name.includes("otp")) {
          score += 100;
        }

        if (id.includes("code") || name.includes("code")) {
          score += 80;
        }
      }

      //------------------------------------------------
      // Generic semantic attributes
      //------------------------------------------------

      const combined = [id, name, placeholder, aria, autocomplete, type].join(
        " ",
      );

      if (combined.includes(normalized)) {
        score += 30;
      }

      return {
        ...candidate,
        score,
        matchType: "semantic-input",
        exactMatch: score >= 100,
      };
    });

    //----------------------------------------------------
    // Highest score
    //----------------------------------------------------

    ranked.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const best = ranked[0];

    if (!best || best.score <= 0) {
      return null;
    }

    //----------------------------------------------------
    // Convert semantic score into Resolver score
    //----------------------------------------------------

    return {
      ...best,

      score: Math.min(100, Number(best.score)),
    };
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

  //=====================================================
  // TYPE CANDIDATE
  //=====================================================

  async typeCandidate(scope, candidate, value) {
    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();

        if (!(await locator.count())) {
          continue;
        }

        //------------------------------------------------
        // VISIBLE
        //------------------------------------------------

        const visible = await locator.isVisible().catch(() => false);

        if (!visible) {
          continue;
        }

        //------------------------------------------------
        // ENABLED
        //------------------------------------------------

        const disabled = await locator.isDisabled().catch(() => false);

        if (disabled) {
          continue;
        }

        //------------------------------------------------
        // SCROLL
        //------------------------------------------------

        await locator.scrollIntoViewIfNeeded().catch(() => {});

        //------------------------------------------------
        // FOCUS
        //------------------------------------------------

        await locator.focus().catch(() => {});

        //------------------------------------------------
        // CLEAR
        //------------------------------------------------

        await locator.fill("");

        //------------------------------------------------
        // TYPE
        //------------------------------------------------

        await locator.fill(String(value));

        //------------------------------------------------
        // VERIFY IMMEDIATELY
        //------------------------------------------------

        const actualValue = await locator.inputValue().catch(() => null);

        if (actualValue !== null && String(actualValue) !== String(value)) {
          this.warn("Type verification mismatch:", {
            selector,
            expected: String(value),
            actual: String(actualValue),
          });

          continue;
        }

        this.log("Typed successfully:", selector);

        return true;
      } catch (error) {
        this.log("Type candidate failed:", selector, error.message);
      }
    }

    return false;
  }
  //=====================================================
  // VERIFY TYPED VALUE
  //=====================================================

  async verifyTypedValue(page, candidate, value) {
    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();

        if (!(await locator.count())) {
          continue;
        }

        const actual = await locator.inputValue().catch(() => null);

        if (actual === null) {
          continue;
        }

        if (String(actual) === String(value)) {
          return true;
        }
      } catch {
        // Continue with next selector
      }
    }

    //--------------------------------------------------
    // Try frames
    //--------------------------------------------------

    for (const frame of page.frames()) {
      for (const selector of selectors) {
        try {
          const locator = frame.locator(selector).first();

          if (!(await locator.count())) {
            continue;
          }

          const actual = await locator.inputValue().catch(() => null);

          if (actual !== null && String(actual) === String(value)) {
            return true;
          }
        } catch {
          // Continue
        }
      }
    }

    return false;
  }
  //==========================================================
  // SELECTOR BUILDER
  //==========================================================

  //=====================================================
  // SELECTOR GENERATOR
  //=====================================================

  buildCandidateSelectors(candidate) {
    const selectors = [];

    const escapeCSS = (value) =>
      String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .trim();

    const escapeText = (value) =>
      String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .trim();

    //--------------------------------------------------
    // TEST ID
    //--------------------------------------------------

    if (candidate.testid) {
      selectors.push(`[data-testid="${escapeCSS(candidate.testid)}"]`);
    }

    //--------------------------------------------------
    // ID
    //--------------------------------------------------

    if (candidate.id) {
      selectors.push(`#${escapeCSS(candidate.id)}`);
    }

    //--------------------------------------------------
    // NAME
    //--------------------------------------------------

    if (candidate.name) {
      selectors.push(`[name="${escapeCSS(candidate.name)}"]`);
    }

    //--------------------------------------------------
    // ARIA
    //--------------------------------------------------

    const aria = candidate.aria || candidate.ariaLabel;

    if (aria) {
      selectors.push(`[aria-label="${escapeCSS(aria)}"]`);
    }

    //--------------------------------------------------
    // PLACEHOLDER
    //--------------------------------------------------

    if (candidate.placeholder) {
      selectors.push(`[placeholder="${escapeCSS(candidate.placeholder)}"]`);
    }

    //--------------------------------------------------
    // TITLE
    //--------------------------------------------------

    if (candidate.title) {
      selectors.push(`[title="${escapeCSS(candidate.title)}"]`);
    }

    //--------------------------------------------------
    // INPUT TYPE
    //--------------------------------------------------

    if (candidate.tag === "input" && candidate.type) {
      selectors.push(`input[type="${escapeCSS(candidate.type)}"]`);
    }

    //--------------------------------------------------
    // LABEL TEXT
    //
    // Example:
    //
    // <label>E-mail or ID</label>
    // <input ...>
    //
    //--------------------------------------------------

    if (candidate.text) {
      const text = escapeText(candidate.text);

      selectors.push(`label:has-text("${text}")`);

      selectors.push(`input:has-text("${text}")`);

      selectors.push(`textarea:has-text("${text}")`);
    }

    //--------------------------------------------------
    // DIRECT TEXT
    //--------------------------------------------------

    if (candidate.text) {
      const text = escapeText(candidate.text);

      selectors.push(`text="${text}"`);

      selectors.push(`:text("${text}")`);
    }

    //--------------------------------------------------
    // ROLE
    //--------------------------------------------------

    if (candidate.role && candidate.text) {
      selectors.push(
        `[role="${escapeCSS(candidate.role)}"]:has-text("${escapeText(candidate.text)}")`,
      );
    }

    //--------------------------------------------------
    // REMOVE DUPLICATES
    //--------------------------------------------------

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

  //======================================================
  // SEQUENTIAL EXECUTION
  //======================================================

  async execute(plan) {
    const steps = this.normalizeExecutionSteps(plan);

    if (!steps.length) {
      return {
        success: false,
        error: "Empty execution plan",
        results: [],
      };
    }

    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      const stepNumber = i + 1;

      this.log(
        `[SequentialExecutor] Step ${stepNumber}/${steps.length}`,
        step.action,
        step.target || step.url || "",
      );

      let result;

      try {
        switch (step.action) {
          //================================================
          // NAVIGATE
          //================================================

          case "navigate": {
            const url = String(step.url || step.target || "").trim();

            if (!url) {
              throw new Error(`Step ${stepNumber}: Navigation URL missing`);
            }

            const page = await this.mcp.getPage();

            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });

            /*
             * Do NOT use networkidle.
             *
             * Login pages often keep network
             * connections open.
             */
            await page.waitForTimeout(500).catch(() => {});

            /*
             * Page changed.
             *
             * Old DOM information is invalid.
             */
            this.invalidateDOMCache();

            result = {
              success: true,
              action: "navigate",
              url,
            };

            break;
          }

          //================================================
          // CLICK
          //================================================

          case "click": {
            const target = String(step.target || "").trim();

            if (!target) {
              throw new Error(`Step ${stepNumber}: click target missing`);
            }

            result = await this.clickSmart(target);

            break;
          }

          //================================================
          // TYPE / FILL
          //================================================

          case "type":
          case "fill": {
            const target = String(step.target || "").trim();

            const value = step.value;

            if (!target) {
              throw new Error(`Step ${stepNumber}: field target missing`);
            }

            if (value === undefined || value === null) {
              throw new Error(
                `Step ${stepNumber}: value missing for '${target}'`,
              );
            }

            result = await this.typeSmart(target, value);

            break;
          }

          //================================================
          // SUBMIT
          //================================================

          case "submit": {
            result = await this.submitSmart(step.target || "");

            break;
          }

          //================================================
          // WAIT
          //================================================

          case "wait": {
            const page = await this.mcp.getPage();

            const time = Math.max(0, Number(step.value) || 500);

            await page.waitForTimeout(time);

            result = {
              success: true,
              action: "wait",
              time,
            };

            break;
          }

          //================================================
          // RELOAD
          //================================================

          case "reload": {
            const page = await this.mcp.getPage();

            await page.reload({
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });

            this.invalidateDOMCache();

            result = {
              success: true,
              action: "reload",
            };

            break;
          }

          //================================================
          // UNKNOWN
          //================================================

          default:
            throw new Error(`Unsupported action '${step.action}'`);
        }

        /*
         * ================================================
         * VERIFY STEP SUCCESS
         * ================================================
         */

        if (!result || result.success !== true) {
          throw new Error(result?.error || `Step ${stepNumber} failed`);
        }

        /*
         * Store successful result.
         */
        results.push({
          step: stepNumber,
          action: step.action,
          target: step.target,
          value:
            step.action === "type" || step.action === "fill"
              ? "[REDACTED]"
              : step.value,
          success: true,
          result,
        });

        if (
          step.action === "click" ||
          step.action === "type" ||
          step.action === "fill" ||
          step.action === "navigate" ||
          step.action === "submit" ||
          step.action === "reload"
        ) {
          this.invalidateDOMCache();
        }

        this.log(`[SequentialExecutor] Step ${stepNumber} SUCCESS`);
      } catch (error) {
        /*
         * ================================================
         * HARD STOP
         * ================================================
         *
         * NEVER continue to the next step.
         */
        const errorMessage = error?.message || String(error);

        this.error(
          `[SequentialExecutor] Step ${stepNumber} FAILED:`,
          errorMessage,
        );

        results.push({
          step: stepNumber,
          action: step.action,
          target: step.target,
          success: false,
          error: errorMessage,
        });

        return {
          success: false,
          stoppedAtStep: stepNumber,
          totalSteps: steps.length,
          completedSteps: results.filter((item) => item.success).length,
          results,
          error: errorMessage,
        };
      }
    }

    /*
     * ALL STEPS SUCCESSFUL
     */
    return {
      success: true,
      totalSteps: steps.length,
      completedSteps: results.length,
      results,
    };
  }
  //======================================================
  // PARSE SEQUENTIAL COMMAND
  //======================================================

  parseSequentialCommand(input) {
    const text = String(input ?? "").trim();

    if (!text) {
      return [];
    }

    /*
     * Normalize line endings.
     */
    const normalized = text.replace(/\r\n?/g, "\n");

    let chunks = normalized
      .split(/\n+/)
      .flatMap((line) => line.trim().split(/(?=\s*\d+\s*[\)\.\-:]\s+)/g))
      .map((line) =>
        line.replace(/^\s*(?:[-*•]\s+|\d+\s*[\)\.\-:]\s*)/, "").trim(),
      )
      .filter(Boolean);

    /*
     * If no numbered instructions were detected,
     * allow IntentParser to split natural commands.
     */
    if (chunks.length <= 1) {
      chunks = this.intentParser
        .splitIntoSteps(text)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    const steps = [];

    for (const chunk of chunks) {
      /*
       * ----------------------------------------------
       * NAVIGATE
       * ----------------------------------------------
       */

      const navigateMatch = chunk.match(
        /^(?:go\s+to|navigate(?:\s+to)?|open)\s+(https?:\/\/\S+)/i,
      );

      if (navigateMatch) {
        steps.push({
          action: "navigate",
          target: navigateMatch[1],
          url: navigateMatch[1],
          value: null,
          confidence: 1,
        });

        continue;
      }

      /*
       * ----------------------------------------------
       * CLICK
       * ----------------------------------------------
       */

      const clickMatch = chunk.match(
        /^(?:please\s+)?click\s+(?:the\s+)?["']?(.+?)["']?\s*$/i,
      );

      if (clickMatch) {
        steps.push({
          action: "click",
          target: clickMatch[1].replace(/^["']|["']$/g, "").trim(),
          value: null,
          confidence: 1,
        });

        continue;
      }

      /*
       * ----------------------------------------------
       * FILL / TYPE
       * ----------------------------------------------
       */

      const fillMatch = chunk.match(
        /^(?:please\s+)?(?:fill|type|enter)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:field\s+)?with\s+["']([\s\S]*)["']$/i,
      );

      if (fillMatch) {
        steps.push({
          action: "type",
          target: fillMatch[1].replace(/^["']|["']$/g, "").trim(),

          value: fillMatch[2],

          confidence: 1,
        });

        continue;
      }

      /*
       * ----------------------------------------------
       * SUBMIT
       * ----------------------------------------------
       */

      if (/^(?:please\s+)?submit\b/i.test(chunk)) {
        const target = chunk.replace(/^(?:please\s+)?submit\s*/i, "").trim();

        steps.push({
          action: "submit",
          target,
          value: null,
          confidence: 1,
        });

        continue;
      }

      /*
       * ----------------------------------------------
       * FALLBACK TO INTENT PARSER
       * ----------------------------------------------
       */

      const parsed = this.intentParser.parse(chunk);

      const parsedSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];

      const validSteps = parsedSteps.filter(
        (step) => step?.action && step.action !== "chat",
      );

      if (validSteps.length) {
        steps.push(...validSteps);
        continue;
      }

      /*
       * Do not silently throw the command away.
       */
      steps.push({
        action: "unknown",
        target: chunk,
        value: null,
        confidence: 0,
      });
    }

    /*
     * Add deterministic sequence numbers.
     */
    return steps.map((step, index) => ({
      ...step,
      sequence: index + 1,
    }));
  }
  //======================================================

  normalizeResolverText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }
  async submitSmart(target = "") {
    const page = await this.mcp.getPage();

    const normalizedTarget = this.normalizeResolverText(target);

    /*
     * First preference:
     * Native submit controls.
     */
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      '[role="button"][type="submit"]',
    ];

    for (const scope of [page, ...page.frames()]) {
      for (const selector of submitSelectors) {
        try {
          const locator = scope.locator(selector).first();

          if (
            (await locator.count()) &&
            (await locator.isVisible().catch(() => false))
          ) {
            await locator.scrollIntoViewIfNeeded().catch(() => {});

            await locator.click({
              timeout: 5000,
            });

            this.invalidateDOMCache();

            return {
              success: true,
              action: "submit",
              method: "submit-button",
            };
          }
        } catch {
          /*
           * Try next candidate.
           */
        }
      }
    }

    /*
     * Text fallback.
     */
    const candidates = await this.getDOMPool(true);

    const submitWords = ["login", "log in", "sign in", "submit", "continue"];

    const candidate = candidates
      .filter((item) => this.isClickableCandidate(item))
      .filter((item) => item.visible !== false && item.enabled !== false)
      .find((item) => {
        const textValue = this.normalizeResolverText(
          item.text || item.ariaLabel || item.title || "",
        );

        if (normalizedTarget && textValue.includes(normalizedTarget)) {
          return true;
        }

        return submitWords.includes(textValue);
      });

    if (candidate) {
      const clicked = await this.executeClickWithVerification(
        candidate,
        target || "submit",
      );

      if (clicked.success) {
        this.invalidateDOMCache();

        return {
          success: true,
          action: "submit",
          method: "fallback-click",
        };
      }
    }

    throw new Error("Unable to locate the login form submit button");
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
      // NORMALIZE INPUT
      //--------------------------------------------------

      const rawInput = String(input).trim();

      const normalizedInput = rawInput
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      this.log("==========================================");
      this.log("RESOLVE INPUT:", rawInput);
      this.log("NORMALIZED INPUT:", normalizedInput);
      this.log("==========================================");

      //--------------------------------------------------
      // DIRECT CANVAS COMMAND
      //
      // This is intentionally checked BEFORE the
      // intent parser.
      //
      // This prevents:
      //
      // "Read canvas"
      //
      // from being interpreted as an unsupported action.
      //--------------------------------------------------

      const isCanvasCommand =
        normalizedInput === "read canvas" ||
        normalizedInput === "read the canvas" ||
        normalizedInput === "canvas" ||
        normalizedInput === "readcanvas" ||
        normalizedInput === "read canvas data" ||
        normalizedInput === "extract canvas" ||
        normalizedInput === "extract canvas data";

      if (isCanvasCommand) {
        this.log("==========================================");
        this.log("CANVAS COMMAND DETECTED");
        this.log("COMMAND:", rawInput);
        this.log("ACTION: readCanvas");
        this.log("==========================================");

        try {
          //------------------------------------------------
          // IMPORTANT:
          //
          // readCanvas() must already exist in this class.
          //------------------------------------------------

          const canvasResult = await this.readCanvas();

          this.log("==========================================");
          this.log("CANVAS READ SUCCESS");
          this.log("CANVAS RESULT:", JSON.stringify(canvasResult, null, 2));
          this.log("==========================================");

          return {
            success: true,

            results: [
              {
                success: true,
                action: "readCanvas",
                command: rawInput,
                data: canvasResult,
              },
            ],
          };
        } catch (canvasError) {
          this.log("==========================================");
          this.log("CANVAS READ FAILED");
          this.log("ERROR:", canvasError.message);
          this.log("==========================================");

          return {
            success: false,

            results: [
              {
                success: false,
                action: "readCanvas",
                command: rawInput,
                error: canvasError.message,
              },
            ],
          };
        }
      }

      //--------------------------------------------------
      // Parse command once
      //--------------------------------------------------

      const parsed = this.intentParser.parse(rawInput);

      this.log("Parsed intent:", JSON.stringify(parsed, null, 2));

      if (!parsed.steps?.length) {
        throw new Error(`Unable to understand command '${rawInput}'`);
      }

      const results = [];

      //--------------------------------------------------
      // PROCESS STEPS
      //--------------------------------------------------

      for (const step of parsed.steps) {
        //------------------------------------------------
        // NORMALIZE ACTION
        //------------------------------------------------

        const action = String(step.action || "")
          .toLowerCase()
          .replace(/[_-]+/g, "")
          .trim();

        this.log("==========================================");
        this.log("PROCESSING STEP");
        this.log("ACTION:", action);
        this.log("STEP:", JSON.stringify(step, null, 2));
        this.log("==========================================");

        //------------------------------------------------
        // CLICK
        //------------------------------------------------

        if (action === "click") {
          const target = step.target || step.value;

          if (!target) {
            throw new Error("Click target is missing");
          }

          this.log("CLICK:", target);

          results.push(await this.clickSmart(target));

          continue;
        }

        //------------------------------------------------
        // TYPE
        //------------------------------------------------

        if (action === "type") {
          const target = step.target || step.field;
          const value = step.value ?? step.text ?? "";

          if (!target) {
            throw new Error("Type target is missing");
          }

          this.log("TYPE TARGET:", target);
          this.log("TYPE VALUE:", value);

          results.push(await this.typeSmart(target, value));

          continue;
        }

        //------------------------------------------------
        // READ CANVAS
        //
        // Supports parser actions such as:
        //
        // readCanvas
        // read_canvas
        // read-canvas
        // canvas
        //------------------------------------------------

        if (
          action === "readcanvas" ||
          action === "canvas" ||
          action === "extractcanvas"
        ) {
          this.log("==========================================");
          this.log("READ CANVAS ACTION");
          this.log("==========================================");

          try {
            const canvasResult = await this.readCanvas({
              target: step.target || step.value || null,
            });

            this.log("Canvas data received:");

            this.log(JSON.stringify(canvasResult, null, 2));

            results.push({
              success: true,

              action: "readCanvas",

              data: canvasResult,
            });
          } catch (canvasError) {
            this.log("Read canvas failed:", canvasError.message);

            results.push({
              success: false,

              action: "readCanvas",

              error: canvasError.message,
            });
          }

          continue;
        }

        //------------------------------------------------
        // NAVIGATE
        //------------------------------------------------

        if (action === "navigate") {
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

        if (action === "wait") {
          const page = await this.mcp.getPage();

          const waitTime = Number(step.value || step.time || 1000);

          this.log("WAIT:", waitTime, "ms");

          await page.waitForTimeout(waitTime);

          results.push({
            success: true,

            action: "wait",

            duration: waitTime,
          });

          continue;
        }

        //------------------------------------------------
        // UNSUPPORTED
        //------------------------------------------------

        this.log("UNSUPPORTED ACTION:", step.action);

        results.push({
          success: false,

          action: step.action,

          error: "Unsupported action",
        });
      }

      //--------------------------------------------------
      // FINAL RESULT
      //--------------------------------------------------

      const success = results.every((result) => result.success);

      this.log("==========================================");
      this.log("RESOLVE COMPLETE");
      this.log("SUCCESS:", success);
      this.log("RESULTS:", JSON.stringify(results, null, 2));
      this.log("==========================================");

      return {
        success,

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
  // READ CANVAS - CONTINUOUS CANVAS CHANGE MONITOR
  //==========================================================
  //
  // Usage:
  //
  // await this.readCanvas();
  //
  // Or:
  //
  // await this.readCanvas({
  //   interval: 250,
  //   duration: 0
  // });
  //
  // duration:
  //   0 = monitor continuously
  //   >0 = monitor for specified milliseconds
  //
  // Every time canvas data changes, a JSON object is logged.
  //
  //==========================================================

  async readCanvas({
    interval = 250,
    duration = 0,
    includeImageData = false,
    includeNumbers = true,
  } = {}) {
    const started = Date.now();

    const page = await this.mcp.getPage();

    if (!page || page.isClosed()) {
      throw new Error("Browser page is closed");
    }

    this.log("==========================================");
    this.log("READ CANVAS STARTED");
    this.log("==========================================");

    this.log(
      "Canvas monitor options:",
      JSON.stringify(
        {
          interval,
          duration,
          includeImageData,
          includeNumbers,
        },
        null,
        2,
      ),
    );

    //--------------------------------------------------------
    // HASH FUNCTION
    //--------------------------------------------------------

    const hashString = (value) => {
      const str = String(value || "");

      let hash = 0;

      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }

      return String(hash);
    };

    //--------------------------------------------------------
    // EXTRACT CANVAS DATA
    //--------------------------------------------------------

    const extractCanvasData = async () => {
      return await page.evaluate(
        ({ includeImageData, includeNumbers }) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));

          const results = [];

          //--------------------------------------------------
          // NUMBER EXTRACTION
          //--------------------------------------------------

          const extractNumbers = (text) => {
            if (!text) {
              return [];
            }

            const matches = String(text).match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)/g);

            if (!matches) {
              return [];
            }

            return [...new Set(matches)].map((value) => {
              const number = Number(value);

              return Number.isFinite(number) ? number : value;
            });
          };

          //--------------------------------------------------
          // CANVAS LOOP
          //--------------------------------------------------

          for (let index = 0; index < canvases.length; index++) {
            const canvas = canvases[index];

            try {
              const rect = canvas.getBoundingClientRect();

              const visible =
                rect.width > 0 &&
                rect.height > 0 &&
                window.getComputedStyle(canvas).display !== "none" &&
                window.getComputedStyle(canvas).visibility !== "hidden";

              if (!visible) {
                continue;
              }

              //------------------------------------------------
              // BASIC INFORMATION
              //------------------------------------------------

              const width = canvas.width;
              const height = canvas.height;

              const cssWidth = rect.width;
              const cssHeight = rect.height;

              const id = canvas.id || "";

              const className =
                typeof canvas.className === "string" ? canvas.className : "";

              //------------------------------------------------
              // CANVAS CONTEXT
              //------------------------------------------------

              let ctx = null;

              try {
                ctx = canvas.getContext("2d", {
                  willReadFrequently: true,
                });
              } catch (_) {
                ctx = null;
              }

              let imageData = null;
              let pixelHash = "";

              //------------------------------------------------
              // READ PIXELS
              //------------------------------------------------

              if (ctx && width > 0 && height > 0) {
                try {
                  imageData = ctx.getImageData(0, 0, width, height);

                  //------------------------------------------------
                  // CREATE COMPACT PIXEL HASH
                  //
                  // Reading every pixel can be expensive on
                  // large canvases, so sample pixels.
                  //------------------------------------------------

                  const data = imageData.data;

                  const sampleSize = Math.min(data.length, 50000);

                  const sample = [];

                  const step = Math.max(
                    4,
                    Math.floor(data.length / sampleSize),
                  );

                  for (let i = 0; i < data.length; i += step) {
                    sample.push(data[i]);
                  }

                  pixelHash = String(
                    sample.reduce(
                      (hash, value) => ((hash << 5) - hash + value) | 0,
                      0,
                    ),
                  );
                } catch (_) {
                  imageData = null;
                }
              }

              //------------------------------------------------
              // CANVAS TEXT
              //
              // Canvas text itself is not available as DOM
              // text. toDataURL gives us a representation of
              // the rendered canvas.
              //------------------------------------------------

              let dataUrl = "";

              try {
                dataUrl = canvas.toDataURL("image/png");
              } catch (_) {
                dataUrl = "";
              }

              //------------------------------------------------
              // PAGE TEXT NEAR CANVAS
              //------------------------------------------------

              let parentText = "";

              try {
                const parent =
                  canvas.parentElement ||
                  canvas.closest("div") ||
                  document.body;

                parentText = String(parent?.innerText || "").trim();
              } catch (_) {
                parentText = "";
              }

              //------------------------------------------------
              // NUMBERS
              //------------------------------------------------

              const numbers = includeNumbers ? extractNumbers(parentText) : [];

              //------------------------------------------------
              // BUILD RESULT
              //------------------------------------------------

              const result = {
                index,

                id,

                className,

                width,

                height,

                cssWidth,

                cssHeight,

                visible,

                numbers,

                parentText,

                pixelHash,

                dataChangedSource: {
                  pixelHash,
                  dataUrlLength: dataUrl.length,
                },
              };

              //------------------------------------------------
              // OPTIONAL IMAGE DATA
              //------------------------------------------------

              if (includeImageData && imageData) {
                result.imageData = Array.from(imageData.data);
              }

              //------------------------------------------------
              // OPTIONAL DATA URL
              //------------------------------------------------

              if (includeImageData) {
                result.dataUrl = dataUrl;
              }

              results.push(result);
            } catch (canvasError) {
              results.push({
                index,
                error: canvasError?.message || String(canvasError),
              });
            }
          }

          return {
            timestamp: new Date().toISOString(),

            url: window.location.href,

            canvasCount: canvases.length,

            canvases: results,
          };
        },
        {
          includeImageData,
          includeNumbers,
        },
      );
    };

    //--------------------------------------------------------
    // CREATE SNAPSHOT HASH
    //--------------------------------------------------------

    const createSnapshotHash = (data) => {
      const compact = data.canvases.map((canvas) => ({
        index: canvas.index,
        id: canvas.id,
        width: canvas.width,
        height: canvas.height,
        pixelHash: canvas.pixelHash,
        dataUrlLength: canvas.dataChangedSource?.dataUrlLength || 0,
        numbers: canvas.numbers || [],
        parentText: canvas.parentText || "",
      }));

      return hashString(JSON.stringify(compact));
    };

    //--------------------------------------------------------
    // INITIAL SNAPSHOT
    //--------------------------------------------------------

    let previousHash = null;

    let changeNumber = 0;

    //--------------------------------------------------------
    // CONTINUOUS MONITOR
    //--------------------------------------------------------

    while (true) {
      //------------------------------------------------------
      // PAGE CHECK
      //------------------------------------------------------

      if (page.isClosed()) {
        this.log("READ CANVAS STOPPED: page closed");
        break;
      }

      //------------------------------------------------------
      // DURATION CHECK
      //------------------------------------------------------

      if (duration > 0 && Date.now() - started >= duration) {
        this.log("READ CANVAS STOPPED: duration reached");

        break;
      }

      //------------------------------------------------------
      // READ CURRENT CANVAS
      //------------------------------------------------------

      let currentData;

      try {
        currentData = await extractCanvasData();
      } catch (error) {
        this.log("READ CANVAS ERROR:", error?.message || String(error));

        await page.waitForTimeout(interval);

        continue;
      }

      //------------------------------------------------------
      // CREATE HASH
      //------------------------------------------------------

      const currentHash = createSnapshotHash(currentData);

      //------------------------------------------------------
      // DETECT CHANGE
      //------------------------------------------------------

      if (previousHash === null) {
        previousHash = currentHash;

        changeNumber++;

        const initialLog = {
          event: "canvas_initial_data",

          changeNumber,

          timestamp: currentData.timestamp,

          url: currentData.url,

          canvasCount: currentData.canvasCount,

          canvases: currentData.canvases,
        };

        this.log("CANVAS DATA:", JSON.stringify(initialLog, null, 2));
      } else if (currentHash !== previousHash) {
        //----------------------------------------------------
        // DATA CHANGED
        //----------------------------------------------------

        changeNumber++;

        const changedLog = {
          event: "canvas_data_changed",

          changeNumber,

          timestamp: currentData.timestamp,

          url: currentData.url,

          canvasCount: currentData.canvasCount,

          canvases: currentData.canvases,
        };

        this.log("==========================================");

        this.log("CANVAS DATA CHANGED:");

        this.log(JSON.stringify(changedLog, null, 2));

        this.log("==========================================");

        previousHash = currentHash;
      }

      //------------------------------------------------------
      // WAIT
      //------------------------------------------------------

      await page.waitForTimeout(interval);
    }

    //--------------------------------------------------------
    // RESULT
    //--------------------------------------------------------

    const result = {
      success: true,

      action: "readCanvas",

      continuous: duration === 0,

      duration,

      interval,

      changesDetected: changeNumber,

      message: "Canvas monitoring completed",
    };

    this.log("READ CANVAS RESULT:", JSON.stringify(result, null, 2));

    return result;
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
