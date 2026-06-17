// tool-map.js

export default class ToolMap {
  constructor(resolver) {
    this.resolver = resolver;
  }

  async execute(step) {
    if (!step || !step.tool) {
      throw new Error("Invalid step");
    }

    const tool = String(step.tool).toLowerCase();
    const args = step.args || {};

    switch (tool) {
      // ---------------------------------
      // CLICK
      // ---------------------------------
      case "click":
        return await this.resolver.click(args.text);

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
        return await this.resolver.read(args.text || args.title || args.field);

      // ---------------------------------
      // SNAPSHOT
      // ---------------------------------
      case "snapshot":
        return await this.resolver.snapshot();

      // ---------------------------------
      // HTML
      // ---------------------------------
      case "html":
        return await this.resolver.html();

      // ---------------------------------
      // SCROLL
      // ---------------------------------
      case "scroll":
        return await this.resolver.scroll(
          args.direction || "down",
          args.amount || 1000,
        );

      default:
        throw new Error(`Unsupported tool: ${tool}`);
    }
  }
}
