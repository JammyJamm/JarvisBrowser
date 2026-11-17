import assert from "assert";
import { chromium } from "playwright";
import {
  getFrameSVGs,
  getFrameContainerData,
  getIframeContainerData,
  getSVGDataFromIframe,
  convertSVGToJSON,
  watchIframeContainerData,
} from "./utils/iframeContent.js";
import { fastPath, isBrowserActionText } from "./planner/fast-path.js";
import CommandRouter from "./command-router.js";
import ToolMap from "./tool-map.js";
import { mapAction, ACTION_TYPES } from "./planner/action-map.js";

console.log("==========================================================");
console.log("TESTING SVG TO JSON EXTRACTION & INTERVAL UPDATES FOR .tzQn0o");
console.log("==========================================================");

async function runTests() {
  // --------------------------------------------------------
  // 1. Test fastPath command parsing
  // --------------------------------------------------------
  console.log("\n[1] Testing fast-path parsing for user command variations...");

  const fp1 = fastPath("get data from .tzQn0o");
  assert(fp1, "fastPath should parse 'get data from .tzQn0o'");
  assert.strictEqual(fp1.steps[0].tool, "get_iframe_data");
  assert.strictEqual(fp1.steps[0].args.target, ".tzQn0o");
  assert.strictEqual(fp1.steps[0].args.onlyIframes, true);
  console.log("  ✔ 'get data from .tzQn0o' parsed:", fp1.steps[0]);

  const fp2 = fastPath("get data from tzQn0o");
  assert(fp2, "fastPath should parse 'get data from tzQn0o'");
  assert.strictEqual(fp2.steps[0].tool, "get_iframe_data");
  assert.strictEqual(fp2.steps[0].args.target, "tzQn0o");
  console.log("  ✔ 'get data from tzQn0o' parsed:", fp2.steps[0]);

  const fp3 = fastPath("get data from parent class .tzQn0o inside the iframe");
  assert(fp3, "fastPath should parse parent class inside iframe");
  assert.strictEqual(fp3.steps[0].tool, "get_iframe_data");
  assert.strictEqual(fp3.steps[0].args.target, ".tzQn0o");
  console.log("  ✔ 'get data from parent class .tzQn0o inside the iframe' parsed:", fp3.steps[0]);

  const fp4 = fastPath("get svg from .tzQn0o");
  assert(fp4, "fastPath should parse 'get svg from .tzQn0o'");
  assert.strictEqual(fp4.steps[0].tool, "get_iframe_svg");
  assert.strictEqual(fp4.steps[0].args.parentClass, ".tzQn0o");
  console.log("  ✔ 'get svg from .tzQn0o' parsed:", fp4.steps[0]);

  const fp5 = fastPath("convert svg to json from .tzQn0o");
  assert(fp5, "fastPath should parse 'convert svg to json from .tzQn0o'");
  assert.strictEqual(fp5.steps[0].tool, "get_iframe_svg");
  console.log("  ✔ 'convert svg to json from .tzQn0o' parsed:", fp5.steps[0]);

  const fp6 = fastPath("watch data from .tzQn0o every 1s");
  assert(fp6, "fastPath should parse watch interval command");
  assert.strictEqual(fp6.steps[0].tool, "watch_iframe_data");
  assert.strictEqual(fp6.steps[0].args.target, ".tzQn0o");
  assert.strictEqual(fp6.steps[0].args.interval, 1000);
  console.log("  ✔ 'watch data from .tzQn0o every 1s' parsed:", fp6.steps[0]);

  const fp7 = fastPath("stop interval");
  assert(fp7, "fastPath should parse 'stop interval'");
  assert.strictEqual(fp7.steps[0].tool, "stop_interval");
  console.log("  ✔ 'stop interval' parsed:", fp7.steps[0]);

  assert(isBrowserActionText("get data from .tzQn0o"), "isBrowserActionText should match .tzQn0o command");
  assert(isBrowserActionText("watch data from .tzQn0o"), "isBrowserActionText should match watch command");

  // --------------------------------------------------------
  // 2. Test CommandRouter
  // --------------------------------------------------------
  console.log("\n[2] Testing CommandRouter classification...");
  const router = new CommandRouter();
  const route1 = await router.route("get data from .tzQn0o");
  assert.strictEqual(route1.mode, "action", "Router should classify as action");
  console.log("  ✔ Router classified 'get data from .tzQn0o' as:", route1.mode);

  const route2 = await router.route("watch data from .tzQn0o");
  assert.strictEqual(route2.mode, "action", "Router should classify watch as action");
  console.log("  ✔ Router classified 'watch data from .tzQn0o' as:", route2.mode);

  // --------------------------------------------------------
  // 3. Test ActionMap
  // --------------------------------------------------------
  console.log("\n[3] Testing ActionMap...");
  const action1 = mapAction("get data from .tzQn0o");
  assert(action1, "ActionMap should match 'get data from .tzQn0o'");
  assert.strictEqual(action1.type, ACTION_TYPES.GET_IFRAME_DATA);
  console.log("  ✔ ActionMap matched 'get data from .tzQn0o' to:", action1.type);

  const action2 = mapAction("watch data from .tzQn0o");
  assert(action2, "ActionMap should match 'watch data from .tzQn0o'");
  assert.strictEqual(action2.type, ACTION_TYPES.WATCH_IFRAME_DATA);
  console.log("  ✔ ActionMap matched 'watch data from .tzQn0o' to:", action2.type);

  // --------------------------------------------------------
  // 4. Test ToolMap Execution
  // --------------------------------------------------------
  console.log("\n[4] Testing ToolMap execution...");
  const mockResolver = {
    getIframeContainerData: async (target, opts) => ({
      success: true,
      target,
      totalSVGs: 1,
      frames: [{ frameUrl: "https://casino.game/iframe", containers: [{ className: "tzQn0o", svgs: [{ id: "wheel-svg" }] }] }],
      opts,
    }),
  };
  const toolMap = new ToolMap(mockResolver);
  const res1 = await toolMap.execute({
    tool: "get_iframe_data",
    args: { target: ".tzQn0o" },
  });
  assert(res1.success);
  assert.strictEqual(res1.result.target, ".tzQn0o");
  console.log("  ✔ ToolMap executed 'get_iframe_data':", res1.result);

  const res2 = await toolMap.execute({
    tool: "watch_iframe_data",
    args: { target: ".tzQn0o", interval: 1500 },
  });
  assert(res2.success);
  assert(res2.result.isIntervalWatch);
  assert.strictEqual(res2.result.intervalMs, 1500);
  console.log("  ✔ ToolMap executed 'watch_iframe_data':", res2.result.message);

  // --------------------------------------------------------
  // 5. Test Real Playwright Extraction & SVG to JSON
  // --------------------------------------------------------
  console.log("\n[5] Testing real Playwright extraction from iframe with parent class '.tzQn0o'...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // HTML content simulating dynamic live casino iframe with class .tzQn0o
  const iframeHTML = `
    <!DOCTYPE html>
    <html>
      <head><title>Live Game Table</title></head>
      <body>
        <!-- Parent container with class tzQn0o -->
        <div class="tzQn0o live-roulette-container" data-game-type="roulette" data-round="74839">
          <div class="game-status">
            <span class="timer">14s</span>
            <span class="state">PLACE YOUR BETS</span>
          </div>

          <!-- Dynamic SVG Roulette Wheel & Graphics -->
          <div class="wheel-box">
            <svg id="roulette-wheel" class="wheel-svg" viewBox="0 0 500 500" width="500" height="500">
              <g id="wheel-rotor" transform="rotate(78.5, 250, 250)">
                <circle cx="250" cy="250" r="240" fill="#111111" stroke="#d4af37" stroke-width="4"></circle>
                <path id="pocket-0" d="M250 250 L250 10 A240 240 0 0 1 290 13 Z" fill="#008000" data-number="0" aria-label="Zero Green"></path>
                <path id="pocket-32" d="M250 250 L290 13 A240 240 0 0 1 330 24 Z" fill="#e74c3c" data-number="32" aria-label="32 Red"></path>
                <path id="pocket-15" d="M250 250 L330 24 A240 240 0 0 1 368 41 Z" fill="#2c3e50" data-number="15" aria-label="15 Black"></path>
                <text x="250" y="50" fill="#ffffff" font-size="18" text-anchor="middle">32 RED</text>
              </g>
              <g id="pointer">
                <polygon points="250,0 240,25 260,25" fill="#f1c40f"></polygon>
              </g>
            </svg>

            <!-- Multiplier badge SVG -->
            <svg id="multiplier-badge" viewBox="0 0 120 120" width="120" height="120">
              <rect x="10" y="10" width="100" height="100" rx="15" fill="#ff6c2f" stroke="#fff" stroke-width="2"></rect>
              <text x="60" y="70" fill="#fff" font-size="28" font-weight="bold" text-anchor="middle">500x</text>
            </svg>
          </div>

          <!-- Controls -->
          <div class="chips">
            <button id="chip-25" class="chip" value="25">25</button>
            <button id="chip-100" class="chip" value="100">100</button>
            <button id="chip-500" class="chip" value="500">500</button>
            <input type="text" id="bet-input" value="100" />
          </div>
        </div>
      </body>
    </html>
  `;

  const mainHTML = `
    <!DOCTYPE html>
    <html>
      <head><title>Casino Main Portal</title></head>
      <body>
        <h1>Casino Live Portal</h1>
        <iframe id="table-iframe" name="roulette-frame" srcdoc="${iframeHTML.replace(/"/g, "&quot;")}"></iframe>
      </body>
    </html>
  `;

  await page.setContent(mainHTML);
  await page.waitForTimeout(500);

  // A. Test getIframeContainerData for ".tzQn0o"
  console.log("\n[A] Testing getIframeContainerData for '.tzQn0o'...");
  const dataFromDotClass = await getIframeContainerData(page, ".tzQn0o", { onlyIframes: true });
  assert(dataFromDotClass.success, "Extraction for '.tzQn0o' should succeed");
  assert.strictEqual(dataFromDotClass.totalContainers, 1, "Should find 1 container for '.tzQn0o'");
  assert.strictEqual(dataFromDotClass.totalSVGs, 2, "Container should have 2 SVGs");

  const container = dataFromDotClass.frames[0].containers[0];
  console.log("  ✔ Container extracted successfully:");
  console.log("    - Tag:", container.tagName);
  console.log("    - Class:", container.className);
  console.log("    - Dataset:", container.dataset);
  console.log("    - SVG Count:", container.svgCount);
  console.log("    - Buttons count:", container.buttons?.length);

  assert.strictEqual(container.tagName, "div");
  assert(container.className.includes("tzQn0o"));
  assert.strictEqual(container.dataset.gameType, "roulette");
  assert.strictEqual(container.svgCount, 2);

  // B. Verify SVG to JSON Conversion Details
  console.log("\n[B] Verifying SVG-to-JSON structure...");
  const wheelSvg = container.svgs[0];
  console.log("  ✔ First SVG (Wheel):");
  console.log("    - ID:", wheelSvg.id);
  console.log("    - ViewBox:", wheelSvg.viewBox);
  console.log("    - Width x Height:", wheelSvg.width, "x", wheelSvg.height);
  console.log("    - Paths count:", wheelSvg.pathCount);
  console.log("    - Path 0 d:", wheelSvg.paths[0].d);
  console.log("    - Path 0 fill:", wheelSvg.paths[0].fill);
  console.log("    - Shapes count:", wheelSvg.shapeCount);
  console.log("    - Group count:", wheelSvg.groupCount);
  console.log("    - Dynamic numbers extracted:", wheelSvg.dynamicValues.numbers);
  console.log("    - Parsed rotation angle:", wheelSvg.dynamicValues.rotationAngle);
  console.log("    - Timestamp:", wheelSvg.timestamp);

  assert.strictEqual(wheelSvg.id, "roulette-wheel");
  assert.strictEqual(wheelSvg.pathCount, 3);
  assert.strictEqual(wheelSvg.shapeCount, 2); // circle + polygon
  assert.strictEqual(wheelSvg.groupCount, 2); // rotor + pointer
  assert.strictEqual(wheelSvg.dynamicValues.rotationAngle, 78.5);
  assert(wheelSvg.dynamicValues.numbers.includes("32"));
  assert(wheelSvg.timestamp);

  const badgeSvg = container.svgs[1];
  console.log("  ✔ Second SVG (Multiplier Badge):");
  console.log("    - ID:", badgeSvg.id);
  console.log("    - Shapes:", badgeSvg.shapes.map((s) => s.tagName));
  console.log("    - Text:", badgeSvg.text);
  console.log("    - Dynamic numbers:", badgeSvg.dynamicValues.numbers);

  assert.strictEqual(badgeSvg.id, "multiplier-badge");
  assert(badgeSvg.text.includes("500x"));
  assert(badgeSvg.dynamicValues.numbers.includes("500x"));

  // C. Test convertSVGToJSON helper
  console.log("\n[C] Testing convertSVGToJSON helper...");
  const converted = convertSVGToJSON(wheelSvg);
  assert.strictEqual(converted.id, "roulette-wheel");
  assert.strictEqual(converted.pathCount, 3);
  assert.strictEqual(converted.dynamicValues.rotationAngle, 78.5);
  console.log("  ✔ convertSVGToJSON formatted JSON perfectly:", {
    id: converted.id,
    viewBox: converted.viewBox,
    pathCount: converted.pathCount,
    shapeCount: converted.shapeCount,
    angle: converted.dynamicValues.rotationAngle,
    timestamp: converted.timestamp,
  });

  // D. Test getIframeContainerData without leading dot ("tzQn0o")
  console.log("\n[D] Testing getIframeContainerData for 'tzQn0o' (without leading dot)...");
  const dataNoDot = await getIframeContainerData(page, "tzQn0o", { onlyIframes: true });
  assert(dataNoDot.success);
  assert.strictEqual(dataNoDot.totalContainers, 1);
  console.log("  ✔ Extraction with 'tzQn0o' matched 1 container with 2 SVGs!");

  // E. Simulate Dynamic SVG value change over interval
  console.log("\n[E] Simulating dynamic SVG change across intervals...");
  const frame = page.frames().find((f) => f !== page.mainFrame());

  // Mutate DOM inside iframe to simulate rotating wheel & updated round/multiplier
  await frame.evaluate(() => {
    const rotor = document.getElementById("wheel-rotor");
    if (rotor) rotor.setAttribute("transform", "rotate(145.2, 250, 250)");

    const text = rotor?.querySelector("text");
    if (text) text.textContent = "15 BLACK";

    const badgeText = document.querySelector("#multiplier-badge text");
    if (badgeText) badgeText.textContent = "1000x";
  });

  // Re-fetch data on next interval tick
  const updatedData = await getIframeContainerData(page, ".tzQn0o", { onlyIframes: true });
  const updatedWheel = updatedData.frames[0].containers[0].svgs[0];
  const updatedBadge = updatedData.frames[0].containers[0].svgs[1];

  console.log("  ✔ Interval tick captured dynamic SVG value updates:");
  console.log("    - New Rotation Angle:", updatedWheel.dynamicValues.rotationAngle);
  console.log("    - New Wheel Text:", updatedWheel.text);
  console.log("    - New Multiplier Text:", updatedBadge.text);

  assert.strictEqual(updatedWheel.dynamicValues.rotationAngle, 145.2, "Rotation angle should update to 145.2°");
  assert(updatedWheel.text.includes("15 BLACK"), "Wheel text should update to '15 BLACK'");
  assert(updatedBadge.text.includes("1000x"), "Multiplier badge should update to '1000x'");

  await browser.close();

  console.log("\n==========================================================");
  console.log("ALL .tzQn0o SVG TO JSON & INTERVAL TESTS PASSED 100%! 🚀🎉");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
