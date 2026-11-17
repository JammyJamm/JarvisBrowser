import assert from "assert";
import { chromium } from "playwright";
import {
  getFrameSVGs,
  getFrameContainerData,
  getIframeContainerData,
  getSVGDataFromIframe,
} from "./utils/iframeContent.js";
import { fastPath } from "./planner/fast-path.js";
import ToolMap from "./tool-map.js";

async function testParentClassExtraction() {
  console.log("==========================================");
  console.log("TESTING DATA EXTRACTION FOR PARENT CLASS 'dGBOyn'");
  console.log("==========================================");

  // 1. Test fastPath command parsing
  console.log("\n[1] Testing fast-path parsing for user command...");
  const fp1 = fastPath("get data from parent class 'dGBOyn' inside the iframe");
  assert(fp1, "fastPath should parse parent class data command");
  assert.strictEqual(fp1.steps[0].tool, "get_iframe_data");
  assert.strictEqual(fp1.steps[0].args.target, "dGBOyn");
  assert.strictEqual(fp1.steps[0].args.onlyIframes, true);
  console.log("  ✔ Parsed:", fp1.steps[0]);

  const fp2 = fastPath("get svg from parent class dGBOyn inside iframe");
  assert(fp2, "fastPath should parse parent class svg command");
  assert.strictEqual(fp2.steps[0].tool, "get_iframe_svg");
  assert.strictEqual(fp2.steps[0].args.parentClass, "dGBOyn");
  console.log("  ✔ Parsed SVG command:", fp2.steps[0]);

  // 2. Test ToolMap execution
  console.log("\n[2] Testing ToolMap execution...");
  const mockResolver = {
    getIframeContainerData: async (target, opts) => ({
      success: true,
      target,
      opts,
    }),
  };
  const toolMap = new ToolMap(mockResolver);
  const res = await toolMap.execute({
    tool: "get_iframe_data",
    args: { target: "dGBOyn" },
  });
  assert(res.success);
  assert.strictEqual(res.result.target, "dGBOyn");
  console.log("  ✔ ToolMap executed 'get_iframe_data':", res.result);

  // 3. Test Real Playwright iframe with parent class .dGBOyn
  console.log("\n[3] Testing real Playwright extraction from iframe with class 'dGBOyn'...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // HTML content inside iframe simulating casino game container
  const iframeHTML = `
    <!DOCTYPE html>
    <html>
      <head><title>Evolution Game Frame</title></head>
      <body>
        <div class="header">Game Header</div>
        
        <!-- Parent container with class dGBOyn -->
        <div class="sc-casino-component dGBOyn custom-theme" data-testid="roulette-table" data-game-id="evo-roulette-1">
          <div class="title-bar">
            <h3>Lightning Roulette</h3>
            <span class="status active">OPEN FOR BETS</span>
          </div>

          <!-- SVGs inside dGBOyn -->
          <div class="wheel-area">
            <svg id="roulette-svg" class="wheel-graphic" viewBox="0 0 500 500" width="500" height="500" aria-label="Roulette Wheel">
              <circle cx="250" cy="250" r="230" fill="#1a1a1a" stroke="#d4af37" stroke-width="6"></circle>
              <path id="pocket-0" d="M250 250 L250 20 A230 230 0 0 1 289 23 Z" fill="#27ae60" data-number="0" aria-label="Zero"></path>
              <path id="pocket-32" d="M250 250 L289 23 A230 230 0 0 1 327 33 Z" fill="#c0392b" data-number="32" aria-label="Number 32 Red"></path>
              <text x="250" y="255" fill="#ffffff" font-size="22" text-anchor="middle">24 BLACK</text>
            </svg>
            <svg id="multiplier-badge" viewBox="0 0 100 100" width="100" height="100">
              <polygon points="50,5 90,95 10,95" fill="#f39c12"></polygon>
              <text x="50" y="70" fill="#000" font-size="20">500x</text>
            </svg>
          </div>

          <!-- Controls inside dGBOyn -->
          <div class="betting-controls">
            <button class="chip-btn" id="chip-10" aria-label="10 Chip" value="10">10</button>
            <button class="chip-btn" id="chip-100" aria-label="100 Chip" value="100">100</button>
            <button class="chip-btn" id="chip-500" aria-label="500 Chip" value="500">500</button>
            <button class="action-btn spin-btn" id="double-btn">DOUBLE</button>
            <input type="text" id="custom-bet" placeholder="Custom Bet" value="250" />
          </div>

          <div class="footer-info">
            <span class="balance">Balance: $5,420.00</span>
            <span class="total-bet">Total Bet: $150.00</span>
          </div>
        </div>

        <div class="other-container">
          <p>Unrelated footer content</p>
        </div>
      </body>
    </html>
  `;

  const mainHTML = `
    <!DOCTYPE html>
    <html>
      <head><title>Casino Portal</title></head>
      <body>
        <h1>Live Casino Main Page</h1>
        <iframe id="game-iframe" name="evolution-frame" srcdoc="${iframeHTML.replace(/"/g, '&quot;')}"></iframe>
      </body>
    </html>
  `;

  await page.setContent(mainHTML);
  await page.waitForTimeout(500);

  // A. Test getIframeContainerData for "dGBOyn"
  console.log("\n[A] Testing getIframeContainerData for 'dGBOyn'...");
  const containerData = await getIframeContainerData(page, "dGBOyn", { onlyIframes: true });
  
  assert(containerData.success, "Should succeed in finding container");
  assert.strictEqual(containerData.totalContainers, 1, "Should find 1 container matching dGBOyn");
  assert.strictEqual(containerData.totalSVGs, 2, "Container dGBOyn should contain 2 SVGs");

  const c = containerData.frames[0].containers[0];
  console.log("  ✔ Found container:");
  console.log("    - Tag:", c.tagName);
  console.log("    - Class:", c.className);
  console.log("    - Data attributes:", c.dataset);
  console.log("    - Text snippet:", c.text.substring(0, 100) + "...");
  console.log("    - SVG count inside container:", c.svgCount);
  console.log("    - Buttons inside container:", c.buttons?.map(b => b.text || b.id));
  console.log("    - Inputs inside container:", c.inputs);
  console.log("    - BoundingBox:", c.boundingBox);

  assert.strictEqual(c.tagName, "div");
  assert(c.className.includes("dGBOyn"));
  assert.strictEqual(c.dataset.gameId, "evo-roulette-1");
  assert(c.text.includes("Lightning Roulette"));
  assert(c.text.includes("Balance: $5,420.00"));
  assert.strictEqual(c.svgCount, 2);
  assert.strictEqual(c.svgs[0].id, "roulette-svg");
  assert.strictEqual(c.svgs[0].paths.length, 2);
  assert.strictEqual(c.buttons.length, 4);
  assert.strictEqual(c.inputs.length, 1);
  assert.strictEqual(c.inputs[0].value, "250");

  // B. Test getSVGDataFromIframe with parentClass: "dGBOyn"
  console.log("\n[B] Testing getSVGDataFromIframe with parentClass: 'dGBOyn'...");
  const svgFromClass = await getSVGDataFromIframe(page, { parentClass: "dGBOyn", onlyIframes: true });
  assert(svgFromClass.success);
  assert.strictEqual(svgFromClass.totalSVGs, 2);
  assert.strictEqual(svgFromClass.frames[0].svgs[0].id, "roulette-svg");
  console.log("  ✔ getSVGDataFromIframe extracted", svgFromClass.totalSVGs, "SVGs specifically from parent class 'dGBOyn'!");

  // C. Test getFrameSVGs directly with selector: ".dGBOyn"
  console.log("\n[C] Testing getFrameSVGs with selector: '.dGBOyn'...");
  const frame = page.frames().find(f => f !== page.mainFrame());
  const svgs = await getFrameSVGs(frame, { selector: ".dGBOyn" });
  assert.strictEqual(svgs.length, 2, "Should find 2 SVGs inside .dGBOyn container");
  console.log("  ✔ getFrameSVGs automatically resolved container selector to its child SVGs!");

  await browser.close();

  console.log("\n==========================================");
  console.log("PARENT CLASS 'dGBOyn' TESTS PASSED 100%! 🎉");
  console.log("==========================================");
}

testParentClassExtraction().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
