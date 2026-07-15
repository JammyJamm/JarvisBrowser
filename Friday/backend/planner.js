//==========================================================
//
// backend/planner.js
//
// Ultra Intelligent Planner
//
// Architecture
//
// User Command
//       │
// Intent Parser
//       │
// Core Planner Pipeline
//       │
// Fast Regex Planner
//       │
// LLM Planner (Qwen/Ollama)
//       │
// ToolMap
//
// Features
// --------
// ✔ Multi-stage planning pipeline
// ✔ Ultra-fast regex planner
// ✔ Core planner integration
// ✔ Intelligent normalization
// ✔ Multi-step planning
// ✔ Tool alias support
// ✔ Context-aware planning
// ✔ Automatic fallback hierarchy
// ✔ JSON repair
// ✔ Performance statistics
//
//==========================================================

import CorePlanner from "./planner/planner.js";

export default class Planner {
  constructor(options = {}) {
    //--------------------------------------------------
    // Configuration
    //--------------------------------------------------

    this.options = {
      model: options.model || "qwen3:8b",

      endpoint: options.endpoint || "http://localhost:11434/api/generate",

      regexFirst: options.regexFirst ?? false,

      enableCore: options.enableCore ?? true,

      enableLLM: options.enableLLM ?? true,

      debug: options.debug ?? false,

      timeout: options.timeout ?? 120000,

      temperature: options.temperature ?? 0,

      ...options,
    };

    //--------------------------------------------------
    // Runtime
    //--------------------------------------------------

    this.model = this.options.model;

    this.ollama = this.options.endpoint;

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.stats = {
      requests: 0,

      corePlannerHits: 0,

      regexPlannerHits: 0,

      llmPlannerHits: 0,

      chatResponses: 0,

      actionResponses: 0,

      parseFailures: 0,

      llmFailures: 0,
    };

    //--------------------------------------------------
    // Core Planner
    //--------------------------------------------------

    this.core = new CorePlanner(this.options);
  }

  //==================================================
  // LOGGING
  //==================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[Planner]", ...args);
    }
  }

  warn(...args) {
    console.warn("[Planner]", ...args);
  }

  error(...args) {
    console.error("[Planner]", ...args);
  }

  //==================================================
  // PUBLIC PLAN
  //==================================================

  async plan(command, pageText = "", context = {}) {
    this.stats.requests++;

    if (!command) {
      return this.empty();
    }

    command = String(command).trim();

    //--------------------------------------------------
    // Fast Regex First (Optional)
    //--------------------------------------------------

    if (this.options.regexFirst) {
      const fast = this.regexPlan(command);

      if (fast?.length) {
        this.stats.regexPlannerHits++;
        this.stats.actionResponses++;

        return {
          mode: "action",

          source: "regex",

          steps: fast,
        };
      }
    }

    //--------------------------------------------------
    // Core Planner Pipeline
    //--------------------------------------------------

    if (this.options.enableCore) {
      try {
        const advanced = await this.core.plan(command, {
          ...context,
          pageText,
        });

        if (advanced?.steps?.length) {
          this.stats.corePlannerHits++;
          this.stats.actionResponses++;

          return this.normalizeAdvanced(advanced);
        }
      } catch (err) {
        this.warn("Core planner failed:", err.message);
      }
    }

    //--------------------------------------------------
    // Regex Planner Fallback
    //--------------------------------------------------

    const regex = this.regexPlan(command);

    if (regex?.length) {
      this.stats.regexPlannerHits++;
      this.stats.actionResponses++;

      return {
        mode: "action",

        source: "regex",

        steps: regex,
      };
    }

    //--------------------------------------------------
    // LLM Planner
    //--------------------------------------------------

    if (this.options.enableLLM) {
      this.stats.llmPlannerHits++;

      return await this.llmPlan(command, pageText);
    }

    //--------------------------------------------------
    // Nothing matched
    //--------------------------------------------------

    return {
      mode: "chat",

      reply: "I couldn't determine the requested action.",
    };
  }

  //==================================================
  // PART 2
  // normalizeAdvanced()
  // Chat → Action conversion
  // Tool normalization
  //==================================================
  //==================================================
  // NORMALIZE ADVANCED PLAN
  //==================================================

  normalizeAdvanced(plan) {
    const steps = [];

    for (const step of plan.steps || []) {
      let tool = String(step.tool ?? step.type ?? "")
        .toLowerCase()
        .trim();

      const args = {
        ...(step.args || {}),
      };

      //--------------------------------------------------
      // Flatten common fields
      //--------------------------------------------------

      args.url ??= step.url;
      args.text ??= step.text;
      args.field ??= step.field;
      args.value ??= step.value;
      args.query ??= step.query;
      args.selector ??= step.selector;
      args.key ??= step.key;
      args.time ??= step.time;
      args.role ??= step.role;

      //--------------------------------------------------
      // Tool aliases
      //--------------------------------------------------

      switch (tool) {
        case "tap":
        case "open":
        case "choose":
          tool = "click";
          break;

        case "fill":
        case "enter":
        case "input":
          tool = "type";
          break;

        case "goto":
        case "visit":
        case "go":
          tool = "navigate";
          break;

        case "sleep":
        case "pause":
          tool = "wait";
          break;

        case "tick":
          tool = "check";
          break;

        case "untick":
          tool = "uncheck";
          break;
      }

      //--------------------------------------------------
      // CHAT STEP
      //--------------------------------------------------

      if (tool === "chat") {
        const message = String(
          args.message ?? step.message ?? step.raw ?? step.text ?? "",
        ).trim();

        if (!message) continue;

        let match;

        //----------------------------------------------
        // Navigate
        //----------------------------------------------

        match =
          message.match(/(?:navigate|go)\s+to\s+(https?:\/\/\S+)/i) ||
          message.match(/open\s+(https?:\/\/\S+)/i);

        if (match) {
          steps.push({
            tool: "navigate",

            args: {
              url: match[1],
            },
          });

          continue;
        }

        //----------------------------------------------
        // Click
        //----------------------------------------------

        match = message.match(
          /(?:click|tap|press)\s+(?:the\s+)?["']?(.+?)["']?$/i,
        );

        if (match) {
          steps.push({
            tool: "click",

            args: {
              text: match[1].trim(),
            },
          });

          continue;
        }

        //----------------------------------------------
        // Search
        //----------------------------------------------

        match = message.match(/search\s+(?:for\s+)?["']?(.+?)["']?$/i);

        if (match) {
          steps.push({
            tool: "search",

            args: {
              query: match[1].trim(),
            },
          });

          continue;
        }

        //----------------------------------------------
        // Wait
        //----------------------------------------------

        match = message.match(
          /wait\s+([0-9]+)\s*(ms|milliseconds|s|sec|seconds)?/i,
        );

        if (match) {
          let time = Number(match[1]);

          const unit = (match[2] || "").toLowerCase();

          if (unit.startsWith("s")) {
            time *= 1000;
          }

          steps.push({
            tool: "wait",

            args: {
              time,
            },
          });

          continue;
        }

        //----------------------------------------------
        // Type:
        //
        // Type email "abc"
        // Fill password "123"
        //----------------------------------------------

        match = message.match(
          /(?:type|fill|enter)\s+([a-z0-9_\- ]+)\s+["'](.+?)["']/i,
        );

        if (match) {
          let field = match[1].trim().toLowerCase();

          if (/(password|passwd|pwd)/i.test(field)) {
            field = "password";
          } else if (/(email|user|login|username|id)/i.test(field)) {
            field = "email";
          }

          steps.push({
            tool: "type",

            args: {
              field,

              value: match[2],
            },
          });

          continue;
        }

        //----------------------------------------------
        // Type "value" into field
        //----------------------------------------------

        match = message.match(
          /(?:type|fill|enter)\s+["'](.+?)["']\s+(?:into|in)\s+(.+)/i,
        );

        if (match) {
          steps.push({
            tool: "type",

            args: {
              value: match[1],

              field: match[2].trim(),
            },
          });

          continue;
        }

        //----------------------------------------------
        // Submit/Login
        //----------------------------------------------

        if (/(submit|login|log\s*in|sign\s*in)/i.test(message)) {
          steps.push({
            tool: "click",

            args: {
              text: "Log in",
            },
          });

          continue;
        }

        //----------------------------------------------
        // Unknown chat instruction
        //----------------------------------------------

        this.warn("Unknown chat step:", message);

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

      source: plan.source || "core-planner",

      steps,
    };
  }

  //==================================================
  // PART 3
  // Fast Regex Planner
  // Multi-step parsing
  // Command splitting
  //==================================================
  //==================================================
  // FAST REGEX PLANNER
  //==================================================

  regexPlan(command) {
    if (!command) return null;

    const steps = [];

    //--------------------------------------------------
    // Split multi-step commands
    //--------------------------------------------------

    const commands = String(command)
      .replace(/\s+/g, " ")

      .split(/\b(?:and then|then|after that|afterwards|next|and|,)\b/i)

      .map((part) => part.trim())

      .filter(Boolean);

    //--------------------------------------------------
    // Parse every instruction
    //--------------------------------------------------

    for (const cmd of commands) {
      let match;

      const lower = cmd.toLowerCase();

      //----------------------------------------------
      // CLICK
      //----------------------------------------------

      match = cmd.match(/^(?:click|tap|press|open|choose)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "click",

          args: {
            text: match[1].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // TYPE
      //
      // Type abc into email
      // Fill password with 123
      //----------------------------------------------

      match = cmd.match(
        /^(?:type|fill|enter|input)\s+(.+?)\s+(?:into|in|as|to|with)\s+(.+)$/i,
      );

      if (match) {
        steps.push({
          tool: "type",

          args: {
            value: match[1].trim(),

            field: match[2].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // TYPE field value
      //
      // type email test@test.com
      //----------------------------------------------

      match = cmd.match(
        /^(?:type|fill|enter)\s+([a-z0-9_\- ]+)\s+["']?(.+?)["']?$/i,
      );

      if (match) {
        steps.push({
          tool: "type",

          args: {
            field: match[1].trim(),

            value: match[2].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // SEARCH
      //----------------------------------------------

      match = cmd.match(/^(?:search|find|lookup)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "search",

          args: {
            query: match[1].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // SELECT
      //----------------------------------------------

      match = cmd.match(/^(?:select|choose)\s+(.+?)\s+(?:from|in)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "select",

          args: {
            value: match[1].trim(),

            field: match[2].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // CHECK
      //----------------------------------------------

      match = cmd.match(/^(?:check|tick)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "check",

          args: {
            field: match[1].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // UNCHECK
      //----------------------------------------------

      match = cmd.match(/^(?:uncheck|untick)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "uncheck",

          args: {
            field: match[1].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // HOVER
      //----------------------------------------------

      match = cmd.match(/^(?:hover|move)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "hover",

          args: {
            text: match[1].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // PRESS KEY
      //----------------------------------------------

      match = cmd.match(/^(?:press|hit)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "press",

          args: {
            key: match[1].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // WAIT
      //----------------------------------------------

      match = cmd.match(
        /^wait\s+([0-9]+)\s*(ms|milliseconds|s|sec|seconds)?$/i,
      );

      if (match) {
        let time = Number(match[1]);

        const unit = (match[2] || "").toLowerCase();

        if (unit.startsWith("s")) {
          time *= 1000;
        }

        steps.push({
          tool: "wait",

          args: {
            time,
          },
        });

        continue;
      }

      //----------------------------------------------
      // NAVIGATE
      //----------------------------------------------

      match = cmd.match(/^(?:go\s+to|navigate\s+to|visit|browse)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "navigate",

          args: {
            url: match[1].trim(),
          },
        });

        continue;
      }

      //----------------------------------------------
      // READ
      //----------------------------------------------

      match = cmd.match(/^(?:read|inspect|show)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "read",

          args: {
            text: match[1].trim(),
          },
        });

        continue;
      }
    }

    return steps.length ? steps : null;
  }

  //==================================================
  // PART 4
  // LLM Planner
  // JSON repair
  // Response normalization
  //==================================================
  //==================================================
  // LLM PLANNER
  //==================================================

  async llmPlan(command, pageText = "") {
    const prompt = `
You are Jarvis Browser Planner.

Return ONLY valid JSON.

----------------------------------------
CHAT RESPONSE
----------------------------------------

{
  "mode":"chat",
  "reply":"..."
}

----------------------------------------
ACTION RESPONSE
----------------------------------------

{
  "mode":"action",
  "steps":[
    {
      "tool":"click",
      "args":{
        "text":"..."
      }
    }
  ]
}

Available tools:

click
type
search
select
check
uncheck
hover
press
wait
navigate
read
scroll

Rules:

- Never explain.
- Never return markdown.
- Never wrap JSON in code fences.
- Prefer multiple steps when needed.
- Use only the tools listed above.

Current page:

${pageText}

User command:

${command}
`;

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),

      this.options.timeout,
    );

    try {
      const response = await fetch(
        this.ollama,

        {
          method: "POST",

          signal: controller.signal,

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            model: this.model,

            prompt,

            stream: false,

            options: {
              temperature: this.options.temperature,
            },
          }),
        },
      );

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`LLM request failed (${response.status})`);
      }

      const json = await response.json();

      const parsed = this.safeParse(json.response);

      //--------------------------------------------------
      // Parsed successfully
      //--------------------------------------------------

      if (parsed) {
        if (parsed.mode === "chat") {
          this.stats.chatResponses++;
        } else {
          this.stats.actionResponses++;
        }

        return parsed;
      }

      //--------------------------------------------------
      // JSON parsing failed
      //--------------------------------------------------

      this.stats.parseFailures++;

      const repaired = this.repairJSON(json.response || "");

      if (repaired) {
        if (repaired.mode === "chat") {
          this.stats.chatResponses++;
        } else {
          this.stats.actionResponses++;
        }

        return repaired;
      }

      //--------------------------------------------------
      // Plain text fallback
      //--------------------------------------------------

      this.stats.chatResponses++;

      return {
        mode: "chat",

        reply: String(json.response || "Unable to understand request.").trim(),
      };
    } catch (err) {
      clearTimeout(timeout);

      this.stats.llmFailures++;

      this.error(
        "LLM planner failed:",

        err.message,
      );

      return {
        mode: "chat",

        reply: `Planner failed: ${err.message}`,
      };
    }
  }

  //==================================================
  // JSON PARSER
  //==================================================

  safeParse(text) {
    if (!text) return null;

    try {
      text = String(text)
        .replace(/```json/gi, "")

        .replace(/```/g, "")

        .trim();

      const match = text.match(/\{[\s\S]*\}/);

      if (!match) return null;

      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  //==================================================
  // JSON REPAIR
  //==================================================

  repairJSON(text) {
    if (!text) return null;

    try {
      let repaired = String(text)
        .replace(/```json/gi, "")

        .replace(/```/g, "")

        .replace(/\r/g, "")

        .trim();

      repaired = repaired.substring(
        repaired.indexOf("{"),

        repaired.lastIndexOf("}") + 1,
      );

      repaired = repaired.replace(
        /,\s*}/g,

        "}",
      );

      repaired = repaired.replace(
        /,\s*]/g,

        "]",
      );

      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  //==================================================
  // RESPONSE NORMALIZATION
  //==================================================

  normalizeResponse(result) {
    if (!result) {
      return this.empty();
    }

    if (result.mode === "action") {
      result.steps ??= [];
    }

    if (result.mode === "chat") {
      result.reply ??= "";
    }

    return result;
  }

  //==================================================
  // PART 5
  // Statistics
  // Reset
  // Empty
  // Debug Helpers
  //==================================================
  //==================================================
  // STATISTICS
  //==================================================

  getStats() {
    return {
      ...this.stats,

      model: this.model,

      endpoint: this.ollama,

      options: {
        regexFirst: this.options.regexFirst,

        enableCore: this.options.enableCore,

        enableLLM: this.options.enableLLM,

        timeout: this.options.timeout,

        temperature: this.options.temperature,
      },
    };
  }

  resetStats() {
    this.stats = {
      requests: 0,

      corePlannerHits: 0,

      regexPlannerHits: 0,

      llmPlannerHits: 0,

      chatResponses: 0,

      actionResponses: 0,

      parseFailures: 0,

      llmFailures: 0,
    };

    return this.stats;
  }

  //==================================================
  // EMPTY RESPONSE
  //==================================================

  empty() {
    return {
      mode: "chat",

      reply: "",
    };
  }

  //==================================================
  // DEBUG HELPERS
  //==================================================

  async selfTest() {
    const samples = [
      "Click Login",

      "Type admin into username",

      "Type secret into password",

      "Click Sign In",

      "Navigate to https://google.com",

      "Search Playwright",

      "Wait 2 seconds",
    ];

    const results = [];

    for (const sample of samples) {
      const result = await this.plan(sample);

      results.push({
        command: sample,

        result,
      });
    }

    return results;
  }

  async benchmark(commands = []) {
    if (!commands.length) {
      commands = [
        "Click Login",

        "Type admin into username",

        "Navigate to https://google.com",
      ];
    }

    const started = performance.now();

    const results = [];

    for (const command of commands) {
      results.push(await this.plan(command));
    }

    const elapsed = performance.now() - started;

    return {
      commands: commands.length,

      totalTime: Number(elapsed.toFixed(2)),

      averageTime: Number((elapsed / commands.length).toFixed(2)),

      results,
    };
  }

  dumpConfiguration() {
    return {
      model: this.model,

      endpoint: this.ollama,

      options: { ...this.options },

      statistics: this.getStats(),
    };
  }

  async health() {
    return {
      healthy: true,

      model: this.model,

      endpoint: this.ollama,

      corePlanner: !!this.core,

      llmEnabled: this.options.enableLLM,

      regexEnabled: true,

      statistics: this.getStats(),
    };
  }

  //==================================================
  // VERSION
  //==================================================

  version() {
    return {
      name: "Ultra Intelligent Planner",

      version: "2.0.0",

      planner: "Core + Regex + LLM",

      model: this.model,
    };
  }

  //==================================================
  // EXPORT
  //==================================================

  exportConfiguration() {
    return {
      version: this.version(),

      options: {
        ...this.options,
      },

      statistics: this.getStats(),
    };
  }
}
