//==========================================================
//
// tests/run-all-tests.js
//
// Master Test Runner for Jarvis Agentic Browser Test Suite
//
//==========================================================

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testFiles = [
  "test-tab-manager.js",
  "test-command-router.js",
  "test-planner.js",
  "test-executor.js",
  "test-system-agent.js",
  "test-browser-integration.js",
  "test-agentic-workflow.js",
  "test-interactive-agent.js",
];

async function runTest(file) {
  return new Promise((resolve) => {
    const fullPath = path.join(__dirname, file);
    console.log(`\n========================================`);
    console.log(`RUNNING: ${file}`);
    console.log(`========================================`);

    const proc = spawn("node", [fullPath], { stdio: "inherit" });

    proc.on("close", (code) => {
      resolve({ file, success: code === 0 });
    });
  });
}

async function main() {
  console.log("Starting Jarvis Browser Test Suite...\n");
  const results = [];

  for (const testFile of testFiles) {
    const res = await runTest(testFile);
    results.push(res);
  }

  console.log("\n========================================");
  console.log("TEST RUN SUMMARY");
  console.log("========================================");

  let allPassed = true;
  for (const r of results) {
    console.log(`${r.success ? "✅ PASSED" : "❌ FAILED"}: ${r.file}`);
    if (!r.success) allPassed = false;
  }

  if (allPassed) {
    console.log(`\n🎉 ALL ${testFiles.length} TEST SUITES PASSED!`);
    process.exit(0);
  } else {
    console.error(`\n❌ SOME TESTS FAILED`);
    process.exit(1);
  }
}

main();
