// executor.js

export default class Executor {
  constructor(resolver) {
    this.resolver = resolver;
  }

  async execute(step) {
    const tool = step.tool;
    const args = step.args || {};

    try {
      switch (tool) {
        case "click":
          return await this.resolver.clickSmart(args.text);

        case "type":
          return await this.resolver.typeSmart(args.field, args.value);

        case "select":
          return await this.resolver.selectSmart(args.field, args.value);

        default:
          return await this.resolver.execute(tool, args);
      }
    } catch (err) {
      console.log("Primary strategy failed");

      return await this.resolver.selfHeal(step);
    }
  }
}
