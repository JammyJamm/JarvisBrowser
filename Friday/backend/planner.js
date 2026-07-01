// planner.js
//
// Production-ready planner for Jarvis Browser
//
// Now integrated with planner/index.js pipeline
//

import CorePlanner from "./planner/planner.js";

export default class Planner {
  constructor(options = {}) {
    this.model = options.model || "qwen3:8b";
    this.ollama = options.endpoint || "http://localhost:11434/api/generate";

    // NEW: internal advanced planner pipeline
    this.core = new CorePlanner(options);
  }

  // ====================================================
  // PUBLIC
  // ====================================================

  async plan(command, pageText = "", context = {}) {
    if (!command) {
      return this._empty();
    }

    // ====================================================
    // 1. TRY ADVANCED PLANNER FIRST (NEW INTEGRATION)
    // ====================================================

    try {
      const advanced = await this.core.plan(command, {
        ...context,
        pageText,
      });

      if (advanced?.steps?.length) {
        return this._normalizeAdvanced(advanced);
      }
    } catch (err) {
      console.warn("[Planner] Core pipeline failed, fallback:", err.message);
    }

    // ====================================================
    // 2. FALLBACK: REGEX PLANNER (YOUR ORIGINAL)
    // ====================================================

    const fast = this.regexPlan(command);

    if (fast && fast.length) {
      return {
        mode: "action",
        steps: fast,
      };
    }

    // ====================================================
    // 3. FALLBACK: LLM PLANNER
    // ====================================================

    return await this.llmPlan(command, pageText);
  }

  // ====================================================
  // NORMALIZER (CORE INTEGRATION BRIDGE)
  // ====================================================

  _normalizeAdvanced(plan) {
    const steps = [];

    for (const s of plan.steps || []) {
      let tool = String(s.tool || s.type || "").toLowerCase();

      const args = { ...(s.args || {}) };

      args.url ??= s.url;
      args.text ??= s.text;
      args.field ??= s.field;
      args.value ??= s.value;
      args.query ??= s.query;
      args.key ??= s.key;
      args.time ??= s.time;
      args.selector ??= s.selector;

      //--------------------------------------------------
      // CHAT STEP -> ACTION STEP
      //--------------------------------------------------

      if (tool === "chat") {
        const msg = String(
          args.message || s.message || s.raw || s.text || "",
        ).trim();

        let m;

        //--------------------------------------------------
        // Navigate
        //--------------------------------------------------

        m =
          msg.match(/(?:navigate|go)\s+to\s+(https?:\/\/\S+)/i) ||
          msg.match(/open\s+(https?:\/\/\S+)/i);

        if (m) {
          steps.push({
            tool: "navigate",
            args: {
              url: m[1],
            },
          });
          continue;
        }

        //--------------------------------------------------
        // Click
        //--------------------------------------------------

        m = msg.match(/click\s+(?:the\s+)?["']?(.+?)["']?$/i);

        if (m) {
          steps.push({
            tool: "click",
            args: {
              text: m[1].trim(),
            },
          });
          continue;
        }

        //--------------------------------------------------
        // Generic TYPE
        //
        // Supports:
        //
        // Type email "abc"
        // Type username "abc"
        // Type username-password "abc"
        // Type password "abc"
        // Enter email "abc"
        // Fill username "abc"
        //--------------------------------------------------

        m = msg.match(/(?:type|enter|fill)\s+([a-z0-9_-]+)\s+["'](.+?)["']/i);

        if (m) {
          let field = m[1].toLowerCase();

          if (
            field.includes("password") ||
            field.includes("passwd") ||
            field.includes("pwd") ||
            field.includes("username-password")
          ) {
            field = "password";
          } else if (
            field.includes("email") ||
            field.includes("user") ||
            field.includes("login") ||
            field.includes("id") ||
            field.includes("username")
          ) {
            field = "email";
          }

          steps.push({
            tool: "type",
            args: {
              field,
              value: m[2],
            },
          });

          continue;
        }

        //--------------------------------------------------
        // Type "value" into field
        //--------------------------------------------------

        m = msg.match(
          /(?:type|enter|fill)\s+["'](.+?)["']\s+(?:into|in)\s+(.+)/i,
        );

        if (m) {
          steps.push({
            tool: "type",
            args: {
              value: m[1],
              field: m[2].trim(),
            },
          });

          continue;
        }

        //--------------------------------------------------
        // Submit
        //--------------------------------------------------

        if (/submit|login|log\s*in|sign\s*in/i.test(msg)) {
          steps.push({
            tool: "click",
            args: {
              text: "Log in",
            },
          });

          continue;
        }

        console.warn("Unknown chat step:", msg);
        continue;
      }

      //--------------------------------------------------
      // Already executable
      //--------------------------------------------------

      steps.push({
        tool,
        args,
      });
    }

    return {
      mode: plan.mode || "action",
      steps,
      source: plan.source || "core-planner",
    };
  }

  // ====================================================
  // REGEX PLANNER (UNCHANGED - YOUR ORIGINAL LOGIC)
  // ====================================================

  regexPlan(command) {
    if (!command) return null;

    const steps = [];

    const pieces = command
      .split(/(?:\band\b|,|then)/i)
      .map((x) => x.trim())
      .filter(Boolean);

    for (const p of pieces) {
      const lower = p.toLowerCase();

      let m;

      // CLICK
      m = p.match(/^click\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "click",
          args: { text: m[1].trim() },
        });
        continue;
      }

      // TYPE
      m = p.match(/^type\s+(.+?)\s+(?:in|into|as)\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "type",
          args: { value: m[1].trim(), field: m[2].trim() },
        });
        continue;
      }

      // SELECT
      m = p.match(/^select\s+(.+?)\s+(?:in|from)\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "select",
          args: { value: m[1].trim(), field: m[2].trim() },
        });
        continue;
      }

      // CHECK
      m = p.match(/^check\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "check",
          args: { field: m[1].trim() },
        });
        continue;
      }

      // UNCHECK
      m = p.match(/^uncheck\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "uncheck",
          args: { field: m[1].trim() },
        });
        continue;
      }

      // HOVER
      m = p.match(/^hover\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "hover",
          args: { text: m[1].trim() },
        });
        continue;
      }

      // PRESS
      m = p.match(/^press\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "press",
          args: { key: m[1].trim() },
        });
        continue;
      }

      // SEARCH
      m = p.match(/^search\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "search",
          args: { query: m[1].trim() },
        });
        continue;
      }

      // WAIT
      m = p.match(/^wait\s+([0-9]+)(ms|s)?$/i);
      if (m) {
        let time = Number(m[1]);
        if (m[2] === "s") time *= 1000;

        steps.push({
          tool: "wait",
          args: { time },
        });
        continue;
      }

      // NAVIGATE
      m = p.match(/^go\s+to\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "navigate",
          args: { url: m[1].trim() },
        });
        continue;
      }

      // READ
      m = p.match(/^read\s+(.+)$/i);
      if (m) {
        steps.push({
          tool: "read",
          args: { text: m[1].trim() },
        });
        continue;
      }
    }

    return steps.length ? steps : null;
  }

  // ====================================================
  // LLM PLANNER (UNCHANGED)
  // ====================================================

  async llmPlan(command, pageText) {
    const prompt = `
Return ONLY valid JSON.

If chatting:
{
 "mode":"chat",
 "reply":"..."
}

If action:
{
 "mode":"action",
 "steps":[
   { "tool":"click", "args":{ "text":"..." } }
 ]
}

Tools:
click, type, select, check, uncheck, hover, press, wait, navigate, read

Page:
${pageText}

User:
${command}
`;

    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const r = await fetch(this.ollama, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: { temperature: 0 },
        }),
      });

      clearTimeout(timeout);

      const json = await r.json();
      const parsed = this.safeParse(json.response);

      if (parsed) return parsed;

      return {
        mode: "chat",
        reply: json.response || "Unable to understand request.",
      };
    } catch (err) {
      clearTimeout(timeout);

      return {
        mode: "chat",
        reply: `Planner failed: ${err.message}`,
      };
    }
  }

  // ====================================================
  // JSON PARSER
  // ====================================================

  safeParse(text) {
    if (!text) return null;

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  // ====================================================
  // EMPTY
  // ====================================================

  _empty() {
    return {
      mode: "chat",
      reply: "",
    };
  }
}
