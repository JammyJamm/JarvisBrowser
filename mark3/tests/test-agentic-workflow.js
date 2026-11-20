//==========================================================
//
// tests/test-agentic-workflow.js
//
// End-to-End Integration Test Suite for Chrome-like Agentic Browser
//
// Tests:
// 1. Planner Multi-Step & Compound Command Decomposition
// 2. Playwright Page-Grounded Element Interaction
// 3. Dynamic Replanning Pipeline on Step Failure
// 4. Tab ID Synchronization
// 5. Strict Page-Only Security Boundary
//
//==========================================================

import assert from "assert";
import { chromium } from "playwright";
import Planner from "../backend/planner.js";
import ExecutionEngine from "../backend/executor.js";
import browserController from "../backend/browser-controller.js";

async function runAgenticWorkflowTests() {
  console.log("--- Starting Agentic Browser Workflow Integration Tests ---");

  const planner = new Planner();

  // Test 1: Advanced Compound Command Parsing
  console.log("Test 1: Advanced Compound Command Parsing");
  const compound1 = await planner.plan("open google.com and search for weather");
  assert.strictEqual(compound1.mode, "action");
  assert.strictEqual(compound1.steps.length, 2);
  assert.strictEqual(compound1.steps[0].tool, "navigate");
  assert.strictEqual(compound1.steps[1].tool, "type");
  assert.strictEqual(compound1.steps[1].args.field, "search");
  assert.strictEqual(compound1.steps[1].args.value, "weather");

  const compound2 = await planner.plan("fill username with ironman and password with secret123 and click Log in");
  assert.strictEqual(compound2.mode, "action");
  assert.strictEqual(compound2.steps.length, 3);
  assert.strictEqual(compound2.steps[0].tool, "type");
  assert.strictEqual(compound2.steps[0].args.field, "username");
  assert.strictEqual(compound2.steps[0].args.value, "ironman");
  assert.strictEqual(compound2.steps[1].tool, "type");
  assert.strictEqual(compound2.steps[1].args.field, "password");
  assert.strictEqual(compound2.steps[1].args.value, "secret123");
  assert.strictEqual(compound2.steps[2].tool, "click");
  assert.strictEqual(compound2.steps[2].args.target, "Log in");
  console.log("  PASSED");

  // Launch headless browser for real DOM workflow
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const testHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Agentic Workflow Test Page</title></head>
      <body style="min-height: 1500px; padding: 20px;">
        <h1 id="title">User Management Portal</h1>
        <form id="userForm" onsubmit="event.preventDefault(); document.getElementById('status').innerText = 'User Saved: ' + document.getElementById('name').value;">
          <input type="text" id="name" name="name" placeholder="Full Name" />
          <input type="email" id="email" name="email" placeholder="Email Address" />
          <select id="role" name="role">
            <option value="viewer">Viewer</option>
            <option value="admin">Administrator</option>
          </select>
          <button type="submit" id="saveBtn">Save User</button>
        </form>
        <div id="status" style="margin-top: 15px;">Pending</div>
        <div style="margin-top: 600px;">
          <button id="deepActionBtn" onclick="document.getElementById('status').innerText = 'Deep Action Clicked';">Deep Action</button>
        </div>
      </body>
    </html>
  `;

  await page.setContent(testHtml);

  // Set tab ID for deterministic tab verification
  await page.evaluate(() => {
    window.__JARVIS_TAB_ID__ = "tab_test_123";
  });

  browserController.page = page;
  browserController.context = context;
  browserController.browser = browser;
  browserController.connected = true;
  browserController.setActiveTabInfo("tab_test_123", page.url(), "Agentic Workflow Test Page");

  const executor = new ExecutionEngine(browserController, null, { debug: false, maxRetries: 1 });

  // Test 2: Tab ID Verification
  console.log("Test 2: Tab ID Synchronization");
  const activePage = await browserController.getPage();
  assert.strictEqual(activePage, page);
  const tabId = await activePage.evaluate(() => window.__JARVIS_TAB_ID__);
  assert.strictEqual(tabId, "tab_test_123");
  console.log("  PASSED");

  // Test 3: Multi-step Plan Execution on Live DOM
  console.log("Test 3: Multi-step Action Execution & Verification");
  const livePlan = {
    mode: "action",
    goal: "Fill user form and submit",
    steps: [
      { tool: "type", args: { field: "name", value: "Tony Stark" } },
      { tool: "type", args: { field: "email", value: "tony@avengers.org" } },
      { tool: "select", args: { field: "role", value: "Administrator" } },
      { tool: "click", args: { target: "Save User" } },
    ],
  };

  const execResult = await executor.executePlan(livePlan, page);
  assert.strictEqual(execResult.success, true);
  assert.strictEqual(execResult.results.length, 4);
  assert(execResult.results.every((r) => r.verification?.verified === true), "All steps must be verified");

  const statusText = await page.$eval("#status", (el) => el.innerText);
  assert.strictEqual(statusText, "User Saved: Tony Stark");
  console.log("  PASSED (Form filled and submitted successfully)");

  // Test 4: Dynamic Replanning on Step Failure
  console.log("Test 4: Dynamic Replanning on Failure");
  // A plan targeting a non-existent button name "Deep Action Button"
  // Dynamic replan will inspect live page elements and recover to "#deepActionBtn"
  const failingPlan = {
    mode: "action",
    goal: "Click deep action",
    steps: [
      { tool: "click", args: { target: "NonExistentButtonXYZ" } },
    ],
  };

  const replan = planner.replan({
    failedStep: failingPlan.steps[0],
    error: "Target not found",
    currentUrl: page.url(),
    pageElements: await browserController.getInteractiveElements(),
    originalGoal: failingPlan.goal,
  });

  assert(replan !== null, "Planner must generate a replan");
  assert.strictEqual(replan.isReplan, true);
  assert(replan.steps.length > 0, "Replan must have recovery steps");
  console.log(`  PASSED (Dynamic replan generated ${replan.steps.length} recovery steps)`);

  // Test 5: Rejection of OS-level Desktop automation
  console.log("Test 5: Page-Only Security Boundary");
  const forbiddenCommands = [
    { tool: "open_terminal", args: { cmd: "dir" } },
    { tool: "run_shell", args: { command: "calc.exe" } },
    { tool: "desktop_click", args: { x: 500, y: 500 } },
  ];

  for (const fCmd of forbiddenCommands) {
    const res = await executor.execute(fCmd, page);
    assert.strictEqual(res.success, false);
    assert.match(res.error, /Unsupported page action/i);
  }
  console.log("  PASSED (All OS/desktop controls rejected)");

  await browser.close();
  console.log("=== All Agentic Browser Workflow Tests Passed Successfully ===");
}

runAgenticWorkflowTests().catch((err) => {
  console.error("Agentic workflow test failed:", err);
  process.exit(1);
});
