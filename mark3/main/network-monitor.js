// main/network-monitor.js
const { execFile } = require("child_process");
const os = require("os");

function runCommand(file, args, timeout = 3500) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, stdout: String(stdout || ""), error: error.message });
        return;
      }
      resolve({ ok: true, stdout: String(stdout || "") });
    });
  });
}

function parseNetshWlanOutput(output) {
  if (!output) return null;
  const lines = String(output).split(/\r?\n/);
  const fields = {};

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key && !(key in fields)) {
      fields[key] = val;
    }
  }

  const state = (fields["state"] || "").toLowerCase();
  const ssid = fields["ssid"] || "";
  const profile = fields["profile"] || "";
  const bssid = fields["ap bssid"] || fields["bssid"] || "";
  const signal = fields["signal"] || "";

  if (state === "connected" && (ssid || profile)) {
    const primaryName = ssid || profile;
    const identifiers = Array.from(
      new Set([ssid, profile].map((v) => String(v || "").trim()).filter(Boolean)),
    );
    return {
      connected: true,
      type: "wifi",
      name: primaryName,
      ssid,
      profile,
      bssid,
      signal,
      identifiers,
    };
  }

  return {
    connected: false,
    type: "wifi",
    name: "",
    ssid: "",
    profile: "",
    bssid: "",
    signal: "",
    identifiers: [],
  };
}

function getActiveInterfaceSummary() {
  const ifaces = os.networkInterfaces();
  const active = [];
  for (const [ifaceName, addrs] of Object.entries(ifaces)) {
    if (!Array.isArray(addrs)) continue;
    for (const addr of addrs) {
      if (addr && !addr.internal && addr.family === "IPv4") {
        active.push({
          interfaceName: ifaceName,
          address: addr.address,
          mac: addr.mac || "",
        });
      }
    }
  }
  return active;
}

let cachedWiredProfile = { checkedAt: 0, name: "" };

async function detectWindowsWiredProfileName() {
  const now = Date.now();
  if (now - cachedWiredProfile.checkedAt < 15000) {
    return cachedWiredProfile.name;
  }

  const res = await runCommand(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -First 1 -ExpandProperty Name)",
    ],
    4500,
  );

  const name = res.ok ? res.stdout.trim() : "";
  cachedWiredProfile = { checkedAt: Date.now(), name };
  return name;
}

async function detectCurrentNetwork() {
  const activeIfaces = getActiveInterfaceSummary();

  if (process.platform === "win32") {
    const wlan = await runCommand("netsh", ["wlan", "show", "interfaces"], 3000);
    const parsedWifi = wlan.ok ? parseNetshWlanOutput(wlan.stdout) : null;

    if (parsedWifi && parsedWifi.connected) {
      return {
        ...parsedWifi,
        hasInternetInterface: activeIfaces.length > 0,
        interfaces: activeIfaces,
        detectedAt: Date.now(),
      };
    }

    if (activeIfaces.length > 0) {
      const profileName = await detectWindowsWiredProfileName();
      const fallbackName = profileName || activeIfaces[0].interfaceName;
      return {
        connected: true,
        type: "wired",
        name: fallbackName,
        ssid: "",
        profile: profileName,
        bssid: "",
        signal: "",
        identifiers: Array.from(
          new Set([profileName, activeIfaces[0].interfaceName].filter(Boolean)),
        ),
        hasInternetInterface: true,
        interfaces: activeIfaces,
        detectedAt: Date.now(),
      };
    }

    return {
      connected: false,
      type: "none",
      name: "",
      ssid: "",
      profile: "",
      bssid: "",
      signal: "",
      identifiers: [],
      hasInternetInterface: false,
      interfaces: [],
      detectedAt: Date.now(),
    };
  }

  if (process.platform === "darwin") {
    const airport = await runCommand(
      "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport",
      ["-I"],
      3000,
    );
    const match = airport.ok ? airport.stdout.match(/^\s*SSID:\s*(.+)$/m) : null;
    const ssid = match ? match[1].trim() : "";
    if (ssid) {
      return {
        connected: true,
        type: "wifi",
        name: ssid,
        ssid,
        profile: ssid,
        identifiers: [ssid],
        hasInternetInterface: activeIfaces.length > 0,
        interfaces: activeIfaces,
        detectedAt: Date.now(),
      };
    }
  } else {
    const nmcli = await runCommand("nmcli", ["-t", "-f", "ACTIVE,SSID", "dev", "wifi"], 3000);
    if (nmcli.ok) {
      const activeLine = nmcli.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("yes:"));
      if (activeLine) {
        const ssid = activeLine.slice(4).trim();
        if (ssid) {
          return {
            connected: true,
            type: "wifi",
            name: ssid,
            ssid,
            profile: ssid,
            identifiers: [ssid],
            hasInternetInterface: activeIfaces.length > 0,
            interfaces: activeIfaces,
            detectedAt: Date.now(),
          };
        }
      }
    }
  }

  const fallback = activeIfaces[0]?.interfaceName || "";
  return {
    connected: activeIfaces.length > 0,
    type: activeIfaces.length > 0 ? "wired" : "none",
    name: fallback,
    ssid: "",
    profile: fallback,
    identifiers: fallback ? [fallback] : [],
    hasInternetInterface: activeIfaces.length > 0,
    interfaces: activeIfaces,
    detectedAt: Date.now(),
  };
}

function matchesOfficeNetwork(networkInfo, officeNetworks = []) {
  if (!networkInfo || !networkInfo.connected) return false;
  if (!Array.isArray(officeNetworks) || !officeNetworks.length) return false;

  const normalizedOffice = new Set(
    officeNetworks.map((n) => String(n || "").trim().toLowerCase()).filter(Boolean),
  );
  if (!normalizedOffice.size) return false;

  const candidates = [
    networkInfo.name,
    networkInfo.ssid,
    networkInfo.profile,
    ...(Array.isArray(networkInfo.identifiers) ? networkInfo.identifiers : []),
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);

  return candidates.some((candidate) => normalizedOffice.has(candidate));
}

module.exports = {
  parseNetshWlanOutput,
  detectCurrentNetwork,
  matchesOfficeNetwork,
};
