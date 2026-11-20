//==========================================================
//
// tests/test-command-router.js
//
// Unit tests for CommandRouter (Chat vs Action Classification)
//
//==========================================================

import assert from "assert";
import CommandRouter from "../backend/command-router.js";

async function runCommandRouterTests() {
  console.log("--- Starting CommandRouter Unit Tests ---");
  const router = new CommandRouter();

  const actionCases = [
    "click Login",
    "click the blue button",
    "type admin@gmail.com in email",
    "go to google.com",
    "navigate to https://github.com",
    "scroll down",
    "search for best restaurants",
    "read this page",
    "reload page",
    "go back",
    "press Enter",
  ];

  for (const cmd of actionCases) {
    const route = await router.route(cmd);
    assert.strictEqual(route.mode, "action", `Expected "${cmd}" to be classified as 'action', got '${route.mode}'`);
  }
  console.log(`  PASSED ${actionCases.length} action classification cases`);

  const chatCases = [
    "hi",
    "hello",
    "how are you today?",
    "what can you do?",
    "thank you very much",
    "good morning",
    "bye",
  ];

  for (const cmd of chatCases) {
    const route = await router.route(cmd);
    assert.strictEqual(route.mode, "chat", `Expected "${cmd}" to be classified as 'chat', got '${route.mode}'`);
  }
  console.log(`  PASSED ${chatCases.length} chat classification cases`);

  console.log("=== All CommandRouter Unit Tests Passed Successfully ===");
}

runCommandRouterTests().catch((err) => {
  console.error("CommandRouter test failed:", err);
  process.exit(1);
});
