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
//      ▼
// Scoring Engine
//      │
//      ▼
// Resolver
//      │
//      ▼
// Playwright
//      │
//      ▼
// Self Healing
//
//==========================================================

import { clickInsideEvolutionFrame } from "./utils/iframeContent.js";

import IntentParser from "./planner/intent-parser.js";
import Planner from "./planner/planner.js";
import ScoringEngine from "./planner/scoring-engine.js";
import SelfHealingEngine from "./planner/self-healing.js";

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

    this.scoringEngine = options.scoringEngine || new ScoringEngine();

    this.planner =
      options.planner ||
      new Planner({
        useLLM: true,
      });

    this.selfHealing = options.selfHealing || new SelfHealingEngine();

    //--------------------------------------------------
    // DOM Cache
    //--------------------------------------------------

    this.domCache = {
      page: null,

      frames: [],

      timestamp: 0,
    };

    //--------------------------------------------------
    // Frame Cache
    //--------------------------------------------------

    this.frameCache = new Map();

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
  // CACHE MANAGEMENT
  //======================================================

  clearCaches() {
    this.domCache = {
      page: null,

      frames: [],

      timestamp: 0,
    };

    this.frameCache.clear();
  }

  invalidateDOMCache() {
    this.domCache.timestamp = 0;
  }

  isDOMCacheValid() {
    return Date.now() - this.domCache.timestamp < this.options.domCacheTTL;
  }

  remember(query, candidate) {
    if (!this.options.enableLearning) return;

    this.learningCache.set(
      query,

      candidate,
    );

    if (this.scoringEngine?.remember) {
      this.scoringEngine.remember(
        query,

        candidate,
      );
    }
  }

  getRemembered(query) {
    return this.learningCache.get(query);
  }

  //======================================================
  // Remaining methods continue in Part 2
  //======================================================

  // =====================================================
  // DOM CACHE
  // =====================================================

  clearDOMCache() {
    this.domCache = null;

    this.frameCache = [];
  }

  //=====================================================
  // BUILD DOM INDEX
  //=====================================================

  async buildDOMIndex(force = false) {
    if (
      !force &&
      this.domCache &&
      Date.now() - this.domCache.timestamp < this.cacheTTL
    ) {
      return this.domCache;
    }

    const page = await this.mcp.getPage();

    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const frames = [page, ...page.frames()];

    const allElements = [];

    const frameIndex = [];

    //--------------------------------------------------
    // Scan every frame
    //--------------------------------------------------

    for (const frame of frames) {
      try {
        const elements = await this.extractFrameElements(frame);

        frameIndex.push({
          frame,

          url: frame.url(),

          count: elements.length,
        });

        allElements.push(...elements);
      } catch (err) {
        console.log("[Resolver] Frame skipped:", err.message);
      }
    }

    //--------------------------------------------------
    // Build ScoringEngine index
    //--------------------------------------------------

    this.scoringEngine.buildIndex(allElements);

    this.frameCache = frameIndex;

    this.domCache = {
      timestamp: Date.now(),

      elements: allElements,

      count: allElements.length,
    };

    console.log(
      `[Resolver] Indexed ${allElements.length} interactive elements across ${frameIndex.length} frame(s).`,
    );

    return this.domCache;
  }

  //=====================================================
  // EXTRACT INTERACTIVE ELEMENTS
  //=====================================================

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

      document
        .querySelectorAll(selectors.join(","))

        .forEach((el) => {
          if (seen.has(el)) return;

          seen.add(el);

          const rect = el.getBoundingClientRect();

          const style = window.getComputedStyle(el);

          elements.push({
            tagName: el.tagName.toLowerCase(),

            id: el.id || "",

            role: el.getAttribute("role") || "",

            text: (el.innerText || el.textContent || "").trim(),

            ariaLabel: el.getAttribute("aria-label") || "",

            placeholder: el.getAttribute("placeholder") || "",

            title: el.getAttribute("title") || "",

            alt: el.getAttribute("alt") || "",

            testid: el.getAttribute("data-testid") || "",

            name: el.getAttribute("name") || "",

            type: el.getAttribute("type") || "",

            value: el.value || "",

            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none",

            enabled: !el.disabled,

            x: rect.x,

            y: rect.y,

            width: rect.width,

            height: rect.height,
          });
        });

      return elements;
    });
  }

  //=====================================================
  // GET DOM POOL
  //=====================================================

  async getDOMPool(force = false) {
    const cache = await this.buildDOMIndex(force);

    return cache.elements;
  }

  //=====================================================
  // REFRESH DOM
  //=====================================================

  async refreshDOM() {
    this.clearDOMCache();

    return await this.buildDOMIndex(true);
  }

  //=====================================================
  // GET FRAME INFO
  //=====================================================

  getFramePool() {
    return this.frameCache;
  }

  //=====================================================
  // DEBUG
  //=====================================================

  printDOMSummary() {
    if (!this.domCache) {
      console.log("DOM not indexed.");

      return;
    }

    console.table({
      Elements: this.domCache.count,

      Frames: this.frameCache.length,

      Cached: new Date(this.domCache.timestamp).toLocaleTimeString(),
    });
  }
  //=====================================================
  // CLICK SMART
  // Uses:
  //  IntentParser
  //      ↓
  //  ScoringEngine
  //      ↓
  //  Playwright
  //      ↓
  //  SelfHealing
  //=====================================================

  async clickSmart(input) {
    const started = this.startTimer();

    return await this.selfHealing.execute(async () => {
      //--------------------------------------------------
      // Validate
      //--------------------------------------------------

      if (!input) throw new Error("clickSmart requires text");

      //--------------------------------------------------
      // Parse Intent
      //--------------------------------------------------

      const parsed = this.intentParser.parse(input);

      const step = parsed.steps?.[0];

      if (!step) throw new Error("Unable to parse action");

      if (step.action !== "click")
        throw new Error(`Expected click action but received '${step.action}'`);

      const query = step.target || step.value || input;

      //--------------------------------------------------
      // Reuse learned selector
      //--------------------------------------------------

      const learned = this.getRemembered(query);

      if (learned) {
        this.log("Using learned selector:", learned.text);
      }

      //--------------------------------------------------
      // Build DOM Index
      //--------------------------------------------------

      await this.buildDOMIndex();

      //--------------------------------------------------
      // Rank Elements
      //--------------------------------------------------

      const ranked = this.scoringEngine.rankCandidates(query);

      if (!ranked.length) throw new Error(`Unable to locate '${query}'`);

      const best = ranked[0];

      this.log("Top Candidate:", best.text, best.score);

      //--------------------------------------------------
      // Planner only when confidence is low
      //--------------------------------------------------

      let finalCandidate = best;

      if (best.score < this.scoringEngine.options.plannerThreshold) {
        this.stats.plannerCalls++;

        this.log("Low confidence. Asking planner...");

        const plan = await this.planner.plan(input, {
          ranked,

          query,
        });

        if (plan?.steps?.length && plan.steps[0].target) {
          const rescored = this.scoringEngine.rankCandidates(
            plan.steps[0].target,
          );

          if (rescored.length) finalCandidate = rescored[0];
        }
      }

      //--------------------------------------------------
      // Confidence Check
      //--------------------------------------------------

      if (!finalCandidate)
        throw new Error(`No candidate resolved for '${query}'`);

      if (finalCandidate.score < 60) {
        throw new Error(`Low confidence (${finalCandidate.score.toFixed(1)}%)`);
      }

      //--------------------------------------------------
      // Click using Playwright
      //--------------------------------------------------

      const page = await this.mcp.getPage();

      let clicked = false;

      //--------------------------------------------------
      // Current Page
      //--------------------------------------------------

      clicked = await this.clickCandidate(page, finalCandidate);

      //--------------------------------------------------
      // Frames
      //--------------------------------------------------

      if (!clicked) {
        for (const frame of page.frames()) {
          clicked = await this.clickCandidate(frame, finalCandidate);

          if (clicked) break;
        }
      }

      //--------------------------------------------------
      // Evolution helper
      //--------------------------------------------------

      if (!clicked) {
        try {
          clicked = await clickInsideEvolutionFrame(
            page,

            finalCandidate.text,
          );
        } catch {}
      }

      //--------------------------------------------------
      // Failure
      //--------------------------------------------------

      if (!clicked) {
        throw new Error(`Unable to click '${query}'`);
      }

      //--------------------------------------------------
      // Learn successful click
      //--------------------------------------------------

      this.remember(query, finalCandidate);

      this.stats.clicks++;

      //--------------------------------------------------
      // Timing
      //--------------------------------------------------

      this.stopTimer(started);

      //--------------------------------------------------
      // Return
      //--------------------------------------------------

      return {
        success: true,

        action: "click",

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
  //=====================================================
  // TYPE SMART
  //
  // IntentParser
  //      ↓
  // ScoringEngine
  //      ↓
  // Playwright
  //      ↓
  // SelfHealing
  //=====================================================

  async typeSmart(input, explicitValue = null) {
    const started = this.startTimer();

    return await this.selfHealing.execute(async () => {
      //--------------------------------------------------
      // Validate
      //--------------------------------------------------

      if (!input) throw new Error("typeSmart requires input");

      //--------------------------------------------------
      // Parse Intent
      //--------------------------------------------------

      const parsed = this.intentParser.parse(input);

      const step = parsed.steps?.[0];

      if (!step) throw new Error("Unable to parse type action");

      if (step.action !== "type")
        throw new Error(`Expected type action but received '${step.action}'`);

      //--------------------------------------------------
      // Resolve Target + Value
      //--------------------------------------------------

      const query = step.target || input;

      const value = explicitValue ?? step.value;

      if (value === undefined || value === null) {
        throw new Error("No typing value provided");
      }

      //--------------------------------------------------
      // Build DOM Index
      //--------------------------------------------------

      await this.buildDOMIndex();

      //--------------------------------------------------
      // Rank Candidate Inputs
      //--------------------------------------------------

      const ranked = this.scoringEngine
        .rankCandidates(query)
        .filter((candidate) => {
          const tag = (candidate.tag || "").toLowerCase();

          return (
            tag === "input" ||
            tag === "textarea" ||
            candidate.role === "textbox" ||
            candidate.placeholder ||
            candidate.aria ||
            candidate.element?.type === "text"
          );
        });

      if (!ranked.length) {
        throw new Error(`Unable to locate input '${query}'`);
      }

      //--------------------------------------------------
      // Best Candidate
      //--------------------------------------------------

      let finalCandidate = ranked[0];

      //--------------------------------------------------
      // Planner fallback
      //--------------------------------------------------

      if (finalCandidate.score < this.scoringEngine.options.plannerThreshold) {
        this.stats.plannerCalls++;

        const plan = await this.planner.plan(input, {
          ranked,

          query,
        });

        if (plan?.steps?.length && plan.steps[0].target) {
          const rescored = this.scoringEngine
            .rankCandidates(plan.steps[0].target)
            .filter((candidate) => {
              const tag = (candidate.tag || "").toLowerCase();

              return (
                tag === "input" ||
                tag === "textarea" ||
                candidate.role === "textbox"
              );
            });

          if (rescored.length) finalCandidate = rescored[0];
        }
      }

      //--------------------------------------------------
      // Confidence Check
      //--------------------------------------------------

      if (!finalCandidate || finalCandidate.score < 60) {
        throw new Error(`Low confidence (${finalCandidate?.score ?? 0}%)`);
      }

      //--------------------------------------------------
      // Locate Element
      //--------------------------------------------------

      const page = await this.mcp.getPage();

      let typed = false;

      //--------------------------------------------------
      // Current Page
      //--------------------------------------------------

      typed = await this.typeCandidate(
        page,

        finalCandidate,

        value,
      );

      //--------------------------------------------------
      // Search Frames
      //--------------------------------------------------

      if (!typed) {
        for (const frame of page.frames()) {
          typed = await this.typeCandidate(
            frame,

            finalCandidate,

            value,
          );

          if (typed) break;
        }
      }

      //--------------------------------------------------
      // Failure
      //--------------------------------------------------

      if (!typed) {
        throw new Error(`Unable to type into '${query}'`);
      }

      //--------------------------------------------------
      // Learn Successful Match
      //--------------------------------------------------

      this.remember(
        query,

        finalCandidate,
      );

      this.stats.types++;

      //--------------------------------------------------
      // Timing
      //--------------------------------------------------

      this.stopTimer(started);

      //--------------------------------------------------
      // Success
      //--------------------------------------------------

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
  //=====================================================
  // SELF HEALING
  //=====================================================

  createHealingContext(action, query, candidate = null) {
    return {
      action,

      query,

      candidate,

      resolver: this,

      timestamp: Date.now(),

      validate(result) {
        return !!result?.success;
      },

      patch: async (error, ctx) => {
        ctx.retry = (ctx.retry || 0) + 1;

        //--------------------------------------------------
        // Refresh DOM
        //--------------------------------------------------

        if (/timeout|not found|detached|stale/i.test(error.message)) {
          await ctx.resolver.refreshDOM();
        }

        //--------------------------------------------------
        // Clear learned selector if stale
        //--------------------------------------------------

        if (/not found|unable/i.test(error.message)) {
          ctx.resolver.learningCache.delete(ctx.query);
        }

        //--------------------------------------------------
        // Force rebuild after repeated failures
        //--------------------------------------------------

        if (ctx.retry >= 2) {
          await ctx.resolver.buildDOMIndex(true);
        }

        return ctx;
      },
    };
  }

  //=====================================================
  // GENERIC HEALING WRAPPER
  //=====================================================

  async executeWithHealing(action, query, executor, candidate = null) {
    return await this.selfHealing.execute(
      executor,

      this.createHealingContext(
        action,

        query,

        candidate,
      ),
    );
  }

  //=====================================================
  // RECOVER LOW CONFIDENCE
  //=====================================================

  async recoverCandidate(query, ranked = []) {
    //--------------------------------------------------
    // Planner
    //--------------------------------------------------

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

    if (!rescored.length) return ranked[0] || null;

    return rescored[0];
  }

  //=====================================================
  // AUTO REFRESH IF PAGE CHANGED
  //=====================================================

  async ensureFreshDOM() {
    const page = await this.mcp.getPage();

    const url = page.url();

    if (this.lastURL !== url) {
      this.lastURL = url;

      this.invalidateDOMCache();
    }

    if (!this.isDOMCacheValid()) {
      await this.buildDOMIndex(true);
    }
  }

  //=====================================================
  // SAFE EXECUTION
  //=====================================================

  async safeExecute(fn) {
    try {
      return await fn();
    } catch (err) {
      this.error(err);

      return {
        success: false,

        error: err.message,
      };
    }
  }

  //=====================================================
  // SELF-HEALING METRICS
  //=====================================================

  recordHealing() {
    this.stats.healedExecutions++;
  }

  getStatistics() {
    return {
      ...this.stats,

      cacheEntries: this.learningCache.size,

      selectorCache: this.selectorCache.size,

      domCached: this.isDOMCacheValid(),
    };
  }
  //======================================================
  // PLAYWRIGHT EXECUTION HELPERS
  //======================================================

  async clickCandidate(scope, candidate) {
    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();

        if (!(await locator.count())) continue;

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
        // try next selector
      }
    }

    return false;
  }

  async typeCandidate(scope, candidate, value) {
    const selectors = this.buildCandidateSelectors(candidate);

    for (const selector of selectors) {
      try {
        const locator = scope.locator(selector).first();

        if (!(await locator.count())) continue;

        await locator.scrollIntoViewIfNeeded().catch(() => {});

        await locator
          .waitFor({
            state: "visible",
            timeout: 2000,
          })
          .catch(() => {});

        await locator.fill("");

        await locator.fill(String(value));

        return true;
      } catch {
        // continue
      }
    }

    return false;
  }

  //======================================================
  // SELECTOR GENERATOR
  //======================================================

  buildCandidateSelectors(candidate) {
    const selectors = [];

    const escape = (value) => String(value).replace(/"/g, '\\"').trim();

    if (candidate.testid)
      selectors.push(`[data-testid="${escape(candidate.testid)}"]`);

    if (candidate.id) selectors.push(`#${escape(candidate.id)}`);

    if (candidate.aria)
      selectors.push(`[aria-label="${escape(candidate.aria)}"]`);

    if (candidate.placeholder)
      selectors.push(`[placeholder="${escape(candidate.placeholder)}"]`);

    if (candidate.title) selectors.push(`[title="${escape(candidate.title)}"]`);

    if (candidate.alt) selectors.push(`[alt="${escape(candidate.alt)}"]`);

    if (candidate.role && candidate.text) {
      selectors.push(
        `[role="${escape(candidate.role)}"]:has-text("${escape(candidate.text)}")`,
      );
    }

    if (candidate.text) {
      selectors.push(`text="${escape(candidate.text)}"`);

      selectors.push(`:text("${escape(candidate.text)}")`);
    }

    if (candidate.tag && candidate.text) {
      selectors.push(`${candidate.tag}:has-text("${escape(candidate.text)}")`);
    }

    return [...new Set(selectors)];
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
        case "click":
          results.push(await this.clickSmart(step.target || step.text));

          break;

        case "type":
          results.push(await this.typeSmart(step.target, step.value));

          break;

        case "navigate": {
          const page = await this.mcp.getPage();

          await page.goto(step.url, {
            waitUntil: "domcontentloaded",
          });

          this.invalidateDOMCache();

          results.push({
            success: true,
            action: "navigate",
            url: step.url,
          });

          break;
        }

        case "wait": {
          const page = await this.mcp.getPage();

          await page.waitForTimeout(step.value || step.time || 1000);

          results.push({
            success: true,
            action: "wait",
          });

          break;
        }

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

  async resolve(input) {
    return this.safeExecute(async () => {
      await this.ensureFreshDOM();

      const plan = await this.planner.plan(input);

      return await this.execute(plan);
    });
  }

  //======================================================
  // METRICS
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
      averageResolveTime: 0,
      lastResolveTime: 0,
    };
  }

  dumpStatistics() {
    console.table(this.getStatistics());
  }

  //======================================================
  // DEBUG
  //======================================================

  printTopCandidates(query, limit = 10) {
    const ranked = this.scoringEngine.rankCandidates(query);

    console.table(
      ranked

        .slice(0, limit)

        .map((x) => ({
          text: x.text,

          role: x.role,

          tag: x.tag,

          score: x.score.toFixed(2),
        })),
    );
  }
}
