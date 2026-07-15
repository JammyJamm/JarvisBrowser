//==========================================================
//
// backend/tool-map.js
//
// Ultra Intelligent Tool Map
//
// Architecture
//
// Planner
//      │
// ToolMap
//      │
// Resolver
//      │
// Browser Automation
//
// Features
// --------
// ✔ Dynamic tool registration
// ✔ Tool aliases
// ✔ Safe execution
// ✔ Middleware support
// ✔ Validation
// ✔ Statistics
// ✔ Debug logging
//
//==========================================================

export default class ToolMap {
  constructor(resolver, options = {}) {
    //--------------------------------------------------
    // Dependencies
    //--------------------------------------------------

    this.resolver = resolver;

    //--------------------------------------------------
    // Configuration
    //--------------------------------------------------

    this.options = {
      debug: false,

      enableAliases: true,

      enableMiddleware: true,

      ...options,
    };

    //--------------------------------------------------
    // Tool Registry
    //--------------------------------------------------

    this.tools = new Map();

    //--------------------------------------------------
    // Aliases
    //--------------------------------------------------

    this.aliases = new Map();

    //--------------------------------------------------
    // Middleware
    //--------------------------------------------------

    this.beforeMiddleware = [];

    this.afterMiddleware = [];

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.stats = {
      executions: 0,

      successes: 0,

      failures: 0,

      unknownTools: 0,
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
  // TOOL REGISTRATION
  //==================================================

  register(name, handler) {
    if (!name) {
      throw new Error("Tool name is required.");
    }

    if (typeof handler !== "function") {
      throw new Error(`Invalid handler for tool: ${name}`);
    }

    this.tools.set(String(name).toLowerCase(), handler);

    this.log("Registered tool:", name);

    return this;
  }

  unregister(name) {
    this.tools.delete(String(name).toLowerCase());

    return this;
  }

  hasTool(name) {
    return this.tools.has(String(name).toLowerCase());
  }

  getTool(name) {
    return this.tools.get(String(name).toLowerCase());
  }

  listTools() {
    return Array.from(this.tools.keys());
  }

  //==================================================
  // ALIASES
  //==================================================

  registerAlias(alias, tool) {
    this.aliases.set(
      String(alias).toLowerCase(),

      String(tool).toLowerCase(),
    );

    return this;
  }

  resolveAlias(tool) {
    const normalized = String(tool).toLowerCase();

    return this.aliases.get(normalized) || normalized;
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

  //==================================================
  // DEFAULT TOOL REGISTRATION
  //==================================================

  registerDefaultTools() {
    //--------------------------------------------------
    // PART 2 CONTINUES
    //--------------------------------------------------

    //--------------------------------------------------
    // CLICK
    //--------------------------------------------------

    this.register("click", async (args) =>
      this.resolver.clickSmart(args.text ?? args.label ?? args.selector ?? ""),
    );

    //--------------------------------------------------
    // TYPE
    //--------------------------------------------------

    this.register("type", async (args) =>
      this.resolver.typeSmart(
        args.field ?? args.target ?? args.selector ?? "",

        args.value,
      ),
    );

    //--------------------------------------------------
    // SEARCH
    //--------------------------------------------------

    this.register("search", async (args) =>
      this.resolver.searchSmart(args.query ?? ""),
    );

    //--------------------------------------------------
    // SELECT
    //--------------------------------------------------

    this.register("select", async (args) =>
      this.resolver.select(
        args.field ?? args.target,

        args.value,
      ),
    );

    //--------------------------------------------------
    // CHECK
    //--------------------------------------------------

    this.register("check", async (args) =>
      this.resolver.check(args.field ?? args.target),
    );

    //--------------------------------------------------
    // UNCHECK
    //--------------------------------------------------

    this.register("uncheck", async (args) =>
      this.resolver.uncheck(args.field ?? args.target),
    );

    //--------------------------------------------------
    // HOVER
    //--------------------------------------------------

    this.register("hover", async (args) =>
      this.resolver.hover(args.text ?? args.label ?? args.selector),
    );

    //--------------------------------------------------
    // PRESS
    //--------------------------------------------------

    this.register("press", async (args) => this.resolver.press(args.key));

    //--------------------------------------------------
    // UPLOAD
    //--------------------------------------------------

    this.register("upload", async (args) =>
      this.resolver.upload(
        args.field ?? args.target,

        args.path,
      ),
    );

    //--------------------------------------------------
    // WAIT
    //--------------------------------------------------

    this.register("wait", async (args) =>
      this.resolver.wait(args.time ?? args.ms ?? 1000),
    );

    //--------------------------------------------------
    // NAVIGATE
    //--------------------------------------------------

    this.register("navigate", async (args) => this.resolver.navigate(args.url));

    //--------------------------------------------------
    // READ
    //--------------------------------------------------

    this.register("read", async (args) =>
      this.resolver.read(args.text ?? args.title ?? args.field),
    );

    //--------------------------------------------------
    // SNAPSHOT
    //--------------------------------------------------

    this.register("snapshot", async () => this.resolver.snapshot());

    //--------------------------------------------------
    // HTML
    //--------------------------------------------------

    this.register("html", async () => this.resolver.html());

    //--------------------------------------------------
    // SCROLL
    //--------------------------------------------------

    this.register("scroll", async (args) =>
      this.resolver.scroll(
        args.direction ?? "down",

        args.amount ?? 1000,
      ),
    );

    //--------------------------------------------------
    // TOOL ALIASES
    //--------------------------------------------------

    this.registerAlias("tap", "click");
    this.registerAlias("open", "click");
    this.registerAlias("choose", "click");
    this.registerAlias("fill", "type");
    this.registerAlias("input", "type");
    this.registerAlias("enter", "type");
    this.registerAlias("goto", "navigate");
    this.registerAlias("visit", "navigate");
    this.registerAlias("go", "navigate");
    this.registerAlias("sleep", "wait");
    this.registerAlias("pause", "wait");
    this.registerAlias("tick", "check");
    this.registerAlias("untick", "uncheck");
  }

  //==================================================
  // PART 3
  // Execute
  // Safe execution
  // Statistics
  // Middleware
  // Debug helpers
  //==================================================
  //==================================================
  // EXECUTE
  //==================================================

  //==================================================
  // EXECUTE
  //==================================================

  async execute(step) {
    if (!step || typeof step !== "object") {
      throw new Error("Invalid step.");
    }

    this.stats.executions++;

    //--------------------------------------------------
    // Normalize
    //--------------------------------------------------

    const tool = this.options.enableAliases
      ? this.resolveAlias(step.tool)
      : String(step.tool || "").toLowerCase();

    const args = step.args || {};

    //--------------------------------------------------
    // Lookup
    //--------------------------------------------------

    const handler = this.getTool(tool);

    if (!handler) {
      this.stats.unknownTools++;

      throw new Error(`Unsupported tool: ${tool}`);
    }

    //--------------------------------------------------
    // Before Middleware
    //--------------------------------------------------

    if (this.options.enableMiddleware) {
      for (const middleware of this.beforeMiddleware) {
        await middleware({
          tool,

          args,

          step,

          resolver: this.resolver,
        });
      }
    }

    try {
      //--------------------------------------------------
      // Execute
      //--------------------------------------------------

      const result = await handler(args, step);

      this.stats.successes++;

      //--------------------------------------------------
      // After Middleware
      //--------------------------------------------------

      if (this.options.enableMiddleware) {
        for (const middleware of this.afterMiddleware) {
          await middleware({
            tool,

            args,

            step,

            result,

            resolver: this.resolver,
          });
        }
      }

      return {
        success: true,

        tool,

        result,
      };
    } catch (err) {
      this.stats.failures++;

      this.error(
        `Execution failed (${tool})`,

        err,
      );

      throw err;
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

        tool: step?.tool,

        error: err.message,
      };
    }
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
    };
  }

  getStatistics() {
    return {
      ...this.stats,

      registeredTools: this.tools.size,

      aliases: this.aliases.size,

      beforeMiddleware: this.beforeMiddleware.length,

      afterMiddleware: this.afterMiddleware.length,
    };
  }

  //==================================================
  // DEBUG HELPERS
  //==================================================

  printRegisteredTools() {
    console.table(
      this.listTools().map((tool) => ({
        tool,

        alias: [...this.aliases.entries()]
          .filter(([, target]) => target === tool)
          .map(([alias]) => alias)
          .join(", "),
      })),
    );
  }

  printStatistics() {
    console.table(this.getStatistics());
  }

  //==================================================
  // EXPORT HELPERS
  //==================================================

  exportConfiguration() {
    return {
      options: {
        ...this.options,
      },

      tools: this.listTools(),

      aliases: Object.fromEntries(this.aliases),

      statistics: this.getStatistics(),
    };
  }

  importAliases(aliases = {}) {
    for (const [alias, tool] of Object.entries(aliases)) {
      this.registerAlias(alias, tool);
    }

    return this;
  }

  clearAliases() {
    this.aliases.clear();

    return this;
  }

  clearMiddleware() {
    this.beforeMiddleware.length = 0;

    this.afterMiddleware.length = 0;

    return this;
  }
}
