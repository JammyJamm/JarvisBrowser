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
// LLM Planner
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
//       ├── Valid ───────────────► Executor / ToolMap
//       │
//       └── Invalid
//              │
//              ├── Deterministic Recovery
//              │
//              ▼
//        LLM Repair Attempt
//              │
//              ▼
//           Validator
//              │
//              ▼
//           ToolMap
//
//==========================================================
//
// IMPORTANT DESIGN RULE
//
// Planner decides:
//
//     WHAT should happen
//
// Resolver decides:
//
//     HOW to find the element
//
// ScoringEngine decides:
//
//     WHICH DOM candidate is the best match
//
// Therefore:
//
//     Planner MUST NOT perform fuzzy matching.
//
//==========================================================

import CorePlanner from "./planner/planner.js";

export default class Planner {
  constructor(options = {}) {
    //======================================================
    // CONFIGURATION
    //======================================================

    this.options = {
      model: options.model || "qwen3:8b",

      endpoint: options.endpoint || "http://localhost:11434/api/generate",

      // LLM is the primary authority.
      llmFirst: options.llmFirst ?? true,

      // Optional fallback planner.
      enableCore: options.enableCore ?? false,

      // Optional deterministic fallback.
      enableRegexFallback: options.enableRegexFallback ?? false,

      enableLLM: options.enableLLM ?? true,

      debug: options.debug ?? false,

      timeout: options.timeout ?? 120000,

      temperature: options.temperature ?? 0,

      maxRepairAttempts: options.maxRepairAttempts ?? 2,

      maxPageText: options.maxPageText ?? 30000,

      // Prevent excessively large context payloads.
      maxContextText: options.maxContextText ?? 12000,

      // Maximum number of executable steps.
      maxSteps: options.maxSteps ?? 50,

      // LLM request retry count.
      llmRetryAttempts: options.llmRetryAttempts ?? 1,

      ...options,
    };

    //======================================================
    // RUNTIME
    //======================================================

    this.model = this.options.model;

    this.ollama = this.options.endpoint;

    //======================================================
    // STATISTICS
    //======================================================

    this.stats = this.createEmptyStats();

    //======================================================
    // OPTIONAL CORE PLANNER
    //======================================================

    this.core = this.options.enableCore ? new CorePlanner(this.options) : null;
  }

  //========================================================
  // EMPTY STATS
  //========================================================

  createEmptyStats() {
    return {
      requests: 0,

      llmPlannerHits: 0,

      llmRepairCalls: 0,

      llmRequests: 0,

      llmRetries: 0,

      corePlannerHits: 0,

      regexPlannerHits: 0,

      recoveryHits: 0,

      chatResponses: 0,

      actionResponses: 0,

      parseFailures: 0,

      validationFailures: 0,

      llmFailures: 0,

      repairedPlans: 0,

      rejectedPlans: 0,

      totalPlanningTime: 0,
    };
  }

  //========================================================
  // LOGGING
  //========================================================

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

  //========================================================
  // PUBLIC PLAN
  //========================================================

  async plan(command, pageText = "", context = {}) {
    const started = performance.now();

    this.stats.requests++;

    command = this.cleanText(command);

    if (!command) {
      return this.empty();
    }

    this.log("Planning command:", command);

    try {
      //====================================================
      // LLM FIRST
      //====================================================

      if (this.options.enableLLM && this.options.llmFirst) {
        this.stats.llmPlannerHits++;

        const llmResult = await this.llmPlan(command, pageText, context);

        //==================================================
        // VALID ACTION
        //==================================================

        if (llmResult?.mode === "action") {
          this.stats.actionResponses++;

          return llmResult;
        }

        //==================================================
        // CHAT
        //==================================================

        if (llmResult?.mode === "chat") {
          this.stats.chatResponses++;

          return llmResult;
        }
      }

      //====================================================
      // OPTIONAL CORE FALLBACK
      //====================================================

      if (this.options.enableCore && this.core) {
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
          this.warn("Core planner fallback failed:", err?.message || err);
        }
      }

      //====================================================
      // OPTIONAL REGEX FALLBACK
      //====================================================

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

      //====================================================
      // NOTHING WORKED
      //====================================================

      this.stats.rejectedPlans++;

      return {
        mode: "chat",

        source: "planner",

        reply: "I could not create a valid execution plan for this command.",
      };
    } finally {
      const elapsed = performance.now() - started;

      this.stats.totalPlanningTime += elapsed;
    }
  }

  //========================================================
  // TEXT CLEANING
  //========================================================

  cleanText(value) {
    return String(value ?? "")
      .replace(/\u0000/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  //========================================================
  // NORMALIZE ADVANCED PLAN
  //========================================================

  normalizeAdvanced(plan, originalCommand = "") {
    const steps = [];

    const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];

    for (let index = 0; index < rawSteps.length; index++) {
      if (steps.length >= this.options.maxSteps) {
        this.warn(`Maximum step limit reached (${this.options.maxSteps}).`);

        break;
      }

      const rawStep = rawSteps[index];

      if (!rawStep || typeof rawStep !== "object") {
        continue;
      }

      let tool = String(rawStep.tool ?? rawStep.type ?? rawStep.action ?? "")
        .toLowerCase()
        .trim();

      const args = {
        ...(rawStep.args || {}),
      };

      //====================================================
      // FLATTEN COMMON FIELDS
      //====================================================

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
        "label",
        "name",
        "option",
        "index",
      ];

      for (const field of fields) {
        if (args[field] === undefined && rawStep[field] !== undefined) {
          args[field] = rawStep[field];
        }
      }

      //====================================================
      // TOOL ALIASES
      //====================================================

      tool = this.normalizeTool(tool);

      //====================================================
      // CLICK NORMALIZATION
      //====================================================

      if (tool === "click") {
        const clickTarget = this.extractClickTarget(args, rawStep);

        if (clickTarget) {
          args.target = clickTarget;
        }

        // Target is canonical.
        delete args.text;
        delete args.label;
        delete args.name;
      }

      //====================================================
      // TYPE NORMALIZATION
      //====================================================

      if (tool === "type") {
        if (args.field === undefined && args.target !== undefined) {
          args.field = args.target;
        }

        if (args.value === undefined && args.text !== undefined) {
          args.value = args.text;
        }

        delete args.text;
      }

      //====================================================
      // WAIT NORMALIZATION
      //====================================================

      if (tool === "wait") {
        args.time = this.normalizeTime(args.time);
      }

      //====================================================
      // SCROLL NORMALIZATION
      //====================================================

      if (tool === "scroll") {
        args.direction = String(args.direction || "down")
          .toLowerCase()
          .trim();

        if (args.amount !== undefined) {
          const amount = Number(args.amount);

          if (Number.isFinite(amount)) {
            args.amount = amount;
          }
        }
      }

      //====================================================
      // CHAT STEP
      //====================================================

      if (tool === "chat") {
        const message = this.cleanText(
          args.message ?? rawStep.message ?? rawStep.raw ?? rawStep.text ?? "",
        );

        const converted = this.parseChatInstruction(message);

        if (converted) {
          steps.push(converted);
        }

        continue;
      }

      //====================================================
      // IGNORE EMPTY TOOLS
      //====================================================

      if (!tool) {
        continue;
      }

      //====================================================
      // NORMALIZED STEP
      //====================================================

      steps.push({
        tool,
        args,
      });
    }

    return {
      mode: plan?.mode === "chat" ? "chat" : "action",

      source: plan?.source || "llm",

      steps,

      ...(plan?.reply
        ? {
            reply: String(plan.reply).trim(),
          }
        : {}),

      ...(originalCommand
        ? {
            command: originalCommand,
          }
        : {}),
    };
  }

  //========================================================
  // TOOL NORMALIZATION
  //========================================================

  normalizeTool(tool) {
    const aliases = {
      tap: "click",
      pressbutton: "click",
      choose: "click",
      clickbutton: "click",
      clicksmart: "click",
      "click-smart": "click",

      fill: "type",
      enter: "type",
      input: "type",
      write: "type",

      goto: "navigate",
      visit: "navigate",
      go: "navigate",
      browse: "navigate",
      openurl: "navigate",

      sleep: "wait",
      pause: "wait",
      delay: "wait",

      tick: "check",
      untick: "uncheck",

      move: "hover",

      find: "search",
      lookup: "search",

      uncheck: "uncheck",

      back: "back",
      forward: "forward",

      reload: "refresh",
      refreshpage: "refresh",

      keypress: "press",
      keyboard: "press",

      clearfield: "clear",
    };

    return aliases[tool] || tool;
  }

  //========================================================
  // CLICK TARGET EXTRACTION
  //
  // IMPORTANT:
  //
  // NO FUZZY MATCHING HERE.
  //
  // This only extracts the target supplied by the LLM.
  //========================================================

  extractClickTarget(args = {}, rawStep = {}) {
    const candidates = [
      args.target,
      args.text,
      args.label,
      args.name,
      args.selector,

      rawStep.target,
      rawStep.text,
      rawStep.label,
      rawStep.name,
    ];

    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null) {
        const value = String(candidate).trim();

        if (value) {
          return this.cleanTarget(value);
        }
      }
    }

    return "";
  }

  //========================================================
  // CLEAN TARGET
  //
  // Removes unnecessary natural-language wrappers,
  // but does NOT fuzzy-match or change spelling.
  //========================================================

  cleanTarget(value) {
    let target = String(value || "").trim();

    target = target
      .replace(/^["'`]+/, "")
      .replace(/["'`]+$/, "")
      .trim();

    target = target.replace(
      /^(?:the\s+)?(?:button|tab|link|label|element)\s+(?:called\s+|named\s+)?/i,
      "",
    );

    target = target.trim();

    return target;
  }

  //========================================================
  // CHAT INSTRUCTION PARSER
  //========================================================

  parseChatInstruction(message) {
    if (!message) {
      return null;
    }

    let match;

    //======================================================
    // NAVIGATE
    //======================================================

    match =
      message.match(/^(?:navigate|go)\s+to\s+(https?:\/\/\S+)/i) ||
      message.match(/^open\s+(https?:\/\/\S+)/i);

    if (match) {
      return {
        tool: "navigate",
        args: {
          url: match[1],
        },
      };
    }

    //======================================================
    // CLICK
    //======================================================

    match = message.match(
      /^(?:click|tap|press|open|choose)\s+(?:the\s+)?(.+)$/i,
    );

    if (match) {
      const target = this.cleanTarget(match[1]);

      if (target) {
        return {
          tool: "click",
          args: {
            target,
          },
        };
      }
    }

    //======================================================
    // SEARCH
    //======================================================

    match = message.match(/^search\s+(?:for\s+)?(.+)$/i);

    if (match) {
      return {
        tool: "search",
        args: {
          query: match[1].trim(),
        },
      };
    }

    //======================================================
    // WAIT
    //======================================================

    match = message.match(
      /^wait\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds|s|sec|seconds)?$/i,
    );

    if (match) {
      return {
        tool: "wait",
        args: {
          time: this.normalizeTime(`${match[1]} ${match[2] || "ms"}`),
        },
      };
    }

    return null;
  }

  //========================================================
  // TIME NORMALIZATION
  //========================================================

  normalizeTime(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }

    const text = String(value ?? "")
      .trim()
      .toLowerCase();

    if (!text) {
      return 0;
    }

    const match = text.match(
      /^([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds|s|sec|seconds)?$/i,
    );

    if (!match) {
      const numeric = Number(text);

      return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
    }

    let time = Number(match[1]);

    const unit = match[2] || "ms";

    if (unit === "s" || unit === "sec" || unit === "seconds") {
      time *= 1000;
    }

    return Math.max(0, Math.round(time));
  }

  //========================================================
  // VALIDATE PLAN
  //========================================================

  validatePlan(plan, command = "") {
    const errors = [];

    if (!plan) {
      errors.push("Plan is missing.");

      return {
        valid: false,
        errors,
      };
    }

    //======================================================
    // CHAT
    //======================================================

    if (plan.mode === "chat") {
      if (!String(plan.reply || "").trim()) {
        errors.push("Chat response is empty.");
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    }

    //======================================================
    // MODE
    //======================================================

    if (plan.mode !== "action") {
      errors.push(`Invalid plan mode: ${plan.mode}`);
    }

    //======================================================
    // STEPS
    //======================================================

    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      errors.push("Action plan contains no steps.");

      this.stats.validationFailures++;

      return {
        valid: false,
        errors,
      };
    }

    if (plan.steps.length > this.options.maxSteps) {
      errors.push(
        `Action plan exceeds maximum step limit (${this.options.maxSteps}).`,
      );
    }

    //======================================================
    // VALIDATE EACH STEP
    //======================================================

    for (let index = 0; index < plan.steps.length; index++) {
      const step = plan.steps[index];

      const number = index + 1;

      if (!step || typeof step !== "object") {
        errors.push(`Step ${number} is empty.`);

        continue;
      }

      const tool = String(step.tool || "")
        .trim()
        .toLowerCase();

      const args = step.args && typeof step.args === "object" ? step.args : {};

      //====================================================
      // TOOL REQUIRED
      //====================================================

      if (!tool) {
        errors.push(`Step ${number} has no tool.`);

        continue;
      }

      //====================================================
      // CLICK
      //====================================================

      if (tool === "click") {
        const target = args.target;

        if (target === undefined || target === null || !String(target).trim()) {
          errors.push(`Step ${number}: click target is missing.`);
        }
      }

      //====================================================
      // TYPE
      //====================================================

      if (tool === "type") {
        const field = args.field ?? args.target ?? args.selector;

        if (field === undefined || field === null || !String(field).trim()) {
          errors.push(`Step ${number}: type field is missing.`);
        }

        if (args.value === undefined || args.value === null) {
          errors.push(`Step ${number}: type value is missing.`);
        }
      }

      //====================================================
      // NAVIGATE
      //====================================================

      if (tool === "navigate") {
        if (!String(args.url || "").trim()) {
          errors.push(`Step ${number}: navigation URL is missing.`);
        }
      }

      //====================================================
      // SEARCH
      //====================================================

      if (tool === "search") {
        if (!String(args.query || "").trim()) {
          errors.push(`Step ${number}: search query is missing.`);
        }
      }

      //====================================================
      // WAIT
      //====================================================

      if (tool === "wait") {
        const time = Number(args.time);

        if (!Number.isFinite(time) || time < 0) {
          errors.push(`Step ${number}: invalid wait time.`);
        }
      }

      //====================================================
      // SELECT
      //====================================================

      if (tool === "select") {
        const field = args.field ?? args.target ?? args.selector;

        const option = args.option ?? args.value;

        if (!String(field || "").trim()) {
          errors.push(`Step ${number}: select field is missing.`);
        }

        if (option === undefined || option === null || !String(option).trim()) {
          errors.push(`Step ${number}: select option is missing.`);
        }
      }

      //====================================================
      // PRESS
      //====================================================

      if (tool === "press") {
        if (!String(args.key || "").trim()) {
          errors.push(`Step ${number}: press key is missing.`);
        }
      }

      //====================================================
      // SCROLL
      //====================================================

      if (tool === "scroll") {
        const direction = String(args.direction || "")
          .trim()
          .toLowerCase();

        if (
          direction &&
          !["up", "down", "left", "right", "top", "bottom"].includes(direction)
        ) {
          errors.push(
            `Step ${number}: invalid scroll direction "${direction}".`,
          );
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

  //========================================================
  // REPAIR PLAN USING LLM
  //========================================================

  async repairPlan(command, pageText, invalidPlan, validationErrors) {
    this.stats.llmRepairCalls++;

    const prompt = `
You are repairing an INVALID browser automation plan.

Return ONLY valid JSON.

==================================================
USER COMMAND
==================================================

${command}

==================================================
CURRENT PAGE
==================================================

${String(pageText || "").slice(0, this.options.maxPageText)}

==================================================
INVALID PLAN
==================================================

${JSON.stringify(invalidPlan, null, 2)}

==================================================
VALIDATION ERRORS
==================================================

${validationErrors.join("\n")}

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
back
forward
refresh
clear

==================================================
STRICT RULES
==================================================

1. Every click MUST contain args.target.

2. Never create:
   "args": {}

3. Never create:
   "args": {
      "target": ""
   }

4. The click target MUST come from the user's command
   or an unambiguous visible target in the current page.

5. Never invent a target.

6. Preserve the user's exact intended visible text.

7. "Click Login" means target "Login".

8. "Click the Login button" means target "Login".

9. "Click SSO Login" means target "SSO Login".

10. "Click By email / ID" means target "By email / ID".

11. Do NOT replace a target with a CSS selector unless
    the user explicitly provided a selector.

12. Every type action requires:
    field
    value

13. Every navigate action requires:
    url

14. Every search action requires:
    query

15. Every press action requires:
    key

16. Return executable steps only.

17. Return no explanation.

18. Return no markdown.

19. Return JSON only.

==================================================
CORRECT EXAMPLE
==================================================

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

  //========================================================
  // LLM PLANNER
  //========================================================

  async llmPlan(command, pageText = "", context = {}) {
    const limitedPageText = String(pageText || "").slice(
      0,
      this.options.maxPageText,
    );

    const safeContext = this.limitContext(context);

    const prompt = `
You are the PRIMARY AI planner for Jarvis Browser.

Your job is to convert the user's natural-language browser
command into a precise executable JSON plan.

You are the planning authority.

The Resolver and ScoringEngine will later determine HOW
to locate the requested DOM element.

You MUST NOT perform fuzzy matching.

==================================================
OUTPUT FORMAT
==================================================

ACTION:

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

CHAT:

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
back
forward
refresh
clear

==================================================
CRITICAL CLICK RULE
==================================================

EVERY click MUST contain:

{
  "tool": "click",
  "args": {
    "target": "VISIBLE TARGET"
  }
}

NEVER:

{
  "tool": "click",
  "args": {}
}

NEVER:

{
  "tool": "click",
  "args": {
    "text": ""
  }
}

==================================================
CLICK TARGET EXTRACTION
==================================================

Extract the actual requested target from the user command.

Examples:

User:
Click Login

Return:

{
  "tool": "click",
  "args": {
    "target": "Login"
  }
}

User:
Click the Login button

Return:

{
  "tool": "click",
  "args": {
    "target": "Login"
  }
}

User:
Click SSO Login

Return:

{
  "tool": "click",
  "args": {
    "target": "SSO Login"
  }
}

User:
Click By email / ID

Return:

{
  "tool": "click",
  "args": {
    "target": "By email / ID"
  }
}

User:
Click Learn more

Return:

{
  "tool": "click",
  "args": {
    "target": "Learn more"
  }
}

==================================================
IMPORTANT TARGET RULE
==================================================

The target may be:

- visible button text
- visible tab text
- visible link text
- visible label
- accessible name
- element name
- explicitly supplied CSS selector

Prefer the visible target text.

DO NOT convert:

"Click Login"

into:

"button[type=submit]"

unless the user explicitly requests a selector.

DO NOT invent selectors.

==================================================
TAB RULE
==================================================

If the user asks to click a tab such as:

"Click By email / ID"

the planner must return:

{
  "tool": "click",
  "args": {
    "target": "By email / ID"
  }
}

The Resolver may later determine that the visible text
belongs to a child span/label inside the actual clickable tab.

The planner does NOT need to select the parent DOM element.

==================================================
TYPE RULE
==================================================

For:

Type admin into username

Return:

{
  "tool": "type",
  "args": {
    "field": "username",
    "value": "admin"
  }
}

For:

Fill tamiltanishh@gmail.com into E-mail or ID

Return:

{
  "tool": "type",
  "args": {
    "field": "E-mail or ID",
    "value": "tamiltanishh@gmail.com"
  }
}

==================================================
NAVIGATION RULE
==================================================

For:

Navigate to https://google.com

Return:

{
  "tool": "navigate",
  "args": {
    "url": "https://google.com"
  }
}

==================================================
SEARCH RULE
==================================================

For:

Search Playwright

Return:

{
  "tool": "search",
  "args": {
    "query": "Playwright"
  }
}

==================================================
WAIT RULE
==================================================

For:

Wait 2 seconds

Return:

{
  "tool": "wait",
  "args": {
    "time": 2000
  }
}

==================================================
MULTI-STEP RULE
==================================================

For:

Open Google and click Images

Return:

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

${JSON.stringify(safeContext, null, 2)}

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
- Actionable command => mode "action".
- Conversation => mode "chat".
- Every click requires args.target.
- Never return empty click target.
- Preserve the user's target.
- Do not fuzzy match.
- Do not invent targets.
- Do not invent selectors.
- Planner decides WHAT.
- Resolver decides HOW.
`;

    const result = await this.callLLM(prompt);

    //======================================================
    // LLM FAILED
    //======================================================

    if (!result) {
      // Try exact deterministic recovery first.
      const recovered = this.recoverSimpleCommand(command);

      if (recovered) {
        this.stats.recoveryHits++;

        return recovered;
      }

      return {
        mode: "chat",

        source: "llm",

        reply: "The AI planner could not create a plan.",
      };
    }

    //======================================================
    // NORMALIZE
    //======================================================

    let normalized = this.normalizeAdvanced(result, command);

    //======================================================
    // VALIDATE
    //======================================================

    let validation = this.validatePlan(normalized, command);

    //======================================================
    // VALID
    //======================================================

    if (validation.valid) {
      return normalized;
    }

    //======================================================
    // DETERMINISTIC RECOVERY
    //======================================================

    const recovered = this.recoverSimpleCommand(command);

    if (recovered) {
      const recoveredValidation = this.validatePlan(recovered, command);

      if (recoveredValidation.valid) {
        this.stats.recoveryHits++;

        this.log("Recovered invalid LLM plan:", recovered);

        return recovered;
      }
    }

    //======================================================
    // LLM SELF REPAIR
    //======================================================

    for (let attempt = 0; attempt < this.options.maxRepairAttempts; attempt++) {
      this.log(
        `LLM repair attempt ${attempt + 1}/${this.options.maxRepairAttempts}`,
      );

      const repaired = await this.repairPlan(
        command,
        pageText,
        normalized,
        validation.errors,
      );

      if (repaired) {
        return repaired;
      }

      // IMPORTANT:
      // Do not restore the original invalid plan.
      //
      // Keep the most recent normalized plan and
      // validation state.
      //
      // A new repair call gets the latest failure.
      validation = this.validatePlan(normalized, command);
    }

    //======================================================
    // FINAL FAILURE
    //======================================================

    return {
      mode: "chat",

      source: "llm-validation-failed",

      reply: "I could not create a valid browser action plan.",
    };
  }

  //========================================================
  // LIMIT CONTEXT
  //========================================================

  limitContext(context) {
    if (!context || typeof context !== "object") {
      return {};
    }

    try {
      const serialized = JSON.stringify(context);

      if (serialized.length <= this.options.maxContextText) {
        return context;
      }

      return {
        context: serialized.slice(0, this.options.maxContextText),
        truncated: true,
      };
    } catch {
      return {};
    }
  }

  //========================================================
  // LLM CALL
  //========================================================

  async callLLM(prompt) {
    let lastError = null;

    const attempts = Math.max(1, Number(this.options.llmRetryAttempts) + 1);

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        this.stats.llmRetries++;

        this.log(`Retrying LLM request (${attempt}/${attempts - 1})`);
      }

      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, this.options.timeout);

      try {
        this.stats.llmRequests++;

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

        if (!raw) {
          throw new Error("LLM returned an empty response.");
        }

        //================================================
        // DIRECT JSON
        //================================================

        let parsed = this.safeParse(raw);

        if (parsed) {
          return parsed;
        }

        //================================================
        // JSON REPAIR
        //================================================

        this.stats.parseFailures++;

        parsed = this.repairJSON(raw);

        if (parsed) {
          return parsed;
        }

        throw new Error("Unable to parse LLM JSON response.");
      } catch (err) {
        clearTimeout(timeout);

        lastError = err;

        const message =
          err?.name === "AbortError"
            ? `LLM request timed out after ${this.options.timeout}ms`
            : err?.message || String(err);

        this.warn(`LLM attempt ${attempt + 1} failed:`, message);

        if (attempt === attempts - 1) {
          this.stats.llmFailures++;

          this.error("LLM planner failed:", message);
        }
      }
    }

    return null;
  }

  //========================================================
  // SIMPLE COMMAND RECOVERY
  //
  // EXACT EXTRACTION ONLY
  //
  // NO FUZZY MATCHING
  //========================================================

  recoverSimpleCommand(command) {
    const text = String(command || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return null;
    }

    let match;

    //======================================================
    // CLICK
    //======================================================

    match = text.match(
      /^(?:click|tap|press|open|choose)\s+(?:the\s+)?(.+?)\s*$/i,
    );

    if (match) {
      let target = match[1].trim();

      target = this.cleanTarget(target);

      if (target) {
        return {
          mode: "action",

          source: "deterministic-recovery",

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

    //======================================================
    // NAVIGATION
    //======================================================

    match = text.match(
      /^(?:go\s+to|navigate\s+to|visit|browse|open)\s+(https?:\/\/\S+)$/i,
    );

    if (match) {
      return {
        mode: "action",

        source: "deterministic-recovery",

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

    //======================================================
    // SEARCH
    //======================================================

    match = text.match(/^(?:search|find|lookup)\s+(?:for\s+)?(.+)$/i);

    if (match) {
      return {
        mode: "action",

        source: "deterministic-recovery",

        steps: [
          {
            tool: "search",

            args: {
              query: match[1].trim(),
            },
          },
        ],
      };
    }

    //======================================================
    // WAIT
    //======================================================

    match = text.match(
      /^wait\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds|s|sec|seconds)?$/i,
    );

    if (match) {
      return {
        mode: "action",

        source: "deterministic-recovery",

        steps: [
          {
            tool: "wait",

            args: {
              time: this.normalizeTime(`${match[1]} ${match[2] || "ms"}`),
            },
          },
        ],
      };
    }

    return null;
  }

  //========================================================
  // FAST REGEX FALLBACK
  //
  // OPTIONAL ONLY
  //
  // NO FUZZY MATCHING
  //========================================================

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

      //====================================================
      // CLICK
      //====================================================

      match = cmd.match(/^(?:click|tap|press|open|choose)\s+(.+)$/i);

      if (match) {
        const target = this.cleanTarget(match[1].trim());

        if (target) {
          steps.push({
            tool: "click",

            args: {
              target,
            },
          });
        }

        continue;
      }

      //====================================================
      // TYPE
      //====================================================

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

      //====================================================
      // SEARCH
      //====================================================

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

      //====================================================
      // WAIT
      //====================================================

      match = cmd.match(
        /^wait\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds|s|sec|seconds)?$/i,
      );

      if (match) {
        steps.push({
          tool: "wait",

          args: {
            time: this.normalizeTime(`${match[1]} ${match[2] || "ms"}`),
          },
        });

        continue;
      }

      //====================================================
      // NAVIGATE
      //====================================================

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

  //========================================================
  // SAFE JSON PARSER
  //========================================================

  safeParse(text) {
    if (!text) {
      return null;
    }

    try {
      let cleaned = String(text)
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      //====================================================
      // DIRECT PARSE
      //====================================================

      try {
        return JSON.parse(cleaned);
      } catch {
        // Continue.
      }

      //====================================================
      // EXTRACT OBJECT
      //====================================================

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

  //========================================================
  // JSON REPAIR
  //========================================================

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

      if (start === -1 || end === -1 || end <= start) {
        return null;
      }

      repaired = repaired.substring(start, end + 1);

      // Remove common trailing commas.
      repaired = repaired.replace(/,\s*}/g, "}");

      repaired = repaired.replace(/,\s*]/g, "]");

      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  //========================================================
  // RESPONSE NORMALIZATION
  //========================================================

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

  //========================================================
  // STATISTICS
  //========================================================

  getStats() {
    return {
      ...this.stats,

      averagePlanningTime: this.stats.requests
        ? Number(
            (this.stats.totalPlanningTime / this.stats.requests).toFixed(2),
          )
        : 0,

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

        maxPageText: this.options.maxPageText,

        maxSteps: this.options.maxSteps,
      },
    };
  }

  //========================================================
  // RESET STATS
  //========================================================

  resetStats() {
    this.stats = this.createEmptyStats();

    return this.stats;
  }

  //========================================================
  // EMPTY
  //========================================================

  empty() {
    return {
      mode: "chat",

      source: "planner",

      reply: "",
    };
  }

  //========================================================
  // SELF TEST
  //========================================================

  async selfTest() {
    const samples = [
      "Click Login",

      "click learn more",

      "Click the SSO Login button",

      "Click By email / ID",

      "Click the Login tab",

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

  //========================================================
  // LOCAL VALIDATION TEST
  //
  // Does NOT call Ollama.
  //
  // Useful for checking normalization/recovery.
  //========================================================

  localSelfTest() {
    const samples = [
      "Click Login",
      "click the Login button",
      "Click SSO Login",
      "Click By email / ID",
      "Navigate to https://google.com",
      "Search Playwright",
      "Wait 2 seconds",
    ];

    return samples.map((command) => {
      const recovered = this.recoverSimpleCommand(command);

      const validation = recovered
        ? this.validatePlan(recovered, command)
        : {
            valid: false,
            errors: ["No deterministic recovery available."],
          };

      return {
        command,
        plan: recovered,
        valid: validation.valid,
        errors: validation.errors,
      };
    });
  }

  //========================================================
  // BENCHMARK
  //========================================================

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

  //========================================================
  // CONFIGURATION
  //========================================================

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

  //========================================================
  // HEALTH
  //========================================================

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

  //========================================================
  // VERSION
  //========================================================

  version() {
    return {
      name: "Ultra Intelligent LLM-First Planner",

      version: "4.0.0",

      planner: "LLM First + Validation + Deterministic Recovery + Self Repair",

      model: this.model,
    };
  }

  //========================================================
  // EXPORT CONFIGURATION
  //========================================================

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
