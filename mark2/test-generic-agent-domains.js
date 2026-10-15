// test-generic-agent-domains.js
// Automated verification for Jarvis Generic Autonomous Browser Agent across all requested domains:
// 1. Flights & Travel Booking (Google Flights)
// 2. Calendar & Scheduling (Google Calendar)
// 3. Notes & Reminders (Google Keep)
// 4. Maps & Route Directions (Google Maps)
// 5. E-Commerce & Product Buying (Amazon / Any store)
// 6. Generic Web Search & Research

import assert from "assert";
import { AgentEngine } from "./backend/agent/agent-engine.js";

async function runDomainTests() {
  console.log("================================================================================");
  console.log("TESTING JARVIS GENERIC AUTONOMOUS AGENT ENGINE ACROSS MULTIPLE DOMAINS");
  console.log("================================================================================");

  const engine = new AgentEngine({
    debug: false,
    stepDelayMs: 5, // ultra-fast for testing
    mockBrowser: true,
  });

  // TEST 1: FLIGHT BOOKING
  console.log("\n✈️ [TEST 1] Flight Booking: 'Book a flight from San Francisco to Tokyo next month'");
  const flightSteps = await engine.plan("Book a flight from San Francisco to Tokyo next month");
  assert.strictEqual(engine.getState().category, "flight", "Category should be 'flight'");
  assert.ok(flightSteps.length >= 5, "Flight plan should have at least 5 steps");
  assert.strictEqual(flightSteps[0].tool, "navigate");
  assert.ok(flightSteps[0].args.url.includes("flights"), "Step 1 should navigate to Google Flights");
  assert.ok(flightSteps.some((s) => s.tool === "clarify_variant" || s.tool === "clarify_parameter"), "Should ask cabin class clarification");
  console.log(`   ✔ Flight plan generated ${flightSteps.length} steps with target: ${flightSteps[0].args.url}`);

  // TEST 2: CALENDAR SCHEDULING
  console.log("\n📅 [TEST 2] Calendar Event: 'Schedule dental appointment tomorrow on Google Calendar'");
  const calSteps = await engine.plan("Schedule dental appointment tomorrow on Google Calendar");
  assert.strictEqual(engine.getState().category, "calendar", "Category should be 'calendar'");
  assert.ok(calSteps.length >= 5, "Calendar plan should have at least 5 steps");
  assert.strictEqual(calSteps[0].tool, "navigate");
  assert.ok(calSteps[0].args.url.includes("calendar.google.com"), "Step 1 should navigate to Google Calendar");
  assert.ok(calSteps.some((s) => s.tool === "clarify_variant"), "Should ask for time slot clarification");
  console.log(`   ✔ Calendar plan generated ${calSteps.length} steps with target: ${calSteps[0].args.url}`);

  // TEST 3: NOTES & REMINDERS
  console.log("\n📝 [TEST 3] Notes & Reminders: 'Take a note: weekly grocery shopping list'");
  const noteSteps = await engine.plan("Take a note: weekly grocery shopping list");
  assert.strictEqual(engine.getState().category, "note", "Category should be 'note'");
  assert.ok(noteSteps.length >= 5, "Note plan should have at least 5 steps");
  assert.strictEqual(noteSteps[0].tool, "navigate");
  assert.ok(noteSteps[0].args.url.includes("keep.google.com"), "Step 1 should navigate to Google Keep");
  console.log(`   ✔ Note plan generated ${noteSteps.length} steps with target: ${noteSteps[0].args.url}`);

  // TEST 4: MAPS & NAVIGATION
  console.log("\n🗺️ [TEST 4] Maps & Directions: 'Get driving directions from Times Square to Central Park on Google Maps'");
  const mapSteps = await engine.plan("Get driving directions from Times Square to Central Park on Google Maps");
  assert.strictEqual(engine.getState().category, "map", "Category should be 'map'");
  assert.ok(mapSteps.length >= 5, "Map plan should have at least 5 steps");
  assert.strictEqual(mapSteps[0].tool, "navigate");
  assert.ok(mapSteps[0].args.url.includes("maps"), "Step 1 should navigate to Google Maps");
  console.log(`   ✔ Map plan generated ${mapSteps.length} steps with target: ${mapSteps[0].args.url}`);

  // TEST 5: GENERIC ITEM WORKFLOW
  console.log("\n🛍️ [TEST 5] Generic item selection and collection workflow");
  const shopSteps = await engine.plan("Buy a generic item");
  assert.strictEqual(engine.getState().category, "ecommerce", "Category should be 'ecommerce'");
  assert.ok(shopSteps.length >= 3, "Generic item plan should include search, a verified variant workflow, and completion");
  assert.strictEqual(shopSteps[0].tool, "search");
  const variantWorkflow = shopSteps.find((step) => step.workflowActions?.length);
  assert.ok(variantWorkflow, "Selection and collection actions should be grouped into one verified workflow step");
  assert.deepStrictEqual(
    variantWorkflow.workflowActions.map((action) => action.tool),
    ["select_option", "click_buy"],
  );
  assert.strictEqual(variantWorkflow.workflowActions[1].verification.type, "cart_changed");
  assert.ok(!shopSteps.some((step) => step.tool === "navigate" && /amazon|flipkart/i.test(step.args.url || "")));
  console.log(`   ✔ Generic item plan generated ${shopSteps.length} steps without a hardcoded destination`);

  // TEST 6: GENERIC SEARCH FALLBACK
  console.log("\n🔍 [TEST 6] Generic Search: fallback should open a real search destination");
  const searchSteps = await engine.plan("Find the latest research about solar energy");
  assert.strictEqual(engine.getState().category, "search");
  assert.strictEqual(searchSteps[0].tool, "navigate");
  assert.strictEqual(searchSteps[0].args.url, "https://www.google.com");
  assert.strictEqual(searchSteps[1].tool, "search");
  assert.strictEqual(searchSteps[1].args.query, "Find the latest research about solar energy");
  console.log("   ✔ Generic search plan no longer navigates to about:blank");

  // TEST 7: FULL EXECUTION WITH CLARIFICATION ON FLIGHT BOOKING
  console.log("\n🚀 [TEST 7] Live Simulated Execution & Human-In-The-Loop on Flight Goal");
  const flightGoal = "Book a flight from San Francisco to Tokyo next month";
  let capturedQuestion = null;
  engine.on("question_required", (data) => {
    capturedQuestion = data.question;
  });

  const execPromise = engine.run(flightGoal);
  
  // Wait for clarification question
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(capturedQuestion, "Should have received clarification question event");
  console.log(`   ✔ Received clarification question: "${capturedQuestion.message}"`);
  console.log(`   ✔ Clarification options:`, capturedQuestion.options);

  // Submit human answer
  const answer = "Business Class - Lie-Flat Seats";
  console.log(`   ✔ Answering question with: "${answer}"`);
  await engine.answerQuestion(capturedQuestion.id, answer);

  // Wait for completion
  await execPromise;
  const finalState = engine.getState();
  assert.strictEqual(finalState.status, "completed", "Goal should reach completed state");
  assert.strictEqual(finalState.completedSteps, finalState.totalSteps, "All steps should complete");
  console.log(`   ✔ Flight goal completed with 100% progress (${finalState.completedSteps}/${finalState.totalSteps} steps)!`);

  console.log("\n================================================================================");
  console.log("🎉 ALL MULTI-DOMAIN TESTS PASSED! JARVIS IS FULLY GENERIC AND OPERATIONAL!");
  console.log("================================================================================");
}

runDomainTests().catch((err) => {
  console.error("Multi-domain test failed:", err);
  process.exit(1);
});
