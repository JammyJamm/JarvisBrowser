import assert from "assert";
import { chromium } from "playwright";
import {
  getFrameSVGs,
  getAllSVGsFromFrames,
  getSVGDataFromIframe,
  findFramesWithSVGs,
  getSVGBySelector,
  clickSVGElement,
} from "./utils/iframeContent.js";

async function testPlaywrightExtraction() {
  console.log("==========================================");
  console.log("TESTING REAL PLAYWRIGHT IFRAME SVG EXTRACTION");
  console.log("==========================================");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Load a page with main frame SVG + an iframe with SVG
  const iframeContent = `
    <!DOCTYPE html>
    <html>
      <head><title>Iframe Game</title></head>
      <body>
        <h2>Inside Iframe</h2>
        <svg id="game-wheel" class="spin-wheel active" viewBox="0 0 400 400" width="400" height="400" aria-label="Game Wheel">
          <circle cx="200" cy="200" r="180" fill="#222222" stroke="#gold" stroke-width="4"></circle>
          <path id="segment-1" d="M200 200 L200 20 A180 180 0 0 1 327 73 Z" fill="#e74c3c" aria-label="Red Segment"></path>
          <path id="segment-2" d="M200 200 L327 73 A180 180 0 0 1 380 200 Z" fill="#2ecc71" aria-label="Green Segment"></path>
          <text x="200" y="210" font-size="24" fill="#ffffff" text-anchor="middle">JACKPOT 777</text>
        </svg>
        <svg id="icon-sound" width="32" height="32" viewBox="0 0 24 24">
          <path d="M3 9v6h4l5 5V4L7 9H3z" fill="#ffffff"></path>
        </svg>
      </body>
    </html>
  `;

  const mainHTML = `
    <!DOCTYPE html>
    <html>
      <head><title>Main Casino Page</title></head>
      <body>
        <h1>Main Page Header</h1>
        <svg id="main-logo" width="100" height="40" viewBox="0 0 100 40">
          <rect x="0" y="0" width="100" height="40" fill="#333"></rect>
          <text x="50" y="25" fill="#fff">LOGO</text>
        </svg>
        <iframe id="game-frame" name="game-frame" srcdoc="${iframeContent.replace(/"/g, '&quot;')}"></iframe>
      </body>
    </html>
  `;

  await page.setContent(mainHTML);
  await page.waitForTimeout(500);

  // 1. Test getSVGDataFromIframe
  console.log("\n[1] Testing getSVGDataFromIframe (all iframes)...");
  const iframeData = await getSVGDataFromIframe(page, { onlyIframes: true });
  console.log("Iframe Data:", {
    success: iframeData.success,
    totalFrames: iframeData.totalFrames,
    matchedFrames: iframeData.matchedFrames,
    totalSVGs: iframeData.totalSVGs,
  });

  assert(iframeData.success, "Should succeed");
  assert.strictEqual(iframeData.matchedFrames, 1, "Should match 1 iframe");
  assert.strictEqual(iframeData.totalSVGs, 2, "Iframe should have 2 SVGs");

  const wheelSvg = iframeData.frames[0].svgs.find((s) => s.id === "game-wheel");
  assert(wheelSvg, "Should extract game-wheel SVG");
  assert.strictEqual(wheelSvg.viewBox, "0 0 400 400");
  assert.strictEqual(wheelSvg.pathCount, 2);
  assert.strictEqual(wheelSvg.paths[0].d, "M200 200 L200 20 A180 180 0 0 1 327 73 Z");
  assert.strictEqual(wheelSvg.paths[0].fill, "#e74c3c");
  assert.strictEqual(wheelSvg.shapeCount, 1);
  assert.strictEqual(wheelSvg.shapes[0].tagName, "circle");
  assert.strictEqual(wheelSvg.shapes[0].r, "180");
  assert(wheelSvg.text.includes("JACKPOT 777"));
  assert(wheelSvg.outerHTML.includes("<svg id=\"game-wheel\""));

  console.log("  ✔ Successfully extracted game-wheel SVG from real iframe:");
  console.log("    - ID:", wheelSvg.id);
  console.log("    - Class:", wheelSvg.className);
  console.log("    - Dimensions:", `${wheelSvg.width}x${wheelSvg.height}`);
  console.log("    - BoundingBox:", wheelSvg.boundingBox);
  console.log("    - Paths count:", wheelSvg.pathCount);
  console.log("    - Shapes count:", wheelSvg.shapeCount);
  console.log("    - Text extracted:", wheelSvg.text);
  console.log("    - OuterHTML length:", wheelSvg.outerHTML.length);

  // 2. Test filter by selector
  console.log("\n[2] Testing selector filter '#icon-sound'...");
  const soundSvgData = await getSVGDataFromIframe(page, { selector: "#icon-sound", onlyIframes: true });
  assert.strictEqual(soundSvgData.totalSVGs, 1);
  assert.strictEqual(soundSvgData.frames[0].svgs[0].id, "icon-sound");
  console.log("  ✔ Successfully filtered SVG by selector:", soundSvgData.frames[0].svgs[0].id);

  // 3. Test getAllSVGsFromFrames (including main frame)
  console.log("\n[3] Testing getAllSVGsFromFrames (main frame + iframes)...");
  const allFramesData = await getAllSVGsFromFrames(page, { onlyIframes: false });
  const totalAllSVGs = allFramesData.reduce((sum, f) => sum + f.svgCount, 0);
  assert.strictEqual(totalAllSVGs, 3, "Total SVGs across all frames should be 3 (1 in main + 2 in iframe)");
  console.log("  ✔ Total SVGs across main + iframe frames:", totalAllSVGs);

  // 4. Test clickSVGElement
  console.log("\n[4] Testing clickSVGElement inside iframe...");
  const gameFrame = page.frames().find((f) => f !== page.mainFrame());
  const clickRes = await clickSVGElement(gameFrame, "#segment-1");
  assert(clickRes.success, "Should successfully click SVG path element");
  console.log("  ✔ Click result:", clickRes);

  await browser.close();
  console.log("\n==========================================");
  console.log("REAL PLAYWRIGHT EXTRACTION PASSED 100%! 🎉");
  console.log("==========================================");
}

testPlaywrightExtraction().catch((err) => {
  console.error("Real Playwright test failed:", err);
  process.exit(1);
});
