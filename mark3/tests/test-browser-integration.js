//==========================================================
//
// tests/test-browser-integration.js
//
// Real Playwright Integration Test for Page-Only Interactions
//
// Validates:
// 1. DOM & Accessibility element discovery (getInteractiveElements)
// 2. Verified Click (clickSmart)
// 3. Verified Type & Input (typeText)
// 4. Verified Select Dropdown (selectOption)
// 5. Page Text Extraction (readContent)
// 6. Scroll & Keyboard navigation
//
//==========================================================

import assert from "assert";
import { chromium } from "playwright";
import browserController from "../backend/browser-controller.js";

async function runBrowserIntegrationTest() {
  console.log("--- Starting Real Playwright Browser Integration Test ---");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Create test HTML page
  const testHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Agentic Browser Test Page</title></head>
      <body style="min-height: 2000px; padding: 20px; font-family: sans-serif;">
        <h1>Jarvis Browser Automation Sandbox</h1>
        <form id="loginForm" onsubmit="event.preventDefault(); document.getElementById('msg').innerText = 'Logged in successfully';">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" placeholder="Enter username" />

          <label for="country">Country</label>
          <select id="country" name="country">
            <option value="US">United States</option>
            <option value="UK">United Kingdom</option>
            <option value="IN">India</option>
          </select>

          <button type="submit" id="loginBtn">Log in</button>
        </form>

        <div id="msg" style="margin-top: 10px; font-weight: bold;"></div>

        <div style="margin-top: 50px;">
          <a href="#section2" id="navLink">Jump to Section 2</a>
        </div>
        <div id="section2" style="margin-top: 800px;">
          <h2>Section 2 Content</h2>
          <button id="section2Btn" onclick="document.getElementById('msg').innerText = 'Section 2 clicked';">Click Section 2</button>
        </div>
      </body>
    </html>
  `;

  await page.setContent(testHtml);

  // Wire mock handles to BrowserController
  browserController.page = page;
  browserController.context = context;
  browserController.browser = browser;
  browserController.connected = true;

  try {
    // 1. Test getInteractiveElements
    console.log("Test 1: Inspect Interactive Elements");
    const elements = await browserController.getInteractiveElements();
    assert.strictEqual(Array.isArray(elements), true);
    assert(elements.length >= 4, `Expected at least 4 interactive elements, found ${elements.length}`);
    const hasLoginBtn = elements.some((el) => /log in/i.test(el.text));
    const hasInput = elements.some((el) => el.id === "username" || el.placeholder === "Enter username");
    assert(hasLoginBtn, "Should find 'Log in' button");
    assert(hasInput, "Should find username input");
    console.log(`  PASSED (Found ${elements.length} verified interactive elements)`);

    // 2. Test verified typeText
    console.log("Test 2: Verified Type into Input");
    const typeRes = await browserController.typeText("username", "ironman");
    assert.strictEqual(typeRes.success, true);
    assert.strictEqual(typeRes.verification.verified, true);
    const actualVal = await page.$eval("#username", (el) => el.value);
    assert.strictEqual(actualVal, "ironman");
    console.log("  PASSED");

    // 3. Test verified clickSmart
    console.log("Test 3: Verified Click on Button");
    const clickRes = await browserController.clickSmart("Log in");
    assert.strictEqual(clickRes.success, true);
    assert.strictEqual(clickRes.verification.verified, true);
    const msgText = await page.$eval("#msg", (el) => el.innerText);
    assert.strictEqual(msgText, "Logged in successfully");
    console.log("  PASSED");

    // 4. Test selectOption
    console.log("Test 4: Verified Dropdown Selection");
    const selectRes = await browserController.selectOption("country", "India");
    assert.strictEqual(selectRes.success, true);
    const selectedVal = await page.$eval("#country", (el) => el.value);
    assert.strictEqual(selectedVal, "IN");
    console.log("  PASSED");

    // 5. Test scrollPage
    console.log("Test 5: Verified Page Scrolling");
    const scrollRes = await browserController.scrollPage("down", 400);
    assert.strictEqual(scrollRes.success, true);
    const scrollY = await page.evaluate(() => window.scrollY);
    assert(scrollY > 0, "Page scrollY should be greater than 0");
    console.log(`  PASSED (scrollY: ${scrollY}px)`);

    // 6. Test readContent
    console.log("Test 6: Clean Page Text Extraction");
    const content = await browserController.readContent();
    assert(content.includes("Jarvis Browser Automation Sandbox"), "Should extract page heading");
    console.log("  PASSED");

    console.log("=== All Real Playwright Integration Tests Passed Successfully ===");
  } finally {
    await browser.close();
  }
}

runBrowserIntegrationTest().catch((err) => {
  console.error("Browser integration test failed:", err);
  process.exit(1);
});
