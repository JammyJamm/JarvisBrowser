// test-agent-engine-flow.js
// Automated verification for Jarvis Agent Engine:
// 1. Goal decomposition for "Buy a iphone 17 from flipkart"
// 2. Detection of missing variant & generation of clarification question
// 3. Human-in-the-loop interactive question answer submission
// 4. Progress tracking, step status, and reasoning logs

import assert from "assert";
import { AgentEngine } from "./backend/agent/agent-engine.js";

async function runTest() {
  console.log("==========================================================");
  console.log("TESTING JARVIS AGENT: 'Buy a iphone 17 from flipkart' FLOW");
  console.log("==========================================================");

  const engine = new AgentEngine({
    debug: false,
    stepDelayMs: 20, // ultra fast for test
    mockBrowser: true, // test without requiring live Electron CDP instance
  });

  const goal = "Buy a iphone 17 from flipkart";

  // 1. Test Planning
  console.log("\n1. Testing Goal Planning...");
  const steps = await engine.plan(goal);

  assert.ok(Array.isArray(steps) && steps.length >= 5, "Should generate at least 5 execution steps");
  console.log(`   ✔ Successfully generated ${steps.length} sequential steps`);

  // Verify step titles
  console.log("   Steps generated:");
  steps.forEach((s, idx) => {
    console.log(`     [${idx + 1}] ${s.title} (tool: ${s.tool})`);
  });

  assert.strictEqual(steps[0].tool, "navigate", "Step 1 should be navigation");
  assert.strictEqual(steps[1].tool, "search", "Step 2 should be search");
  assert.strictEqual(steps[2].tool, "clarify_variant", "Step 3 should be clarification question");

  // 2. Verify Clarification Question Options
  console.log("\n2. Testing Clarification Question Specification...");
  const clarifyStep = steps[2];
  assert.ok(clarifyStep.args.question.includes("iPhone 17"), "Question should mention iPhone 17");
  assert.ok(Array.isArray(clarifyStep.args.options) && clarifyStep.args.options.length >= 3, "Should provide variant choices");
  console.log(`   ✔ Clarification Question: "${clarifyStep.args.question}"`);
  console.log("   ✔ Options:", clarifyStep.args.options);

  // 3. Test Execution up to Clarification
  console.log("\n3. Testing Execution & Pausing on Question...");
  const questionPromise = new Promise((resolve) => {
    engine.on("question_required", (data) => {
      resolve(data.question);
    });
  });

  // Start execution asynchronously
  const runPromise = engine.run(goal);

  // Await the clarification question event
  const receivedQuestion = await questionPromise;
  assert.ok(receivedQuestion, "Should have received question event");

  const stateWaiting = engine.getState();
  assert.strictEqual(stateWaiting.status, "waiting_for_user", "Engine should be waiting for user input");
  assert.ok(stateWaiting.pendingQuestion, "Pending question should be active");
  console.log(`   ✔ Engine correctly entered 'waiting_for_user' state`);
  console.log(`   ✔ Active question ID: ${stateWaiting.pendingQuestion.id}`);

  // 4. Test Answering the Clarification Question
  console.log("\n4. Testing Human-in-the-Loop Answer Submission...");
  const chosenVariant = "256GB - Natural Titanium";
  const stateAfterAnswer = await engine.answerQuestion(stateWaiting.pendingQuestion.id, chosenVariant);

  assert.ok(["executing", "completed"].includes(stateAfterAnswer.status), "Engine should resume or complete execution after answer");
  console.log(`   ✔ Submitted answer: "${chosenVariant}"`);
  console.log(`   ✔ Engine resumed and progressed: status is '${stateAfterAnswer.status}'`);

  // 5. Wait for full completion
  console.log("\n5. Waiting for task completion...");
  await runPromise;

  const finalState = engine.getState();
  assert.strictEqual(finalState.status, "completed", "Goal should reach completed state");
  assert.strictEqual(finalState.completedSteps, finalState.totalSteps, "All steps should be completed");
  console.log(`   ✔ Goal execution completed with 100% progress (${finalState.completedSteps}/${finalState.totalSteps} steps)`);

  // Verify Reasoning Log
  console.log("\n6. Verifying Deep Reasoning Stream...");
  assert.ok(finalState.reasoningLog.length > 5, "Should have streamed detailed reasoning thoughts");
  console.log(`   ✔ Captured ${finalState.reasoningLog.length} reasoning trace entries:`);
  finalState.reasoningLog.slice(0, 5).forEach((r) => {
    console.log(`     [${r.type.toUpperCase()}] ${r.content}`);
  });

  console.log("\n==========================================================");
  console.log("ALL TESTS PASSED! Jarvis Agent is fully operational!");
  console.log("==========================================================");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
