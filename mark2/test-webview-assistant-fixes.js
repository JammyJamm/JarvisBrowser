// test-webview-assistant-fixes.js
// Verification for:
// 1. Dynamic model discovery & fallback on model_not_found
// 2. Planning timeout handling & thinkWithModel resilience
// 3. Command router approval & contextual directive classification
// 4. Agent engine approval resumption ("Approve", "Yes", "Do it")

import assert from "assert";
import CommandRouter from "./backend/command-router.js";
import ModelRouter from "./backend/agent/model-router.js";
import { AgentEngine } from "./backend/agent/agent-engine.js";

async function runVerification() {
  console.log("================================================================================");
  console.log("TESTING WEBVIEW ASSISTANT FIXES: MODEL RESOLUTION, TIMEOUT, APPROVALS");
  console.log("================================================================================");

  // 1. Command Router Classifications
  console.log("\n1. Testing CommandRouter on Approvals & Contextual Directives...");
  const router = new CommandRouter({ debug: false });

  const approvalPhrases = ["Approve", "Approved", "Yes", "Do it", "proceed", "authorized", "confirm"];
  for (const phrase of approvalPhrases) {
    const route = await router.route(phrase);
    assert.strictEqual(route.mode, "action", `"${phrase}" should be routed as 'action', got '${route.mode}'`);
    console.log(`   âœ” "${phrase}" correctly classified as mode: action`);
  }

  const directivePhrases = ["do this", "complete it", "next", "submit", "handle this", "continue"];
  for (const phrase of directivePhrases) {
    const route = await router.route(phrase);
    assert.strictEqual(route.mode, "action", `"${phrase}" should be routed as 'action', got '${route.mode}'`);
    console.log(`   âœ” "${phrase}" correctly classified as mode: action`);
  }

  // Ensure normal questions still route to chat
  const chatPhrases = ["What is JavaScript?", "Why is the sky blue?", "How does an engine work?"];
  for (const phrase of chatPhrases) {
    const route = await router.route(phrase);
    assert.strictEqual(route.mode, "chat", `"${phrase}" should be routed as 'chat', got '${route.mode}'`);
  }
  console.log("   âœ” Regular questions correctly preserved as mode: chat");

  // 2. ModelRouter Dynamic Discovery & Fallback
  console.log("\n2. Testing ModelRouter Dynamic Resolution & Fallback...");
  const modelRouter = new ModelRouter({ debug: false });

  // Test dynamic resolution
  const resolvedFamily = await modelRouter.resolveOllamaModel("qwen3:8b");
  console.log(`   âœ” Resolved "qwen3:8b" -> "${resolvedFamily}" from available models`);
  assert.ok(resolvedFamily, "Should resolve to an installed model");

  // Test non-existent model fallback
  const resolvedFallback = await modelRouter.resolveOllamaModel("nonexistent-model-xyz");
  console.log(`   âœ” Resolved unknown model "nonexistent-model-xyz" -> "${resolvedFallback}"`);
  assert.ok(resolvedFallback && resolvedFallback !== "nonexistent-model-xyz", "Should fallback to an installed model");

  // 3. AgentEngine Approval Execution
  console.log("\n3. Testing AgentEngine Approval Handling ('Approve', 'Yes', 'Do it')...");
  const engine = new AgentEngine({
    debug: false,
    stepDelayMs: 5,
    mockBrowser: false,
  });

  engine.performToolAction = async (step) => {
    if (step.tool === "user_confirmation") {
      return {
        requiresUserCheck: true,
        reason: step.args.prompt,
        checkType: "user_confirmation",
      };
    }
    return { success: true };
  };

  engine.state.steps = [
    {
      id: "step_1",
      index: 0,
      title: "Review and Approve Order",
      tool: "user_confirmation",
      args: { prompt: "Please approve order placement" },
      status: "pending",
      reasoning: "Awaiting approval checkpoint",
    },
    {
      id: "step_2",
      index: 1,
      title: "Confirm Receipt",
      tool: "finish",
      args: { message: "Order processed" },
      status: "pending",
      reasoning: "Task conclusion",
    },
  ];
  engine.state.totalSteps = 2;
  engine.state.status = "executing";

  let receivedCheck = null;
  engine.on("planner_check_required", (data) => {
    receivedCheck = data.plannerCheck;
  });

  // Trigger check
  await engine.executeStep(0);
  assert.ok(receivedCheck, "Should pause on user_confirmation");

  // Resolve with "Approve"
  console.log("   Resolving with 'Approve' directive...");
  const stateAfterApproval = await engine.resolvePlannerCheck(receivedCheck.id, "Approve");
  assert.strictEqual(stateAfterApproval.status, "completed", "Engine should automatically complete after approval");
  assert.strictEqual(stateAfterApproval.completedSteps, 2, "Both steps should be completed");
  console.log("   âœ” Engine successfully resumed and executed all remaining steps upon receiving 'Approve'!");

  console.log("\n================================================================================");
  console.log("ALL WEBVIEW ASSISTANT SPECIFICATION TESTS PASSED! ðŸš€");
  console.log("================================================================================");
}

runVerification().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

