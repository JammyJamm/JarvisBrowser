//==========================================================
//
// tests/test-planner.js
//
// Unit tests for Jarvis Agentic Planner
//
//==========================================================

import assert from "assert";
import Planner from "../backend/planner.js";

async function runPlannerTests() {
  console.log("--- Starting Planner Unit Tests ---");
  const planner = new Planner();

  // Test 1: Fast-path Navigation
  console.log("Test 1: Fast-path Navigation");
  const plan1 = await planner.plan("go to https://example.com");
  assert.strictEqual(plan1.mode, "action");
  assert.strictEqual(plan1.steps.length, 1);
  assert.strictEqual(plan1.steps[0].tool, "navigate");
  assert.strictEqual(plan1.steps[0].args.url, "https://example.com");
  console.log("  PASSED");

  // Test 2: Fast-path Clicking with element suffix removal
  console.log("Test 2: Fast-path Click Button");
  const plan2 = await planner.plan("click the Submit button");
  assert.strictEqual(plan2.mode, "action");
  assert.strictEqual(plan2.steps.length, 1);
  assert.strictEqual(plan2.steps[0].tool, "click");
  assert.strictEqual(plan2.steps[0].args.target, "Submit");
  console.log("  PASSED");

  // Test 3: Fast-path Typing in field
  console.log("Test 3: Fast-path Typing");
  const plan3 = await planner.plan("type hello@example.com in the email field");
  assert.strictEqual(plan3.mode, "action");
  assert.strictEqual(plan3.steps.length, 1);
  assert.strictEqual(plan3.steps[0].tool, "type");
  assert.strictEqual(plan3.steps[0].args.field, "email");
  assert.strictEqual(plan3.steps[0].args.value, "hello@example.com");
  console.log("  PASSED");

  // Test 4: Fast-path Scrolling
  console.log("Test 4: Fast-path Scrolling");
  const plan4 = await planner.plan("scroll down by 800");
  assert.strictEqual(plan4.mode, "action");
  assert.strictEqual(plan4.steps.length, 1);
  assert.strictEqual(plan4.steps[0].tool, "scroll");
  assert.strictEqual(plan4.steps[0].args.direction, "down");
  assert.strictEqual(plan4.steps[0].args.amount, 800);
  console.log("  PASSED");

  // Test 5: Fast-path Browser Controls (Reload, Back, Forward)
  console.log("Test 5: Fast-path Browser Controls");
  const plan5 = await planner.plan("reload page");
  assert.strictEqual(plan5.steps[0].tool, "refresh"); // normalized to refresh
  const plan6 = await planner.plan("go back");
  assert.strictEqual(plan6.steps[0].tool, "back");
  console.log("  PASSED");

  // Test 6: Multi-step Command Decomposition
  console.log("Test 6: Multi-step Sequential Plan");
  const plan7 = await planner.plan("go to google.com and then type OpenAI in search and then click Search");
  assert.strictEqual(plan7.mode, "action");
  assert.strictEqual(plan7.steps.length, 3);
  assert.strictEqual(plan7.steps[0].tool, "navigate");
  assert.strictEqual(plan7.steps[1].tool, "type");
  assert.strictEqual(plan7.steps[2].tool, "click");
  console.log("  PASSED");

  console.log("=== All Planner Unit Tests Passed Successfully ===");
}

runPlannerTests().catch((err) => {
  console.error("Planner test failed:", err);
  process.exit(1);
});
