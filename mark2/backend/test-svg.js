import assert from "assert";
import {
  getFrameSVGs,
  getAllSVGsFromFrames,
  getSVGDataFromIframe,
  findFramesWithSVGs,
  getSVGBySelector,
} from "./utils/iframeContent.js";
import { fastPath, isBrowserActionText } from "./planner/fast-path.js";
import CommandRouter from "./command-router.js";
import ToolMap from "./tool-map.js";
import { mapAction, ACTION_TYPES } from "./planner/action-map.js";

console.log("==========================================");
console.log("TESTING SVG EXTRACTION & IFRAME UTILITIES");
console.log("==========================================");

async function runTests() {
  // 1. Test fastPath
  console.log("\n[1] Testing fastPath SVG recognition...");
  const fp1 = fastPath("get svg from iframe");
  assert(fp1, "fastPath should parse 'get svg from iframe'");
  assert.strictEqual(fp1.steps[0].tool, "get_iframe_svg");
  assert.strictEqual(fp1.steps[0].args.onlyIframes, true);
  console.log("  ✔ 'get svg from iframe' parsed to:", fp1.steps[0]);

  const fp2 = fastPath("extract svg from iframe https://game.example.com");
  assert(fp2, "fastPath should parse targeted iframe svg");
  assert.strictEqual(fp2.steps[0].tool, "get_iframe_svg");
  assert.strictEqual(fp2.steps[0].args.frameUrl, "https://game.example.com");
  console.log("  ✔ 'extract svg from iframe ...' parsed to:", fp2.steps[0]);

  const fp3 = fastPath("get all svg");
  assert(fp3, "fastPath should parse 'get all svg'");
  assert.strictEqual(fp3.steps[0].tool, "get_svg");
  console.log("  ✔ 'get all svg' parsed to:", fp3.steps[0]);

  assert(isBrowserActionText("get svg from iframe"), "isBrowserActionText should match svg command");
  assert(isBrowserActionText("extract svg data from iframe"), "isBrowserActionText should match svg data");

  // 2. Test CommandRouter
  console.log("\n[2] Testing CommandRouter classification...");
  const router = new CommandRouter();
  const route1 = await router.route("get svg from iframe");
  assert.strictEqual(route1.mode, "action", "Router should classify 'get svg from iframe' as action");
  console.log("  ✔ Router classified 'get svg from iframe' as:", route1.mode);

  const route2 = await router.route("extract svg data from iframe");
  assert.strictEqual(route2.mode, "action", "Router should classify 'extract svg data from iframe' as action");
  console.log("  ✔ Router classified 'extract svg data from iframe' as:", route2.mode);

  // 3. Test ActionMap
  console.log("\n[3] Testing ActionMap...");
  const action1 = mapAction("get svg from iframe");
  assert(action1, "ActionMap should match 'get svg from iframe'");
  assert.strictEqual(action1.type, ACTION_TYPES.GET_IFRAME_SVG);
  console.log("  ✔ ActionMap matched 'get svg from iframe' to:", action1.type);

  // 4. Test ToolMap
  console.log("\n[4] Testing ToolMap registration...");
  const mockResolver = {
    getSVGs: async (opts) => ({ success: true, tool: "resolver.getSVGs", opts }),
    getIframeSVGs: async (opts) => ({ success: true, tool: "resolver.getIframeSVGs", opts }),
  };
  const toolMap = new ToolMap(mockResolver);

  assert(toolMap.hasTool("get_svg"), "ToolMap should have 'get_svg'");
  assert(toolMap.hasTool("get_iframe_svg"), "ToolMap should have 'get_iframe_svg'");
  assert(toolMap.hasTool("extract_svg"), "ToolMap should have 'extract_svg'");
  assert(toolMap.hasTool("click_svg"), "ToolMap should have 'click_svg'");

  // Test aliases
  assert.strictEqual(toolMap.resolveAlias("svg"), "getsvg");
  assert.strictEqual(toolMap.resolveAlias("iframesvg"), "getiframesvg");
  assert.strictEqual(toolMap.resolveAlias("extract_svg"), "extractsvg");

  const res1 = await toolMap.execute({ tool: "get_iframe_svg", args: { onlyIframes: true } });
  assert(res1.success);
  assert.strictEqual(res1.result.tool, "resolver.getIframeSVGs");
  console.log("  ✔ ToolMap executed 'get_iframe_svg':", res1.result);

  // 5. Test Mock Frame SVG extraction
  console.log("\n[5] Testing mock frame SVG extraction with getFrameSVGs & getSVGDataFromIframe...");
  const mockFrame = {
    url: () => "https://casino.evolution.com/frontend/evo/game",
    name: () => "evo_game_frame",
    parentFrame: () => ({ url: () => "https://casino.evolution.com" }),
    evaluate: async (fn, opts) => {
      // Mock DOM environment returned by evaluate
      return [
        {
          index: 0,
          id: "roulette-wheel",
          className: "wheel-svg active",
          viewBox: "0 0 500 500",
          width: 500,
          height: 500,
          isVisible: true,
          childElementCount: 38,
          boundingBox: { x: 50, y: 100, width: 500, height: 500, top: 100, left: 50, right: 550, bottom: 600 },
          attributes: { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 500 500", class: "wheel-svg active", id: "roulette-wheel" },
          text: "0 32 15 19 4 21 2 25",
          pathCount: 37,
          paths: [
            { index: 0, d: "M250 250 L250 0 A250 250 0 0 1 292 3 Z", fill: "#008000", id: "number-0" },
            { index: 1, d: "M250 250 L292 3 A250 250 0 0 1 333 17 Z", fill: "#ff0000", id: "number-32" },
          ],
          shapeCount: 2,
          shapes: [
            { tagName: "circle", cx: "250", cy: "250", r: "50", fill: "#gold" },
          ],
          outerHTML: '<svg id="roulette-wheel" class="wheel-svg active" viewBox="0 0 500 500">...</svg>',
        },
      ];
    },
  };

  const svgs = await getFrameSVGs(mockFrame, { includePaths: true, includeShapes: true });
  assert.strictEqual(svgs.length, 1);
  assert.strictEqual(svgs[0].id, "roulette-wheel");
  assert.strictEqual(svgs[0].pathCount, 37);
  assert.strictEqual(svgs[0].paths[0].d, "M250 250 L250 0 A250 250 0 0 1 292 3 Z");
  console.log("  ✔ getFrameSVGs successfully extracted SVG with paths and shapes:");
  console.log("    - ID:", svgs[0].id);
  console.log("    - ViewBox:", svgs[0].viewBox);
  console.log("    - Paths count:", svgs[0].pathCount);
  console.log("    - First path d:", svgs[0].paths[0].d);

  const mockMainFrame = {
    url: () => "https://casino.evolution.com",
    name: () => "",
    parentFrame: () => null,
    evaluate: async () => [],
  };

  const mockPage = {
    frames: () => [mockMainFrame, mockFrame],
    mainFrame: () => mockMainFrame,
  };

  const iframeSvgData = await getSVGDataFromIframe(mockPage, { onlyIframes: true });
  assert(iframeSvgData.success);
  assert.strictEqual(iframeSvgData.totalFrames, 2);
  assert.strictEqual(iframeSvgData.matchedFrames, 1);
  assert.strictEqual(iframeSvgData.totalSVGs, 1);
  assert.strictEqual(iframeSvgData.frames[0].frameUrl, "https://casino.evolution.com/frontend/evo/game");
  assert.strictEqual(iframeSvgData.frames[0].svgs[0].id, "roulette-wheel");
  console.log("  ✔ getSVGDataFromIframe successfully extracted from iframe frames:");
  console.log("    - Total Frames:", iframeSvgData.totalFrames);
  console.log("    - Matched Iframe Frames:", iframeSvgData.matchedFrames);
  console.log("    - Total SVGs:", iframeSvgData.totalSVGs);
  console.log("    - Frame URL:", iframeSvgData.frames[0].frameUrl);

  console.log("\n==========================================");
  console.log("ALL TESTS PASSED SUCCESSFULLY! 🚀");
  console.log("==========================================");
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
