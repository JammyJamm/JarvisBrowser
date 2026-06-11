// resolver.js

import SnapshotParser from "./snapshot-parser.js";

export default class Resolver {
  constructor(mcp) {
    this.mcp = mcp;
  }

  // ---------------------------------------
  // Get latest parser
  // ---------------------------------------

  async getParser() {
    const snapshot = await this.mcp.snapshot();

    return new SnapshotParser(snapshot);
  }

  // ---------------------------------------
  // Find target by visible text
  // ---------------------------------------

  async resolveTarget(label) {
    const parser = await this.getParser();

    const target = parser.getTarget(label);

    if (!target) {
      throw new Error(`Element "${label}" not found`);
    }

    return target;
  }

  // ---------------------------------------
  // CLICK
  // ---------------------------------------

  async click(label) {
    const target = await this.resolveTarget(label);

    return await this.mcp.click(target);
  }

  // ---------------------------------------
  // TYPE
  // ---------------------------------------

  async type(field, value) {
    const target = await this.resolveTarget(field);

    return await this.mcp.type(target, value);
  }

  // ---------------------------------------
  // SELECT OPTION
  // ---------------------------------------

  async select(field, value) {
    const target = await this.resolveTarget(field);

    return await this.mcp.selectOption(target, [value]);
  }

  // ---------------------------------------
  // HOVER
  // ---------------------------------------

  async hover(label) {
    const target = await this.resolveTarget(label);

    return await this.mcp.hover(target);
  }

  // ---------------------------------------
  // CHECK
  // ---------------------------------------

  async check(label) {
    const target = await this.resolveTarget(label);

    return await this.mcp.callTool("browser_check", {
      target,
    });
  }

  // ---------------------------------------
  // UNCHECK
  // ---------------------------------------

  async uncheck(label) {
    const target = await this.resolveTarget(label);

    return await this.mcp.callTool("browser_uncheck", {
      target,
    });
  }

  // ---------------------------------------
  // FILE UPLOAD
  // ---------------------------------------

  async upload(label, path) {
    const target = await this.resolveTarget(label);

    return await this.mcp.callTool("browser_file_upload", {
      target,
      paths: [path],
    });
  }

  // ---------------------------------------
  // PRESS KEY
  // ---------------------------------------

  async press(key) {
    return await this.mcp.press(key);
  }

  // ---------------------------------------
  // WAIT
  // ---------------------------------------

  async wait(time = 1000) {
    return await this.mcp.wait(time);
  }

  // ---------------------------------------
  // NAVIGATE
  // ---------------------------------------

  async navigate(url) {
    return await this.mcp.navigate(url);
  }

  // ---------------------------------------
  // SNAPSHOT
  // ---------------------------------------

  async snapshot() {
    return await this.mcp.snapshot();
  }

  // ---------------------------------------
  // READ
  // ---------------------------------------

  async read(label) {
    const parser = await this.getParser();

    const element = parser.get(label);

    if (!element) {
      throw new Error(`Unable to read "${label}"`);
    }

    return {
      success: true,
      target: element.target,
      role: element.role,
      text: element.name,
      line: element.line,
    };
  }

  // ---------------------------------------
  // RETRY CLICK
  // ---------------------------------------

  async clickRetry(label, retries = 3) {
    let last;

    for (let i = 0; i < retries; i++) {
      try {
        return await this.click(label);
      } catch (e) {
        last = e;

        await this.wait(500);
      }
    }

    throw last;
  }

  // ---------------------------------------
  // RETRY TYPE
  // ---------------------------------------

  async typeRetry(field, value, retries = 3) {
    let last;

    for (let i = 0; i < retries; i++) {
      try {
        return await this.type(field, value);
      } catch (e) {
        last = e;

        await this.wait(500);
      }
    }

    throw last;
  }

  // ---------------------------------------
  // Generic execute
  // ---------------------------------------

  async execute(tool, args = {}) {
    switch (tool) {
      case "click":
        return this.click(args.text);

      case "type":
        return this.type(args.field, args.value);

      case "select":
        return this.select(args.field, args.value);

      case "hover":
        return this.hover(args.text);

      case "check":
        return this.check(args.field);

      case "uncheck":
        return this.uncheck(args.field);

      case "upload":
        return this.upload(args.field, args.path);

      case "navigate":
        return this.navigate(args.url);

      case "press":
        return this.press(args.key);

      case "wait":
        return this.wait(args.time);

      case "read":
        return this.read(args.text || args.title);

      case "snapshot":
        return this.snapshot();

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }
}
