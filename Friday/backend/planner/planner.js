/**
 * planner/planner.js
 *
 * Ultra-Fast Intent Planner for Jarvis Browser
 *
 * Features:
 * ✅ Zero-LLM fast path (regex + heuristics)
 * ✅ Action classification (click, navigate, search, scroll, wait)
 * ✅ Multi-step intent splitting
 * ✅ JSON repair fallback
 * ✅ LLM fallback (Ollama / Qwen / OpenAI compatible)
 * ✅ Safe execution planner output
 */

export default class Planner {
  constructor(options = {}) {
    this.model = options.model || "qwen3:8b";
    this.useLLM = options.useLLM ?? true;

    this.rules = this._loadRules();
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  async plan(input, context = {}) {
    if (!input || typeof input !== "string") {
      return this._emptyPlan();
    }

    const cleaned = input.trim();

    // 1. FAST RULE-BASED PARSER (NO LLM)
    const fastPlan = this._fastParse(cleaned, context);
    if (fastPlan && fastPlan.steps.length > 0) {
      return fastPlan;
    }

    // 2. FALLBACK LLM PARSER
    if (this.useLLM) {
      try {
        const llmPlan = await this._llmParse(cleaned, context);
        if (llmPlan) return llmPlan;
      } catch (err) {
        console.error("[Planner] LLM fallback failed:", err.message);
      }
    }

    return this._emptyPlan();
  }

  // =====================================================
  // FAST PARSER
  // =====================================================

  _fastParse(text, context) {
    const lower = text.toLowerCase();

    const steps = [];

    // NAVIGATION INTENT
    if (this._match(lower, this.rules.navigate)) {
      steps.push({
        type: "navigate",
        url: this._extractUrl(text) || this._extractDomain(text),
        raw: text,
      });
    }

    // SEARCH INTENT
    if (this._match(lower, this.rules.search)) {
      steps.push({
        type: "search",
        query: this._extractQuery(text),
        raw: text,
      });
    }

    // CLICK INTENT
    if (this._match(lower, this.rules.click)) {
      steps.push({
        type: "click",
        selector: this._extractSelector(text),
        text: this._extractClickText(text),
        raw: text,
      });
    }

    // SCROLL
    if (this._match(lower, this.rules.scroll)) {
      steps.push({
        type: "scroll",
        direction: lower.includes("up") ? "up" : "down",
        amount: this._extractNumber(text) || 800,
      });
    }

    // WAIT
    if (this._match(lower, this.rules.wait)) {
      steps.push({
        type: "wait",
        ms: this._extractNumber(text) || 2000,
      });
    }

    // DEFAULT fallback intent
    if (steps.length === 0) {
      steps.push({
        type: "chat",
        message: text,
      });
    }

    return {
      source: "fast-parser",
      steps,
    };
  }

  // =====================================================
  // LLM PARSER (Ollama / Qwen compatible)
  // =====================================================

  async _llmParse(text, context) {
    const prompt = `
You are an intent planner for a browser automation system.

Convert user input into JSON steps.

Rules:
- Only output JSON
- No explanation
- Supported actions: navigate, search, click, scroll, wait, type

Input:
"${text}"

Output format:
{
  "steps": [
    { "type": "...", "..." }
  ]
}
`;

    const response = await this._callLLM(prompt);

    if (!response) return null;

    const json = this._safeJSONParse(response);
    if (!json?.steps) return null;

    return {
      source: "llm",
      steps: json.steps,
    };
  }

  async _callLLM(prompt) {
    // Ollama default endpoint
    const endpoint = "http://localhost:11434/api/generate";

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.response || null;
  }

  // =====================================================
  // RULES
  // =====================================================

  _loadRules() {
    return {
      navigate: ["open", "go to", "visit", "navigate", "launch"],
      search: ["search", "look for", "find", "google"],
      click: ["click", "press", "tap"],
      scroll: ["scroll"],
      wait: ["wait", "pause", "delay"],
    };
  }

  _match(text, keywords) {
    return keywords.some((k) => text.includes(k));
  }

  // =====================================================
  // EXTRACTION HELPERS
  // =====================================================

  _extractUrl(text) {
    const match = text.match(/https?:\/\/[^\s]+/);
    return match ? match[0] : null;
  }

  _extractDomain(text) {
    const match = text.match(
      /(?:go to|visit|open)\s+([a-zA-Z0-9.-]+\.[a-zA-Z]+)/i,
    );
    return match ? `https://${match[1]}` : null;
  }

  _extractQuery(text) {
    return text.replace(/search|google|find|look for/gi, "").trim();
  }

  _extractSelector(text) {
    const match = text.match(/#\w+|\.\w+/);
    return match ? match[0] : null;
  }

  _extractClickText(text) {
    const patterns = [
      /click\s+"([^"]+)"/i,

      /click\s+'([^']+)'/i,

      /click\s+(?:the\s+)?(.+)/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);

      if (m) return m[1].trim();
    }

    return null;
  }

  _extractNumber(text) {
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  // =====================================================
  // JSON SAFETY
  // =====================================================

  _safeJSONParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      // repair attempt
      try {
        const fixed = str
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();
        return JSON.parse(fixed);
      } catch {
        return null;
      }
    }
  }

  // =====================================================
  // UTIL
  // =====================================================

  _emptyPlan() {
    return {
      source: "empty",
      steps: [],
    };
  }
}
