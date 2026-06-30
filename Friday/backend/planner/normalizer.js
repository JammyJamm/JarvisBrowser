/**
 * planner/normalizer.js
 *
 * Purpose:
 *  - Normalize raw planner output (LLM / regex / hybrid)
 *  - Ensure consistent action schema
 *  - Repair malformed JSON safely
 *  - Standardize intents for execution layer
 *
 * Output format:
 * {
 *   type: "navigate" | "click" | "type" | "wait" | "extract" | "chat",
 *   payload: object,
 *   confidence: number (0-1)
 * }
 */

class Normalizer {
  constructor(options = {}) {
    this.strict = options.strict ?? false;
  }

  // -----------------------------
  // PUBLIC ENTRY
  // -----------------------------
  normalize(input) {
    try {
      if (!input) return this._empty("empty_input");

      // 1. If string → try parse
      let data = typeof input === "string" ? this._safeParse(input) : input;

      if (!data) return this._empty("parse_failed");

      // 2. Normalize structure
      if (Array.isArray(data)) {
        return data.map((d) => this._normalizeItem(d));
      }

      return this._normalizeItem(data);
    } catch (err) {
      return this._empty("exception", err.message);
    }
  }

  // -----------------------------
  // CORE NORMALIZER
  // -----------------------------
  _normalizeItem(item) {
    if (!item || typeof item !== "object") {
      return this._empty("invalid_item");
    }

    let type = (item.type || item.action || item.intent || "").toLowerCase();

    const base = {
      type: this._mapType(type),
      payload: {},
      confidence: this._normalizeConfidence(item.confidence ?? item.score),
    };

    // Normalize payload safely
    base.payload = this._normalizePayload(item);

    return base;
  }

  // -----------------------------
  // TYPE MAPPING
  // -----------------------------
  _mapType(type) {
    const map = {
      open: "navigate",
      go: "navigate",
      navigate: "navigate",
      visit: "navigate",

      click: "click",
      press: "click",

      type: "type",
      input: "type",
      write: "type",

      wait: "wait",
      delay: "wait",

      extract: "extract",
      scrape: "extract",
      get: "extract",

      chat: "chat",
      message: "chat",
      say: "chat",
    };

    return map[type] || type || "unknown";
  }

  // -----------------------------
  // PAYLOAD NORMALIZATION
  // -----------------------------
  _normalizePayload(item) {
    const payload = item.payload || item.data || {};

    const normalized = {};

    // URL handling
    if (payload.url || item.url) {
      normalized.url = this._cleanUrl(payload.url || item.url);
    }

    // selector / element
    if (payload.selector || item.selector) {
      normalized.selector = this._cleanSelector(
        payload.selector || item.selector,
      );
    }

    // text input
    if (payload.text || payload.value || item.text) {
      normalized.text = String(payload.text || payload.value || item.text);
    }

    // wait time
    if (payload.ms || payload.time || item.time) {
      normalized.ms = this._toNumber(
        payload.ms || payload.time || item.time,
        1000,
      );
    }

    // extraction target
    if (payload.target || item.target) {
      normalized.target = String(payload.target || item.target);
    }

    // fallback raw data
    normalized.raw = payload;

    return normalized;
  }

  // -----------------------------
  // SAFE JSON PARSER
  // -----------------------------
  _safeParse(str) {
    if (typeof str !== "string") return null;

    try {
      return JSON.parse(str);
    } catch (_) {
      // attempt repair
      try {
        const fixed = this._repairJson(str);
        return JSON.parse(fixed);
      } catch (e) {
        return null;
      }
    }
  }

  // -----------------------------
  // BASIC JSON REPAIR
  // -----------------------------
  _repairJson(str) {
    return str
      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // keys fix
      .replace(/'/g, '"') // single quotes
      .replace(/,\s*}/g, "}") // trailing comma }
      .replace(/,\s*]/g, "]"); // trailing comma ]
  }

  // -----------------------------
  // HELPERS
  // -----------------------------
  _cleanUrl(url) {
    if (!url || typeof url !== "string") return null;
    return url.trim();
  }

  _cleanSelector(sel) {
    if (!sel || typeof sel !== "string") return null;
    return sel.trim();
  }

  _toNumber(val, fallback = 0) {
    const n = Number(val);
    return isNaN(n) ? fallback : n;
  }

  _normalizeConfidence(c) {
    let n = Number(c);
    if (isNaN(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
  }

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
}

module.exports = Normalizer;
