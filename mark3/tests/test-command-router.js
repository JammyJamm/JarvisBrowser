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
    "can you buy iphone 18 in flipcart ?",
    "can you buy ipgone 18 in flipcart ?",
    "open flipkart and buy iphone 18",
    "could you order running shoes on amazon?",
    "i want to book a flight on makemytrip",
  ];

  for (const cmd of actionCases) {
    const route = await router.route(cmd);
    assert.strictEqual(route.mode, "action", `Expected "${cmd}" to be classified as 'action', got '${route.mode}'`);
  }
  const buyRoute = await router.route("can you buy iphone 18 in flipcart ?");
  assert.strictEqual(buyRoute.intentType, "interactive_goal");
  const compoundBuyRoute = await router.route("open flipkart and buy iphone 18");
  assert.strictEqual(compoundBuyRoute.intentType, "interactive_goal");
  console.log(`  PASSED ${actionCases.length} action classification cases`);

  const chatCases = [
    "hi",
    "hello",
    "how are you today?",
    "what can you do?",
    "can you explain how flipkart works?",
    "what is iphone 18?",
    "thank you very much",
    "good morning",
    "bye",
  ];

  for (const cmd of chatCases) {
    const route = await router.route(cmd);
    assert.strictEqual(route.mode, "chat", `Expected "${cmd}" to be classified as 'chat', got '${route.mode}'`);
  }
  console.log(`  PASSED ${chatCases.length} chat classification cases`);

  const systemCases = [
    "Update our code: make the planner visible before applying the changes.",
    "install https://github.com/HKUDS/CLI-Anything",
    "this is git hub code , can you install in our app ? https://github.com/HKUDS/CLI-Anything",
    "pip install cli-anything-hub",
    "cli-hub list",
    "list project files",
    "read file package.json",
    "system info",
    "run command dir",
    "can you install vlc",
    "auto install python",
  ];

  for (const cmd of systemCases) {
    const route = await router.route(cmd);
    assert.strictEqual(route.mode, "system", `Expected "${cmd}" to be classified as 'system', got '${route.mode}'`);
  }
  console.log(`  PASSED ${systemCases.length} system classification cases`);

  console.log("=== All CommandRouter Unit Tests Passed Successfully ===");
}

runCommandRouterTests().catch((err) => {
  console.error("CommandRouter test failed:", err);
  process.exit(1);
});
