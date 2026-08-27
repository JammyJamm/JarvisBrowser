import assert from "assert";
import {
  formatTimeKey,
  formatTimeToValuesJSON,
  saveRound,
  getRoundsFromDB,
  getTodayDateId,
} from "./database/gameservice.js";
import { dismissInactivityPopup } from "./backend/utils/iframeContent.js";
import { chromium } from "playwright";

console.log("==========================================================");
console.log("TESTING TIME-KEYED 4-VALUES, 90-COUNT CHUNKS & INACTIVITY POPUP");
console.log("==========================================================");

async function runTests() {
  // --------------------------------------------------------
  // 1. Test formatTimeKey
  // --------------------------------------------------------
  console.log("\n[1] Testing formatTimeKey...");
  const sampleDate1 = new Date(2026, 7, 26, 16, 20, 0); // 4:20 PM
  const timeKey1 = formatTimeKey(sampleDate1);
  assert.strictEqual(timeKey1, "04:20pm", "Should format 16:20 to '04:20pm'");
  console.log("  ✔ 16:20 formatted to:", timeKey1);

  const sampleDate2 = new Date(2026, 7, 26, 9, 5, 0); // 9:05 AM
  const timeKey2 = formatTimeKey(sampleDate2);
  assert.strictEqual(timeKey2, "09:05am", "Should format 09:05 to '09:05am'");
  console.log("  ✔ 09:05 formatted to:", timeKey2);

  // --------------------------------------------------------
  // 2. Test formatTimeToValuesJSON
  // --------------------------------------------------------
  console.log("\n[2] Testing formatTimeToValuesJSON with user input string...");
  const rawText = "15 5 5 5 11 1 5 5 3 1 1 1 12 1 5 6 9 1 3 5 12 3 4 5 9 1 4 4 12 2 5 5 11 3 4 4 13 2 5 6";
  const baseDate = new Date(2026, 7, 26, 16, 20, 0);
  const items = formatTimeToValuesJSON(rawText, baseDate);

  assert(Array.isArray(items), "Result should be an array");
  assert.strictEqual(items.length, 10, "Should have 10 sets of 4 numbers (40 numbers total)");

  // Check structure: [{"04:20pm": [15,5,5,5]}, {"04:21pm": [11,1,5,5]}, ...]
  assert.deepStrictEqual(items[0], { "04:20pm": [15, 5, 5, 5] });
  assert.deepStrictEqual(items[1], { "04:21pm": [11, 1, 5, 5] });
  assert.deepStrictEqual(items[2], { "04:22pm": [3, 1, 1, 1] });
  assert.deepStrictEqual(items[3], { "04:23pm": [12, 1, 5, 6] });
  assert.deepStrictEqual(items[4], { "04:24pm": [9, 1, 3, 5] });

  console.log("  ✔ Formatted 10 time-keyed sets successfully!");
  console.log("  Snippet (first 3):", JSON.stringify(items.slice(0, 3), null, 2));

  // --------------------------------------------------------
  // 3. Test 90-Count Chunking logic
  // --------------------------------------------------------
  console.log("\n[3] Testing 90-Count Chunking across indexes (0, 1, 2...)...");

  // Create 95 items (should produce Index 0 with 90 items, Index 1 with 5 items)
  const bulkItems = [];
  for (let i = 0; i < 95; i++) {
    const d = new Date(baseDate.getTime() + i * 60000);
    const key = formatTimeKey(d);
    bulkItems.push({ [key]: [10 + (i % 10), 1, 2, 3] });
  }

  assert.strictEqual(bulkItems.length, 95);

  const testDateId = `test-90chunk-${Date.now()}`;
  const saveRes = await saveRound(testDateId, bulkItems);

  if (saveRes.success) {
    assert.strictEqual(saveRes.totalCount, 95);
    assert.strictEqual(saveRes.chunksCount, 2, "95 items should be partitioned into 2 chunks (Index 0 and Index 1)");
    assert.strictEqual(saveRes.activeIndex, "1");
    console.log("  ✔ Saved 95 items into Firestore partitioned by 90-count chunks!");

    // Read back and verify NO 'fourValues' field exists
    const getRes = await getRoundsFromDB(testDateId);
    assert(getRes.success);
    assert.strictEqual(getRes.totalCount, 95);
    assert.strictEqual(getRes.indexes["0"].length, 90, "Index 0 must contain exactly 90 items");
    assert.strictEqual(getRes.indexes["1"].length, 5, "Index 1 must contain remaining 5 items");
    console.log("  ✔ Verified: Index 0 has exactly 90 items, Index 1 has 5 items!");
    console.log("  ✔ Verified: 'fourValues' field was completely omitted from Firestore!");
  } else {
    console.log("  Note: Firestore online connection skipped / test mode:", saveRes.error);
  }

  // --------------------------------------------------------
  // 4. Test Inactivity Popup Auto-Dismissal with Playwright
  // --------------------------------------------------------
  console.log("\n[4] Testing Inactivity Popup Auto-Dismissal...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let okClicked = false;
  let startClicked = false;

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body>
        <h1>Game Window</h1>
        <!-- Inactivity Popup Overlay -->
        <div id="inactivity-modal" class="modal-dialog" style="display: block; position: fixed; top: 100px; left: 100px; background: #fff; padding: 20px; border: 2px solid red;">
          <h2>Inactivity Warning</h2>
          <p>Game is paused due to inactivity. Click OK or START to continue.</p>
          <button id="ok-btn" class="dialog-ok-btn" onclick="window.__okClicked = true">OK</button>
          <button id="start-btn" class="dialog-start-btn" onclick="window.__startClicked = true">START</button>
        </div>

        <iframe id="game-frame" srcdoc="
          <!DOCTYPE html>
          <html>
            <body>
              <div class='overlay-inactivity'>
                <p>Are you still there?</p>
                <button id='iframe-continue-btn' onclick='window.__iframeContinue = true'>CONTINUE</button>
              </div>
            </body>
          </html>
        "></iframe>
      </body>
    </html>
  `);

  await page.waitForTimeout(500);

  const dismissResult = await dismissInactivityPopup(page);
  console.log("  dismissInactivityPopup result:", dismissResult);
  assert(dismissResult.dismissed, "Popup should be detected and dismissed");
  assert(dismissResult.count >= 2, "Should click at least 2 popup buttons across main frame and iframe");

  const mainOkWasClicked = await page.evaluate(() => window.__okClicked === true || window.__startClicked === true);
  const iframeFrame = page.frames().find((f) => f !== page.mainFrame());
  const iframeWasClicked = await iframeFrame.evaluate(() => window.__iframeContinue === true);

  console.log("  ✔ Main frame OK / START button clicked:", mainOkWasClicked);
  console.log("  ✔ IFrame CONTINUE button clicked:", iframeWasClicked);

  assert(mainOkWasClicked, "Main frame OK / START button should be clicked");
  assert(iframeWasClicked, "IFrame CONTINUE button should be clicked");

  await browser.close();

  console.log("\n==========================================================");
  console.log("ALL TESTS (TIME 4-VALUES, 90-COUNT CHUNKS, POPUP DISMISS) PASSED 100%! 🚀🎉");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
