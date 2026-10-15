import assert from "assert";
import { AgentEngine } from "./backend/agent/agent-engine.js";

async function testRetriesAndVerifiesBeforeAdvancing() {
  const engine = new AgentEngine({
    debug: false,
    mockBrowser: false,
    maxActionRetries: 1,
    stepDelayMs: 0,
  });
  engine.state.goal = "Complete a generic workflow";
  engine.state.status = "executing";
  engine.state.steps = [
    {
      index: 0,
      title: "Perform action",
      tool: "generic_action",
      args: {},
      verification: { type: "text_present", expected: "ready" },
      status: "pending",
    },
    { index: 1, title: "Finish", tool: "finish", args: {}, status: "pending" },
  ];
  engine.getBrowserPage = async () => ({});
  const strategies = [];
  let attemptCount = 0;
  let actionSucceeded = false;
  engine.captureObservableState = async () => ({
    url: "https://example.invalid/",
    title: "Test",
    text: actionSucceeded ? "ready" : "",
    controls: [],
  });
  engine.performToolAction = async (step, context) => {
    if (step.tool === "finish") return { success: true };
    strategies.push(context.strategy);
    actionSucceeded = context.attempt > 0;
    attemptCount++;
    return { success: true };
  };

  await engine.executeStep(0);

  assert.deepStrictEqual(strategies, ["primary", "alternative"]);
  assert.strictEqual(attemptCount, 2);
  assert.strictEqual(engine.state.steps[0].workflowState, "STEP_COMPLETED");
  assert.strictEqual(engine.state.steps[1].workflowState, "STEP_COMPLETED");
  assert.strictEqual(engine.state.status, "completed");
}

async function testWorkflowRemainsOnVariantUntilCartIsVerified() {
  const engine = new AgentEngine({
    debug: false,
    mockBrowser: false,
    maxActionRetries: 1,
    stepDelayMs: 0,
  });
  engine.state.goal = "Select an option and add it to a collection";
  engine.state.status = "executing";
  engine.state.steps = [
    {
      index: 0,
      title: "Clarify Item Variant",
      tool: "clarify_variant",
      args: {},
      userAnswer: "User selected option",
      workflowActionIndex: 0,
      workflowActions: [
        {
          tool: "select_option",
          args: { variant: "User selected option" },
          verification: { type: "selection_matches", expected: "User selected option" },
        },
        {
          tool: "click_buy",
          args: { target: "Add to cart" },
          verification: { type: "cart_changed" },
        },
      ],
      status: "pending",
    },
    { index: 1, title: "Next step", tool: "finish", args: {}, status: "pending" },
  ];
  engine.getBrowserPage = async () => ({});
  const attempts = [];
  let selected = false;
  engine.captureObservableState = async () => ({
    url: "https://example.invalid/",
    title: "Test",
    text: "Page state",
    controls: [
      { label: "User selected option", selected, value: "" },
      { label: "Cart 0", selected: false, value: "" },
    ],
  });
  engine.performToolAction = async (action, context) => {
    attempts.push(`${action.tool}:${context.strategy}`);
    if (action.tool === "select_option") {
      selected = context.attempt > 0;
      return { success: true };
    }
    return { success: true };
  };

  await engine.executeStep(0);

  assert.deepStrictEqual(attempts, [
    "select_option:primary",
    "select_option:alternative",
    "click_buy:primary",
    "click_buy:alternative",
  ]);
  assert.strictEqual(engine.state.activeStepIndex, 0);
  assert.strictEqual(engine.state.steps[0].status, "failed");
  assert.strictEqual(engine.state.steps[0].workflowState, "ACTION_FAILED");
  assert.strictEqual(engine.state.steps[0].workflowActionIndex, 1);
  assert.strictEqual(engine.state.steps[1].status, "pending");
  assert.strictEqual(engine.state.status, "waiting_for_user_check");

  const checkId = engine.state.pendingPlannerCheck.id;
  await engine.resolvePlannerCheck(checkId, "resolved");
  assert.strictEqual(engine.state.activeStepIndex, 0);
  assert.strictEqual(engine.state.steps[0].status, "failed");
  assert.strictEqual(engine.state.steps[1].status, "pending");
  assert.strictEqual(engine.state.status, "waiting_for_user_check");
}

await testRetriesAndVerifiesBeforeAdvancing();
await testWorkflowRemainsOnVariantUntilCartIsVerified();
console.log("Agent workflow verification tests passed.");
