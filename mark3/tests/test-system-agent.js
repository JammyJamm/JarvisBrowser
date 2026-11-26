//==========================================================
//
// tests/test-system-agent.js
//
// Unit tests for SystemAgent (Project Folder, System Info,
// CLI-Anything / GitHub planning, and Approval Gate)
//
//==========================================================

import assert from "assert";
import fs from "fs/promises";
import os from "os";
import path from "path";
import SystemAgent from "../backend/system-agent.js";

async function runSystemAgentTests() {
  console.log("--- Starting SystemAgent Unit Tests ---");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-sys-test-"));
  const outsideRoot = `${tempRoot}-outside`;

  try {
    await fs.writeFile(path.join(tempRoot, "hello.txt"), "hello jarvis", "utf8");
    await fs.mkdir(path.join(tempRoot, "sub"), { recursive: true });

    const agent = new SystemAgent({ projectRoot: tempRoot });

    // Test 1: Project directory listing (read-only)
    console.log("Test 1: List project folder");
    const listPlan = await agent.plan("list project files");
    assert.strictEqual(listPlan.tool, "list_dir");
    assert.strictEqual(listPlan.requiresConfirmation, false);
    const listRes = await agent.executePlan(listPlan);
    assert.strictEqual(listRes.success, true);
    assert(listRes.entries.some((e) => e.name === "hello.txt" && e.type === "file"));
    assert(listRes.entries.some((e) => e.name === "sub" && e.type === "dir"));
    console.log("  PASSED");

    // Test 2: Read file from project folder (read-only)
    console.log("Test 2: Read project file");
    const readPlan = await agent.plan("read file hello.txt");
    assert.strictEqual(readPlan.tool, "read_file");
    assert.strictEqual(readPlan.requiresConfirmation, false);
    const readRes = await agent.executePlan(readPlan);
    assert.strictEqual(readRes.success, true);
    assert.strictEqual(readRes.content, "hello jarvis");
    console.log("  PASSED");

    // Test 3: GitHub CLI-Anything install plan requires confirmation
    console.log("Test 3: HKUDS/CLI-Anything GitHub install plan & approval gate");
    const ghPlan = await agent.plan(
      "this is github code, can you install in our app? https://github.com/HKUDS/CLI-Anything",
    );
    assert.strictEqual(ghPlan.tool, "install_github");
    assert.strictEqual(ghPlan.requiresConfirmation, true);
    assert.strictEqual(ghPlan.requiresBrowserResearch, true);
    assert.strictEqual(ghPlan.args.repo, "HKUDS/CLI-Anything");
    assert.match(ghPlan.commandText, /cli-anything-hub/i);

    const pending = agent.createPendingAction(ghPlan, "install CLI-Anything");
    assert(pending.actionId);

    const rejected = agent.rejectAction(pending.actionId);
    assert.strictEqual(rejected.cancelled, true);

    await assert.rejects(
      () => agent.approveAction(pending.actionId),
      /not found or expired/i,
    );
    console.log("  PASSED");

    // Test 4: Pending command approval execution (with edited safe command)
    console.log("Test 4: Approve & execute system command");
    const cmdPlan = await agent.plan("run command echo jarvis-ok");
    assert.strictEqual(cmdPlan.tool, "run_command");
    assert.strictEqual(cmdPlan.requiresConfirmation, true);
    const pendingCmd = agent.createPendingAction(cmdPlan, "run command echo jarvis-ok");
    const approved = await agent.approveAction(
      pendingCmd.actionId,
      "node -e \"console.log('jarvis-approved')\"",
    );
    assert.strictEqual(approved.success, true);
    assert.strictEqual(approved.result.exitCode, 0);
    assert.match(approved.result.stdout, /jarvis-approved/);
    console.log("  PASSED");

    // Test 5: cli-hub read-only vs install gating
    console.log("Test 5: cli-hub read-only vs install gating");
    const hubSearch = await agent.plan("cli-hub search gimp");
    assert.strictEqual(hubSearch.tool, "cli_hub");
    assert.strictEqual(hubSearch.requiresConfirmation, false);

    const hubInstall = await agent.plan("cli-hub install gimp");
    assert.strictEqual(hubInstall.tool, "cli_hub");
    assert.strictEqual(hubInstall.requiresConfirmation, true);
    assert.strictEqual(hubInstall.requiresBrowserResearch, true);
    console.log("  PASSED");

    // Test 6: Generic software auto-install options & self-healing command diagnosis
    console.log("Test 6: Generic auto-install options & self-healing diagnosis");
    const softPlan = await agent.plan("can you install vlc");
    assert.strictEqual(softPlan.tool, "install_package");
    assert.strictEqual(softPlan.requiresConfirmation, true);
    assert.strictEqual(softPlan.requiresBrowserResearch, true);
    assert(Array.isArray(softPlan.options) && softPlan.options.length >= 2, "Expected selectable installer options");
    const npmPlan = await agent.plan("npm install lodash");
    assert.strictEqual(npmPlan.tool, "install_package");
    assert.strictEqual(npmPlan.requiresBrowserResearch, true);
    const explicitNpmPlan = await agent.plan("run command npm install lodash");
    assert.strictEqual(explicitNpmPlan.requiresBrowserResearch, true);
    const pnpmPlan = await agent.plan("pnpm add lodash");
    assert.strictEqual(pnpmPlan.requiresBrowserResearch, true);

    const wingetHeal = agent.diagnoseAndHealCommand("winget install VideoLAN.VLC", {
      success: false,
      stdout: "",
      stderr: "Agreement required",
    });
    assert(wingetHeal && wingetHeal.strategy === "winget_accept_agreements");
    assert.match(wingetHeal.healedCommand, /--accept-package-agreements/);

    const pipHeal = agent.diagnoseAndHealCommand("pip install requests", {
      success: false,
      stdout: "",
      stderr: "'pip' is not recognized as an internal or external command",
    });
    assert(pipHeal && pipHeal.strategy === "python_module_pip");
    assert.match(pipHeal.healedCommand, /python3?\s+-m\s+pip\s+install\s+requests/i);

    const pipUserHeal = agent.diagnoseAndHealCommand("pip install requests", {
      success: false,
      stdout: "",
      stderr: "error: externally-managed-environment",
    });
    assert(pipUserHeal && pipUserHeal.strategy === "pip_user_install");
    assert.match(pipUserHeal.healedCommand, /--user/);

    const testPlan = await agent.plan("run tests");
    assert.strictEqual(testPlan.tool, "run_command");
    assert.strictEqual(testPlan.requiresConfirmation, true);
    assert.strictEqual(testPlan.commandText, "node tests/run-all-tests.js");
    console.log("  PASSED");

    // Test 7: Comment-driven code updates are planned, approved, and verified
    console.log("Test 7: Plan and apply a comment-driven code update");
    const codeFile = path.join(tempRoot, "sample.js");
    await fs.writeFile(codeFile, "const answer = 1;\n", "utf8");
    const codePlan = await agent.plan("Update our code: change sample.js to set answer to 2.");
    assert.strictEqual(codePlan.tool, "code_heal");
    assert.strictEqual(codePlan.requiresConfirmation, true);
    assert.deepStrictEqual(codePlan.args.targetFiles, ["sample.js"]);

    console.log("Test 8: Recognize and target an office timer UI change");
    const timerFiles = [
      "main/renderer/index.html",
      "main/renderer/dashboard.js",
      "main/renderer/dashboard.css",
    ];
    for (const file of timerFiles) {
      const fullPath = path.join(tempRoot, file);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, "", "utf8");
    }
    const timerPlan = await agent.plan("Remove pause button from office timmer from our project");
    assert.strictEqual(timerPlan.tool, "code_heal");
    assert.deepStrictEqual(timerPlan.args.targetFiles, timerFiles);
    const contextualTimerPlan = await agent.plan("Remove that button", {
      conversationHistory: [
        { role: "user", content: "Update the office timer project and remove the pause button." },
      ],
    });
    assert.strictEqual(contextualTimerPlan.tool, "code_heal");
    assert.deepStrictEqual(contextualTimerPlan.args.targetFiles, timerFiles);
    console.log("  PASSED");

    console.log("Test 9: Identify browser-backed install feature files for code healing");
    const installFeatureFiles = [
      "backend/command-router.js",
      "backend/server.js",
      "backend/system-agent.js",
      "backend/planner.js",
      "main/renderer/ai.js",
    ];
    for (const file of installFeatureFiles) {
      const fullPath = path.join(tempRoot, file);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, "", "utf8");
    }
    const featurePlan = await agent.plan(
      "Update my code: software and npm installs should search the internet, show in browser UI, and plan based on the browser page.",
    );
    assert.deepStrictEqual(featurePlan.args.targetFiles, installFeatureFiles);
    console.log("  PASSED");

    console.log("Test 10: Code-heal timeout reports actionable error");
    const timeoutAgent = new SystemAgent({ projectRoot: tempRoot, codeHealTimeoutMs: 10 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    try {
      await assert.rejects(
        () => timeoutAgent.callCodeHealLLM("test"),
        /timed out after 10 ms.*Ollama/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    console.log("  PASSED");

    let codeHealPrompt = "";
    agent.callCodeHealLLM = async (prompt) => {
      codeHealPrompt = prompt;
      return ({
      summary: "Updated the sample value.",
      edits: [{ file: "sample.js", target: "const answer = 1;", replacement: "const answer = 2;" }],
      });
    };
    const pendingCode = agent.createPendingAction(codePlan, "Update our code");
    const codeResult = await agent.approveAction(pendingCode.actionId);
    assert.strictEqual(codeResult.success, true);
    assert.strictEqual(codeResult.result.action, "code_heal");
    assert.deepStrictEqual(codeResult.result.modifiedFiles, ["sample.js"]);
    assert.match(await fs.readFile(codeFile, "utf8"), /const answer = 2;/);
    assert.match(codeHealPrompt, /RELEVANT PAST CONVERSATION/);

    await fs.mkdir(outsideRoot, { recursive: true });
    const outsideFile = path.join(outsideRoot, "escape.js");
    await fs.writeFile(outsideFile, "const outside = true;\n", "utf8");
    const outsideRel = path.relative(tempRoot, outsideFile).replace(/\\/g, "/");
    agent.callCodeHealLLM = async () => ({
      summary: "This edit must be rejected.",
      edits: [{ file: outsideRel, target: "const outside = true;", replacement: "const outside = false;" }],
    });
    const rejectedPlan = await agent.plan("Update our code: change sample.js.");
    const rejectedPending = agent.createPendingAction(rejectedPlan, "Update our code");
    const rejectedResult = await agent.approveAction(rejectedPending.actionId);
    assert.strictEqual(rejectedResult.success, false);
    assert.match(rejectedResult.result.stderr, /outside the reviewed plan/i);
    assert.match(await fs.readFile(outsideFile, "utf8"), /const outside = true;/);
    console.log("  PASSED");

    console.log("=== All SystemAgent Unit Tests Passed Successfully ===");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  }
}

runSystemAgentTests().catch((err) => {
  console.error("SystemAgent test failed:", err);
  process.exit(1);
});
