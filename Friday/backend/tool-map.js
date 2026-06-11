// tool-map.js

export default class ToolMap {
  constructor(resolver) {
    this.resolver = resolver;
  }

  async execute(step) {
    if (!step || !step.tool) {
      throw new Error("Invalid step");
    }

    const tool = step.tool.toLowerCase();
    const args = step.args || {};

    switch (tool) {
      // ---------------------------------
      // CLICK
      // ---------------------------------
      case "click": {
        const target = await this.resolver.resolveTarget(args.text);

        if (!target) {
          throw new Error(`Element "${args.text}" not found in snapshot`);
        }

        return await this.resolver.mcp.click(target);
      }
      // ---------------------------------
      // TYPE
      // ---------------------------------
      case "type":
        return await this.resolver.type(args.field, args.value);

      // ---------------------------------
      // SELECT OPTION
      // ---------------------------------
      case "select":
        return await this.resolver.select(args.field, args.value);

      // ---------------------------------
      // CHECK
      // ---------------------------------
      case "check":
        return await this.resolver.check(args.field);

      // ---------------------------------
      // UNCHECK
      // ---------------------------------
      case "uncheck":
        return await this.resolver.uncheck(args.field);

      // ---------------------------------
      // HOVER
      // ---------------------------------
      case "hover":
        return await this.resolver.hover(args.text);

      // ---------------------------------
      // PRESS KEY
      // ---------------------------------
      case "press":
        return await this.resolver.press(args.key);

      // ---------------------------------
      // UPLOAD FILE
      // ---------------------------------
      case "upload":
        return await this.resolver.upload(args.field, args.path);

      // ---------------------------------
      // WAIT
      // ---------------------------------
      case "wait":
        return await this.resolver.wait(args.time || 1000);

      // ---------------------------------
      // NAVIGATE
      // ---------------------------------
      case "navigate":
        return await this.resolver.navigate(args.url);

      // ---------------------------------
      // READ
      // ---------------------------------
      case "read":
        return await this.resolver.read(args.text || args.title);

      // ---------------------------------
      // SNAPSHOT
      // ---------------------------------
      case "snapshot":
        return await this.resolver.snapshot();

      default:
        throw new Error(`Unsupported tool: ${tool}`);
    }
  }
}
