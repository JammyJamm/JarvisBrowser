//==========================================================
//
// backend/resolver.js
//
// Ultra Intelligent Resolver
//
// Architecture
//
// User Input
//      │
//      ▼
// Intent Parser
//      │
//      ├── action
//      ├── target
//      ├── modifiers
//      └── entities
//      │
//      ▼
// Scoring Engine
//      │
//      ├── exact
//      ├── normalized
//      ├── token
//      ├── fuzzy
//      └── accessibility
//      │
//      ▼
// Resolver
//      │
//      ├── DOM exact resolver
//      ├── candidate resolver
//      ├── frame resolver
//      └── planner fallback
//      │
//      ▼
// Playwright
//      │
//      ▼
// Self Healing
//
// IMPORTANT
// ----------------------------------------------------------
// IntentParser  = Understand command
// ScoringEngine = Rank candidates
// Resolver      = Resolve DOM + execute
// Planner       = Fallback for ambiguity
// Playwright    = Browser execution
//
//==========================================================

import { clickInsideEvolutionFrame } from "./utils/iframeContent.js";

import IntentParser from "./planner/intent-parser.js";

import Planner from "./planner/planner.js";

import ScoringEngine from "./planner/scoring-engine.js";

import { SelfHealing } from "./planner/self-healing.js";

export default class Resolver {
  constructor(mcp, options = {}) {
    //--------------------------------------------------
    // Core
    //--------------------------------------------------

    this.mcp = mcp;

    this.options = {
      domCacheTTL: 5000,

      frameCacheTTL: 5000,

      autoRefreshDOM: true,

      enableLearning: true,

      debug: false,

      plannerThreshold: 80,

      minimumConfidence: 60,

      exactMatchConfidence: 100,

      maxExecutionAttempts: 3,

      ...options,
    };

    //--------------------------------------------------
    // AI Components
    //--------------------------------------------------

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

    //--------------------------------------------------
    // DOM Cache
    //--------------------------------------------------

    this.domCache = {
      page: null,

      elements: [],

      frames: [],

      timestamp: 0,

      url: "",
    };

    //--------------------------------------------------
    // Frame Cache
    //
    // IMPORTANT:
    // Keep actual Playwright Frame objects here.
    //
    // Old implementation sometimes changed this into
    // an array and sometimes expected a Map.
    //--------------------------------------------------

    this.frameCache = [];

    //--------------------------------------------------
    // Learned Selectors
    //--------------------------------------------------

    this.selectorCache = new Map();

    //--------------------------------------------------
    // Previous Successful Matches
    //--------------------------------------------------

    this.learningCache = new Map();

    //--------------------------------------------------
    // Performance Statistics
    //--------------------------------------------------

    this.stats = {
      clicks: 0,

      types: 0,

      searches: 0,

      plannerCalls: 0,

      healedExecutions: 0,

      cacheHits: 0,

      cacheMisses: 0,

      exactMatches: 0,

      fuzzyMatches: 0,

      frameMatches: 0,

      plannerRecoveries: 0,

      averageResolveTime: 0,

      lastResolveTime: 0,
    };

    //--------------------------------------------------
    // Runtime State
    //--------------------------------------------------

    this.isBuildingIndex = false;

    this.lastSnapshot = null;

    this.lastURL = "";
  }

  //======================================================
  // DEBUG LOGGER
  //======================================================

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

  //======================================================
  // PERFORMANCE TIMER
  //======================================================

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

  //======================================================
  // NORMALIZE TEXT
  //
  // This is NOT fuzzy matching.
  //
  // It only normalizes DOM/user text so:
  //
  // "Learn More"
  // "learn more"
  // "  Learn   More  "
  //
  // can be treated as the same exact semantic text.
  //======================================================

  normalizeText(value = "") {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  //======================================================
  // CACHE MANAGEMENT
  //======================================================

  clearCaches() {
    this.domCache = {
      page: null,

      elements: [],

      frames: [],

      timestamp: 0,

      url: "",
    };

    this.frameCache = [];

    this.selectorCache.clear();
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

  //======================================================
  // LEARNING
  //======================================================

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
    if (!query) {
      return null;
    }

    return this.learningCache.get(this.normalizeText(query));
  }

  forget(query) {
    if (!query) {
      return;
    }

    this.learningCache.delete(this.normalizeText(query));
  }

  //======================================================
  // BUILD DOM INDEX
  //======================================================

  async buildDOMIndex(force = false) {
    //--------------------------------------------------
    // Cache check
    //--------------------------------------------------

    if (!force && this.isDOMCacheValid()) {
      this.stats.cacheHits++;

      return this.domCache;
    }

    this.stats.cacheMisses++;

    //--------------------------------------------------
    // Prevent duplicate index builds
    //--------------------------------------------------

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

      //--------------------------------------------------
      // Main page + every iframe
      //--------------------------------------------------

      for (const frame of frames) {
        try {
          const elements = await this.extractFrameElements(frame);

          const frameInfo = {
            frame,

            url: frame.url(),

            name: frame.name?.() || "",

            count: elements.length,
          };

          frameIndex.push(frameInfo);

          //--------------------------------------------------
          // Preserve frame reference
          //--------------------------------------------------

          for (const element of elements) {
            element.frame = frame;

            element.frameUrl = frame.url();

            element.frameName = frame.name?.() || "";

            allElements.push(element);
          }
        } catch (err) {
          this.log("Frame skipped:", frame.url(), err.message);
        }
      }

      //--------------------------------------------------
      // Build ScoringEngine index
      //--------------------------------------------------

      if (this.scoringEngine?.buildIndex) {
        this.scoringEngine.buildIndex(allElements);
      }

      //--------------------------------------------------
      // Update cache
      //--------------------------------------------------

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
        `Indexed ${allElements.length} interactive elements across ${frameIndex.length} frame(s).`,
      );

      return this.domCache;
    } finally {
      this.isBuildingIndex = false;
    }
  }

  //======================================================
  // EXTRACT INTERACTIVE ELEMENTS
  //======================================================

  async extractFrameElements(frame) {
    return await frame.evaluate(() => {
      const selectors = [
        "button",

        "a",

        "input",

        "textarea",

        "select",

        "[role='button']",

        "[role='tab']",

        "[role='link']",

        "[role='menuitem']",

        "[role='checkbox']",

        "[role='radio']",

        "[role='option']",

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

        //--------------------------------------------------
        // Multiple text representations
        //
        // This is important for:
        //
        // Click Learn More
        //
        // where "Learn More" may be nested inside:
        //
        // <button>
        //   <span>Learn More</span>
        // </button>
        //--------------------------------------------------

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
        });
      });

      return elements;
    });
  }

  //======================================================
  // GET DOM POOL
  //======================================================

  async getDOMPool(force = false) {
    const cache = await this.buildDOMIndex(force);

    return cache?.elements || [];
  }

  //======================================================
  // REFRESH DOM
  //======================================================

  async refreshDOM() {
    this.clearDOMCache();

    return await this.buildDOMIndex(true);
  }

  //======================================================
  // GET FRAME POOL
  //======================================================

  getFramePool() {
    return this.frameCache;
  }

  //======================================================
  // DEBUG
  //======================================================

  printDOMSummary() {
    if (!this.domCache || !this.domCache.elements?.length) {
      console.log("DOM not indexed.");

      return;
    }

    console.table({
      Elements: this.domCache.elements.length,

      Frames: this.frameCache.length,

      Cached: new Date(this.domCache.timestamp).toLocaleTimeString(),

      URL: this.domCache.url,
    });
  }

  //======================================================
  // EXACT DOM MATCH
  //
  // This is the critical fix for:
  //
  // Click Learn More
  //
  // If DOM contains exactly:
  //
  // "Learn More"
  //
  // this resolver can identify it without depending
  // entirely on fuzzy score.
  //
  // This is normalized exact matching, NOT fuzzy matching.
  //======================================================

  findExactCandidates(query, elements = [], modifiers = {}) {
    const normalizedQuery = this.normalizeText(query);

    if (!normalizedQuery) {
      return [];
    }

    const filtered = this.filterCandidatesByElementType(elements, modifiers);

    const matches = [];

    for (const candidate of filtered) {
      const fields = [
        {
          value: candidate.text,
          weight: 100,
          field: "text",
        },

        {
          value: candidate.innerText,
          weight: 100,
          field: "innerText",
        },

        {
          value: candidate.ariaLabel,
          weight: 98,
          field: "ariaLabel",
        },

        {
          value: candidate.aria,
          weight: 98,
          field: "aria",
        },

        {
          value: candidate.title,
          weight: 95,
          field: "title",
        },

        {
          value: candidate.placeholder,
          weight: 95,
          field: "placeholder",
        },

        {
          value: candidate.name,
          weight: 90,
          field: "name",
        },

        {
          value: candidate.testid,
          weight: 90,
          field: "testid",
        },
      ];

      for (const field of fields) {
        if (!field.value) {
          continue;
        }

        if (this.normalizeText(field.value) === normalizedQuery) {
          matches.push({
            ...candidate,

            score: field.weight,

            matchType: "exact-" + field.field,

            exactMatch: true,
          });

          break;
        }
      }
    }

    return matches;
  }

  //======================================================
  // ELEMENT TYPE FILTER
  //======================================================

  filterCandidatesByElementType(elements = [], modifiers = {}) {
    const type = modifiers?.elementType;

    if (!type) {
      return elements;
    }

    const normalizedType = this.normalizeText(type);

    return elements.filter((candidate) => {
      const tag = this.normalizeText(candidate.tag || candidate.tagName || "");

      const role = this.normalizeText(candidate.role || "");

      switch (normalizedType) {
        case "button":
          return tag === "button" || role === "button";

        case "link":
          return tag === "a" || role === "link";

        case "textbox":
        case "input":
        case "field":
        case "text field":
          return tag === "input" || tag === "textarea" || role === "textbox";

        case "checkbox":
          return (
            (tag === "input" && candidate.type === "checkbox") ||
            role === "checkbox"
          );

        case "radio":
          return (
            (tag === "input" && candidate.type === "radio") || role === "radio"
          );

        case "tab":
          return role === "tab";

        case "menuitem":
          return role === "menuitem";

        case "option":
          return role === "option";

        case "select":
        case "dropdown":
        case "combobox":
          return tag === "select" || role === "combobox";

        default:
          return true;
      }
    });
  }

  //======================================================
  // CLICK SMART
  //======================================================

  //======================================================
  // CLICK SMART
  //
  // IMPORTANT CONTRACT
  //
  // clickSmart() receives TARGET ONLY.
  //
  // User:
  //   "Click Learn More"
  //
  // IntentParser:
  //   {
  //     action: "click",
  //     target: "Learn More"
  //   }
  //
  // Resolver:
  //   clickSmart("Learn More")
  //
  // Therefore:
  //   ❌ Do NOT call IntentParser here
  //   ❌ Do NOT expect "click" in input
  //
  // Pipeline:
  //
  // Target
  //   ↓
  // Exact DOM Match
  //   ↓
  // ScoringEngine
  //   ↓
  // Planner fallback (only if necessary)
  //   ↓
  // Playwright execution
  //   ↓
  // Click verification
  //   ↓
  // Success / Failure
  //
  //======================================================

  async clickSmart(input) {
    const started = this.startTimer();

    return await this.executeWithHealing("clickSmart", input, async (ctx) => {
      //--------------------------------------------------
      // 1. VALIDATE TARGET
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
      this.log("CLICK SMART");
      this.log("Target:", query);
      this.log("==========================================");

      //--------------------------------------------------
      // 2. ENSURE FRESH DOM
      //--------------------------------------------------

      await this.ensureFreshDOM();

      //--------------------------------------------------
      // 3. BUILD DOM INDEX
      //--------------------------------------------------

      const dom = await this.buildDOMIndex(ctx?.retry > 0);

      const elements = dom?.elements || [];

      if (!elements.length) {
        throw new Error(
          `No interactive elements found while searching for '${query}'`,
        );
      }

      //--------------------------------------------------
      // 4. EXACT MATCH FIRST
      //
      // Example:
      //
      // Query:
      //   learn more
      //
      // DOM:
      //   Learn More
      //
      // This should be treated as a very strong match.
      //--------------------------------------------------

      let exactMatches = this.findExactClickCandidates(query, elements);

      this.log("Exact matches:", exactMatches.length);

      //--------------------------------------------------
      // 5. EXECUTE EXACT MATCH
      //--------------------------------------------------

      if (exactMatches.length) {
        const candidate = this.selectBestClickCandidate(exactMatches);

        this.log("Exact candidate:", candidate.text, candidate.score);

        const execution = await this.executeClickWithVerification(
          candidate,
          query,
        );

        if (execution.success) {
          this.remember(query, candidate);

          this.stats.clicks++;

          this.stopTimer(started);

          return {
            success: true,

            action: "click",

            confidence: 100,

            matchType: "exact",

            verified: execution.verified,

            candidate: {
              text: candidate.text,

              role: candidate.role,

              tag: candidate.tag,

              score: 100,
            },
          };
        }

        this.log("Exact candidate execution failed.");
      }

      //--------------------------------------------------
      // 6. SCORING ENGINE
      //
      // Only now use fuzzy / semantic matching.
      //--------------------------------------------------

      let ranked = this.scoringEngine.rankCandidates(query);

      //--------------------------------------------------
      // Keep only clickable elements
      //--------------------------------------------------

      ranked = ranked.filter((candidate) =>
        this.isClickableCandidate(candidate),
      );

      //--------------------------------------------------
      // No candidate
      //--------------------------------------------------

      if (!ranked.length) {
        throw new Error(`Unable to locate clickable element '${query}'`);
      }

      //--------------------------------------------------
      // TOP SCORE
      //--------------------------------------------------

      let finalCandidate = ranked[0];

      this.log(
        "Scoring candidate:",
        finalCandidate.text,

        "Score:",
        finalCandidate.score,
      );

      //--------------------------------------------------
      // 7. LOW SCORE → PLANNER
      //
      // Planner receives explicit click context.
      //
      // IMPORTANT:
      // We do NOT parse "learn more" as an action.
      //--------------------------------------------------

      if (finalCandidate.score < this.options.plannerThreshold) {
        this.stats.plannerCalls++;

        this.log("Low confidence.", "Planner fallback...");

        const plan = await this.planner.plan(`Click "${query}"`, {
          action: "click",

          target: query,

          ranked,

          dom: elements,
        });

        if (plan?.steps?.length) {
          const plannerStep = plan.steps[0];

          const plannerTarget = plannerStep.target || plannerStep.text || query;

          this.log("Planner target:", plannerTarget);

          const rescored = this.scoringEngine.rankCandidates(plannerTarget);

          const clickableRescored = rescored.filter((candidate) =>
            this.isClickableCandidate(candidate),
          );

          if (
            clickableRescored.length &&
            clickableRescored[0].score > finalCandidate.score
          ) {
            finalCandidate = clickableRescored[0];

            this.stats.plannerRecoveries =
              (this.stats.plannerRecoveries || 0) + 1;
          }
        }
      }

      //--------------------------------------------------
      // 8. CONFIDENCE CHECK
      //--------------------------------------------------

      if (!finalCandidate) {
        throw new Error(`No clickable candidate resolved for '${query}'`);
      }

      if (finalCandidate.score < this.options.minimumConfidence) {
        throw new Error(
          `Low confidence click match for '${query}': ` +
            `${Number(finalCandidate.score).toFixed(1)}%`,
        );
      }

      //--------------------------------------------------
      // 9. EXECUTE WITH PLAYWRIGHT
      //--------------------------------------------------

      const execution = await this.executeClickWithVerification(
        finalCandidate,
        query,
      );

      //--------------------------------------------------
      // 10. FINAL FAILURE
      //--------------------------------------------------

      if (!execution.success) {
        throw new Error(`Playwright could not click '${query}'`);
      }

      //--------------------------------------------------
      // 11. LEARN ONLY AFTER SUCCESS
      //--------------------------------------------------

      this.remember(query, finalCandidate);

      this.stats.clicks++;

      this.stopTimer(started);

      //--------------------------------------------------
      // 12. RETURN
      //--------------------------------------------------

      return {
        success: true,

        action: "click",

        confidence: Number(finalCandidate.score.toFixed(2)),

        matchType: finalCandidate.matchType || "scored",

        verified: execution.verified,

        candidate: {
          text: finalCandidate.text,

          role: finalCandidate.role,

          tag: finalCandidate.tag,

          score: finalCandidate.score,
        },
      };
    });
  }

  //======================================================
  // EXECUTE CLICK WITH VERIFICATION
  //
  // Playwright click() success
  //        ↓
  // Element interaction success
  //        ↓
  // Optional post-click verification
  //
  //======================================================

  async executeClickWithVerification(candidate, query) {
    if (!candidate) {
      return {
        success: false,
        verified: false,
      };
    }

    const page = await this.mcp.getPage();

    //--------------------------------------------------
    // 1. CURRENT PAGE
    //--------------------------------------------------

    let result = await this.clickCandidateVerified(page, candidate);

    if (result.success) {
      return result;
    }

    //--------------------------------------------------
    // 2. ALL FRAMES
    //--------------------------------------------------

    for (const frame of page.frames()) {
      try {
        result = await this.clickCandidateVerified(frame, candidate);

        if (result.success) {
          this.stats.frameMatches = (this.stats.frameMatches || 0) + 1;

          return result;
        }
      } catch {
        // Continue
      }
    }

    //--------------------------------------------------
    // 3. EVOLUTION FRAME FALLBACK
    //--------------------------------------------------

    try {
      const clicked = await clickInsideEvolutionFrame(page, query);

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

    //--------------------------------------------------
    // FAILURE
    //--------------------------------------------------

    return {
      success: false,

      verified: false,
    };
  }
  //======================================================
  // VERIFIED PLAYWRIGHT CLICK
  //======================================================

  async clickCandidateVerified(scope, candidate) {
    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();

        if (!(await locator.count())) {
          continue;
        }

        //------------------------------------------------
        // Check visibility
        //------------------------------------------------

        if (!(await locator.isVisible().catch(() => false))) {
          continue;
        }

        //------------------------------------------------
        // Check enabled
        //------------------------------------------------

        if (!(await locator.isEnabled().catch(() => true))) {
          continue;
        }

        //------------------------------------------------
        // Scroll
        //------------------------------------------------

        await locator.scrollIntoViewIfNeeded().catch(() => {});

        //------------------------------------------------
        // CLICK
        //------------------------------------------------

        await locator.click({
          timeout: 5000,

          // Do not force by default.
          // Force should only be used as
          // a deliberate fallback.
          force: false,
        });

        //------------------------------------------------
        // IMPORTANT
        //
        // Playwright click() resolved successfully.
        // Therefore browser interaction succeeded.
        //------------------------------------------------

        this.log("Playwright click successful:", candidate.text);

        //------------------------------------------------
        // Small post-click stabilization
        //------------------------------------------------

        await this.waitForClickResult(scope);

        return {
          success: true,

          verified: true,

          method: "playwright",

          selector,
        };
      } catch (error) {
        this.log(
          "Click selector failed:",
          selector,

          error.message,
        );
      }
    }

    return {
      success: false,

      verified: false,
    };
  }

  //======================================================
  // POST CLICK STABILIZATION
  //======================================================

  async waitForClickResult(scope) {
    try {
      await scope.waitForTimeout(100);
    } catch {
      // Ignore
    }
  }
  //======================================================
  // FIND EXACT CLICK CANDIDATES
  //======================================================

  findExactClickCandidates(query, elements = []) {
    const normalizedQuery = this.normalizeResolverText(query);

    if (!normalizedQuery) {
      return [];
    }

    return elements
      .filter((element) => this.isClickableCandidate(element))
      .filter((element) => {
        const values = [
          element.text,
          element.ariaLabel,
          element.aria,
          element.title,
          element.testid,
          element.id,
        ];

        return values.some(
          (value) => this.normalizeResolverText(value) === normalizedQuery,
        );
      })
      .map((element) => ({
        ...element,

        score: 100,

        matchType: "exact",
      }));
  }

  //======================================================
  // SELECT BEST CLICK CANDIDATE
  //======================================================

  selectBestClickCandidate(candidates = []) {
    if (!candidates.length) {
      return null;
    }

    return [...candidates].sort((a, b) => {
      // Visible first
      if (a.visible !== b.visible) {
        return a.visible ? -1 : 1;
      }

      // Enabled first
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }

      // Prefer buttons
      const aButton = a.tag === "button" || a.role === "button";

      const bButton = b.tag === "button" || b.role === "button";

      if (aButton !== bButton) {
        return aButton ? -1 : 1;
      }

      return 0;
    })[0];
  }

  //======================================================
  // CLICKABLE CANDIDATE
  //======================================================

  isClickableCandidate(candidate) {
    if (!candidate) {
      return false;
    }

    const tag = String(candidate.tag || candidate.tagName || "").toLowerCase();

    const role = String(candidate.role || "").toLowerCase();

    return (
      tag === "button" ||
      tag === "a" ||
      role === "button" ||
      role === "link" ||
      role === "tab" ||
      role === "menuitem" ||
      candidate.onclick ||
      candidate.testid ||
      candidate.aria ||
      candidate.ariaLabel
    );
  }

  //======================================================
  // NORMALIZE RESOLVER TEXT
  //======================================================

  normalizeResolverText(value = "") {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  //======================================================
  // SELECT BEST EXACT CANDIDATE
  //======================================================

  selectBestExactCandidate(candidates, modifiers = {}) {
    let result = [...candidates];

    //--------------------------------------------------
    // Visible first
    //--------------------------------------------------

    const visible = result.filter((x) => x.visible !== false);

    if (visible.length) {
      result = visible;
    }

    //--------------------------------------------------
    // Enabled first
    //--------------------------------------------------

    const enabled = result.filter((x) => x.enabled !== false);

    if (enabled.length) {
      result = enabled;
    }

    //--------------------------------------------------
    // Position
    //--------------------------------------------------

    if (modifiers.position) {
      const position = modifiers.position;

      if (position === "first") {
        return result[0];
      }

      if (position === "last") {
        return result[result.length - 1];
      }

      if (typeof position === "number") {
        return result[position - 1] || result[0];
      }
    }

    return result[0];
  }

  //======================================================
  // EXECUTE CANDIDATE CLICK
  //======================================================

  async executeCandidateClick(candidate) {
    if (!candidate) {
      return false;
    }

    //--------------------------------------------------
    // Preferred frame from DOM index
    //--------------------------------------------------

    if (candidate.frame) {
      const clicked = await this.clickCandidate(candidate.frame, candidate);

      if (clicked) {
        if (candidate.frame !== candidate.page) {
          this.stats.frameMatches++;
        }

        return true;
      }
    }

    //--------------------------------------------------
    // Current page
    //--------------------------------------------------

    const page = await this.mcp.getPage();

    let clicked = await this.clickCandidate(page, candidate);

    if (clicked) {
      return true;
    }

    //--------------------------------------------------
    // Every frame
    //--------------------------------------------------

    for (const frame of page.frames()) {
      clicked = await this.clickCandidate(frame, candidate);

      if (clicked) {
        this.stats.frameMatches++;

        return true;
      }
    }

    //--------------------------------------------------
    // Evolution helper
    //--------------------------------------------------

    try {
      const text =
        candidate.text || candidate.aria || candidate.ariaLabel || "";

      if (text) {
        clicked = await clickInsideEvolutionFrame(page, text);

        if (clicked) {
          return true;
        }
      }
    } catch (err) {
      this.log("Evolution frame helper failed:", err.message);
    }

    return false;
  }

  //======================================================
  // TYPE SMART
  //======================================================

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

      //--------------------------------------------------
      // Build DOM
      //--------------------------------------------------

      await this.buildDOMIndex(ctx.retry > 0);

      //--------------------------------------------------
      // Score
      //--------------------------------------------------

      let ranked = this.scoringEngine
        .rankCandidates(query)
        .filter((candidate) => this.isInputCandidate(candidate));

      if (!ranked.length) {
        throw new Error(`Unable to locate input '${query}'`);
      }

      let finalCandidate = ranked[0];

      //--------------------------------------------------
      // Planner fallback
      //--------------------------------------------------

      if (finalCandidate.score < this.options.plannerThreshold) {
        this.stats.plannerCalls++;

        const plan = await this.planner.plan(input, {
          parsed,

          ranked,

          query,
        });

        if (plan?.steps?.length && plan.steps[0].target) {
          const rescored = this.scoringEngine
            .rankCandidates(plan.steps[0].target)
            .filter((candidate) => this.isInputCandidate(candidate));

          if (rescored.length && rescored[0].score > finalCandidate.score) {
            finalCandidate = rescored[0];
          }
        }
      }

      //--------------------------------------------------
      // Confidence
      //--------------------------------------------------

      if (
        !finalCandidate ||
        finalCandidate.score < this.options.minimumConfidence
      ) {
        throw new Error(
          `Low confidence input match for '${query}': ${Number(
            finalCandidate?.score || 0,
          ).toFixed(1)}%`,
        );
      }

      //--------------------------------------------------
      // Execute
      //--------------------------------------------------

      const typed = await this.executeCandidateType(finalCandidate, value);

      if (!typed) {
        throw new Error(`Unable to type into '${query}'`);
      }

      //--------------------------------------------------
      // Learn
      //--------------------------------------------------

      this.remember(query, finalCandidate);

      this.stats.types++;

      this.stopTimer(started);

      return {
        success: true,

        action: "type",

        value,

        confidence: Number(finalCandidate.score.toFixed(2)),

        candidate: {
          text: finalCandidate.text,

          role: finalCandidate.role,

          tag: finalCandidate.tag,

          score: finalCandidate.score,
        },
      };
    });
  }

  //======================================================
  // INPUT CANDIDATE
  //======================================================

  isInputCandidate(candidate) {
    const tag = (candidate.tag || candidate.tagName || "").toLowerCase();

    const role = (candidate.role || "").toLowerCase();

    return (
      tag === "input" ||
      tag === "textarea" ||
      candidate.contenteditable === true ||
      role === "textbox" ||
      Boolean(candidate.placeholder)
    );
  }

  //======================================================
  // EXECUTE CANDIDATE TYPE
  //======================================================

  async executeCandidateType(candidate, value) {
    if (candidate.frame) {
      const typed = await this.typeCandidate(candidate.frame, candidate, value);

      if (typed) {
        return true;
      }
    }

    const page = await this.mcp.getPage();

    let typed = await this.typeCandidate(page, candidate, value);

    if (typed) {
      return true;
    }

    for (const frame of page.frames()) {
      typed = await this.typeCandidate(frame, candidate, value);

      if (typed) {
        return true;
      }
    }

    return false;
  }

  //======================================================
  // SELF HEALING CONTEXT
  //======================================================

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

        //--------------------------------------------------
        // Refresh DOM
        //--------------------------------------------------

        if (
          /timeout|not found|unable|detached|stale|low confidence/i.test(
            message,
          )
        ) {
          await ctx.resolver.refreshDOM().catch(() => {});
        }

        //--------------------------------------------------
        // Clear stale learning
        //--------------------------------------------------

        if (/not found|unable|low confidence/i.test(message)) {
          ctx.resolver.forget(ctx.query);
        }

        //--------------------------------------------------
        // Force rebuild
        //--------------------------------------------------

        if (ctx.retry >= 2) {
          await ctx.resolver.buildDOMIndex(true).catch(() => {});
        }

        return ctx;
      },
    };
  }

  //======================================================
  // GENERIC HEALING WRAPPER
  //======================================================

  async executeWithHealing(action, query, executor) {
    const context = this.createHealingContext(action, query);

    return await this.selfHealing.execute(action, executor, context);
  }

  //======================================================
  // RECOVER LOW CONFIDENCE
  //======================================================

  async recoverCandidate(query, ranked = []) {
    this.stats.plannerCalls++;

    const plan = await this.planner.plan(query, {
      ranked,

      query,
    });

    if (!plan?.steps?.length) {
      return ranked[0] || null;
    }

    const target = plan.steps[0].target || query;

    const rescored = this.scoringEngine.rankCandidates(target);

    if (!rescored.length) {
      return ranked[0] || null;
    }

    return rescored[0];
  }

  //======================================================
  // AUTO REFRESH DOM
  //======================================================

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

  //======================================================
  // SAFE EXECUTION
  //======================================================

  async safeExecute(fn) {
    try {
      return await fn();
    } catch (err) {
      this.error(err);

      return {
        success: false,

        error: err?.message || String(err),
      };
    }
  }

  //======================================================
  // SELF HEALING METRICS
  //======================================================

  recordHealing() {
    this.stats.healedExecutions++;
  }

  //======================================================
  // STATISTICS
  //======================================================

  getStatistics() {
    return {
      ...this.stats,

      cacheEntries: this.learningCache.size,

      selectorCache: this.selectorCache.size,

      domCached: this.isDOMCacheValid(),
    };
  }

  //======================================================
  // PLAYWRIGHT CLICK
  //======================================================

  async clickCandidate(scope, candidate) {
    if (!scope || !candidate) {
      return false;
    }

    //--------------------------------------------------
    // 1. Role based strategy
    //--------------------------------------------------

    if (candidate.role && candidate.text) {
      try {
        const locator = scope
          .getByRole(candidate.role, {
            name: candidate.text,
            exact: true,
          })
          .first();

        if (await locator.count()) {
          await locator.scrollIntoViewIfNeeded().catch(() => {});

          await locator.click({
            timeout: 3000,
          });

          return true;
        }
      } catch {
        // Continue
      }
    }

    //--------------------------------------------------
    // 2. Text based strategy
    //--------------------------------------------------

    if (candidate.text) {
      try {
        const locator = scope
          .getByText(candidate.text, {
            exact: true,
          })
          .first();

        if (await locator.count()) {
          await locator.scrollIntoViewIfNeeded().catch(() => {});

          await locator.click({
            timeout: 3000,
          });

          return true;
        }
      } catch {
        // Continue
      }
    }

    //--------------------------------------------------
    // 3. CSS selector strategies
    //--------------------------------------------------

    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();

        if (!(await locator.count())) {
          continue;
        }

        await locator.scrollIntoViewIfNeeded().catch(() => {});

        await locator
          .waitFor({
            state: "visible",
            timeout: 2000,
          })
          .catch(() => {});

        await locator.click({
          timeout: 3000,
        });

        return true;
      } catch {
        // Try next strategy
      }
    }

    //--------------------------------------------------
    // 4. Parent clickable strategy
    //
    // Useful when text is inside:
    //
    // <span>Learn More</span>
    //
    // inside:
    //
    // <button>...</button>
    //--------------------------------------------------

    if (candidate.text) {
      try {
        const textLocator = scope
          .getByText(candidate.text, {
            exact: true,
          })
          .first();

        if (await textLocator.count()) {
          const clickable = textLocator.locator(
            "xpath=ancestor-or-self::*[self::button or self::a or @role='button' or @role='link'][1]",
          );

          if (await clickable.count()) {
            await clickable.scrollIntoViewIfNeeded().catch(() => {});

            await clickable.click({
              timeout: 3000,
            });

            return true;
          }
        }
      } catch {
        // Continue
      }
    }

    return false;
  }

  //======================================================
  // PLAYWRIGHT TYPE
  //======================================================

  async typeCandidate(scope, candidate, value) {
    if (!scope || !candidate) {
      return false;
    }

    //--------------------------------------------------
    // Locator strategies
    //--------------------------------------------------

    const selectors = this.buildCandidateSelectors(candidate);

    //--------------------------------------------------
    // Placeholder first
    //--------------------------------------------------

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

    //--------------------------------------------------
    // Label
    //--------------------------------------------------

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

    //--------------------------------------------------
    // CSS
    //--------------------------------------------------

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

  //======================================================
  // SELECTOR GENERATOR
  //======================================================

  buildCandidateSelectors(candidate) {
    const selectors = [];

    //--------------------------------------------------
    // Safe CSS escaping
    //--------------------------------------------------

    const escapeCSS = (value) => {
      const text = String(value ?? "");

      if (typeof CSS !== "undefined" && CSS.escape) {
        return CSS.escape(text);
      }

      return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    };

    //--------------------------------------------------
    // Test ID
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
    // Aria
    //--------------------------------------------------

    const aria = candidate.aria || candidate.ariaLabel;

    if (aria) {
      selectors.push(`[aria-label="${escapeCSS(aria)}"]`);
    }

    //--------------------------------------------------
    // Placeholder
    //--------------------------------------------------

    if (candidate.placeholder) {
      selectors.push(`[placeholder="${escapeCSS(candidate.placeholder)}"]`);
    }

    //--------------------------------------------------
    // Title
    //--------------------------------------------------

    if (candidate.title) {
      selectors.push(`[title="${escapeCSS(candidate.title)}"]`);
    }

    //--------------------------------------------------
    // Name
    //--------------------------------------------------

    if (candidate.name) {
      selectors.push(`[name="${escapeCSS(candidate.name)}"]`);
    }

    //--------------------------------------------------
    // Role + text
    //--------------------------------------------------

    if (candidate.role && candidate.text) {
      selectors.push(
        `[role="${escapeCSS(candidate.role)}"]:has-text("${escapeCSS(
          candidate.text,
        )}")`,
      );
    }

    //--------------------------------------------------
    // Tag + text
    //--------------------------------------------------

    if (candidate.tag && candidate.text) {
      selectors.push(
        `${candidate.tag}:has-text("${escapeCSS(candidate.text)}")`,
      );
    }

    //--------------------------------------------------
    // Text
    //--------------------------------------------------

    if (candidate.text) {
      selectors.push(`text="${escapeCSS(candidate.text)}"`);

      selectors.push(`:text("${escapeCSS(candidate.text)}")`);
    }

    return [...new Set(selectors.filter(Boolean))];
  }

  //======================================================
  // EXECUTOR
  //======================================================

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

          await page.goto(url, {
            waitUntil: "domcontentloaded",
          });

          this.invalidateDOMCache();

          results.push({
            success: true,

            action: "navigate",

            url,
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

          this.invalidateDOMCache();

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

          this.invalidateDOMCache();

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

          this.invalidateDOMCache();

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
      success: results.every((r) => r.success),

      results,
    };
  }

  //======================================================
  // RESOLVE ENTRY POINT
  //======================================================

  //======================================================
  // RESOLVE ENTRY POINT
  //======================================================

  async resolve(input) {
    return this.safeExecute(async () => {
      if (!input) {
        throw new Error("Resolver input is empty");
      }

      //------------------------------------------------
      // Parse full user command ONCE
      //------------------------------------------------

      const parsed = this.intentParser.parse(input);

      this.log("Parsed intent:", JSON.stringify(parsed, null, 2));

      //------------------------------------------------
      // No steps
      //------------------------------------------------

      if (!parsed.steps?.length) {
        throw new Error(`Unable to understand command '${input}'`);
      }

      //------------------------------------------------
      // Execute each parsed step
      //------------------------------------------------

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
          const target = step.target || step.value;

          results.push(await this.typeSmart(target, step.value));

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

          await page.goto(url, {
            waitUntil: "domcontentloaded",
          });

          this.invalidateDOMCache();

          results.push({
            success: true,

            action: "navigate",

            url,
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

  //======================================================
  // RESET STATISTICS
  //======================================================

  resetStatistics() {
    this.stats = {
      clicks: 0,

      types: 0,

      searches: 0,

      plannerCalls: 0,

      healedExecutions: 0,

      cacheHits: 0,

      cacheMisses: 0,

      exactMatches: 0,

      fuzzyMatches: 0,

      frameMatches: 0,

      plannerRecoveries: 0,

      averageResolveTime: 0,

      lastResolveTime: 0,
    };
  }

  //======================================================
  // DUMP STATISTICS
  //======================================================

  dumpStatistics() {
    console.table(this.getStatistics());
  }

  //======================================================
  // PRINT TOP CANDIDATES
  //======================================================

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
