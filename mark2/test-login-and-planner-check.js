// test-login-and-planner-check.js
// Automated verification for:
// 1. Dual-Storage Secure Credential Manager (AES-256-GCM Local + Firebase Firestore)
// 2. Autonomous Login Handler for Flipkart, ZingHR, Udemy
// 3. Human-in-the-Loop Planner Check (Fallback on Failure / Unexpected Outcome)
// 4. Missing Credential In-Line Prompting & Execution Resumption

import assert from "assert";
import { CredentialManager } from "./backend/auth/credential-manager.js";
import { LoginHandler } from "./backend/auth/login-handler.js";
import { AgentEngine } from "./backend/agent/agent-engine.js";

async function runTests() {
  console.log("================================================================================");
  console.log("TESTING: LOGIN HANDLER, LOCAL/FIREBASE CREDENTIAL VAULT & PLANNER CHECK FALLBACK");
  console.log("================================================================================");

  // ==========================================================
  // SECTION 1: DUAL-STORAGE CREDENTIAL MANAGER (LOCAL + FIREBASE)
  // ==========================================================
  console.log("\n🔐 [SECTION 1] Dual-Storage Secure Credential Manager");

  const cm = new CredentialManager({ debug: false });

  // 1.1 AES-256-GCM Encryption & Decryption
  const rawPassword = "SuperSecretPassword#2026!";
  const encrypted = cm.encrypt(rawPassword);
  assert.notStrictEqual(encrypted, rawPassword, "Password must be encrypted");
  assert.ok(encrypted.includes(":"), "AES-256-GCM cipher payload must include IV and AuthTag");
  const decrypted = cm.decrypt(encrypted);
  assert.strictEqual(decrypted, rawPassword, "Decrypted password must match original");
  console.log("   ✔ AES-256-GCM authenticated encryption and decryption validated");

  // 1.2 Domain Normalization
  assert.strictEqual(cm.normalizeSite("https://www.flipkart.com/account/login"), "flipkart.com");
  assert.strictEqual(cm.normalizeSite("flipkart"), "flipkart.com");
  assert.strictEqual(cm.normalizeSite("https://mycompany.zinghr.com/2020/login.aspx"), "zinghr.com");
  assert.strictEqual(cm.normalizeSite("zinghr"), "zinghr.com");
  assert.strictEqual(cm.normalizeSite("https://www.udemy.com/join/login-popup/"), "udemy.com");
  assert.strictEqual(cm.normalizeSite("udemy"), "udemy.com");
  console.log("   ✔ Site and domain URL normalization validated for Flipkart, ZingHR, and Udemy");

  // 1.3 Local Storage Save & Retrieve
  await cm.save("flipkart.com", "9876543210", "flipPass123", { storage: "local" });
  const flipCred = await cm.get("https://www.flipkart.com/account/login");
  assert.ok(flipCred, "Should retrieve saved Flipkart credentials");
  assert.strictEqual(flipCred.username, "9876543210");
  assert.strictEqual(flipCred.password, "flipPass123");
  assert.strictEqual(flipCred.source, "local");
  console.log("   ✔ Saved and retrieved Flipkart credentials locally (AES-256-GCM encrypted)");

  // 1.4 ZingHR with Extra Fields (Company Code)
  await cm.save("zinghr.com", "EMP1045", "zingPass456", {
    storage: "local",
    extraFields: { companyCode: "TECHCORP" },
  });
  const zingCred = await cm.get("https://enterprise.zinghr.com/login");
  assert.ok(zingCred, "Should retrieve ZingHR credentials");
  assert.strictEqual(zingCred.username, "EMP1045");
  assert.strictEqual(zingCred.password, "zingPass456");
  assert.strictEqual(zingCred.extraFields?.companyCode, "TECHCORP");
  console.log("   ✔ Saved and retrieved ZingHR credentials with Company Code locally");

  // 1.5 Firebase Firestore Save & Retrieve
  console.log("   Testing Firebase Firestore Cloud Database integration...");
  const fbSave = await cm.save("udemy.com", "student@udemy.com", "udemyPass789", { storage: "firebase" });
  assert.ok(fbSave.firebase, "Should successfully write to Firebase Firestore");
  const udemyCred = await cm.get("https://www.udemy.com/join/login-popup/", { storage: "firebase" });
  assert.ok(udemyCred, "Should retrieve credentials from Firebase Firestore");
  assert.strictEqual(udemyCred.username, "student@udemy.com");
  assert.strictEqual(udemyCred.password, "udemyPass789");
  assert.strictEqual(udemyCred.source, "firebase");
  console.log("   ✔ Saved and retrieved Udemy credentials from Firebase Firestore DB");

  // 1.6 List with Masked Passwords
  const credList = await cm.list();
  assert.ok(credList.length >= 2, "Vault list should contain saved accounts");
  credList.forEach((item) => {
    assert.strictEqual(item.passwordMasked, "••••••••", "Raw passwords must never be exposed in list API");
  });
  console.log(`   ✔ Vault listing masked correctly for ${credList.length} accounts`);

  // 1.7 Clean up test credentials
  await cm.remove("flipkart.com", { storage: "both" });
  await cm.remove("zinghr.com", { storage: "both" });
  await cm.remove("udemy.com", { storage: "both" });
  console.log("   ✔ Cleaned up test credentials from Local and Firebase");

  // ==========================================================
  // SECTION 2: MULTI-DOMAIN AUTONOMOUS PLANNING WITH LOGIN HANDLER
  // ==========================================================
  console.log("\n📋 [SECTION 2] Domain Planning with Login Handler");

  const engine = new AgentEngine({
    debug: false,
    stepDelayMs: 5,
    mockBrowser: true,
  });

  // 2.1 Flipkart iPhone Buying Plan
  console.log("   Planning: 'Buy a iphone 17 from flipkart'");
  const flipSteps = await engine.plan("Buy a iphone 17 from flipkart");
  assert.strictEqual(engine.getState().category, "ecommerce");
  assert.ok(flipSteps.some((s) => s.tool === "login_handler"), "Flipkart plan must include login_handler step");
  assert.ok(flipSteps.some((s) => s.tool === "clarify_variant"), "Flipkart plan must include variant clarification");
  assert.ok(flipSteps.some((s) => s.tool === "click_buy"), "Flipkart plan must include click_buy step");
  console.log(`   ✔ Flipkart plan generated ${flipSteps.length} sequential steps including login handler`);

  // 2.2 ZingHR Leave Application Plan
  console.log("   Planning: 'Apply leave in zinghr for next monday'");
  const zingSteps = await engine.plan("Apply leave in zinghr for next monday");
  assert.strictEqual(engine.getState().category, "hr_leave");
  assert.ok(zingSteps[0].args.url.includes("zinghr"), "Step 1 must navigate to ZingHR portal");
  assert.strictEqual(zingSteps[1].tool, "login_handler", "Step 2 must authenticate ZingHR credentials");
  assert.ok(zingSteps.some((s) => s.tool === "fill_form"), "Must include fill_form step");
  assert.ok(zingSteps.some((s) => s.tool === "user_confirmation"), "Must include review check before submit");
  console.log(`   ✔ ZingHR leave plan generated ${zingSteps.length} sequential steps`);

  // 2.3 Udemy Course Purchase Plan
  console.log("   Planning: 'Buy react course on udemy'");
  const udemySteps = await engine.plan("Buy react course on udemy");
  assert.strictEqual(engine.getState().category, "edtech");
  assert.ok(udemySteps[0].args.url.includes("udemy"), "Step 1 must navigate to Udemy");
  assert.strictEqual(udemySteps[1].tool, "search", "Step 2 must search course topic");
  assert.ok(udemySteps.some((s) => s.tool === "login_handler"), "Must include login handler");
  assert.ok(udemySteps.some((s) => s.tool === "click_buy"), "Must include buy step");
  console.log(`   ✔ Udemy plan generated ${udemySteps.length} sequential steps`);

  // ==========================================================
  // SECTION 3: PLANNER CHECK / FALLBACK ON UNEXPECTED OUTCOME OR ERROR
  // ==========================================================
  console.log("\n⚠️ [SECTION 3] Planner Check: Human-in-the-Loop Fallback on Failure");

  const failEngine = new AgentEngine({
    debug: false,
    stepDelayMs: 5,
    mockBrowser: true,
  });

  // Deliberately simulate an unexpected failure in tool execution
  failEngine.performToolAction = async (step) => {
    if (step.tool === "click_element") {
      throw new Error("Unable to locate element 'Submit Leave' on ZingHR page (Stuck on Captcha / Form Error)");
    }
    return { success: true };
  };

  failEngine.state.steps = [
    {
      id: "step_1",
      index: 0,
      title: "Submit Leave Form in ZingHR",
      tool: "click_element",
      args: { target: "Submit Leave" },
      status: "pending",
      reasoning: "Submitting ZingHR form",
    },
    {
      id: "step_2",
      index: 1,
      title: "Complete Confirmation",
      tool: "finish",
      args: { message: "Leave confirmed" },
      status: "pending",
      reasoning: "Concluding task",
    },
  ];
  failEngine.state.totalSteps = 2;
  failEngine.state.status = "executing";

  let capturedPlannerCheck = null;
  failEngine.on("planner_check_required", (data) => {
    capturedPlannerCheck = data.plannerCheck;
  });

  // Execute failing step
  await failEngine.executeStep(0);

  assert.ok(capturedPlannerCheck, "Planner must emit 'planner_check_required' when an error occurs");
  assert.strictEqual(failEngine.getState().status, "waiting_for_user_check", "Status must be 'waiting_for_user_check'");
  assert.ok(capturedPlannerCheck.reason.includes("Unable to locate element"), "Reason must describe the failure");
  assert.ok(capturedPlannerCheck.options.length >= 4, "Must offer resolution options");
  console.log("   ✔ Engine safely paused in 'waiting_for_user_check' state on error:");
  console.log(`     Check ID: ${capturedPlannerCheck.id}`);
  console.log(`     Reason: "${capturedPlannerCheck.reason}"`);
  console.log("     Options provided to user:", capturedPlannerCheck.options);

  // 3.1 User indicates: "I resolved it in the browser" -> Agent resumes and advances!
  console.log("   Submitting user resolution: '✔ I resolved it in the browser — Continue'...");
  await failEngine.resolvePlannerCheck(capturedPlannerCheck.id, "resolved");

  const stateAfterResolution = failEngine.getState();
  assert.strictEqual(stateAfterResolution.status, "completed", "Goal must resume and complete remaining steps");
  assert.strictEqual(stateAfterResolution.completedSteps, 2, "All 2 steps must be completed");
  console.log("   ✔ Execution resumed after user check and reached 100% completion!");

  // ==========================================================
  // SECTION 4: IN-LINE CREDENTIAL PROMPT & RESUMPTION
  // ==========================================================
  console.log("\n🔑 [SECTION 4] In-Line Credential Prompting & Resumption");

  const credPromptEngine = new AgentEngine({
    debug: false,
    stepDelayMs: 5,
    mockBrowser: false, // will invoke real credential check
  });

  let capturedCredRequest = null;
  credPromptEngine.on("credential_required", (data) => {
    capturedCredRequest = data.credentialRequest;
  });

  credPromptEngine.state.steps = [
    {
      id: "step_1",
      index: 0,
      title: "Authenticate with Flipkart Account",
      tool: "login_handler",
      args: { site: "test-site-unknown-99.com", purpose: "Test authentication prompt" },
      status: "pending",
      reasoning: "Verifying credentials",
    },
  ];
  credPromptEngine.state.totalSteps = 1;
  credPromptEngine.state.status = "executing";

  await credPromptEngine.executeStep(0);

  assert.ok(capturedCredRequest, "Engine must trigger credential prompt when no saved credentials exist");
  assert.strictEqual(credPromptEngine.getState().status, "waiting_for_user");
  console.log("   ✔ Engine correctly prompted user for missing credentials:");
  console.log(`     Target Site: "${capturedCredRequest.site}"`);
  console.log(`     Request ID: ${capturedCredRequest.id}`);

  // User submits credentials
  console.log("   User enters credentials and chooses to save locally...");
  // Temporarily mock loginHandler for the test site
  credPromptEngine.loginHandler = {
    login: async () => ({ success: true }),
  };

  await credPromptEngine.provideCredentials(
    capturedCredRequest.id,
    "user@test-site.com",
    "securePass123",
    { storage: "local" }
  );

  const credPromptFinalState = credPromptEngine.getState();
  assert.strictEqual(credPromptFinalState.status, "completed");
  console.log("   ✔ Credentials saved and login step completed successfully!");

  // Clean up test site
  await cm.remove("test-site-unknown-99.com", { storage: "local" });

  console.log("\n================================================================================");
  console.log("🎉 ALL TESTS PASSED! FULL LOGIN HANDLER & PLANNER CHECK SYSTEM OPERATIONAL!");
  console.log("================================================================================");
}

runTests().catch((err) => {
  console.error("Test Suite Failed:", err);
  process.exit(1);
});