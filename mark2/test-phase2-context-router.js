//==========================================================
//
// test-phase2-context-router.js
//
// Test Suite for Phase 2: Page Context Engine & Model Router
//
//==========================================================

import assert from "assert";
import { chromium } from "playwright";
import PageContextEngine from "./backend/context/page-context-engine.js";
import ModelRouter from "./backend/agent/model-router.js";
import ObservationBuilder from "./backend/agent/observation-builder.js";

console.log("==========================================================");
console.log("TESTING PHASE 2: PAGE CONTEXT ENGINE & MODEL ROUTER");
console.log("==========================================================");

async function runTests() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Test HTML fixture with buttons, inputs, links, SVGs, and iframes
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Jarvis Agentic Browser - Test Page</title>
        <style>
          body { font-family: sans-serif; margin: 20px; }
          .btn { background: blue; color: white; padding: 8px 16px; border: none; cursor: pointer; }
          .hidden-el { display: none; }
          .container { margin-top: 20px; border: 1px solid #ccc; padding: 10px; }
        </style>
      </head>
      <body>
        <header>
          <h1>Flight Search Portal</h1>
          <nav>
            <a href="/home" id="home-link">Home</a>
            <a href="/flights" id="flights-link">Flights</a>
          </nav>
        </header>

        <main>
          <div class="container" id="search-box">
            <input type="text" id="origin-input" name="origin" placeholder="From where?" value="New York" />
            <input type="text" id="dest-input" name="destination" placeholder="Where to?" />
            <button class="btn" id="search-btn" data-testid="search-flights-btn">Search Flights</button>
          </div>

          <div class="hidden-el">
            <button id="hidden-btn">Should not appear</button>
          </div>

          <div class="container">
            <svg width="100" height="100" id="plane-icon" aria-label="Airplane graphic">
              <circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" />
            </svg>
          </div>

          <iframe srcdoc="<html><body><button id='iframe-sub-btn'>IFrame Submit</button></body></html>" width="300" height="100"></iframe>
        </main>
      </body>
    </html>
  `);

  const engine = new PageContextEngine({ debug: false, enableSoM: true });

  // --------------------------------------------------------
  // 1. Test Interactive Elements Extraction
  // --------------------------------------------------------
  console.log("\n[1] Testing PageContextEngine.extractInteractiveElements...");
  const elements = await engine.extractInteractiveElements(page);

  assert(Array.isArray(elements), "Elements should be an array");
  assert(elements.length >= 5, `Expected at least 5 interactive elements, found ${elements.length}`);

  // Verify elements contain bounding boxes & center coordinates
  const searchBtn = elements.find((e) => e.id === "search-btn" || e.text === "Search Flights");
  assert(searchBtn, "Search button should be found");
  assert.strictEqual(searchBtn.tagName, "button");
  assert(searchBtn.rect.width > 0, "Button rect width must be > 0");
  assert(searchBtn.rect.height > 0, "Button rect height must be > 0");
  assert(searchBtn.center.x > 0 && searchBtn.center.y > 0, "Center coordinates must be valid");
  assert.strictEqual(searchBtn.selector, '[data-testid="search-flights-btn"]', "Selector should prefer data-testid");

  // Verify hidden element was excluded
  const hiddenBtn = elements.find((e) => e.id === "hidden-btn");
  assert(!hiddenBtn, "Hidden element should NOT be included");

  // Verify iframe element was extracted
  const iframeBtn = elements.find((e) => e.id === "iframe-sub-btn" || e.text === "IFrame Submit");
  assert(iframeBtn, "IFrame interactive element should be extracted");
  assert.strictEqual(iframeBtn.isIframe, true, "IFrame element should be marked as isIframe: true");

  console.log(`  ✔ Extracted ${elements.length} interactive elements with bounding boxes and selectors!`);

  // --------------------------------------------------------
  // 2. Test Accessibility Tree Extraction
  // --------------------------------------------------------
  console.log("\n[2] Testing PageContextEngine.extractAccessibilityTree...");
  const a11yTree = await engine.extractAccessibilityTree(page);
  assert(a11yTree, "A11y tree should be returned");
  assert.strictEqual(a11yTree.role, "WebArea");
  console.log("  ✔ Accessibility tree extracted successfully!");

  // --------------------------------------------------------
  // 3. Test Screenshot Capture
  // --------------------------------------------------------
  console.log("\n[3] Testing PageContextEngine.captureScreenshot...");
  const screenshot = await engine.captureScreenshot(page);
  assert(screenshot.base64, "Screenshot base64 must exist");
  assert(screenshot.dataUri.startsWith("data:image/png;base64,"), "Screenshot dataUri must be valid");
  assert(screenshot.byteLength > 1000, "Screenshot byteLength must be > 1000 bytes");
  console.log(`  ✔ Clean viewport screenshot captured (${Math.round(screenshot.byteLength / 1024)} KB)!`);

  // --------------------------------------------------------
  // 4. Test Set-of-Marks (SoM) Generation & Non-Destructive Cleanup
  // --------------------------------------------------------
  console.log("\n[4] Testing PageContextEngine.generateSetOfMarks...");
  const somResult = await engine.generateSetOfMarks(page, elements);
  assert(somResult.somBase64, "SoM screenshot must exist");
  assert(somResult.markedElements.length > 0, "Marked elements count must be > 0");

  // Verify DOM was not permanently modified
  const overlayLeftover = await page.evaluate(() => document.getElementById("jarvis-som-overlay-root"));
  assert.strictEqual(overlayLeftover, null, "SoM overlay MUST be completely removed after capture");
  console.log(`  ✔ Set-of-Marks generated ${somResult.markedElements.length} visual badges and cleaned up overlay completely!`);

  // --------------------------------------------------------
  // 5. Test Unified AgentObservation Generation
  // --------------------------------------------------------
  console.log("\n[5] Testing PageContextEngine.createObservation...");
  const observation = await engine.createObservation(page, { includeScreenshot: true, enableSoM: true });

  assert(observation.id.startsWith("obs_"), "Observation ID should be valid");
  assert.strictEqual(observation.title, "Jarvis Agentic Browser - Test Page");
  assert.strictEqual(observation.viewport.width, 1280);
  assert(observation.compactElements.length > 20, "Compact elements string should be populated");
  assert(observation.screenshot, "Screenshot dataUri should be present");
  assert(observation.somScreenshot, "SoM screenshot dataUri should be present");
  assert(observation.timings.total > 0, "Observation timings should be recorded");

  console.log("  ✔ Unified AgentObservation created with DOM, A11y, Screenshots, and Compact LLM Context!");
  console.log(`    Timings: DOM=${observation.timings.dom.toFixed(1)}ms, A11y=${observation.timings.a11y.toFixed(1)}ms, Visual=${observation.timings.visual.toFixed(1)}ms, Total=${observation.timings.total.toFixed(1)}ms`);

  // --------------------------------------------------------
  // 6. Test ModelRouter Tier Routing & Fallback
  // --------------------------------------------------------
  console.log("\n[6] Testing ModelRouter tier selection and fallback...");
  const router = new ModelRouter({ debug: false });

  assert.strictEqual(router.selectTier("chat"), "fast", "Chat tasks should route to Fast tier");
  assert.strictEqual(router.selectTier("plan_direct"), "fast", "Direct actions should route to Fast tier");
  assert.strictEqual(router.selectTier("reasoning"), "reasoning", "Complex tasks should route to Reasoning tier");
  assert.strictEqual(router.selectTier("repair"), "reasoning", "Repair tasks should route to Reasoning tier");

  // Vision request with configured key chooses vision
  assert.strictEqual(router.selectTier("vision", { requiresVision: true }), "vision", "Vision with API key selects Vision tier");

  // Vision request without key falls back gracefully
  const routerNoKey = new ModelRouter({ debug: false, openaiApiKey: "", models: { vision: "gpt-4o" } });
  assert.strictEqual(routerNoKey.selectTier("vision", { requiresVision: true }), "fast", "Vision without API key falls back to Fast tier");

  // Mock complete dispatch with Fast model
  router.callFastModel = async (prompt, model) => ({
    success: true,
    text: JSON.stringify({
      action: "click",
      index: searchBtn.index,
      target: "Search Flights button",
      value: null,
      reason: "Submit flight search query",
    }),
  });

  const actionDecision = await router.planAction(observation, "Click search flights");
  assert(actionDecision.success, "Action decision should succeed");
  assert.strictEqual(actionDecision.action.action, "click");
  assert.strictEqual(actionDecision.action.index, searchBtn.index);
  console.log("  ✔ ModelRouter planned next action accurately using AgentObservation!");
  console.log("    Decision:", actionDecision.action);

  // --------------------------------------------------------
  // 7. Test ObservationBuilder formatting
  // --------------------------------------------------------
  console.log("\n[7] Testing ObservationBuilder prompt formatters...");
  const fastPrompt = ObservationBuilder.buildPromptForFastLLM(observation, "Find flights to London");
  assert(fastPrompt.includes("VISIBLE INTERACTIVE ELEMENTS:"));
  assert(fastPrompt.includes("USER GOAL: \"Find flights to London\""));

  const visionPrompt = ObservationBuilder.buildPromptForVision(observation, "Click the search button");
  assert(visionPrompt.includes("Set-of-Marks (SoM)"));
  assert(visionPrompt.includes("TOTAL MARKED ELEMENTS:"));

  const summary = ObservationBuilder.summarize(observation);
  assert.strictEqual(summary.hasScreenshot, true);
  assert.strictEqual(summary.hasSoM, true);
  assert(summary.totalElements >= 5);
  console.log("  ✔ ObservationBuilder formatted Fast, Vision, and Summary contexts perfectly!");

  await browser.close();

  console.log("\n==========================================================");
  console.log("PHASE 2 ENGINE & ROUTER TESTS COMPLETED 100% SUCCESSFULLY! 🚀🎉");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
