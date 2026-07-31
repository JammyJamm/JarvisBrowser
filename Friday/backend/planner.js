//==========================================================
//
// backend/planner.js
//
// Ultra Intelligent LLM-First Planner
//
// Architecture
//
// User Command
//       │
//       ▼
// Current Page Snapshot
//       │
//       ▼
// LLM Planner (Primary Authority)
//       │
//       ▼
// JSON Parser / Repair
//       │
//       ▼
// Plan Normalizer
//       │
//       ▼
// Plan Validator
//       │
//       ├── Valid ───────────────► ToolMap
//       │
//       └── Invalid
//              │
//              ▼
//        LLM Repair Attempt
//              │
//              ▼
//           ToolMap
//
// Features
// --------
// ✔ LLM-first planning
// ✔ Qwen/Ollama support
// ✔ Page-aware planning
// ✔ Multi-step planning
// ✔ Strong action schema
// ✔ Click target enforcement
// ✔ Automatic invalid-plan repair
// ✔ JSON repair
// ✔ Tool alias normalization
// ✔ Optional Core Planner fallback
// ✔ Optional Regex fallback
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

      // IMPORTANT:
      // LLM is now the PRIMARY planner.
      llmFirst: options.llmFirst ?? true,

      // Fallbacks are disabled by default.
      // Enable only if you explicitly want them.
      enableCore: options.enableCore ?? false,

      enableRegexFallback: options.enableRegexFallback ?? false,

      enableLLM: options.enableLLM ?? true,

      debug: options.debug ?? false,

      timeout: options.timeout ?? 120000,

      temperature: options.temperature ?? 0,

      // Number of times the LLM may repair an invalid plan.
      maxRepairAttempts: options.maxRepairAttempts ?? 2,

      // Send enough page information to the LLM.
      maxPageText: options.maxPageText ?? 30000,

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

      llmPlannerHits: 0,

      llmRepairCalls: 0,

      corePlannerHits: 0,

      regexPlannerHits: 0,

      chatResponses: 0,

      actionResponses: 0,

      parseFailures: 0,

      validationFailures: 0,

      llmFailures: 0,

      repairedPlans: 0,
    };

    //--------------------------------------------------
    // Optional Core Planner
    //--------------------------------------------------

    this.core = this.options.enableCore ? new CorePlanner(this.options) : null;
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
  //
  // LLM IS THE PRIMARY AUTHORITY
  //==================================================

  async plan(command, pageText = "", context = {}) {
    this.stats.requests++;

    command = String(command || "").trim();

    if (!command) {
      return this.empty();
    }

    this.log("Planning command:", command);

    //--------------------------------------------------
    // LLM FIRST
    //--------------------------------------------------

    if (this.options.enableLLM && this.options.llmFirst) {
      this.stats.llmPlannerHits++;

      const llmResult = await this.llmPlan(command, pageText, context);

      //------------------------------------------------
      // Valid LLM Plan
      //------------------------------------------------

      if (llmResult?.mode === "action") {
        this.stats.actionResponses++;

        return llmResult;
      }

      //------------------------------------------------
      // Chat Response
      //------------------------------------------------

      if (llmResult?.mode === "chat") {
        this.stats.chatResponses++;

        return llmResult;
      }
    }

    //--------------------------------------------------
    // OPTIONAL CORE FALLBACK
    //--------------------------------------------------

    if (this.options.enableCore) {
      try {
        const advanced = await this.core.plan(command, {
          ...context,
          pageText,
        });

        if (advanced?.steps?.length) {
          const normalized = this.normalizeAdvanced(advanced, command);

          const validation = this.validatePlan(normalized, command);

          if (validation.valid) {
            this.stats.corePlannerHits++;
            this.stats.actionResponses++;

            return normalized;
          }

          this.warn("Core planner produced invalid plan:", validation.errors);
        }
      } catch (err) {
        this.warn("Core planner fallback failed:", err.message);
      }
    }

    //--------------------------------------------------
    // OPTIONAL REGEX FALLBACK
    //--------------------------------------------------

    if (this.options.enableRegexFallback) {
      const regex = this.regexPlan(command);

      if (regex?.length) {
        const fallbackPlan = {
          mode: "action",

          source: "regex-fallback",

          steps: regex,
        };

        const validation = this.validatePlan(fallbackPlan, command);

        if (validation.valid) {
          this.stats.regexPlannerHits++;
          this.stats.actionResponses++;

          return fallbackPlan;
        }
      }
    }

    //--------------------------------------------------
    // NOTHING WORKED
    //--------------------------------------------------

    return {
      mode: "chat",

      source: "planner",

      reply: "I could not create a valid execution plan for this command.",
    };
  }

  //==================================================
  // NORMALIZE ADVANCED PLAN
  //==================================================

  normalizeAdvanced(plan, originalCommand = "") {
    const steps = [];

    for (const rawStep of plan?.steps || []) {
      if (!rawStep) {
        continue;
      }

      let tool = String(rawStep.tool ?? rawStep.type ?? rawStep.action ?? "")
        .toLowerCase()
        .trim();

      const args = {
        ...(rawStep.args || {}),
      };

      //------------------------------------------------
      // Flatten common fields
      //------------------------------------------------

      const fields = [
        "url",
        "text",
        "target",
        "field",
        "value",
        "query",
        "selector",
        "key",
        "time",
        "role",
        "direction",
        "amount",
        "message",
      ];

      for (const field of fields) {
        if (args[field] === undefined && rawStep[field] !== undefined) {
          args[field] = rawStep[field];
        }
      }

      //------------------------------------------------
      // Tool aliases
      //------------------------------------------------

      switch (tool) {
        case "tap":
        case "open":
        case "pressbutton":
        case "choose":
          tool = "click";
          break;

        case "fill":
        case "enter":
        case "input":
        case "write":
          tool = "type";
          break;

        case "goto":
        case "visit":
        case "go":
        case "browse":
          tool = "navigate";
          break;

        case "sleep":
        case "pause":
        case "delay":
          tool = "wait";
          break;

        case "tick":
          tool = "check";
          break;

        case "untick":
          tool = "uncheck";
          break;

        case "move":
          tool = "hover";
          break;
      }

      //------------------------------------------------
      // CLICK NORMALIZATION
      //
      // CRITICAL:
      //
      // LLM may return:
      //
      // args: {
      //   text: "Learn more"
      // }
      //
      // Convert to:
      //
      // args: {
      //   target: "Learn more"
      // }
      //------------------------------------------------

      if (tool === "click") {
        const clickTarget =
          args.target ??
          args.text ??
          args.label ??
          args.name ??
          args.selector ??
          rawStep.target ??
          rawStep.text ??
          rawStep.label ??
          rawStep.name;

        if (
          clickTarget !== undefined &&
          clickTarget !== null &&
          String(clickTarget).trim()
        ) {
          args.target = String(clickTarget).trim();
        }

        // Remove ambiguity.
        delete args.text;
      }

      //------------------------------------------------
      // CHAT STEP CONVERSION
      //------------------------------------------------

      if (tool === "chat") {
        const message = String(
          args.message ?? rawStep.message ?? rawStep.raw ?? rawStep.text ?? "",
        ).trim();

        const converted = this.parseChatInstruction(message);

        if (converted) {
          steps.push(converted);
        }

        continue;
      }

      //------------------------------------------------
      // Skip empty tools
      //------------------------------------------------

      if (!tool) {
        continue;
      }

      //------------------------------------------------
      // Add normalized step
      //------------------------------------------------

      steps.push({
        tool,

        args,
      });
    }

    return {
      mode: plan?.mode || "action",

      source: plan?.source || "llm",

      steps,
    };
  }

  //==================================================
  // CHAT INSTRUCTION PARSER
  //==================================================

  parseChatInstruction(message) {
    if (!message) {
      return null;
    }

    let match;

    //--------------------------------------------------
    // NAVIGATE
    //--------------------------------------------------

    match =
      message.match(/(?:navigate|go)\s+to\s+(https?:\/\/\S+)/i) ||
      message.match(/open\s+(https?:\/\/\S+)/i);

    if (match) {
      return {
        tool: "navigate",

        args: {
          url: match[1],
        },
      };
    }

    //--------------------------------------------------
    // CLICK
    //--------------------------------------------------

    match = message.match(
      /^(?:click|tap|press|open)\s+(?:the\s+)?["']?(.+?)["']?$/i,
    );

    if (match) {
      return {
        tool: "click",

        args: {
          target: match[1].trim(),
        },
      };
    }

    //--------------------------------------------------
    // SEARCH
    //--------------------------------------------------

    match = message.match(/^search\s+(?:for\s+)?["']?(.+?)["']?$/i);

    if (match) {
      return {
        tool: "search",

        args: {
          query: match[1].trim(),
        },
      };
    }

    //--------------------------------------------------
    // WAIT
    //--------------------------------------------------

    match = message.match(
      /^wait\s+([0-9]+)\s*(ms|milliseconds|s|sec|seconds)?$/i,
    );

    if (match) {
      let time = Number(match[1]);

      const unit = (match[2] || "").toLowerCase();

      if (unit.startsWith("s")) {
        time *= 1000;
      }

      return {
        tool: "wait",

        args: {
          time,
        },
      };
    }

    return null;
  }

  //==================================================
  // VALIDATE PLAN
  //
  // IMPORTANT:
  // This prevents invalid plans from reaching
  // server.js.
  //==================================================

  validatePlan(plan, command = "") {
    const errors = [];

    if (!plan) {
      errors.push("Plan is missing.");

      return {
        valid: false,
        errors,
      };
    }

    if (plan.mode === "chat") {
      if (!String(plan.reply || "").trim()) {
        errors.push("Chat response is empty.");
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    }

    if (plan.mode !== "action") {
      errors.push(`Invalid plan mode: ${plan.mode}`);
    }

    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      errors.push("Action plan contains no steps.");

      return {
        valid: false,
        errors,
      };
    }

    for (let index = 0; index < plan.steps.length; index++) {
      const step = plan.steps[index];

      if (!step) {
        errors.push(`Step ${index + 1} is empty.`);

        continue;
      }

      const tool = String(step.tool || "")
        .trim()
        .toLowerCase();

      const args = step.args || {};

      //------------------------------------------------
      // Tool required
      //------------------------------------------------

      if (!tool) {
        errors.push(`Step ${index + 1} has no tool.`);

        continue;
      }

      //------------------------------------------------
      // CLICK TARGET REQUIRED
      //------------------------------------------------

      if (tool === "click" || tool === "clicksmart" || tool === "click-smart") {
        const target =
          args.target ?? args.text ?? args.label ?? args.name ?? args.selector;

        if (target === undefined || target === null || !String(target).trim()) {
          errors.push(`Step ${index + 1}: click target is missing.`);
        }
      }

      //------------------------------------------------
      // TYPE VALIDATION
      //------------------------------------------------

      if (tool === "type") {
        if (!String(args.field || args.target || args.selector || "").trim()) {
          errors.push(`Step ${index + 1}: type field is missing.`);
        }

        if (args.value === undefined || args.value === null) {
          errors.push(`Step ${index + 1}: type value is missing.`);
        }
      }

      //------------------------------------------------
      // NAVIGATE VALIDATION
      //------------------------------------------------

      if (tool === "navigate") {
        if (!String(args.url || "").trim()) {
          errors.push(`Step ${index + 1}: navigation URL is missing.`);
        }
      }
    }

    if (errors.length) {
      this.stats.validationFailures++;

      this.warn("Plan validation failed:", command, errors);
    }

    return {
      valid: errors.length === 0,

      errors,
    };
  }

  //==================================================
  // REPAIR PLAN USING LLM
  //==================================================

  async repairPlan(command, pageText, invalidPlan, validationErrors) {
    this.stats.llmRepairCalls++;

    const prompt = `
You are repairing an invalid browser automation plan.

Return ONLY valid JSON.

The user command is:

${command}

Current page:

${String(pageText || "").slice(0, this.options.maxPageText)}

Invalid plan:

${JSON.stringify(invalidPlan, null, 2)}

Validation errors:

${validationErrors.join("\n")}

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

STRICT RULES:

1. Every click MUST have args.target.
2. Never create a click step with empty args.
3. If the user says "click Learn more", target MUST be "Learn more".
4. If the user says "click Login", target MUST be "Login".
5. Preserve the exact visible target text from the user's command whenever possible.
6. Do not invent a target.
7. Every type action requires field and value.
8. Every navigate action requires url.
9. Return executable steps only.
10. Return no explanation.
11. Do not use markdown.
12. Return JSON only.

Correct JSON example:

{
  "mode": "action",
  "steps": [
    {
      "tool": "click",
      "args": {
        "target": "Learn more"
      }
    }
  ]
}
`;

    const result = await this.callLLM(prompt);

    if (!result) {
      return null;
    }

    const normalized = this.normalizeAdvanced(result, command);

    const validation = this.validatePlan(normalized, command);

    if (validation.valid) {
      this.stats.repairedPlans++;

      return normalized;
    }

    this.warn("LLM repair still invalid:", validation.errors);

    return null;
  }

  //==================================================
  // LLM PLANNER
  //==================================================

  async llmPlan(command, pageText = "", context = {}) {
    const limitedPageText = String(pageText || "").slice(
      0,
      this.options.maxPageText,
    );

    const prompt = `
You are the primary AI planner for Jarvis Browser.

Your job is to convert the user's natural-language browser command
into a precise executable JSON plan.

You are the PRIMARY planner.
Do not delegate planning to regex.
Do not assume another planner will fix your output.

==================================================
OUTPUT FORMAT
==================================================

For browser actions:

{
  "mode": "action",
  "steps": [
    {
      "tool": "click",
      "args": {
        "target": "Learn more"
      }
    }
  ]
}

For conversation:

{
  "mode": "chat",
  "reply": "..."
}

==================================================
AVAILABLE TOOLS
==================================================

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

==================================================
CRITICAL CLICK RULE
==================================================

Every click MUST contain:

{
  "tool": "click",
  "args": {
    "target": "VISIBLE TARGET"
  }
}

NEVER return:

{
  "tool": "click",
  "args": {}
}

NEVER return:

{
  "tool": "click",
  "args": {
    "text": ""
  }
}

If the user says:

"click learn more"

Return:

{
  "mode": "action",
  "steps": [
    {
      "tool": "click",
      "args": {
        "target": "learn more"
      }
    }
  ]
}

If the user says:

"click the Login button"

Return:

{
  "mode": "action",
  "steps": [
    {
      "tool": "click",
      "args": {
        "target": "Login button"
      }
    }
  ]
}

If the user says:

"click SSO Login"

Return:

{
  "mode": "action",
  "steps": [
    {
      "tool": "click",
      "args": {
        "target": "SSO Login"
      }
    }
  ]
}

==================================================
TARGET RULE
==================================================

For click commands, extract the target from the user's command.

The target can be:

- Button text
- Link text
- Visible text
- Accessible label
- Element name
- CSS selector if explicitly provided

Prefer visible text.

Do NOT leave the target empty.

==================================================
TYPE RULE
==================================================

For:

"Type admin into username"

Return:

{
  "tool": "type",
  "args": {
    "field": "username",
    "value": "admin"
  }
}

==================================================
NAVIGATION RULE
==================================================

For:

"Navigate to https://google.com"

Return:

{
  "tool": "navigate",
  "args": {
    "url": "https://google.com"
  }
}

==================================================
MULTI-STEP RULE
==================================================

For:

"Open Google and click Images"

Return multiple steps:

{
  "mode": "action",
  "steps": [
    {
      "tool": "navigate",
      "args": {
        "url": "https://google.com"
      }
    },
    {
      "tool": "click",
      "args": {
        "target": "Images"
      }
    }
  ]
}

==================================================
CURRENT PAGE
==================================================

${limitedPageText}

==================================================
CONTEXT
==================================================

${JSON.stringify(context || {})}

==================================================
USER COMMAND
==================================================

${command}

==================================================
FINAL RULES
==================================================

- Return ONLY JSON.
- No markdown.
- No explanation.
- No code fences.
- Never produce an empty click target.
- Never produce click args without target.
- Preserve the user's intended target.
- Use the current page only to improve target understanding.
- If the command is actionable, return mode "action".
- If the command is conversational, return mode "chat".
`;

    const result = await this.callLLM(prompt);

    //--------------------------------------------------
    // LLM FAILED
    //--------------------------------------------------

    if (!result) {
      return {
        mode: "chat",

        source: "llm",

        reply: "The AI planner could not create a plan.",
      };
    }

    //--------------------------------------------------
    // Normalize
    //--------------------------------------------------

    let normalized = this.normalizeAdvanced(result, command);

    //--------------------------------------------------
    // Validate
    //--------------------------------------------------

    let validation = this.validatePlan(normalized, command);

    //--------------------------------------------------
    // Valid
    //--------------------------------------------------

    if (validation.valid) {
      return normalized;
    }

    //--------------------------------------------------
    // Attempt deterministic recovery for simple
    // click commands.
    //
    // This is NOT fuzzy matching.
    // It only extracts the exact user target.
    //--------------------------------------------------

    const recovered = this.recoverSimpleCommand(command);

    if (recovered) {
      const recoveredValidation = this.validatePlan(recovered, command);

      if (recoveredValidation.valid) {
        this.log("Recovered invalid LLM plan:", recovered);

        return recovered;
      }
    }

    //--------------------------------------------------
    // Ask LLM to repair its own plan
    //--------------------------------------------------

    for (let attempt = 0; attempt < this.options.maxRepairAttempts; attempt++) {
      this.log(`LLM repair attempt ${attempt + 1}`);

      const repaired = await this.repairPlan(
        command,
        pageText,
        normalized,
        validation.errors,
      );

      if (repaired) {
        return repaired;
      }

      normalized = this.normalizeAdvanced(result, command);

      validation = this.validatePlan(normalized, command);
    }

    //--------------------------------------------------
    // Final failure
    //--------------------------------------------------

    return {
      mode: "chat",

      source: "llm-validation-failed",

      reply: "I could not create a valid browser action plan.",
    };
  }

  //==================================================
  // LLM CALL
  //==================================================

  async callLLM(prompt) {
    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(this.ollama, {
        method: "POST",

        signal: controller.signal,

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: this.model,

          prompt,

          stream: false,

          format: "json",

          options: {
            temperature: this.options.temperature,
          },
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`LLM request failed (${response.status})`);
      }

      const json = await response.json();

      const raw = json?.response || "";

      //------------------------------------------------
      // Direct JSON parse
      //------------------------------------------------

      let parsed = this.safeParse(raw);

      if (parsed) {
        return parsed;
      }

      //------------------------------------------------
      // JSON repair
      //------------------------------------------------

      this.stats.parseFailures++;

      parsed = this.repairJSON(raw);

      if (parsed) {
        return parsed;
      }

      this.warn("Unable to parse LLM response:", raw);

      return null;
    } catch (err) {
      clearTimeout(timeout);

      this.stats.llmFailures++;

      this.error("LLM planner failed:", err.message);

      return null;
    }
  }

  //==================================================
  // SIMPLE COMMAND RECOVERY
  //
  // Exact extraction only.
  // No fuzzy matching.
  //==================================================

  recoverSimpleCommand(command) {
    const text = String(command || "").trim();

    //--------------------------------------------------
    // CLICK
    //--------------------------------------------------

    let match = text.match(
      /^(?:click|tap|press|open|choose)\s+(?:the\s+)?["']?(.+?)["']?\s*$/i,
    );

    if (match) {
      const target = String(match[1] || "").trim();

      if (target) {
        return {
          mode: "action",

          source: "llm-recovery",

          steps: [
            {
              tool: "click",

              args: {
                target,
              },
            },
          ],
        };
      }
    }

    //--------------------------------------------------
    // NAVIGATE
    //--------------------------------------------------

    match = text.match(
      /^(?:go\s+to|navigate\s+to|visit|browse)\s+(https?:\/\/\S+)$/i,
    );

    if (match) {
      return {
        mode: "action",

        source: "llm-recovery",

        steps: [
          {
            tool: "navigate",

            args: {
              url: match[1],
            },
          },
        ],
      };
    }

    return null;
  }

  //==================================================
  // FAST REGEX FALLBACK
  //==================================================

  regexPlan(command) {
    if (!command) {
      return null;
    }

    const steps = [];

    const commands = String(command)
      .replace(/\s+/g, " ")
      .split(/\b(?:and then|then|after that|afterwards|next)\b/i)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const cmd of commands) {
      let match;

      //------------------------------------------------
      // CLICK
      //------------------------------------------------

      match = cmd.match(/^(?:click|tap|press|open|choose)\s+(.+)$/i);

      if (match) {
        steps.push({
          tool: "click",

          args: {
            target: match[1].trim(),
          },
        });

        continue;
      }

      //------------------------------------------------
      // TYPE
      //------------------------------------------------

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

      //------------------------------------------------
      // SEARCH
      //------------------------------------------------

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

      //------------------------------------------------
      // WAIT
      //------------------------------------------------

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

      //------------------------------------------------
      // NAVIGATE
      //------------------------------------------------

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
    }

    return steps.length ? steps : null;
  }

  //==================================================
  // SAFE JSON PARSER
  //==================================================

  safeParse(text) {
    if (!text) {
      return null;
    }

    try {
      let cleaned = String(text)
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      //------------------------------------------------
      // Direct parse first
      //------------------------------------------------

      try {
        return JSON.parse(cleaned);
      } catch {}

      //------------------------------------------------
      // Extract JSON object
      //------------------------------------------------

      const start = cleaned.indexOf("{");

      const end = cleaned.lastIndexOf("}");

      if (start === -1 || end === -1 || end <= start) {
        return null;
      }

      return JSON.parse(cleaned.substring(start, end + 1));
    } catch {
      return null;
    }
  }

  //==================================================
  // JSON REPAIR
  //==================================================

  repairJSON(text) {
    if (!text) {
      return null;
    }

    try {
      let repaired = String(text)
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .replace(/\r/g, "")
        .trim();

      const start = repaired.indexOf("{");

      const end = repaired.lastIndexOf("}");

      if (start === -1 || end === -1) {
        return null;
      }

      repaired = repaired.substring(start, end + 1);

      repaired = repaired.replace(/,\s*}/g, "}");

      repaired = repaired.replace(/,\s*]/g, "]");

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
  // STATISTICS
  //==================================================

  getStats() {
    return {
      ...this.stats,

      model: this.model,

      endpoint: this.ollama,

      options: {
        llmFirst: this.options.llmFirst,

        enableLLM: this.options.enableLLM,

        enableCore: this.options.enableCore,

        enableRegexFallback: this.options.enableRegexFallback,

        timeout: this.options.timeout,

        temperature: this.options.temperature,

        maxRepairAttempts: this.options.maxRepairAttempts,
      },
    };
  }

  //==================================================
  // RESET STATS
  //==================================================

  resetStats() {
    this.stats = {
      requests: 0,

      llmPlannerHits: 0,

      llmRepairCalls: 0,

      corePlannerHits: 0,

      regexPlannerHits: 0,

      chatResponses: 0,

      actionResponses: 0,

      parseFailures: 0,

      validationFailures: 0,

      llmFailures: 0,

      repairedPlans: 0,
    };

    return this.stats;
  }

  //==================================================
  // EMPTY
  //==================================================

  empty() {
    return {
      mode: "chat",

      source: "planner",

      reply: "",
    };
  }

  //==================================================
  // SELF TEST
  //==================================================

  async selfTest() {
    const samples = [
      "Click Login",

      "click learn more",

      "Click the SSO Login button",

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

  //==================================================
  // BENCHMARK
  //==================================================

  async benchmark(commands = []) {
    if (!commands.length) {
      commands = [
        "Click Login",

        "click learn more",

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

  //==================================================
  // CONFIGURATION
  //==================================================

  dumpConfiguration() {
    return {
      model: this.model,

      endpoint: this.ollama,

      options: {
        ...this.options,
      },

      statistics: this.getStats(),
    };
  }

  //==================================================
  // HEALTH
  //==================================================

  async health() {
    return {
      healthy: true,

      model: this.model,

      endpoint: this.ollama,

      corePlanner: !!this.core,

      llmEnabled: this.options.enableLLM,

      llmFirst: this.options.llmFirst,

      regexFallback: this.options.enableRegexFallback,

      statistics: this.getStats(),
    };
  }

  //==================================================
  // VERSION
  //==================================================

  version() {
    return {
      name: "Ultra Intelligent LLM-First Planner",

      version: "3.0.0",

      planner: "LLM First + Validation + Self Repair",

      model: this.model,
    };
  }

  //==================================================
  // EXPORT CONFIGURATION
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
