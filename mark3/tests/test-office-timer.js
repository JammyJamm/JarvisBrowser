// tests/test-office-timer.js
import assert from "assert";
import { createRequire } from "module";
import {
  getOfficeTimerConfig,
  saveOfficeTimerConfig,
  saveOfficeAttendance,
  getOfficeAttendance,
  getOfficeAttendanceRange,
  computeAttendanceStatus,
  formatHoursMinutes,
  normalizeTargetMinutes,
  normalizeAttendanceRecord,
} from "../database/officeTimerService.js";
import db from "../database/firebaseConfig.js";
import { doc, deleteDoc } from "firebase/firestore";

const require = createRequire(import.meta.url);
const {
  parseNetshWlanOutput,
  detectCurrentNetwork,
  matchesOfficeNetwork,
} = require("../main/network-monitor.js");

async function runTests() {
  console.log("1. Testing netsh parser & office network matching...");
  const sampleNetsh = `
There is 1 interface on the system:
    Name                   : Wi-Fi
    State                  : connected
    SSID                   : CS-B5F-AP
    AP BSSID               : 80:80:2c:98:80:f8
    Profile                : CS-B5F-AP
`;
  const parsed = parseNetshWlanOutput(sampleNetsh);
  assert.strictEqual(parsed.connected, true);
  assert.strictEqual(parsed.ssid, "CS-B5F-AP");
  assert.strictEqual(matchesOfficeNetwork(parsed, ["CS-B5F-AP"]), true);
  assert.strictEqual(matchesOfficeNetwork(parsed, ["cs-b5f-ap"]), true);
  assert.strictEqual(matchesOfficeNetwork(parsed, ["Home-WiFi"]), false);
  assert.strictEqual(
    matchesOfficeNetwork({ connected: false, name: "CS-B5F-AP" }, ["CS-B5F-AP"]),
    false,
  );
  console.log("   ✔ Network parser and matching passed");

  console.log("2. Testing live current network detection...");
  const currentNet = await detectCurrentNetwork();
  console.log("   Detected network:", currentNet.name || "(none)", "| connected:", currentNet.connected);
  assert.strictEqual(typeof currentNet.connected, "boolean");

  console.log("3. Testing 8h30m / 7h target calculations...");
  assert.strictEqual(normalizeTargetMinutes(510), 510);
  assert.strictEqual(normalizeTargetMinutes(420), 420);
  assert.strictEqual(normalizeTargetMinutes(999), 510);
  assert.strictEqual(computeAttendanceStatus(510 * 60, 510), "completed");
  assert.strictEqual(computeAttendanceStatus(420 * 60, 420), "completed");
  assert.strictEqual(computeAttendanceStatus(300 * 60, 510), "in_progress");
  assert.strictEqual(computeAttendanceStatus(0, 510), "not_started");
  assert.strictEqual(formatHoursMinutes(510 * 60), "8h 30m");
  assert.strictEqual(formatHoursMinutes(420 * 60), "7h 00m");
  const activeRecord = normalizeAttendanceRecord("2026-11-26", {
    targetMinutes: 510,
    elapsedSeconds: 120,
    sessions: [{
      network: "CS-B5F-AP",
      start: "2026-11-26T04:00:00.000Z",
      end: "2026-11-26T04:02:00.000Z",
      durationSeconds: 120,
      active: true,
    }],
  });
  assert.strictEqual(activeRecord.sessions[0].active, true);
  console.log("   ✔ Target & duration helpers passed");

  console.log("4. Testing Firebase Firestore office_timer_config & office_attendance...");
  const notedNetworks =
    currentNet.connected && currentNet.identifiers?.length
      ? currentNet.identifiers
      : ["CS-B5F-AP"];
  const saveCfgRes = await saveOfficeTimerConfig({
    officeNetworks: notedNetworks,
    defaultTargetMinutes: 510,
    autoStartOnOfficeNetwork: true,
  });
  assert.strictEqual(saveCfgRes.success, true, `Config save failed: ${saveCfgRes.error}`);

  const readCfgRes = await getOfficeTimerConfig();
  assert.strictEqual(readCfgRes.success, true);
  assert.strictEqual(readCfgRes.exists, true);
  assert.deepStrictEqual(readCfgRes.config.officeNetworks, notedNetworks);
  assert.strictEqual(readCfgRes.config.defaultTargetMinutes, 510);
  console.log("   ✔ Firebase office_timer_config/settings saved & verified:", readCfgRes.config.officeNetworks);

  const testDate = "2099-12-31";
  const saveAttRes = await saveOfficeAttendance(testDate, {
    targetMinutes: 420,
    elapsedSeconds: 420 * 60,
    networkName: notedNetworks[0],
    firstCheckIn: "09:30",
    lastCheckOut: "16:30",
    sessions: [
      {
        network: notedNetworks[0],
        start: "2099-12-31T04:00:00.000Z",
        end: "2099-12-31T11:00:00.000Z",
        durationSeconds: 420 * 60,
      },
    ],
  });
  assert.strictEqual(saveAttRes.success, true, `Attendance save failed: ${saveAttRes.error}`);

  const readAttRes = await getOfficeAttendance(testDate);
  assert.strictEqual(readAttRes.success, true);
  assert.strictEqual(readAttRes.exists, true);
  assert.strictEqual(readAttRes.record.targetMinutes, 420);
  assert.strictEqual(readAttRes.record.status, "completed");

  const rangeRes = await getOfficeAttendanceRange("2099-12-01", "2099-12-31");
  assert.strictEqual(rangeRes.success, true);
  assert.ok(rangeRes.records[testDate], "Range query should include test date");

  // Clean up synthetic test attendance record
  await deleteDoc(doc(db, "office_attendance", testDate));
  console.log("   ✔ Firebase office_attendance read/write/range & cleanup passed");

  console.log("\nALL OFFICE TIMER TESTS PASSED!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
