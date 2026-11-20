//==========================================================
//
// tests/test-executor.js
//
// Unit tests for Action Execution Engine & Verification
//
//==========================================================

import assert from "assert";
import ExecutionEngine from "../backend/executor.js";

async function runExecutorTests() {
  console.log("--- Starting ExecutionEngine Unit Tests ---");

  // Create a mock BrowserController that tracks page-only actions
  let pageState = {
    url: "https://example.com",
    title: "Example Domain",
    clickedTargets: [],
    typedFields: {},
    scrolled: [],
  };

  const mockBrowser = {
    async getPage() {
      return {
        isClosed: () => false,
        url: () => pageState.url,
      };
    },
    async goto(url) {
      pageState.url = url;
      return true;
    },
    async clickSmart(target) {
      pageState.clickedTargets.push(target);
      return {
        success: true,
        action: "click",
        target,
        verification: { verified: true, message: `Clicked "${target}" successfully` },
      };
    },
    async typeText(field, value) {
      pageState.typedFields[field] = value;
      return {
        success: true,
        action: "type",
        field,
        value,
        verification: { verified: true, message: `Filled "${field}" with "${value}"` },
      };
    },
    async scrollPage(direction, amount) {
      pageState.scrolled.push({ direction, amount });
      return {
        success: true,
        action: "scroll",
        direction,
        amount,
        verification: { verified: true, message: `Scrolled ${direction}` },
      };
    },
  };

  const executor = new ExecutionEngine(mockBrowser, null, { maxRetries: 1 });

  // Test 1: Navigation Execution with Verification
  console.log("Test 1: Navigate Execution");
  const navRes = await executor.execute({ tool: "navigate", args: { url: "github.com" } });
  assert.strictEqual(navRes.success, true);
  assert.strictEqual(navRes.result.url, "https://github.com");
  assert.strictEqual(navRes.verification.verified, true);
  console.log("  PASSED");

  // Test 2: Click Execution with Verification
  console.log("Test 2: Click Execution");
  const clickRes = await executor.execute({ tool: "click", args: { target: "Sign in" } });
  assert.strictEqual(clickRes.success, true);
  assert.strictEqual(pageState.clickedTargets.includes("Sign in"), true);
  assert.strictEqual(clickRes.verification.verified, true);
  console.log("  PASSED");

  // Test 3: Type Execution with Verification
  console.log("Test 3: Type Execution");
  const typeRes = await executor.execute({ tool: "type", args: { field: "username", value: "testuser" } });
  assert.strictEqual(typeRes.success, true);
  assert.strictEqual(pageState.typedFields["username"], "testuser");
  assert.strictEqual(typeRes.verification.verified, true);
  console.log("  PASSED");

  // Test 4: Rejection of Desktop / External OS automation commands
  console.log("Test 4: Strict Page-Only Enforcement (Forbidden OS Tools)");
  const forbiddenRes = await executor.execute({ tool: "open_terminal", args: { cmd: "dir" } });
  assert.strictEqual(forbiddenRes.success, false);
  assert.strictEqual(forbiddenRes.verification.verified, false);
  assert.match(forbiddenRes.error, /Unsupported page action/i);
  console.log("  PASSED");

  console.log("=== All ExecutionEngine Unit Tests Passed Successfully ===");
}

runExecutorTests().catch((err) => {
  console.error("Executor test failed:", err);
  process.exit(1);
});
