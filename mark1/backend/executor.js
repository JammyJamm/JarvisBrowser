export default class Executor {
  constructor(resolver) {
    this.resolver = resolver;
  }

  async execute(step) {
    const tool = step.tool;
    const args = step.args || {};

    switch (tool) {
      case "click":
        return await this.resolver.clickSmart(args.text || args.selector || "");

      case "type":
        return await this.resolver.type(args.field, args.value);

      case "select":
        return await this.resolver.select(args.field, args.value);

      case "navigate":
        return await this.resolver.navigate(args.url);

      case "wait":
        return await this.resolver.wait(args.time);

      default:
        return await this.resolver.execute(tool, args);
    }
  }
}
