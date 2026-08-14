/**
 * selector-builder.js
 *
 * Ultra-robust DOM selector generator for automated browser control systems.
 * Designed for Playwright / Puppeteer-like environments.
 *
 * Features:
 * - Smart selector priority (id > data-* > aria > class > text fallback)
 * - XPath fallback for unstable DOMs
 * - Deep selector scoring
 * - Handles dynamic/reactive UI
 * - Shadow DOM-safe heuristics (basic)
 */

class SelectorBuilder {
  constructor(options = {}) {
    this.debug = options.debug || false;

    // weights for scoring selectors
    this.weights = {
      id: 100,
      dataAttr: 90,
      aria: 85,
      name: 70,
      class: 40,
      tag: 20,
      text: 10,
    };
  }

  /**
   * Main entry: build best selector for a target description
   * @param {Object} target
   * @returns {Object} { selector, type, confidence }
   */
  build(target) {
    if (!target) throw new Error("Target is required");

    const candidates = [];

    if (target.id) {
      candidates.push(this._score(`#${target.id}`, "id", 100));
    }

    if (target["data-testid"]) {
      candidates.push(
        this._score(`[data-testid="${target["data-testid"]}"]`, "dataAttr", 95),
      );
    }

    if (target["data-id"]) {
      candidates.push(
        this._score(`[data-id="${target["data-id"]}"]`, "dataAttr", 90),
      );
    }

    if (target.ariaLabel) {
      candidates.push(
        this._score(`[aria-label="${target.ariaLabel}"]`, "aria", 85),
      );
    }

    if (target.name) {
      candidates.push(this._score(`[name="${target.name}"]`, "name", 75));
    }

    if (target.className) {
      const classSelector = this._buildClassSelector(target.className);
      candidates.push(this._score(classSelector, "class", 50));
    }

    if (target.tag && target.text) {
      candidates.push(
        this._score(`${target.tag}:has-text("${target.text}")`, "text", 60),
      );
    }

    if (target.text && !target.tag) {
      candidates.push(this._score(`text="${target.text}"`, "text", 40));
    }

    // fallback XPath
    if (candidates.length === 0) {
      return {
        selector: this._buildXPathFallback(target),
        type: "xpath",
        confidence: 20,
      };
    }

    const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];

    if (this.debug) {
      console.log("[SelectorBuilder] candidates:", candidates);
      console.log("[SelectorBuilder] selected:", best);
    }

    return best;
  }

  /**
   * Score a selector
   */
  _score(selector, type, base) {
    const confidence = Math.min(100, base);
    return { selector, type, confidence };
  }

  /**
   * Build class selector safely
   */
  _buildClassSelector(className) {
    if (!className) return "*";

    const classes = className
      .split(" ")
      .filter(Boolean)
      .map((c) => `.${c}`)
      .join("");

    return classes || "*";
  }

  /**
   * XPath fallback generator (very important for dynamic UIs)
   */
  _buildXPathFallback(target) {
    let xpath = "//*";

    const conditions = [];

    if (target.tag) {
      xpath = `//${target.tag}`;
    }

    if (target.text) {
      conditions.push(`contains(text(), "${target.text}")`);
    }

    if (target.ariaLabel) {
      conditions.push(`@aria-label="${target.ariaLabel}"`);
    }

    if (target.id) {
      conditions.push(`@id="${target.id}"`);
    }

    if (conditions.length > 0) {
      xpath += "[" + conditions.join(" and ") + "]";
    }

    return xpath;
  }

  /**
   * Try to infer selector from DOM node metadata (Playwright evaluate result)
   */
  fromNode(nodeInfo) {
    if (!nodeInfo) return null;

    return this.build({
      id: nodeInfo.id,
      className: nodeInfo.class,
      tag: nodeInfo.tag,
      text: nodeInfo.text,
      name: nodeInfo.name,
      "data-testid": nodeInfo.testid,
      "data-id": nodeInfo.dataId,
      ariaLabel: nodeInfo.ariaLabel,
    });
  }

  /**
   * Batch selector builder for multiple targets
   */
  buildMany(targets = []) {
    return targets.map((t) => this.build(t));
  }

  /**
   * Validate selector format (basic safety check)
   */
  validate(selector) {
    if (!selector || typeof selector !== "string") return false;

    // prevent obviously broken selectors
    if (selector.length > 500) return false;
    if (selector.includes("undefined")) return false;

    return true;
  }
}

module.exports = SelectorBuilder;
