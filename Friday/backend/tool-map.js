//==========================================================
//
// backend/tool-map.js
//
// Ultra Intelligent Tool Map
//
// Architecture
//
// User Command
//      │
//      ▼
// Planner
//      │
//      ▼
// ToolMap
//      │
//      ├── Resolver
//      │      │
//      │      ├── Intent Parser
//      │      ├── Scoring Engine
//      │      └── Self Healing
//      │
//      └── MCP / Browser
//             │
//             ▼
//          Playwright
//
// Features
// --------
// ✔ Dynamic tool registration
// ✔ Tool aliases
// ✔ Tool metadata
// ✔ Argument normalization
// ✔ Argument validation
// ✔ Resolver integration
// ✔ MCP fallback
// ✔ Middleware support
// ✔ Safe execution
// ✔ Retry support
// ✔ Execution timing
// ✔ Statistics
// ✔ Debug logging
// ✔ Consistent result format
// ✔ Backward compatible execute(step)
// ✔ Runtime tool discovery
//
//==========================================================

export default class ToolMap {
  constructor(resolver, options = {}) {
    //--------------------------------------------------
    // Dependencies
    //--------------------------------------------------

    if (!resolver) {
      throw new Error("ToolMap requires a Resolver instance.");
    }

    this.resolver = resolver;

    //--------------------------------------------------
    // MCP / Browser reference
    //
    // Resolver normally contains:
    //
    // resolver.mcp
    //
    //--------------------------------------------------

    this.mcp = resolver.mcp || options.mcp || null;

    //--------------------------------------------------
    // Configuration
    //--------------------------------------------------

    this.options = {
      debug: false,

      enableAliases: true,

      enableMiddleware: true,

      enableValidation: true,

      enableTiming: true,

      enableRetries: true,

      maxRetries: 1,

      normalizeArguments: true,

      throwOnError: true,

      ...options,
    };

    //--------------------------------------------------
    // Tool Registry
    //--------------------------------------------------

    this.tools = new Map();

    //--------------------------------------------------
    // Tool Metadata
    //--------------------------------------------------

    this.metadata = new Map();

    //--------------------------------------------------
    // Aliases
    //--------------------------------------------------

    this.aliases = new Map();

    //--------------------------------------------------
    // Middleware
    //--------------------------------------------------

    this.beforeMiddleware = [];

    this.afterMiddleware = [];

    this.errorMiddleware = [];

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.stats = {
      executions: 0,

      successes: 0,

      failures: 0,

      unknownTools: 0,

      validationFailures: 0,

      retries: 0,

      aliasesResolved: 0,

      fallbackExecutions: 0,

      resolverExecutions: 0,

      mcpExecutions: 0,

      totalExecutionTime: 0,

      averageExecutionTime: 0,

      lastExecutionTime: 0,
    };

    //--------------------------------------------------
    // Register Built-In Tools
    //--------------------------------------------------

    this.registerDefaultTools();
  }

  //==================================================
  // LOGGING
  //==================================================

  log(...args) {
    if (this.options.debug) {
      console.log("[ToolMap]", ...args);
    }
  }

  warn(...args) {
    console.warn("[ToolMap]", ...args);
  }

  error(...args) {
    console.error("[ToolMap]", ...args);
  }

  //==================================================
  // NORMALIZATION
  //==================================================

  normalizeToolName(name) {
    if (name === undefined || name === null) {
      return "";
    }

    return String(name)
      .trim()

      .toLowerCase()

      .replace(/[\s_-]+/g, "");
  }

  normalizeArguments(args = {}) {
    if (!args || typeof args !== "object") {
      return {};
    }

    return {
      ...args,
    };
  }

  //==================================================
  // TOOL REGISTRATION
  //==================================================

  register(name, handler, metadata = {}) {
    if (!name) {
      throw new Error("Tool name is required.");
    }

    if (typeof handler !== "function") {
      throw new Error(`Invalid handler for tool: ${name}`);
    }

    const normalized = this.normalizeToolName(name);

    this.tools.set(normalized, handler);

    this.metadata.set(normalized, {
      name: normalized,

      description: metadata.description || "",

      category: metadata.category || "general",

      requiresResolver: metadata.requiresResolver ?? false,

      requiresMCP: metadata.requiresMCP ?? false,

      args: metadata.args || {},

      ...metadata,
    });

    this.log("Registered tool:", normalized);

    return this;
  }

  unregister(name) {
    const normalized = this.normalizeToolName(name);

    this.tools.delete(normalized);

    this.metadata.delete(normalized);

    return this;
  }

  hasTool(name) {
    const normalized = this.resolveAlias(name);

    return this.tools.has(normalized);
  }

  getTool(name) {
    const normalized = this.resolveAlias(name);

    return this.tools.get(normalized);
  }

  getToolMetadata(name) {
    const normalized = this.resolveAlias(name);

    return this.metadata.get(normalized);
  }

  listTools() {
    return Array.from(this.tools.keys());
  }

  listToolDetails() {
    return this.listTools().map((tool) => ({
      name: tool,

      metadata: this.metadata.get(tool) || {},
    }));
  }

  //==================================================
  // ALIASES
  //==================================================

  registerAlias(alias, tool) {
    if (!alias || !tool) {
      throw new Error("Alias and target tool are required.");
    }

    const normalizedAlias = this.normalizeToolName(alias);

    const normalizedTool = this.normalizeToolName(tool);

    this.aliases.set(
      normalizedAlias,

      normalizedTool,
    );

    return this;
  }

  resolveAlias(tool) {
    let normalized = this.normalizeToolName(tool);

    if (!normalized) {
      return "";
    }

    const visited = new Set();

    while (this.aliases.has(normalized)) {
      if (visited.has(normalized)) {
        this.warn("Circular alias detected:", normalized);

        break;
      }

      visited.add(normalized);

      normalized = this.aliases.get(normalized);

      this.stats.aliasesResolved++;
    }

    return normalized;
  }

  //==================================================
  // MIDDLEWARE
  //==================================================

  useBefore(fn) {
    if (typeof fn === "function") {
      this.beforeMiddleware.push(fn);
    }

    return this;
  }

  useAfter(fn) {
    if (typeof fn === "function") {
      this.afterMiddleware.push(fn);
    }

    return this;
  }

  useError(fn) {
    if (typeof fn === "function") {
      this.errorMiddleware.push(fn);
    }

    return this;
  }

  //==================================================
  // CAPABILITY CHECK
  //==================================================

  hasResolverMethod(method) {
    return this.resolver && typeof this.resolver[method] === "function";
  }

  hasMCPMethod(method) {
    return this.mcp && typeof this.mcp[method] === "function";
  }

  //==================================================
  // REQUIRE RESOLVER
  //==================================================

  requireResolverMethod(method) {
    if (!this.hasResolverMethod(method)) {
      throw new Error(`Resolver method '${method}' is not available.`);
    }

    return this.resolver[method].bind(this.resolver);
  }

  //==================================================
  // REQUIRE MCP
  //==================================================

  requireMCPMethod(method) {
    if (!this.hasMCPMethod(method)) {
      throw new Error(`MCP method '${method}' is not available.`);
    }

    return this.mcp[method].bind(this.mcp);
  }

  //==================================================
  // ARGUMENT HELPERS
  //==================================================

  getTarget(args = {}) {
    return (
      args.text ??
      args.label ??
      args.target ??
      args.field ??
      args.selector ??
      args.name ??
      ""
    );
  }

  getValue(args = {}) {
    return args.value ?? args.text ?? "";
  }

  //==================================================
  // DEFAULT TOOL REGISTRATION
  //==================================================

  registerDefaultTools() {
    //--------------------------------------------------
    // CLICK
    //--------------------------------------------------

    this.register(
      "click",

      async (args) => {
        const target = this.getTarget(args);

        if (!target) {
          throw new Error("Click target is required.");
        }

        const clickSmart = this.requireResolverMethod("clickSmart");

        this.stats.resolverExecutions++;

        return await clickSmart(target);
      },

      {
        category: "interaction",

        requiresResolver: true,

        description: "Intelligently click an element.",
      },
    );

    //--------------------------------------------------
    // TYPE
    //--------------------------------------------------

    this.register(
      "type",

      async (args) => {
        const target =
          args.field ?? args.target ?? args.selector ?? args.label ?? "";

        const value = args.value ?? args.text ?? "";

        if (!target) {
          throw new Error("Type target is required.");
        }

        const typeSmart = this.requireResolverMethod("typeSmart");

        this.stats.resolverExecutions++;

        return await typeSmart(
          target,

          value,
        );
      },

      {
        category: "interaction",

        requiresResolver: true,

        description: "Intelligently type into an input.",
      },
    );

    //--------------------------------------------------
    // NAVIGATE
    //--------------------------------------------------

    this.register(
      "navigate",

      async (args) => {
        const url = args.url ?? args.value ?? "";

        if (!url) {
          throw new Error("Navigation URL is required.");
        }

        if (this.hasResolverMethod("navigate")) {
          this.stats.resolverExecutions++;

          return await this.resolver.navigate(url);
        }

        if (this.hasMCPMethod("goto")) {
          this.stats.mcpExecutions++;

          return await this.mcp.goto(url);
        }

        throw new Error("No navigation method available.");
      },

      {
        category: "navigation",

        description: "Navigate to a URL.",
      },
    );

    //--------------------------------------------------
    // SEARCH
    //--------------------------------------------------

    this.register(
      "search",

      async (args) => {
        const query = args.query ?? args.text ?? args.value ?? "";

        if (!query) {
          throw new Error("Search query is required.");
        }

        if (this.hasResolverMethod("searchSmart")) {
          this.stats.resolverExecutions++;

          return await this.resolver.searchSmart(query);
        }

        if (this.hasResolverMethod("typeSmart")) {
          this.stats.fallbackExecutions++;

          return await this.resolver.typeSmart(
            "search",

            query,
          );
        }

        throw new Error("Search functionality is not available.");
      },

      {
        category: "interaction",

        description: "Search using the page search field.",
      },
    );

    //--------------------------------------------------
    // SELECT
    //--------------------------------------------------

    this.register(
      "select",

      async (args) => {
        const target = this.getTarget(args);

        const value = args.value;

        if (!target) {
          throw new Error("Select target is required.");
        }

        if (this.hasResolverMethod("select")) {
          this.stats.resolverExecutions++;

          return await this.resolver.select(
            target,

            value,
          );
        }

        if (this.hasMCPMethod("selectOption")) {
          this.stats.mcpExecutions++;

          return await this.mcp.selectOption(
            target,

            value,
          );
        }

        throw new Error("Select functionality is not available.");
      },

      {
        category: "interaction",

        description: "Select an option.",
      },
    );

    //--------------------------------------------------
    // CHECK
    //--------------------------------------------------

    this.register(
      "check",

      async (args) => {
        const target = this.getTarget(args);

        if (!target) {
          throw new Error("Checkbox target is required.");
        }

        if (this.hasResolverMethod("check")) {
          this.stats.resolverExecutions++;

          return await this.resolver.check(target);
        }

        throw new Error("Checkbox functionality is not available.");
      },

      {
        category: "interaction",

        description: "Check a checkbox.",
      },
    );

    //--------------------------------------------------
    // UNCHECK
    //--------------------------------------------------

    this.register(
      "uncheck",

      async (args) => {
        const target = this.getTarget(args);

        if (!target) {
          throw new Error("Checkbox target is required.");
        }

        if (this.hasResolverMethod("uncheck")) {
          this.stats.resolverExecutions++;

          return await this.resolver.uncheck(target);
        }

        throw new Error("Checkbox functionality is not available.");
      },

      {
        category: "interaction",

        description: "Uncheck a checkbox.",
      },
    );

    //--------------------------------------------------
    // HOVER
    //--------------------------------------------------

    this.register(
      "hover",

      async (args) => {
        const target = this.getTarget(args);

        if (!target) {
          throw new Error("Hover target is required.");
        }

        if (this.hasResolverMethod("hover")) {
          this.stats.resolverExecutions++;

          return await this.resolver.hover(target);
        }

        if (this.hasMCPMethod("hoverByText")) {
          this.stats.mcpExecutions++;

          return await this.mcp.hoverByText(target);
        }

        throw new Error("Hover functionality is not available.");
      },

      {
        category: "interaction",

        description: "Hover over an element.",
      },
    );

    //--------------------------------------------------
    // PRESS
    //--------------------------------------------------

    this.register(
      "press",

      async (args) => {
        const key = args.key ?? args.value ?? args.text ?? "";

        if (!key) {
          throw new Error("Keyboard key is required.");
        }

        if (this.hasResolverMethod("press")) {
          this.stats.resolverExecutions++;

          return await this.resolver.press(key);
        }

        if (this.hasMCPMethod("press")) {
          this.stats.mcpExecutions++;

          return await this.mcp.press(key);
        }

        throw new Error("Keyboard press functionality is not available.");
      },

      {
        category: "keyboard",

        description: "Press a keyboard key.",
      },
    );

    //--------------------------------------------------
    // WAIT
    //--------------------------------------------------

    this.register(
      "wait",

      async (args) => {
        const milliseconds = Number(
          args.time ?? args.ms ?? args.milliseconds ?? 1000,
        );

        if (!Number.isFinite(milliseconds)) {
          throw new Error("Invalid wait duration.");
        }

        if (this.hasResolverMethod("wait")) {
          this.stats.resolverExecutions++;

          return await this.resolver.wait(milliseconds);
        }

        if (this.hasMCPMethod("wait")) {
          this.stats.mcpExecutions++;

          return await this.mcp.wait(milliseconds);
        }

        await new Promise((resolve) => setTimeout(resolve, milliseconds));

        this.stats.fallbackExecutions++;

        return {
          success: true,

          action: "wait",

          milliseconds,
        };
      },

      {
        category: "utility",

        description: "Wait for a specified duration.",
      },
    );

    //--------------------------------------------------
    // SNAPSHOT
    //--------------------------------------------------

    this.register(
      "snapshot",

      async () => {
        if (this.hasResolverMethod("snapshot")) {
          this.stats.resolverExecutions++;

          return await this.resolver.snapshot();
        }

        if (this.hasMCPMethod("snapshot")) {
          this.stats.mcpExecutions++;

          return await this.mcp.snapshot();
        }

        throw new Error("Snapshot functionality is not available.");
      },

      {
        category: "inspection",

        description: "Capture the current page snapshot.",
      },
    );

    //--------------------------------------------------
    // HTML
    //--------------------------------------------------

    this.register(
      "html",

      async () => {
        if (this.hasResolverMethod("html")) {
          this.stats.resolverExecutions++;

          return await this.resolver.html();
        }

        if (this.hasMCPMethod("html")) {
          this.stats.mcpExecutions++;

          return await this.mcp.html();
        }

        throw new Error("HTML retrieval is not available.");
      },

      {
        category: "inspection",

        description: "Get current page HTML.",
      },
    );

    //--------------------------------------------------
    // READ
    //--------------------------------------------------

    this.register(
      "read",

      async (args) => {
        if (this.hasResolverMethod("read")) {
          this.stats.resolverExecutions++;

          return await this.resolver.read(this.getTarget(args));
        }

        if (this.hasMCPMethod("text")) {
          this.stats.mcpExecutions++;

          return await this.mcp.text();
        }

        if (this.hasMCPMethod("snapshot")) {
          this.stats.mcpExecutions++;

          const snapshot = await this.mcp.snapshot();

          return snapshot.text;
        }

        throw new Error("Read functionality is not available.");
      },

      {
        category: "inspection",

        description: "Read visible page content.",
      },
    );

    //--------------------------------------------------
    // SCROLL
    //--------------------------------------------------

    this.register(
      "scroll",

      async (args) => {
        const direction = args.direction ?? "down";

        const amount = Number(args.amount ?? args.distance ?? 1000);

        if (this.hasResolverMethod("scroll")) {
          this.stats.resolverExecutions++;

          return await this.resolver.scroll(
            direction,

            amount,
          );
        }

        if (this.mcp && this.hasMCPMethod("getPage")) {
          const page = await this.mcp.getPage();

          const delta =
            direction.toLowerCase() === "up"
              ? -Math.abs(amount)
              : Math.abs(amount);

          await page.mouse.wheel(0, delta);

          this.stats.mcpExecutions++;

          return {
            success: true,

            action: "scroll",

            direction,

            amount,
          };
        }

        throw new Error("Scroll functionality is not available.");
      },

      {
        category: "navigation",

        description: "Scroll the current page.",
      },
    );

    //--------------------------------------------------
    // RELOAD
    //--------------------------------------------------

    this.register(
      "reload",

      async () => {
        if (this.hasResolverMethod("reload")) {
          this.stats.resolverExecutions++;

          return await this.resolver.reload();
        }

        if (this.hasMCPMethod("reload")) {
          this.stats.mcpExecutions++;

          return await this.mcp.reload();
        }

        throw new Error("Reload functionality is not available.");
      },

      {
        category: "navigation",

        description: "Reload the current page.",
      },
    );

    //--------------------------------------------------
    // BACK
    //--------------------------------------------------

    this.register(
      "back",

      async () => {
        if (this.hasResolverMethod("back")) {
          this.stats.resolverExecutions++;

          return await this.resolver.back();
        }

        if (this.hasMCPMethod("back")) {
          this.stats.mcpExecutions++;

          return await this.mcp.back();
        }

        throw new Error("Back navigation is not available.");
      },

      {
        category: "navigation",

        description: "Navigate back.",
      },
    );

    //--------------------------------------------------
    // FORWARD
    //--------------------------------------------------

    this.register(
      "forward",

      async () => {
        if (this.hasResolverMethod("forward")) {
          this.stats.resolverExecutions++;

          return await this.resolver.forward();
        }

        if (this.hasMCPMethod("forward")) {
          this.stats.mcpExecutions++;

          return await this.mcp.forward();
        }

        throw new Error("Forward navigation is not available.");
      },

      {
        category: "navigation",

        description: "Navigate forward.",
      },
    );

    //--------------------------------------------------
    // TOOL ALIASES
    //--------------------------------------------------

    this.registerAlias("tap", "click");

    this.registerAlias("pressbutton", "click");

    this.registerAlias("fill", "type");

    this.registerAlias("input", "type");

    this.registerAlias("enter", "type");

    this.registerAlias("write", "type");

    this.registerAlias("goto", "navigate");

    this.registerAlias("visit", "navigate");

    this.registerAlias("openurl", "navigate");

    this.registerAlias("sleep", "wait");

    this.registerAlias("pause", "wait");

    this.registerAlias("tick", "check");

    this.registerAlias("untick", "uncheck");

    this.registerAlias("refresh", "reload");

    this.registerAlias("previous", "back");

    this.registerAlias("next", "forward");
  }

  //==================================================
  // VALIDATION
  //==================================================

  validateStep(step, tool, args) {
    if (!this.options.enableValidation) {
      return true;
    }

    if (!tool) {
      this.stats.validationFailures++;

      throw new Error("Tool name is required.");
    }

    if (!this.tools.has(tool)) {
      this.stats.validationFailures++;

      throw new Error(`Unsupported tool: ${tool}`);
    }

    if (args === null || typeof args !== "object") {
      this.stats.validationFailures++;

      throw new Error("Tool arguments must be an object.");
    }

    return true;
  }

  //==================================================
  // EXECUTE
  //==================================================

  async execute(step) {
    const started = performance.now();

    if (!step || typeof step !== "object") {
      throw new Error("Invalid step.");
    }

    this.stats.executions++;

    //--------------------------------------------------
    // Normalize
    //--------------------------------------------------

    const originalTool = step.tool ?? step.action ?? "";

    const tool = this.options.enableAliases
      ? this.resolveAlias(originalTool)
      : this.normalizeToolName(originalTool);

    const args = this.options.normalizeArguments
      ? this.normalizeArguments(step.args || step.arguments || {})
      : step.args || {};

    //--------------------------------------------------
    // Validate
    //--------------------------------------------------

    this.validateStep(step, tool, args);

    //--------------------------------------------------
    // Handler
    //--------------------------------------------------

    const handler = this.tools.get(tool);

    if (!handler) {
      this.stats.unknownTools++;

      throw new Error(`Unsupported tool: ${tool}`);
    }

    //--------------------------------------------------
    // Execution Context
    //--------------------------------------------------

    const context = {
      tool,

      originalTool,

      args,

      step,

      resolver: this.resolver,

      mcp: this.mcp,

      toolMap: this,

      started,
    };

    //--------------------------------------------------
    // Before Middleware
    //--------------------------------------------------

    if (this.options.enableMiddleware) {
      for (const middleware of this.beforeMiddleware) {
        await middleware(context);
      }
    }

    //--------------------------------------------------
    // Execute with Retry
    //--------------------------------------------------

    let result = null;

    let lastError = null;

    const maxRetries = this.options.enableRetries ? this.options.maxRetries : 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.stats.retries++;

          this.log(`Retrying '${tool}' ` + `(attempt ${attempt + 1})`);

          await this.prepareRetry(context, lastError);
        }

        result = await handler(args, step, context);

        lastError = null;

        break;
      } catch (err) {
        lastError = err;

        this.log(`Tool '${tool}' failed:`, err.message);

        if (attempt >= maxRetries) {
          break;
        }
      }
    }

    //--------------------------------------------------
    // Failure
    //--------------------------------------------------

    if (lastError) {
      this.stats.failures++;

      await this.runErrorMiddleware(
        lastError,

        context,
      );

      const elapsed = this.recordTiming(started);

      if (this.options.throwOnError) {
        throw lastError;
      }

      return {
        success: false,

        tool,

        error: lastError.message,

        executionTime: elapsed,
      };
    }

    //--------------------------------------------------
    // Success
    //--------------------------------------------------

    this.stats.successes++;

    //--------------------------------------------------
    // After Middleware
    //--------------------------------------------------

    if (this.options.enableMiddleware) {
      for (const middleware of this.afterMiddleware) {
        await middleware({
          ...context,

          result,
        });
      }
    }

    //--------------------------------------------------
    // Timing
    //--------------------------------------------------

    const elapsed = this.recordTiming(started);

    //--------------------------------------------------
    // Normalize Result
    //--------------------------------------------------

    return {
      success: true,

      tool,

      result,

      executionTime: Number(elapsed.toFixed(2)),
    };
  }

  //==================================================
  // PREPARE RETRY
  //==================================================

  async prepareRetry(context, error) {
    //--------------------------------------------------
    // Refresh Resolver DOM
    //--------------------------------------------------

    if (this.resolver && typeof this.resolver.refreshDOM === "function") {
      try {
        await this.resolver.refreshDOM();
      } catch {}
    }

    //--------------------------------------------------
    // Ensure MCP Connection
    //--------------------------------------------------

    if (this.mcp && typeof this.mcp.ensureConnected === "function") {
      try {
        await this.mcp.ensureConnected();
      } catch {}
    }

    //--------------------------------------------------
    // Middleware
    //--------------------------------------------------

    this.log(
      "Retry prepared for:",

      context.tool,

      error?.message,
    );
  }

  //==================================================
  // ERROR MIDDLEWARE
  //==================================================

  async runErrorMiddleware(error, context) {
    if (!this.options.enableMiddleware) {
      return;
    }

    for (const middleware of this.errorMiddleware) {
      try {
        await middleware({
          ...context,

          error,
        });
      } catch (middlewareError) {
        this.warn(
          "Error middleware failed:",

          middlewareError.message,
        );
      }
    }
  }

  //==================================================
  // SAFE EXECUTION
  //==================================================

  async executeSafe(step) {
    try {
      return await this.execute(step);
    } catch (err) {
      return {
        success: false,

        tool: step?.tool ?? step?.action ?? null,

        error: err.message,
      };
    }
  }

  //==================================================
  // TIMING
  //==================================================

  recordTiming(started) {
    if (!this.options.enableTiming) {
      return 0;
    }

    const elapsed = performance.now() - started;

    this.stats.lastExecutionTime = elapsed;

    this.stats.totalExecutionTime += elapsed;

    const count = this.stats.executions;

    this.stats.averageExecutionTime =
      count > 0 ? this.stats.totalExecutionTime / count : 0;

    return elapsed;
  }

  //==================================================
  // STATISTICS
  //==================================================

  resetStatistics() {
    this.stats = {
      executions: 0,

      successes: 0,

      failures: 0,

      unknownTools: 0,

      validationFailures: 0,

      retries: 0,

      aliasesResolved: 0,

      fallbackExecutions: 0,

      resolverExecutions: 0,

      mcpExecutions: 0,

      totalExecutionTime: 0,

      averageExecutionTime: 0,

      lastExecutionTime: 0,
    };

    return this;
  }

  getStatistics() {
    return {
      ...this.stats,

      registeredTools: this.tools.size,

      aliases: this.aliases.size,

      beforeMiddleware: this.beforeMiddleware.length,

      afterMiddleware: this.afterMiddleware.length,

      errorMiddleware: this.errorMiddleware.length,
    };
  }

  //==================================================
  // DEBUG HELPERS
  //==================================================

  printRegisteredTools() {
    console.table(
      this.listToolDetails().map((item) => ({
        tool: item.name,

        category: item.metadata.category,

        resolver: item.metadata.requiresResolver,

        mcp: item.metadata.requiresMCP,

        aliases: [...this.aliases.entries()]

          .filter(([, target]) => target === item.name)

          .map(([alias]) => alias)

          .join(", "),
      })),
    );
  }

  printStatistics() {
    console.table(this.getStatistics());
  }

  //==================================================
  // EXPORT CONFIGURATION
  //==================================================

  exportConfiguration() {
    return {
      options: {
        ...this.options,
      },

      tools: this.listToolDetails(),

      aliases: Object.fromEntries(this.aliases),

      statistics: this.getStatistics(),
    };
  }

  //==================================================
  // IMPORT ALIASES
  //==================================================

  importAliases(aliases = {}) {
    for (const [alias, tool] of Object.entries(aliases)) {
      this.registerAlias(alias, tool);
    }

    return this;
  }

  //==================================================
  // CLEAR ALIASES
  //==================================================

  clearAliases() {
    this.aliases.clear();

    return this;
  }

  //==================================================
  // CLEAR MIDDLEWARE
  //==================================================

  clearMiddleware() {
    this.beforeMiddleware.length = 0;

    this.afterMiddleware.length = 0;

    this.errorMiddleware.length = 0;

    return this;
  }

  //==================================================
  // DYNAMIC TOOL MAP
  //==================================================

  registerMany(tools = {}) {
    for (const [name, handler] of Object.entries(tools)) {
      this.register(name, handler);
    }

    return this;
  }

  //==================================================
  // TOOL INFORMATION
  //==================================================

  describeTool(name) {
    const normalized = this.resolveAlias(name);

    const handler = this.tools.get(normalized);

    if (!handler) {
      return null;
    }

    return {
      name: normalized,

      metadata: this.metadata.get(normalized) || {},

      aliases: Array.from(this.aliases.entries())

        .filter(([, target]) => target === normalized)

        .map(([alias]) => alias),
    };
  }

  //==================================================
  // TOOL CATEGORIES
  //==================================================

  getToolsByCategory(category) {
    return this.listToolDetails()

      .filter((item) => item.metadata.category === category)

      .map((item) => item.name);
  }
}
