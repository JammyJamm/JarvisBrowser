// browser-controller.js

import { chromium } from "playwright";

class BrowserController {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async connect() {
    if (this.browser) {
      return this.page;
    }

    this.browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

    const contexts = this.browser.contexts();

    this.context = contexts[0];

    const pages = this.context.pages();

    this.page = pages[0];

    console.log("✅ Attached to Electron");

    return this.page;
  }

  async getPage() {
    if (!this.page) {
      await this.connect();
    }

    return this.page;
  }

  async html() {
    const page = await this.getPage();

    return page.content();
  }

  async url() {
    const page = await this.getPage();

    return page.url();
  }
}

export default new BrowserController();
