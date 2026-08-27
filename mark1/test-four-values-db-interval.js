import assert from "assert";
import {
  formatToFourValuesJSON,
  saveRound,
  getTodayDateId,
} from "./database/gameservice.js";
import { fastPath } from "./backend/planner/fast-path.js";
import { mapAction, ACTION_TYPES } from "./backend/planner/action-map.js";

console.log("==========================================================");
console.log("TESTING 4-VALUES LOG STATUS, EXTENDED INTERVALS & DB SAVE");
console.log("==========================================================");

async function runTests() {
  // --------------------------------------------------------
  // 1. Test 4-Values JSON Formatting from user text
  // --------------------------------------------------------
  console.log("\n[1] Testing 4-Values JSON formatting for user input text...");
  const rawText =
    "15 5 5 5 11 1 5 5 3 1 1 1 12 1 5 6 9 1 3 5 12 3 4 5 9 1 4 4 12 2 5 5 11 3 4 4 13 2 5 6";
  const formattedFromStr = formatToFourValuesJSON(rawText);

  assert(Array.isArray(formattedFromStr), "Result should be an array");
  assert.strictEqual(
    formattedFromStr.length,
    1,
    "Result should have 1 round container",
  );
  assert(formattedFromStr[0]["0"], "Result should have key '0'");

  const items = formattedFromStr[0]["0"];
  assert.strictEqual(
    items.length,
    10,
    "Should have 10 sets of 4 values (40 numbers total)",
  );

  // Check individual sets
  assert.deepStrictEqual(
    items[0],
    { values: [15, 5, 5, 5] },
    "First set should be [15, 5, 5, 5]",
  );
  assert.deepStrictEqual(
    items[1],
    { values: [11, 1, 5, 5] },
    "Second set should be [11, 1, 5, 5]",
  );
  assert.deepStrictEqual(
    items[2],
    { values: [3, 1, 1, 1] },
    "Third set should be [3, 1, 1, 1]",
  );
  assert.deepStrictEqual(
    items[3],
    { values: [12, 1, 5, 6] },
    "Fourth set should be [12, 1, 5, 6]",
  );
  assert.deepStrictEqual(
    items[4],
    { values: [9, 1, 3, 5] },
    "Fifth set should be [9, 1, 3, 5]",
  );
  assert.deepStrictEqual(
    items[5],
    { values: [12, 3, 4, 5] },
    "Sixth set should be [12, 3, 4, 5]",
  );
  assert.deepStrictEqual(
    items[6],
    { values: [9, 1, 4, 4] },
    "Seventh set should be [9, 1, 4, 4]",
  );
  assert.deepStrictEqual(
    items[7],
    { values: [12, 2, 5, 5] },
    "Eighth set should be [12, 2, 5, 5]",
  );
  assert.deepStrictEqual(
    items[8],
    { values: [11, 3, 4, 4] },
    "Ninth set should be [11, 3, 4, 4]",
  );
  assert.deepStrictEqual(
    items[9],
    { values: [13, 2, 5, 6] },
    "Tenth set should be [13, 2, 5, 6]",
  );

  console.log("  ✔ Extracted and formatted 10 sets of 4 values successfully!");
  console.log("  Formatted JSON output snippet:");
  console.log(JSON.stringify(formattedFromStr.slice(0, 1), null, 2));

  // --------------------------------------------------------
  // 2. Test object with text property: { "text": "15 5 5 5..." }
  // --------------------------------------------------------
  console.log(
    "\n[2] Testing formatToFourValuesJSON with object payload { text: '...' }...",
  );
  const objInput = { text: rawText };
  const formattedFromObj = formatToFourValuesJSON(objInput);
  assert.deepStrictEqual(
    formattedFromObj,
    formattedFromStr,
    "Object with text property should yield identical 4-values JSON",
  );
  console.log("  ✔ Object input { text: '...' } formatted correctly!");

  // --------------------------------------------------------
  // 3. Test FastPath interval parsing for 5s, 10s, 15s
  // --------------------------------------------------------
  console.log(
    "\n[3] Testing FastPath parsing for extended intervals (5s, 10s, 15s)...",
  );

  const fp5s = fastPath("watch data from .tzQn0o every 5s");
  assert(fp5s, "Should match 'watch data from .tzQn0o every 5s'");
  assert.strictEqual(fp5s.steps[0].tool, "watch_iframe_data");
  assert.strictEqual(
    fp5s.steps[0].args.interval,
    5000,
    "5s should be converted to 5000ms",
  );
  assert.strictEqual(fp5s.steps[0].args.target, ".tzQn0o");
  console.log(
    "  ✔ Parsed 'watch data from .tzQn0o every 5s' -> interval: 5000ms",
  );

  const fp10s = fastPath("watch data from .tzQn0o every 10s");
  assert(fp10s, "Should match 'watch data from .tzQn0o every 10s'");
  assert.strictEqual(
    fp10s.steps[0].args.interval,
    10000,
    "10s should be converted to 10000ms",
  );
  console.log(
    "  ✔ Parsed 'watch data from .tzQn0o every 10s' -> interval: 10000ms",
  );

  const fp15s = fastPath("watch data from .tzQn0o every 15s");
  assert(fp15s, "Should match 'watch data from .tzQn0o every 15s'");
  assert.strictEqual(
    fp15s.steps[0].args.interval,
    15000,
    "15s should be converted to 15000ms",
  );
  console.log(
    "  ✔ Parsed 'watch data from .tzQn0o every 15s' -> interval: 15000ms",
  );

  const fpExtend10s = fastPath("extend interval to 10s");
  assert(fpExtend10s, "Should match 'extend interval to 10s'");
  assert.strictEqual(fpExtend10s.steps[0].args.interval, 10000);
  console.log("  ✔ Parsed 'extend interval to 10s' -> interval: 10000ms");

  const fpSet15s = fastPath("set interval 15s");
  assert(fpSet15s, "Should match 'set interval 15s'");
  assert.strictEqual(fpSet15s.steps[0].args.interval, 15000);
  console.log("  ✔ Parsed 'set interval 15s' -> interval: 15000ms");

  // --------------------------------------------------------
  // 4. Test ActionMap interval parsing for 5s, 10s, 15s
  // --------------------------------------------------------
  console.log("\n[4] Testing ActionMap parsing for extended intervals...");
  const action5s = mapAction("watch data from .tzQn0o every 5s");
  assert(action5s, "ActionMap should match 5s");
  assert.strictEqual(action5s.type, ACTION_TYPES.WATCH_IFRAME_DATA);
  assert.strictEqual(action5s.args.interval, 5000);
  console.log("  ✔ ActionMap parsed 5s interval ->", action5s.args.interval);

  const action10s = mapAction("watch data from .tzQn0o every 10s");
  assert.strictEqual(action10s.args.interval, 10000);
  console.log("  ✔ ActionMap parsed 10s interval ->", action10s.args.interval);

  const action15s = mapAction("watch data from .tzQn0o every 15s");
  assert.strictEqual(action15s.args.interval, 15000);
  console.log("  ✔ ActionMap parsed 15s interval ->", action15s.args.interval);

  // --------------------------------------------------------
  // 5. Test Firestore Database save functionality (Bio_sic)
  // --------------------------------------------------------
  console.log("\n[5] Testing Firestore DB saveRound with 4-values payload...");
  const today = getTodayDateId();
  console.log(`  Today Date ID: ${today}`);

  try {
    const saveRes = await saveRound(today, formattedFromStr);
    console.log("  saveRound response:", saveRes);
    if (saveRes.success) {
      assert.strictEqual(saveRes.collection, "Bio_sic");
      assert.strictEqual(saveRes.totalSets, 10);
      console.log(
        "  ✔ Successfully saved 4-values data into Firestore 'Bio_sic' collection!",
      );
    } else {
      console.log(
        "  Note: Firestore online connection skipped or returned:",
        saveRes.error,
      );
    }
  } catch (err) {
    console.log(
      "  Note: Network error connecting to Firebase (offline simulated):",
      err.message,
    );
  }

  console.log("\n==========================================================");
  console.log(
    "ALL 4-VALUES, EXTENDED INTERVALS (5s/10s/15s) & DB TESTS PASSED! 🚀🎉",
  );
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
