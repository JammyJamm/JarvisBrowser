(() => {
  const keys = {
    theme: "jarvis.dashboard.theme",
    bookmarks: "jarvis.dashboard.bookmarks",
    history: "jarvis.dashboard.history",
    tabs: "jarvis.dashboard.tabs",
    activeTab: "jarvis.dashboard.activeTab",
    hiddenCards: "jarvis.dashboard.hiddenCards",
    events: "jarvis.calendar.events",
    water: "jarvis.health.water",
    reminders: "jarvis.calendar.reminders",
    foodPlans: "jarvis.food.meals",
    produce: "jarvis.food.produce",
    sidebarCollapsed: "jarvis.dashboard.sidebarCollapsed",
    officeConfig: "jarvis.office.config",
    officeAttendance: "jarvis.office.attendance",
  };

  const pages = new Set([
    "dashboard",
    "browser",
    "finance",
    "health",
    "calendar",
    "food",
  ]);

  const load = (key, fallback) => {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      console.error(`Unable to read ${key} from local storage:`, error);
      return fallback;
    }
  };

  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Unable to save ${key} to local storage:`, error);
      return false;
    }
  };

  const validWebUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  const formatDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  function updateTopbarDateTime() {
    const now = new Date();
    const compact = window.matchMedia("(max-width: 760px)").matches;
    const dateOptions = compact
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "long", month: "long", day: "numeric", year: "numeric" };

    document.getElementById("todayDate").textContent =
      new Intl.DateTimeFormat(undefined, dateOptions).format(now);
    document.getElementById("todayTime").textContent =
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(now);
  }

  const parseDateKey = (key) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const makeElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function makeFeatherIcon(name, className = "feather-icon") {
    const icon = makeElement("span", className);
    icon.dataset.feather = name;
    icon.setAttribute("aria-hidden", "true");
    icon.style.setProperty("--feather-mask", `url("./icon/${name}.svg")`);
    return icon;
  }

  function initializeFeatherIcons(root = document) {
    root.querySelectorAll("[data-feather]").forEach((icon) => {
      icon.style.setProperty(
        "--feather-mask",
        `url("./icon/${icon.dataset.feather}.svg")`,
      );
    });
  }

  window.jarvisCreateIcon = makeFeatherIcon;

  const showEmpty = (container, message) => {
    container.replaceChildren(makeElement("div", "empty-state", message));
  };

  const store = {
    bookmarks: load(keys.bookmarks, []),
    history: load(keys.history, []),
    tabs: load(keys.tabs, []),
    hiddenCards: load(keys.hiddenCards, []),
    events: load(keys.events, []),
    activeTab: Number(load(keys.activeTab, 0)),
    cursor: new Date(),
    calendarView: "month",
    remindersEnabled: load(keys.reminders, false) === true,
    water: load(keys.water, {}),
    foodPlans: load(keys.foodPlans, {}),
    produce: load(keys.produce, []),
    officeConfig: load(keys.officeConfig, null),
    officeAttendance: load(keys.officeAttendance, {}),
  };

  if (!Array.isArray(store.bookmarks)) store.bookmarks = [];
  if (!Array.isArray(store.history)) store.history = [];
  if (!Array.isArray(store.tabs)) store.tabs = [];
  if (!Array.isArray(store.hiddenCards)) store.hiddenCards = [];
  if (!Array.isArray(store.events)) store.events = [];
  store.hiddenCards = store.hiddenCards.filter((key) =>
    ["shortcuts", "schedule", "finance", "health", "recent", "bookmarks"].includes(
      key,
    ),
  );
  store.bookmarks = store.bookmarks.filter(
    (item) => item && validWebUrl(item.url),
  );
  store.history = store.history.filter(
    (item) => item && validWebUrl(item.url),
  );
  store.events = store.events.filter(
    (event) =>
      event &&
      typeof event.title === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(event.date),
  );
  if (!store.water || typeof store.water !== "object") store.water = {};
  if (!store.foodPlans || typeof store.foodPlans !== "object" || Array.isArray(store.foodPlans)) {
    store.foodPlans = {};
  }
  if (!Array.isArray(store.produce)) store.produce = [];
  if (!store.officeAttendance || typeof store.officeAttendance !== "object" || Array.isArray(store.officeAttendance)) {
    store.officeAttendance = {};
  }

  const OFFICE_TARGETS = [510, 420]; // 8h 30m (510m), 7h 00m (420m)
  const DEFAULT_OFFICE_CONFIG = {
    officeNetworks: ["CS-B5F-AP"],
    defaultTargetMinutes: 510,
    autoStartOnOfficeNetwork: true,
  };

  function normalizeOfficeConfig(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const hasExplicit = Array.isArray(src.officeNetworks);
    const networks = hasExplicit
      ? Array.from(
          new Set(
            src.officeNetworks
              .map((n) => String(n || "").trim())
              .filter(Boolean),
          ),
        )
      : [...DEFAULT_OFFICE_CONFIG.officeNetworks];
    return {
      officeNetworks: networks,
      defaultTargetMinutes: Number(src.defaultTargetMinutes) === 420 ? 420 : 510,
      autoStartOnOfficeNetwork: src.autoStartOnOfficeNetwork !== false,
    };
  }

  store.officeConfig = normalizeOfficeConfig(store.officeConfig);

  const officeState = {
    network: { connected: false, name: "", ssid: "", profile: "", identifiers: [] },
    activeDateKey: formatDateKey(new Date()),
    isRunning: false,
    manualPausedOnCurrentConnection: false,
    wasOnOfficeNetwork: false,
    lastTickMs: Date.now(),
    lastSyncMs: 0,
    firebaseStatus: "Syncing...",
    inspectDateKey: formatDateKey(new Date()),
    notifiedDateKey: "",
    fetchedRanges: new Set(),
  };

  function formatHMS(totalSeconds) {
    const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function formatHM(totalSeconds) {
    const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const totalMinutes = Math.floor(secs / 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  function formatTargetShort(targetMinutes) {
    return Number(targetMinutes) === 420 ? "7h 00m" : "8h 30m";
  }

  function getOfficeRecord(dateKey = formatDateKey(new Date())) {
    const existing = store.officeAttendance[dateKey];
    if (existing && typeof existing === "object") {
      return {
        date: dateKey,
        targetMinutes: Number(existing.targetMinutes) === 420 ? 420 : store.officeConfig.defaultTargetMinutes,
        elapsedSeconds: Math.max(0, Math.floor(Number(existing.elapsedSeconds) || 0)),
        networkName: String(existing.networkName || ""),
        firstCheckIn: String(existing.firstCheckIn || ""),
        lastCheckOut: String(existing.lastCheckOut || ""),
        sessions: Array.isArray(existing.sessions) ? existing.sessions : [],
      };
    }
    return {
      date: dateKey,
      targetMinutes: store.officeConfig.defaultTargetMinutes,
      elapsedSeconds: 0,
      networkName: "",
      firstCheckIn: "",
      lastCheckOut: "",
      sessions: [],
    };
  }

  function setOfficeRecord(dateKey, record) {
    const targetMinutes = Number(record.targetMinutes) === 420 ? 420 : 510;
    const elapsedSeconds = Math.max(0, Math.floor(Number(record.elapsedSeconds) || 0));
    const normalized = {
      date: dateKey,
      targetMinutes,
      elapsedSeconds,
      status: elapsedSeconds >= targetMinutes * 60 ? "completed" : elapsedSeconds > 0 ? "in_progress" : "not_started",
      networkName: String(record.networkName || ""),
      firstCheckIn: String(record.firstCheckIn || ""),
      lastCheckOut: String(record.lastCheckOut || ""),
      sessions: Array.isArray(record.sessions) ? record.sessions : [],
    };
    store.officeAttendance[dateKey] = normalized;
    save(keys.officeAttendance, store.officeAttendance);
    return normalized;
  }

  function matchesOfficeNetwork(networkInfo, officeNetworks = store.officeConfig.officeNetworks) {
    if (!networkInfo || !networkInfo.connected) return false;
    if (!Array.isArray(officeNetworks) || !officeNetworks.length) return false;
    const allowed = new Set(officeNetworks.map((n) => String(n || "").trim().toLowerCase()).filter(Boolean));
    const candidates = [
      networkInfo.name,
      networkInfo.ssid,
      networkInfo.profile,
      ...(Array.isArray(networkInfo.identifiers) ? networkInfo.identifiers : []),
    ]
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean);
    return candidates.some((c) => allowed.has(c));
  }

  const OFFICE_API_BASE = window.aiState?.backendUrl || "http://localhost:9000";

  async function callOfficeApi(methodName, httpPath, httpMethod = "GET", body = null) {
    if (window.officeTimerAPI && typeof window.officeTimerAPI[methodName] === "function") {
      if (methodName === "saveDay") return await window.officeTimerAPI.saveDay(body.date, body);
      if (methodName === "getDay") return await window.officeTimerAPI.getDay(body);
      if (methodName === "getRange") return await window.officeTimerAPI.getRange(body.start, body.end);
      if (methodName === "saveConfig") return await window.officeTimerAPI.saveConfig(body);
      return await window.officeTimerAPI[methodName]();
    }
    try {
      const res = await fetch(`${OFFICE_API_BASE}${httpPath}`, {
        method: httpMethod,
        headers: { "Content-Type": "application/json" },
        body: httpMethod === "POST" ? JSON.stringify(body) : undefined,
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function updateFirebaseBadge(text) {
    officeState.firebaseStatus = text;
    const badge = document.getElementById("officeFirebaseStatus");
    if (badge) badge.textContent = text;
  }

  async function syncOfficeConfigToFirebase() {
    save(keys.officeConfig, store.officeConfig);
    updateFirebaseBadge("Saving config...");
    const res = await callOfficeApi("saveConfig", "/api/office-timer/config", "POST", store.officeConfig);
    updateFirebaseBadge(res?.success ? "FIREBASE SYNCED" : "LOCAL SAVED (OFFLINE)");
  }

  async function syncOfficeDayToFirebase(dateKey) {
    const record = getOfficeRecord(dateKey);
    save(keys.officeAttendance, store.officeAttendance);
    officeState.lastSyncMs = Date.now();
    updateFirebaseBadge("Syncing...");
    const res = await callOfficeApi("saveDay", "/api/office-timer/attendance", "POST", {
      ...record,
      date: dateKey,
    });
    updateFirebaseBadge(res?.success ? "FIREBASE SYNCED" : "LOCAL SAVED (OFFLINE)");
  }

  async function loadOfficeRangeFromFirebase(startKey, endKey, force = false) {
    const rangeKey = `${startKey}_${endKey}`;
    if (!force && officeState.fetchedRanges.has(rangeKey)) return;
    officeState.fetchedRanges.add(rangeKey);
    const res = await callOfficeApi(
      "getRange",
      `/api/office-timer/attendance?start=${encodeURIComponent(startKey)}&end=${encodeURIComponent(endKey)}`,
      "GET",
      { start: startKey, end: endKey },
    );
    if (res?.success && res.records) {
      const todayKey = formatDateKey(new Date());
      for (const [dateKey, remoteRec] of Object.entries(res.records)) {
        const localRec = store.officeAttendance[dateKey];
        if (dateKey === todayKey && localRec && localRec.elapsedSeconds > remoteRec.elapsedSeconds) {
          continue;
        }
        setOfficeRecord(dateKey, remoteRec);
      }
      renderCalendar();
      renderHomeSchedule();
      renderOfficeTimerUI();
    }
  }

  function formatTimeShort(date = new Date()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function startOfficeTimer(reason = "manual") {
    const todayKey = formatDateKey(new Date());
    officeState.activeDateKey = todayKey;
    const rec = getOfficeRecord(todayKey);
    const now = new Date();
    const nowIso = now.toISOString();
    const activeNetName = officeState.network.name || store.officeConfig.officeNetworks[0] || "Office";

    if (!officeState.isRunning) {
      if (rec.elapsedSeconds >= rec.targetMinutes * 60) {
        return;
      }
      officeState.isRunning = true;
      officeState.lastTickMs = Date.now();
      officeState.manualPausedOnCurrentConnection = false;
      if (!rec.firstCheckIn) rec.firstCheckIn = formatTimeShort(now);
      if (!rec.networkName) rec.networkName = activeNetName;
      rec.lastCheckOut = formatTimeShort(now);
      rec.sessions.push({
        network: activeNetName,
        start: nowIso,
        end: nowIso,
        durationSeconds: 0,
        active: true,
      });
      setOfficeRecord(todayKey, rec);
      syncOfficeDayToFirebase(todayKey);
    }
    renderOfficeTimerUI();
    renderCalendar();
    renderHomeSchedule();
  }

  function flushActiveSession(rec, active = officeState.isRunning) {
    const now = new Date();
    if (rec.sessions.length) {
      const last = rec.sessions[rec.sessions.length - 1];
      if (last && last.active) {
        last.end = now.toISOString();
        const sessionStartMs = Date.parse(last.start);
        if (Number.isFinite(sessionStartMs)) {
          last.durationSeconds = Math.max(
            Number(last.durationSeconds) || 0,
            Math.floor((now.getTime() - sessionStartMs) / 1000),
          );
        }
        last.active = active;
      }
    }
    if (!active) rec.lastCheckOut = formatTimeShort(now);
  }

  function pauseOfficeTimer(reason = "manual") {
    const todayKey = officeState.activeDateKey || formatDateKey(new Date());
    const rec = getOfficeRecord(todayKey);
    const nowMs = Date.now();
    if (officeState.isRunning) {
      const firstSession = rec.sessions.find((session) => Number.isFinite(Date.parse(session.start)));
      const startMs = firstSession ? Date.parse(firstSession.start) : NaN;
      if (Number.isFinite(startMs)) {
        rec.elapsedSeconds = Math.min(
          rec.targetMinutes * 60,
          Math.max(0, Math.floor((nowMs - startMs) / 1000)),
        );
      }
    }
    flushActiveSession(rec, false);

    officeState.isRunning = false;
    officeState.lastTickMs = nowMs;
    if (reason === "manual") {
      officeState.manualPausedOnCurrentConnection = true;
    }
    setOfficeRecord(todayKey, rec);
    syncOfficeDayToFirebase(todayKey);
    renderOfficeTimerUI();
    renderCalendar();
    renderHomeSchedule();
  }

  function setOfficeDayTarget(minutes, dateKey = formatDateKey(new Date())) {
    const normalized = Number(minutes) === 420 ? 420 : 510;
    const rec = getOfficeRecord(dateKey);
    rec.targetMinutes = normalized;
    setOfficeRecord(dateKey, rec);
    if (dateKey === formatDateKey(new Date())) {
      store.officeConfig.defaultTargetMinutes = normalized;
      syncOfficeConfigToFirebase();
    }
    syncOfficeDayToFirebase(dateKey);
    renderOfficeTimerUI();
    renderCalendar();
    renderHomeSchedule();
    if (document.getElementById("officeTimerDialog")?.open) {
      renderOfficeDialog();
    }
  }

  function handleOfficeNetworkUpdate(networkInfo) {
    if (!networkInfo || typeof networkInfo !== "object") return;
    officeState.network = networkInfo;
    const isOffice = matchesOfficeNetwork(networkInfo, store.officeConfig.officeNetworks);
    const reconnected = !officeState.wasOnOfficeNetwork && isOffice;

    if (reconnected) {
      officeState.manualPausedOnCurrentConnection = false;
      if (store.officeConfig.autoStartOnOfficeNetwork && !officeState.isRunning) {
        startOfficeTimer("network-reconnect");
      }
    } else if (
      isOffice &&
      store.officeConfig.autoStartOnOfficeNetwork &&
      !officeState.isRunning &&
      !officeState.manualPausedOnCurrentConnection
    ) {
      startOfficeTimer("network-auto");
    } else if (!isOffice) {
      officeState.manualPausedOnCurrentConnection = false;
    }

    officeState.wasOnOfficeNetwork = isOffice;
    renderOfficeTimerUI();
    if (document.getElementById("officeTimerDialog")?.open) {
      renderOfficeDialog();
    }
  }

  async function refreshOfficeNetwork() {
    if (window.officeTimerAPI?.getNetwork) {
      try {
        const net = await window.officeTimerAPI.getNetwork();
        handleOfficeNetworkUpdate(net);
        return net;
      } catch (err) {
        console.error("Failed to detect network:", err);
      }
    }
    const fallback = {
      connected: navigator.onLine,
      type: navigator.onLine ? "online" : "none",
      name: navigator.onLine ? (store.officeConfig.officeNetworks[0] || "Online") : "",
      identifiers: [],
    };
    handleOfficeNetworkUpdate(fallback);
    return fallback;
  }

  function tickOfficeTimer() {
    const nowMs = Date.now();
    const currentKey = formatDateKey(new Date(nowMs));

    if (currentKey !== officeState.activeDateKey) {
      const wasRunning = officeState.isRunning;
      if (wasRunning) {
        pauseOfficeTimer("midnight-rollover");
      }
      officeState.activeDateKey = currentKey;
      officeState.manualPausedOnCurrentConnection = false;
      if (
        wasRunning ||
        (store.officeConfig.autoStartOnOfficeNetwork &&
          matchesOfficeNetwork(officeState.network, store.officeConfig.officeNetworks))
      ) {
        startOfficeTimer("midnight-continue");
      }
    }

    if (officeState.isRunning) {
      officeState.lastTickMs = nowMs;
      const rec = getOfficeRecord(currentKey);
      const firstSession = rec.sessions.find((session) => Number.isFinite(Date.parse(session.start)));
      const startMs = firstSession ? Date.parse(firstSession.start) : NaN;
      const targetSecs = rec.targetMinutes * 60;

      if (Number.isFinite(startMs)) {
        rec.elapsedSeconds = Math.min(
          targetSecs,
          Math.max(0, Math.floor((nowMs - startMs) / 1000)),
        );
      }

      const completed = rec.elapsedSeconds >= targetSecs;
      flushActiveSession(rec, !completed);
      setOfficeRecord(currentKey, rec);

      if (completed) {
        officeState.isRunning = false;
        officeState.manualPausedOnCurrentConnection = true;
        syncOfficeDayToFirebase(currentKey);
      }

      if (completed && officeState.notifiedDateKey !== currentKey) {
        officeState.notifiedDateKey = currentKey;
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Office target complete", {
            body: `You completed ${formatTargetShort(rec.targetMinutes)} in office today!`,
          });
        }
      }

      if (nowMs - officeState.lastSyncMs >= 30000) {
        syncOfficeDayToFirebase(currentKey);
      }
    } else {
      officeState.lastTickMs = nowMs;
    }

    renderOfficeTimerUI();
  }

  function renderOfficeTimerUI() {
    const todayKey = formatDateKey(new Date());
    const rec = getOfficeRecord(todayKey);
    const targetSecs = rec.targetMinutes * 60;
    const firstSession = rec.sessions.find((session) => Number.isFinite(Date.parse(session.start)));
    const startedAt = firstSession ? new Date(firstSession.start) : null;
    const nowMs = Date.now();
    const elapsedSeconds = officeState.isRunning && startedAt
      ? Math.min(targetSecs, Math.max(0, Math.floor((nowMs - startedAt.getTime()) / 1000)))
      : Math.min(targetSecs, rec.elapsedSeconds);
    const remainingSecs = targetSecs - elapsedSeconds;
    const completed = remainingSecs <= 0;
    const pct = Math.min(100, (elapsedSeconds / targetSecs) * 100);
    const expectedEnd = startedAt
      ? new Date(startedAt.getTime() + targetSecs * 1000)
      : null;
    const timeRangeEl = document.getElementById("officeTimerTimeRange");
    if (timeRangeEl) {
      timeRangeEl.textContent = startedAt
        ? `Start ${formatTimeShort(startedAt)} · End ${formatTimeShort(expectedEnd)}`
        : "Connect to office Wi-Fi to start";
      timeRangeEl.title = startedAt
        ? `Started ${startedAt.toLocaleString()} · Target end ${expectedEnd.toLocaleString()}`
        : "Timer starts automatically when you connect to a noted office network";
    }

    const bar = document.getElementById("officeTimerBar");
    if (bar) {
      bar.classList.toggle("is-running", officeState.isRunning);
      bar.classList.toggle("is-completed", completed);
    }

    const remainingEl = document.getElementById("officeTimerRemaining");
    if (remainingEl) {
      remainingEl.textContent = completed
        ? `Goal met (+${formatHM(Math.abs(remainingSecs))})`
        : `${formatHM(remainingSecs)} left`;
    }

    const fillEl = document.getElementById("officeTimerProgressFill");
    if (fillEl) fillEl.style.width = `${pct}%`;
    const progressEl = document.querySelector(".office-timer-progress");
    if (progressEl) {
      progressEl.setAttribute("aria-valuenow", String(Math.round(pct)));
      progressEl.setAttribute("aria-valuetext", `${Math.round(pct)}% complete`);
    }

    document.querySelectorAll("[data-office-target]").forEach((btn) => {
      btn.classList.toggle(
        "active",
        Number(btn.dataset.officeTarget) === rec.targetMinutes,
      );
    });

    const isOffice = matchesOfficeNetwork(officeState.network, store.officeConfig.officeNetworks);
    const netPill = document.getElementById("officeNetworkBtn");
    const netText = document.getElementById("officeNetworkText");
    if (netPill && netText) {
      netPill.classList.toggle("is-office", isOffice);
      const netIcon = netPill.querySelector(".feather-icon");
      if (netIcon) {
        netIcon.dataset.feather = officeState.network.connected ? "wifi" : "wifi-off";
        initializeFeatherIcons(netPill);
      }
      if (officeState.network.connected && officeState.network.name) {
        netText.textContent = isOffice
          ? `${officeState.network.name} · Office`
          : officeState.network.name;
      } else {
        netText.textContent = "Offline";
      }
    }

    // Live-update Calendar summary & today chip if Calendar is visible
    const calTodayEl = document.getElementById("calOfficeTodayValue");
    if (calTodayEl) {
      calTodayEl.textContent = `${formatHM(elapsedSeconds)} / ${formatTargetShort(rec.targetMinutes)}`;
    }
    const calTodayMeta = document.getElementById("calOfficeTodayMeta");
    if (calTodayMeta) {
      calTodayMeta.textContent = officeState.isRunning
        ? `Tracking live on ${officeState.network.name || "office network"}`
        : completed
          ? "Daily office target reached"
          : isOffice
            ? "Connected to office network (paused)"
            : "Waiting for office network";
    }
    const todayChip = document.querySelector(`.calendar-office-chip[data-office-date="${todayKey}"]`);
    if (todayChip) {
      todayChip.textContent = `Office ${formatHM(elapsedSeconds)}${completed ? " ✓" : ""}`;
      todayChip.classList.toggle("is-met", completed);
    }
  }

  function renderOfficeDialog() {
    const net = officeState.network;
    const isOffice = matchesOfficeNetwork(net, store.officeConfig.officeNetworks);
    const currentNetEl = document.getElementById("officeDialogCurrentNet");
    const matchStatusEl = document.getElementById("officeDialogMatchStatus");
    if (currentNetEl) {
      currentNetEl.textContent = net.connected && net.name ? net.name : "Not connected";
    }
    if (matchStatusEl) {
      matchStatusEl.textContent = !net.connected
        ? "Connect to your office Wi-Fi or LAN to auto-start"
        : isOffice
          ? "Matches noted office network · auto-start ready"
          : "Connected, but not noted as an office network yet";
    }

    const listEl = document.getElementById("officeNotedNetworksList");
    if (listEl) {
      listEl.replaceChildren(
        ...store.officeConfig.officeNetworks.map((netName) => {
          const chip = makeElement("span", "produce-chip");
          chip.append(makeElement("span", "", netName));
          const remove = makeElement("button", "produce-remove");
          remove.type = "button";
          remove.dataset.removeOfficeNetwork = netName;
          remove.setAttribute("aria-label", `Remove ${netName}`);
          remove.append(makeFeatherIcon("x"));
          chip.append(remove);
          return chip;
        }),
      );
    }

    document.getElementById("officeDefaultTargetSelect").value = String(
      store.officeConfig.defaultTargetMinutes,
    );
    document.getElementById("officeAutoStartToggle").checked =
      store.officeConfig.autoStartOnOfficeNetwork !== false;

    const inspectDate = officeState.inspectDateKey || formatDateKey(new Date());
    document.getElementById("officeInspectDate").value = inspectDate;
    document.getElementById("officeInspectHeading").textContent =
      inspectDate === formatDateKey(new Date())
        ? "TODAY'S LOG"
        : `LOG FOR ${inspectDate}`;

    const rec = getOfficeRecord(inspectDate);
    document.getElementById("officeDayTargetSelect").value = String(rec.targetMinutes);
    document.getElementById("officeDayMinutesInput").value = String(
      Math.round(rec.elapsedSeconds / 60),
    );
    updateFirebaseBadge(officeState.firebaseStatus);

    const sessionsEl = document.getElementById("officeDaySessionsList");
    if (sessionsEl) {
      if (!rec.sessions.length) {
        sessionsEl.replaceChildren(
          makeElement("div", "empty-state", "No sessions logged for this date yet."),
        );
      } else {
        sessionsEl.replaceChildren(
          ...rec.sessions.map((s) => {
            const row = makeElement("div", "office-session-row");
            const startLabel = new Date(s.start).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const endLabel = s.active
              ? "Active"
              : s.end
              ? new Date(s.end).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—";
            row.append(
              makeElement("span", "", `${s.network || "Office"} · ${startLabel} – ${endLabel}`),
              makeElement("small", "", formatHM(s.durationSeconds)),
            );
            return row;
          }),
        );
      }
    }
  }

  function openOfficeDialog(dateKey = formatDateKey(new Date())) {
    officeState.inspectDateKey = dateKey;
    renderOfficeDialog();
    document.getElementById("officeTimerDialog").showModal();
  }

  async function initOfficeTimer() {
    renderOfficeTimerUI();

    const todayKey = formatDateKey(new Date());
    const [configRes, todayRes] = await Promise.all([
      callOfficeApi("getConfig", "/api/office-timer/config", "GET"),
      callOfficeApi(
        "getDay",
        `/api/office-timer/attendance?date=${encodeURIComponent(todayKey)}`,
        "GET",
        todayKey,
      ),
    ]);

    if (configRes?.success && configRes.config) {
      store.officeConfig = normalizeOfficeConfig(configRes.config);
      save(keys.officeConfig, store.officeConfig);
    }

    if (todayRes?.success && todayRes.record) {
      const localToday = getOfficeRecord(todayKey);
      if (todayRes.record.elapsedSeconds >= localToday.elapsedSeconds) {
        setOfficeRecord(todayKey, todayRes.record);
      } else if (localToday.elapsedSeconds > 0) {
        syncOfficeDayToFirebase(todayKey);
      }
      updateFirebaseBadge("FIREBASE SYNCED");
    } else {
      updateFirebaseBadge(todayRes?.success ? "FIREBASE READY" : "LOCAL MODE");
    }

    const todayRecord = getOfficeRecord(todayKey);
    const activeSession = [...todayRecord.sessions].reverse().find((session) => session.active === true);
    if (activeSession) {
      const nowMs = Date.now();
      const firstSession = todayRecord.sessions.find((session) => Number.isFinite(Date.parse(session.start)));
      const startMs = firstSession ? Date.parse(firstSession.start) : Date.parse(activeSession.start);
      const sessionStartMs = Date.parse(activeSession.start);
      const targetSeconds = todayRecord.targetMinutes * 60;
      todayRecord.elapsedSeconds = Number.isFinite(startMs)
        ? Math.min(targetSeconds, Math.max(0, Math.floor((nowMs - startMs) / 1000)))
        : todayRecord.elapsedSeconds;
      activeSession.durationSeconds = Number.isFinite(sessionStartMs)
        ? Math.max(0, Math.floor((nowMs - sessionStartMs) / 1000))
        : activeSession.durationSeconds;
      activeSession.end = new Date(nowMs).toISOString();
      if (todayRecord.elapsedSeconds >= targetSeconds) {
        activeSession.active = false;
        todayRecord.lastCheckOut = formatTimeShort(new Date(nowMs));
      } else {
        officeState.isRunning = true;
      }
      officeState.lastTickMs = nowMs;
      setOfficeRecord(todayKey, todayRecord);
      await syncOfficeDayToFirebase(todayKey);
    }

    if (window.officeTimerAPI?.onNetworkChanged) {
      window.officeTimerAPI.onNetworkChanged((net) => handleOfficeNetworkUpdate(net));
    }
    if (window.officeTimerAPI?.onPowerEvent) {
      window.officeTimerAPI.onPowerEvent((evt) => {
        if (evt?.type === "resume") {
          refreshOfficeNetwork();
        }
      });
    }

    window.addEventListener("online", () => refreshOfficeNetwork());
    window.addEventListener("offline", () => refreshOfficeNetwork());

    await refreshOfficeNetwork();
    renderOfficeTimerUI();
    renderCalendar();
    renderHomeSchedule();
    window.setInterval(tickOfficeTimer, 1000);
  }
  store.produce = store.produce.filter(
    (item) =>
      item &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      ["fruit", "vegetable"].includes(item.type),
  );

  store.tabs = store.tabs.filter(
    (tab) => tab && typeof tab.id === "string" && validWebUrl(tab.url),
  );
  if (!store.tabs.length) {
    store.tabs = [{ id: String(Date.now()), url: "https://example.com" }];
  }
  if (
    !Number.isInteger(store.activeTab) ||
    store.activeTab < 0 ||
    store.activeTab >= store.tabs.length
  ) {
    store.activeTab = 0;
  }

  const activeTab = () => store.tabs[store.activeTab];

  function persistTabs() {
    save(keys.tabs, store.tabs);
    save(keys.activeTab, store.activeTab);
  }

  function setBrowserAssistantOpen(isOpen, focusInput = false) {
    const panel = document.getElementById("browserAssistantPanel");
    const button = document.getElementById("browserAssistantButton");
    panel.hidden = !isOpen;
    panel.inert = !isOpen;
    panel.setAttribute("aria-hidden", String(!isOpen));
    button.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("browser-assistant-open", isOpen);
    requestAnimationFrame(resizeBrowserHost);
    if (isOpen && focusInput) {
      requestAnimationFrame(() => document.getElementById("cmd").focus());
    } else if (!isOpen) {
      button.focus();
    }
  }

  function setAssistantTab(tabName, focusTab = false) {
    const tabs = [
      document.getElementById("assistantLiveTab"),
      document.getElementById("assistantLogsTab"),
    ];
    const views = [
      document.getElementById("assistantLiveView"),
      document.getElementById("assistantLogsView"),
    ];
    const selectedIndex = tabName === "logs" ? 1 : 0;

    tabs.forEach((tab, index) => {
      const selected = index === selectedIndex;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      views[index].hidden = !selected;
      views[index].inert = !selected;
    });

    if (focusTab) tabs[selectedIndex].focus();
  }

  function setPage(name) {
    if (name === "assistant") {
      setPage("browser");
      setBrowserAssistantOpen(true, true);
      return;
    }
    if (!pages.has(name)) return;

    document.body.dataset.page = name;
    document.querySelectorAll("[data-page-view]").forEach((page) => {
      page.hidden = page.dataset.pageView !== name;
    });
    document.querySelectorAll("[data-page]").forEach((button) => {
      const selected = button.dataset.page === name;
      if (button.classList.contains("nav-link")) {
        button.classList.toggle("active", selected);
        if (selected) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    });

    if (name === "browser") {
      renderTabs();
      const currentUrl = activeTab()?.url;
      if (currentUrl) document.getElementById("url").value = currentUrl;
      updateBookmarkButton();
    }

    if (name === "dashboard") renderHome();
    if (name === "calendar") renderCalendar();
    if (name === "food") renderFoodPage();
    requestAnimationFrame(resizeBrowserHost);
  }

  function getFoodPlan(dateKey) {
    const saved = store.foodPlans[dateKey] || {};
    return ["breakfast", "dinner"].reduce((plan, meal) => {
      const savedMeal = saved[meal] || {};
      const protein = Number(savedMeal.protein);
      plan[meal] = {
        foods: typeof savedMeal.foods === "string" ? savedMeal.foods : "",
        protein: Number.isFinite(protein)
          ? Math.max(0, Math.min(300, Math.round(protein)))
          : 0,
      };
      return plan;
    }, {});
  }

  function renderFoodPage() {
    const today = new Date();
    const dateKey = formatDateKey(today);
    const plan = getFoodPlan(dateKey);
    document.getElementById("foodTodayDate").textContent =
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(today);

    ["breakfast", "dinner"].forEach((meal) => {
      document.getElementById(`${meal}Foods`).value = plan[meal].foods;
      document.getElementById(`${meal}Protein`).value = String(plan[meal].protein);
      document.getElementById(`${meal}ProteinLabel`).textContent =
        String(plan[meal].protein);
      document.getElementById(`${meal}ChartProtein`).textContent =
        String(plan[meal].protein);
    });

    const breakfastProtein = plan.breakfast.protein;
    const dinnerProtein = plan.dinner.protein;
    const totalProtein = breakfastProtein + dinnerProtein;
    const breakfastPercent = totalProtein
      ? (breakfastProtein / totalProtein) * 100
      : 0;
    const chart = document.getElementById("proteinPieChart");
    chart.style.background = totalProtein
      ? `conic-gradient(var(--color-primary) 0% ${breakfastPercent}%, var(--color-secondary) ${breakfastPercent}% 100%)`
      : "conic-gradient(var(--color-border) 0% 100%)";
    chart.setAttribute(
      "aria-label",
      totalProtein
        ? `Estimated protein: ${breakfastProtein} grams at breakfast and ${dinnerProtein} grams at dinner`
        : "No protein planned yet",
    );
    chart.dataset.total = String(totalProtein);
    document.getElementById("totalChartProtein").textContent =
      String(totalProtein);
    renderProduce();
  }

  function renderProduceGroup(type, containerId) {
    const container = document.getElementById(containerId);
    const items = store.produce.filter((item) => item.type === type);
    if (!items.length) {
      container.replaceChildren(
        makeElement(
          "span",
          "produce-empty",
          `No ${type === "fruit" ? "fruits" : "vegetables"} added yet`,
        ),
      );
      return;
    }

    container.replaceChildren(
      ...items.map((item) => {
        const chip = makeElement("span", "produce-chip");
        chip.append(makeElement("span", "", item.name));
        const remove = makeElement("button", "produce-remove");
        remove.type = "button";
        remove.dataset.removeProduce = item.id;
        remove.setAttribute("aria-label", `Remove ${item.name}`);
        remove.append(makeFeatherIcon("x"));
        chip.append(remove);
        return chip;
      }),
    );
  }

  function renderProduce() {
    renderProduceGroup("fruit", "availableFruits");
    renderProduceGroup("vegetable", "availableVegetables");
  }

  function resizeBrowserHost() {
    if (window.electronAPI?.resizeBrowser) {
      window.electronAPI.resizeBrowser().catch((error) => {
        console.error("Unable to resize the browser view:", error);
      });
    }
  }

  function renderTabs() {
    const container = document.getElementById("tabs");
    container.replaceChildren();

    store.tabs.forEach((tab, index) => {
      const tabButton = makeElement("div", "browser-tab");
      tabButton.setAttribute("role", "tab");
      tabButton.setAttribute("aria-selected", String(index === store.activeTab));
      tabButton.tabIndex = index === store.activeTab ? 0 : -1;
      tabButton.classList.toggle("active", index === store.activeTab);

      const label = makeElement(
        "button",
        "browser-tab-label",
        getSiteLabel(tab.url),
      );
      label.type = "button";
      label.addEventListener("click", () => activateTab(index));
      const close = makeElement("button", "browser-tab-close");
      close.type = "button";
      close.setAttribute("aria-label", `Close ${getSiteLabel(tab.url)}`);
      close.tabIndex = -1;
      close.append(makeFeatherIcon("x"));

      tabButton.append(label, close);
      close.addEventListener("click", () => closeTab(index));
      container.append(tabButton);
    });
  }

  function getSiteLabel(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      return hostname || "New tab";
    } catch {
      return "New tab";
    }
  }

  async function navigateTo(value) {
    const input = document.getElementById("url");
    input.value = value;
    setPage("browser");
    input.value = value;
    input.focus();
    if (typeof window.navigate === "function") {
      await window.navigate(value);
    } else {
      console.error("Browser navigation is unavailable in this renderer.");
    }
  }

  function openTab(url = "https://example.com") {
    store.tabs.push({ id: String(Date.now()), url });
    store.activeTab = store.tabs.length - 1;
    persistTabs();
    renderTabs();
    setPage("browser");
    navigateTo(url);
  }

  function activateTab(index) {
    if (index < 0 || index >= store.tabs.length) return;
    store.activeTab = index;
    persistTabs();
    renderTabs();
    setPage("browser");
    navigateTo(activeTab().url);
  }

  function closeTab(index) {
    const closingActive = index === store.activeTab;
    store.tabs.splice(index, 1);
    if (!store.tabs.length) {
      store.tabs.push({ id: String(Date.now()), url: "https://example.com" });
      store.activeTab = 0;
      persistTabs();
      renderTabs();
      navigateTo(activeTab().url);
      return;
    }

    if (index < store.activeTab) store.activeTab -= 1;
    else if (closingActive) {
      store.activeTab = Math.min(index, store.tabs.length - 1);
    }

    persistTabs();
    renderTabs();
    if (closingActive) {
      navigateTo(activeTab().url);
    }
  }

  function recordVisit(url) {
    if (!validWebUrl(url)) return;
    const mostRecent = store.history[0];
    if (mostRecent?.url !== url) {
      store.history.unshift({ url, visitedAt: Date.now() });
      store.history = store.history.slice(0, 100);
      save(keys.history, store.history);
    }

    if (activeTab()) activeTab().url = url;
    persistTabs();
    const input = document.getElementById("url");
    if (input) input.value = url;
    renderTabs();
    updateBookmarkButton();
    renderHome();
  }

  function renderSiteRows(container, items, emptyMessage) {
    container.replaceChildren();
    if (!items.length) {
      showEmpty(container, emptyMessage);
      return;
    }

    items.forEach((item) => {
      const row = makeElement("div", "site-row");
      const favicon = makeElement(
        "span",
        "site-favicon",
        getSiteLabel(item.url).charAt(0).toUpperCase(),
      );
      const info = makeElement("span");
      info.append(
        makeElement("strong", "", getSiteLabel(item.url)),
        makeElement(
          "small",
          "",
          item.visitedAt
            ? new Date(item.visitedAt).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : item.url,
        ),
      );
      const open = makeElement("button", "site-open-button");
      open.type = "button";
      open.setAttribute("aria-label", `Open ${getSiteLabel(item.url)}`);
      open.append(makeFeatherIcon("external-link"));
      open.addEventListener("click", () => navigateTo(item.url));
      row.append(favicon, info, open);
      container.append(row);
    });
  }

  function renderHome() {
    const date = new Date();
    const eyebrow = document.querySelector(".welcome-row .eyebrow");
    eyebrow.textContent = date
      .toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
      .toUpperCase();

    renderSiteRows(
      document.getElementById("recentSites"),
      store.history.slice(0, 4),
      "Websites you visit will show up here.",
    );
    renderSiteRows(
      document.getElementById("bookmarkList"),
      store.bookmarks.slice(0, 4),
      "Save a page in the browser to keep it close.",
    );
    renderHomeSchedule();
  }

  function renderHomeSchedule() {
    const container = document.getElementById("homeSchedule");
    container.replaceChildren();
    const today = formatDateKey(new Date());
    const officeRec = getOfficeRecord(today);
    const hasOfficeRow = officeRec.elapsedSeconds > 0 || officeState.isRunning;

    const todaysEvents = store.events
      .filter((event) => event.date === today)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
      .slice(0, hasOfficeRow ? 2 : 2);

    if (hasOfficeRow) {
      const met = officeRec.elapsedSeconds >= officeRec.targetMinutes * 60;
      const row = makeElement("div", "compact-event");
      row.append(
        makeElement("span", "event-date-chip", met ? "DONE" : "OFFICE"),
        makeElement("span"),
      );
      row.children[1].append(
        makeElement(
          "strong",
          "",
          `Office Hours · ${formatHM(officeRec.elapsedSeconds)} / ${formatTargetShort(officeRec.targetMinutes)}`,
        ),
        makeElement(
          "small",
          "",
          officeState.isRunning
            ? `Tracking live (${officeState.network.name || "Office"})`
            : met
              ? "Target completed today"
              : "Paused · resumes on office network",
        ),
      );
      container.append(row);
    }

    if (!todaysEvents.length && !hasOfficeRow) {
      showEmpty(container, "Nothing scheduled yet. Add an event when you’re ready.");
      return;
    }

    todaysEvents.forEach((event) => {
      const row = makeElement("div", "compact-event");
      row.append(
        makeElement(
          "span",
          "event-date-chip",
          event.time || "ALL DAY",
        ),
        makeElement("span"),
      );
      row.children[1].append(
        makeElement("strong", "", event.title),
        makeElement("small", "", event.type || event.notes || "Today"),
      );
      container.append(row);
    });
  }

  function getEventDateTime(event) {
    const date = parseDateKey(event.date);
    if (event.time) {
      const [hours, minutes] = event.time.split(":").map(Number);
      date.setHours(hours, minutes, 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  }

  function renderEventRow(event, options = {}) {
    const row = makeElement("div", "event-row");
    const dateChip = makeElement(
      "span",
      "event-date-chip",
      parseDateKey(event.date).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      }),
    );
    const details = makeElement("span");
    const timeLabel = event.time
      ? new Date(`${event.date}T${event.time}`).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : "All day";
    details.append(
      makeElement("strong", "", event.title),
      makeElement(
        "small",
        "",
        [event.type || "Event", timeLabel, event.notes].filter(Boolean).join(" · "),
      ),
    );
    row.append(dateChip, details);

    if (options.editable) {
      const actions = makeElement("span", "event-actions");
      const edit = makeElement("button", "", "Edit");
      edit.type = "button";
      edit.dataset.eventEdit = event.id;
      edit.setAttribute("aria-label", `Edit ${event.title}`);
      actions.append(edit);
      row.append(actions);
    }

    return row;
  }

  function getEventsForDate(date) {
    const dateKey = formatDateKey(date);
    return store.events
      .filter((event) => event.date === dateKey)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  function startOfWeek(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - start.getDay());
    return start;
  }

  function renderCalendar() {
    const grid = document.getElementById("calendarGrid");
    const page = document.getElementById("calendarPage");
    const heading = document.getElementById("calendarHeading");
    const weekdays = document.querySelector(".calendar-weekdays");
    grid.replaceChildren();
    grid.classList.toggle("week-mode", store.calendarView === "week");
    grid.classList.toggle("day-mode", store.calendarView === "day");
    page.classList.toggle("calendar-page-day", store.calendarView === "day");
    weekdays.hidden = store.calendarView === "day";

    let dates;
    if (store.calendarView === "month") {
      const firstOfMonth = new Date(
        store.cursor.getFullYear(),
        store.cursor.getMonth(),
        1,
      );
      const firstCell = startOfWeek(firstOfMonth);
      dates = Array.from({ length: 42 }, (_, index) => {
        const date = new Date(firstCell);
        date.setDate(firstCell.getDate() + index);
        return date;
      });
      heading.textContent = store.cursor.toLocaleDateString([], {
        month: "long",
        year: "numeric",
      });
    } else if (store.calendarView === "week") {
      const firstDay = startOfWeek(store.cursor);
      dates = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(firstDay);
        date.setDate(firstDay.getDate() + index);
        return date;
      });
      const lastDay = dates[6];
      heading.textContent = `${dates[0].toLocaleDateString([], { month: "short", day: "numeric" })} – ${lastDay.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
    } else {
      dates = [new Date(store.cursor)];
      heading.textContent = store.cursor.toLocaleDateString([], {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }

    const todayDateKey = formatDateKey(new Date());
    if (dates.length) {
      const startKey = formatDateKey(dates[0]);
      const endKey = formatDateKey(dates[dates.length - 1]);
      loadOfficeRangeFromFirebase(startKey, endKey);
    }

    let periodSeconds = 0;
    let periodLoggedDays = 0;
    let periodMetDays = 0;

    dates.forEach((date) => {
      const dateKey = formatDateKey(date);
      const cell = makeElement("div", "calendar-day");
      cell.dataset.date = dateKey;
      cell.classList.toggle("outside-month", date.getMonth() !== store.cursor.getMonth() && store.calendarView === "month");
      cell.classList.toggle("today", dateKey === todayDateKey);
      if (store.calendarView === "week") cell.classList.add("week-mode");
      if (store.calendarView === "day") cell.classList.add("day-mode");
      const dayNumber = makeElement("button", "day-number", String(date.getDate()));
      dayNumber.type = "button";
      dayNumber.dataset.date = dateKey;
      dayNumber.setAttribute(
        "aria-label",
        `Add an event on ${date.toLocaleDateString()}`,
      );
      cell.append(dayNumber);

      const officeRec = store.officeAttendance[dateKey];
      const showOfficeChip =
        officeRec && (officeRec.elapsedSeconds > 0 || (dateKey === todayDateKey && officeState.isRunning));
      if (showOfficeChip) {
        const met = officeRec.elapsedSeconds >= officeRec.targetMinutes * 60;
        const inCurrentMonth =
          store.calendarView !== "month" || date.getMonth() === store.cursor.getMonth();
        if (inCurrentMonth && officeRec.elapsedSeconds > 0) {
          periodSeconds += officeRec.elapsedSeconds;
          periodLoggedDays += 1;
          if (met) periodMetDays += 1;
        }
        const officeChip = makeElement(
          "button",
          `calendar-office-chip${met ? " is-met" : ""}`,
          `Office ${formatHM(officeRec.elapsedSeconds)}${met ? " ✓" : ""}`,
        );
        officeChip.type = "button";
        officeChip.dataset.officeDate = dateKey;
        officeChip.setAttribute(
          "aria-label",
          `Office attendance on ${dateKey}: ${formatHM(officeRec.elapsedSeconds)} of ${formatTargetShort(officeRec.targetMinutes)}`,
        );
        cell.append(officeChip);
      }

      getEventsForDate(date).slice(0, showOfficeChip ? 2 : 3).forEach((event) => {
        const chip = makeElement("button", "calendar-event-chip", event.title);
        chip.type = "button";
        chip.dataset.eventEdit = event.id;
        chip.setAttribute("aria-label", `Edit ${event.title}`);
        cell.append(chip);
      });
      const maxEvents = showOfficeChip ? 2 : 3;
      const extraCount = getEventsForDate(date).length - maxEvents;
      if (extraCount > 0) {
        cell.append(makeElement("span", "calendar-event-chip", `+${extraCount} more`));
      }
      grid.append(cell);
    });

    const todayRec = getOfficeRecord(todayDateKey);
    const calTodayVal = document.getElementById("calOfficeTodayValue");
    const calPeriodVal = document.getElementById("calOfficePeriodValue");
    const calPeriodMeta = document.getElementById("calOfficePeriodMeta");
    const calNetVal = document.getElementById("calOfficeNetworkValue");
    if (calTodayVal) {
      calTodayVal.textContent = `${formatHM(todayRec.elapsedSeconds)} / ${formatTargetShort(todayRec.targetMinutes)}`;
    }
    if (calPeriodVal) {
      calPeriodVal.textContent = formatHM(periodSeconds);
    }
    if (calPeriodMeta) {
      calPeriodMeta.textContent = `${periodMetDays} / ${periodLoggedDays} logged days met target`;
    }
    if (calNetVal) {
      calNetVal.textContent = store.officeConfig.officeNetworks.join(", ") || "Not set";
    }

    document.querySelectorAll("[data-calendar-view]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.calendarView === store.calendarView,
      );
    });

    const upcoming = document.getElementById("upcomingEvents");
    const now = new Date();
    const todayKey = formatDateKey(now);
    const upcomingEvents = store.events
      .filter((event) => event.date >= todayKey)
      .sort((a, b) => getEventDateTime(a) - getEventDateTime(b))
      .slice(0, 6);

    if (!upcomingEvents.length) {
      showEmpty(upcoming, "No upcoming events. Your calendar is ready when you are.");
    } else {
      upcoming.replaceChildren(
        ...upcomingEvents.map((event) => renderEventRow(event, { editable: true })),
      );
    }

    document.getElementById("reminderStatus").textContent = store.remindersEnabled
      ? "Desktop reminders are on"
      : "Reminders are off";
  }

  function openEventDialog(dateKey = formatDateKey(store.cursor), event = null) {
    const dialog = document.getElementById("eventDialog");
    const form = document.getElementById("eventForm");
    form.reset();
    document.getElementById("eventId").value = event?.id || "";
    document.getElementById("eventTitle").value = event?.title || "";
    document.getElementById("eventType").value = event?.type || "Meeting";
    document.getElementById("eventDate").value = event?.date || dateKey;
    document.getElementById("eventTime").value = event?.time || "";
    document.getElementById("eventNotes").value = event?.notes || "";
    document.getElementById("eventReminder").checked = event?.reminder === true;
    document.getElementById("eventFormTitle").textContent = event
      ? "Edit event"
      : "Add event";
    document.getElementById("deleteEventButton").hidden = !event;
    dialog.showModal();
    document.getElementById("eventTitle").focus();
  }

  function handleEventSubmit(event) {
    event.preventDefault();
    const id = document.getElementById("eventId").value || String(Date.now());
    const existing = store.events.find((item) => item.id === id);
    const item = {
      id,
      title: document.getElementById("eventTitle").value.trim(),
      type: document.getElementById("eventType").value,
      date: document.getElementById("eventDate").value,
      time: document.getElementById("eventTime").value,
      notes: document.getElementById("eventNotes").value.trim(),
      reminder: document.getElementById("eventReminder").checked,
      reminded:
        existing?.date === document.getElementById("eventDate").value &&
        existing?.time === document.getElementById("eventTime").value
          ? existing.reminded === true
          : false,
    };

    if (!item.title || !item.date) return;
    store.events = store.events.filter((entry) => entry.id !== id);
    store.events.push(item);
    save(keys.events, store.events);
    document.getElementById("eventDialog").close();
    renderCalendar();
    renderHomeSchedule();
  }

  function showUtility(title, content) {
    document.getElementById("utilityPanelTitle").textContent = title;
    document.getElementById("browserUtilityContent").replaceChildren(content);
    document.getElementById("browserUtilityPanel").hidden = false;
  }

  function renderUtilitySites(items, emptyMessage) {
    const list = makeElement("div", "site-list");
    if (!items.length) {
      showEmpty(list, emptyMessage);
      return list;
    }

    items.forEach((item) => {
      const row = makeElement("div", "site-row");
      const info = makeElement("span");
      info.append(
        makeElement("strong", "", getSiteLabel(item.url)),
        makeElement("small", "", item.url),
      );
      const open = makeElement("button", "site-open-button");
      open.type = "button";
      open.setAttribute("aria-label", `Open ${getSiteLabel(item.url)}`);
      open.append(makeFeatherIcon("external-link"));
      open.addEventListener("click", () => navigateTo(item.url));
      row.append(info, open);
      list.append(row);
    });
    return list;
  }

  function openBrowserTool(tool) {
    if (tool === "bookmark") {
      const url = document.getElementById("url").value.trim();
      if (!validWebUrl(url)) return;
      const existing = store.bookmarks.findIndex((item) => item.url === url);
      if (existing >= 0) store.bookmarks.splice(existing, 1);
      else store.bookmarks.unshift({ url, savedAt: Date.now() });
      save(keys.bookmarks, store.bookmarks);
      renderHome();
      updateBookmarkButton();
      return;
    }

    if (tool === "history") {
      showUtility(
        "Browsing history",
        renderUtilitySites(
          store.history.slice(0, 15),
          "Your recent browsing history will appear here.",
        ),
      );
      return;
    }

    if (tool === "downloads") {
      const message = makeElement(
        "div",
        "empty-state",
        "Downloads are not connected in this version of Jarvis.",
      );
      showUtility("Downloads", message);
      return;
    }

    if (tool === "private") {
      showUtility(
        "Private browsing",
        makeElement(
          "div",
          "empty-state",
          "Private sessions are not configured. This browser uses the existing standard Electron session.",
        ),
      );
    }
  }

  function updateBookmarkButton() {
    const button = document.querySelector('[data-browser-tool="bookmark"]');
    const isSaved = store.bookmarks.some(
      (item) => item.url === document.getElementById("url").value,
    );
    button.setAttribute("aria-pressed", String(isSaved));
    button.setAttribute("aria-label", isSaved ? "Remove saved page" : "Save page");
    button.title = isSaved ? "Remove saved page" : "Save page";
  }

  function updateTheme(theme) {
    document.body.dataset.theme = theme;
    const themeButton = document.querySelector('[data-action="toggle-theme"] .feather-icon');
    if (themeButton) {
      themeButton.dataset.feather = theme === "dark" ? "sun" : "moon";
      initializeFeatherIcons(themeButton.parentElement);
    }
    save(keys.theme, theme);
  }

  function setWaterCount(delta) {
    const today = formatDateKey(new Date());
    const currentCount = Number(store.water[today] ?? 4);
    const next = Math.max(
      0,
      Math.min(8, (Number.isFinite(currentCount) ? currentCount : 4) + delta),
    );
    store.water[today] = next;
    save(keys.water, store.water);
    renderWaterCount(next);
  }

  function renderWaterCount(count) {
    const counter = document.getElementById("waterCount");
    counter.replaceChildren(
      document.createTextNode(`${count} `),
      makeElement("small", "", "/ 8 glasses"),
    );
  }

  function deleteEvent(id) {
    store.events = store.events.filter((event) => event.id !== id);
    save(keys.events, store.events);
    document.getElementById("eventDialog").close();
    renderCalendar();
    renderHomeSchedule();
  }

  function moveCalendar(direction) {
    if (store.calendarView === "month") {
      store.cursor.setMonth(store.cursor.getMonth() + direction);
    } else if (store.calendarView === "week") {
      store.cursor.setDate(store.cursor.getDate() + direction * 7);
    } else {
      store.cursor.setDate(store.cursor.getDate() + direction);
    }
    renderCalendar();
  }

  async function enableReminders() {
    if (!("Notification" in window)) {
      document.getElementById("reminderStatus").textContent =
        "Desktop notifications are unavailable";
      return;
    }

    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    store.remindersEnabled = permission === "granted";
    save(keys.reminders, store.remindersEnabled);
    renderCalendar();
  }

  function checkReminders() {
    if (!store.remindersEnabled || Notification.permission !== "granted") return;
    const now = Date.now();
    let changed = false;
    store.events.forEach((event) => {
      const eventTime = getEventDateTime(event).getTime();
      if (
        event.reminder &&
        !event.reminded &&
        eventTime >= now &&
        eventTime - now <= 30000
      ) {
        new Notification("Jarvis reminder", {
          body: event.title,
          silent: false,
        });
        event.reminded = true;
        changed = true;
      }
    });
    if (changed) save(keys.events, store.events);
  }

  function init() {
    updateTopbarDateTime();
    window.setInterval(updateTopbarDateTime, 1000);
    window.addEventListener("resize", updateTopbarDateTime);

    updateTheme(load(keys.theme, "light") === "dark" ? "dark" : "light");
    const sidebarToggle = document.getElementById("sidebarToggle");
    const setSidebarCollapsed = (collapsed, persist = true) => {
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      sidebarToggle.setAttribute(
        "aria-label",
        collapsed ? "Expand sidebar" : "Collapse sidebar",
      );
      sidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
      if (persist) save(keys.sidebarCollapsed, collapsed);
      requestAnimationFrame(resizeBrowserHost);
    };

    setSidebarCollapsed(load(keys.sidebarCollapsed, false) === true, false);
    sidebarToggle.addEventListener("click", () => {
      setSidebarCollapsed(
        !document.body.classList.contains("sidebar-collapsed"),
      );
    });

    document
      .getElementById("browserAssistantButton")
      .addEventListener("click", () => {
        setBrowserAssistantOpen(
          document.getElementById("browserAssistantPanel").hidden,
          true,
        );
      });
    document
      .getElementById("closeBrowserAssistant")
      .addEventListener("click", () => setBrowserAssistantOpen(false));

    setAssistantTab("live");
    const assistantTabs = [
      document.getElementById("assistantLiveTab"),
      document.getElementById("assistantLogsTab"),
    ];
    assistantTabs.forEach((tab, index) => {
      tab.addEventListener("click", () =>
        setAssistantTab(index === 0 ? "live" : "logs"),
      );
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? 1
              : (index + (event.key === "ArrowRight" ? 1 : -1) + 2) % 2;
        setAssistantTab(nextIndex === 0 ? "live" : "logs", true);
      });
    });

    document.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => setPage(button.dataset.page));
    });
    document.querySelector(".brand").addEventListener("click", (event) => {
      event.preventDefault();
      setPage("dashboard");
    });

    document.querySelectorAll('[data-action="toggle-theme"]').forEach((button) => {
      button.addEventListener("click", () => {
        updateTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
      });
    });

    document.querySelectorAll("[data-meal-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const meal = form.dataset.mealForm;
        const dateKey = formatDateKey(new Date());
        const protein = Number(formData.get("protein"));
        const plan = getFoodPlan(dateKey);
        plan[meal] = {
          foods: String(formData.get("foods") || "").trim(),
          protein: Number.isFinite(protein)
            ? Math.max(0, Math.min(300, Math.round(protein)))
            : 0,
        };
        store.foodPlans[dateKey] = plan;
        const saved = save(keys.foodPlans, store.foodPlans);
        document.getElementById("foodStatus").textContent = saved
          ? "Meal plan saved on this device."
          : "Meal plan could not be saved. Check available device storage.";
        renderFoodPage();
      });
    });

    document.getElementById("produceForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const name = String(formData.get("name") || "").trim();
      if (!name) return;
      store.produce.push({
        id: crypto.randomUUID(),
        name,
        type: String(formData.get("type")),
      });
      const saved = save(keys.produce, store.produce);
      document.getElementById("foodStatus").textContent = saved
        ? "Produce list saved on this device."
        : "Produce list could not be saved. Check available device storage.";
      form.reset();
      renderProduce();
      document.getElementById("produceName").focus();
    });

    document.querySelector(".food-page").addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-produce]");
      if (!removeButton) return;
      store.produce = store.produce.filter(
        (item) => item.id !== removeButton.dataset.removeProduce,
      );
      const saved = save(keys.produce, store.produce);
      document.getElementById("foodStatus").textContent = saved
        ? "Produce removed from your local list."
        : "Produce list could not be saved. Check available device storage.";
      renderProduce();
    });

    document
      .getElementById("dashboardSearchForm")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        const query = document.getElementById("dashboardSearch").value.trim();
        if (query) navigateTo(query);
      });

    document.querySelectorAll(".quick-action").forEach((button) => {
      button.addEventListener("click", () => navigateTo(button.dataset.url));
    });

    document.getElementById("newTabButton").addEventListener("click", () => {
      openTab();
    });

    document.querySelectorAll("[data-browser-tool]").forEach((button) => {
      button.addEventListener("click", () =>
        openBrowserTool(button.dataset.browserTool),
      );
    });

    document
      .querySelector('[data-action="close-utility"]')
      .addEventListener("click", () => {
        document.getElementById("browserUtilityPanel").hidden = true;
      });

    document
      .getElementById("customizeBtn")
      .addEventListener("click", (event) => {
        const enabled = document.body.classList.toggle("customizing");
        event.currentTarget.setAttribute("aria-pressed", String(enabled));
        event.currentTarget.textContent = enabled
          ? "Done customizing"
          : "Customize";
      });
    document.getElementById("restoreCardsBtn").addEventListener("click", () => {
      store.hiddenCards = [];
      save(keys.hiddenCards, store.hiddenCards);
      document.querySelectorAll("[data-card-key]").forEach((card) => {
        card.hidden = false;
      });
      document.getElementById("restoreCardsBtn").hidden = true;
    });

    document
      .querySelectorAll('[data-action="hide-card"]')
      .forEach((button) => {
        button.addEventListener("click", () => {
          const card = button.closest("[data-card-key]");
          if (!card) return;
          card.hidden = true;
          if (!store.hiddenCards.includes(card.dataset.cardKey)) {
            store.hiddenCards.push(card.dataset.cardKey);
            save(keys.hiddenCards, store.hiddenCards);
          }
          document.getElementById("restoreCardsBtn").hidden = false;
        });
      });

    store.hiddenCards.forEach((key) => {
      const card = document.querySelector(`[data-card-key="${key}"]`);
      if (card) card.hidden = true;
    });
    document.getElementById("restoreCardsBtn").hidden =
      store.hiddenCards.length === 0;

    document.querySelectorAll("[data-calendar-view]").forEach((button) => {
      button.addEventListener("click", () => {
        store.calendarView = button.dataset.calendarView;
        renderCalendar();
      });
    });

    document
      .querySelector('[data-action="calendar-prev"]')
      .addEventListener("click", () => moveCalendar(-1));
    document
      .querySelector('[data-action="calendar-next"]')
      .addEventListener("click", () => moveCalendar(1));
    document
      .querySelector('[data-action="calendar-today"]')
      .addEventListener("click", () => {
        store.cursor = new Date();
        renderCalendar();
      });
    document
      .getElementById("addEventButton")
      .addEventListener("click", () => openEventDialog());
    document
      .getElementById("eventForm")
      .addEventListener("submit", handleEventSubmit);
    document
      .getElementById("deleteEventButton")
      .addEventListener("click", () => {
        const id = document.getElementById("eventId").value;
        if (id) deleteEvent(id);
      });
    document.querySelectorAll('[data-action="close-event"]').forEach((button) => {
      button.addEventListener("click", () =>
        document.getElementById("eventDialog").close(),
      );
    });
    document
      .getElementById("calendarGrid")
      .addEventListener("click", (event) => {
        const officeChip = event.target.closest("[data-office-date]");
        if (officeChip) {
          openOfficeDialog(officeChip.dataset.officeDate);
          return;
        }
        const editButton = event.target.closest("[data-event-edit]");
        if (editButton) {
          const selected = store.events.find(
            (item) => item.id === editButton.dataset.eventEdit,
          );
          if (selected) openEventDialog(selected.date, selected);
          return;
        }
        const cell = event.target.closest("[data-date]");
        if (cell) openEventDialog(cell.dataset.date);
      });

    document.querySelectorAll("[data-office-target]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setOfficeDayTarget(Number(btn.dataset.officeTarget));
      });
    });

    document.getElementById("officeNetworkBtn")?.addEventListener("click", () => {
      openOfficeDialog(formatDateKey(new Date()));
    });

    document.getElementById("calOfficeSettingsBtn")?.addEventListener("click", () => {
      openOfficeDialog(formatDateKey(new Date()));
    });

    document.querySelectorAll('[data-action="close-office-dialog"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("officeTimerDialog").close();
      });
    });

    document.getElementById("noteCurrentNetworkBtn")?.addEventListener("click", async () => {
      const net = await refreshOfficeNetwork();
      const candidates = Array.from(
        new Set([net.name, net.ssid, net.profile, ...(net.identifiers || [])].filter(Boolean)),
      );
      if (!candidates.length) {
        updateFirebaseBadge("NO ACTIVE NETWORK");
        return;
      }
      store.officeConfig.officeNetworks = Array.from(
        new Set([...store.officeConfig.officeNetworks, ...candidates]),
      );
      await syncOfficeConfigToFirebase();
      handleOfficeNetworkUpdate(net);
      renderOfficeDialog();
      renderCalendar();
    });

    document.getElementById("addOfficeNetworkForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("addOfficeNetworkInput");
      const val = String(input.value || "").trim();
      if (!val) return;
      if (!store.officeConfig.officeNetworks.some((n) => n.toLowerCase() === val.toLowerCase())) {
        store.officeConfig.officeNetworks.push(val);
        await syncOfficeConfigToFirebase();
      }
      input.value = "";
      handleOfficeNetworkUpdate(officeState.network);
      renderOfficeDialog();
      renderCalendar();
    });

    document.getElementById("officeNotedNetworksList")?.addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-remove-office-network]");
      if (!btn) return;
      const targetNet = btn.dataset.removeOfficeNetwork;
      store.officeConfig.officeNetworks = store.officeConfig.officeNetworks.filter(
        (n) => n !== targetNet,
      );
      await syncOfficeConfigToFirebase();
      handleOfficeNetworkUpdate(officeState.network);
      renderOfficeDialog();
      renderCalendar();
    });

    document.getElementById("officeDefaultTargetSelect")?.addEventListener("change", async (event) => {
      store.officeConfig.defaultTargetMinutes = Number(event.target.value) === 420 ? 420 : 510;
      await syncOfficeConfigToFirebase();
      renderOfficeTimerUI();
    });

    document.getElementById("officeAutoStartToggle")?.addEventListener("change", async (event) => {
      store.officeConfig.autoStartOnOfficeNetwork = event.target.checked;
      await syncOfficeConfigToFirebase();
      if (event.target.checked) {
        handleOfficeNetworkUpdate(officeState.network);
      }
    });

    document.getElementById("officeInspectDate")?.addEventListener("change", (event) => {
      if (event.target.value) {
        officeState.inspectDateKey = event.target.value;
        renderOfficeDialog();
      }
    });

    document.getElementById("officeSaveDayBtn")?.addEventListener("click", async () => {
      const dateKey = officeState.inspectDateKey || formatDateKey(new Date());
      const targetMinutes =
        Number(document.getElementById("officeDayTargetSelect").value) === 420 ? 420 : 510;
      const minutesInput = Math.max(
        0,
        Math.min(1440, Math.round(Number(document.getElementById("officeDayMinutesInput").value) || 0)),
      );
      const rec = getOfficeRecord(dateKey);
      rec.targetMinutes = targetMinutes;
      rec.elapsedSeconds = minutesInput * 60;
      if (!rec.networkName && store.officeConfig.officeNetworks.length) {
        rec.networkName = store.officeConfig.officeNetworks[0];
      }
      setOfficeRecord(dateKey, rec);
      await syncOfficeDayToFirebase(dateKey);
      renderOfficeDialog();
      renderOfficeTimerUI();
      renderCalendar();
      renderHomeSchedule();
    });
    document
      .getElementById("upcomingEvents")
      .addEventListener("click", (event) => {
        const editButton = event.target.closest("[data-event-edit]");
        if (!editButton) return;
        const selected = store.events.find(
          (item) => item.id === editButton.dataset.eventEdit,
        );
        if (selected) openEventDialog(selected.date, selected);
      });
    document
      .getElementById("reminderPermissionButton")
      .addEventListener("click", enableReminders);

    document.body.addEventListener("click", (event) => {
      const waterButton = event.target.closest('[data-action^="water-"]');
      if (waterButton) {
        setWaterCount(waterButton.dataset.action === "water-plus" ? 1 : -1);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        !document.getElementById("browserAssistantPanel").hidden
      ) {
        setBrowserAssistantOpen(false);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        if (document.body.dataset.page === "browser") {
          document.getElementById("url").focus();
        } else {
          setPage("dashboard");
          document.getElementById("dashboardSearch").focus();
        }
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "t" &&
        document.body.dataset.page === "browser"
      ) {
        event.preventDefault();
        openTab();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "w" &&
        document.body.dataset.page === "browser"
      ) {
        event.preventDefault();
        closeTab(store.activeTab);
      }
    });

    window.addEventListener("resize", resizeBrowserHost);
    const windowApi = window.electronAPI;
    const setMaximizedState = (isMaximized) => {
      document.body.classList.toggle("window-maximized", isMaximized);
    };

    if (windowApi?.onWindowMaximized) {
      windowApi.onWindowMaximized(setMaximizedState);
    }

    if (windowApi?.isWindowMaximized) {
      windowApi.isWindowMaximized().then(setMaximizedState).catch((error) => {
        console.error("Unable to read window state:", error);
      });
    }

    const windowActions = {
      minimize: windowApi?.minimizeWindow,
      maximize: windowApi?.toggleMaximizeWindow,
      close: windowApi?.closeWindow,
    };

    document.querySelectorAll("[data-window-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = windowActions[button.dataset.windowAction];
        if (typeof action !== "function") {
          console.error(`Window action is unavailable: ${button.dataset.windowAction}`);
          return;
        }

        action()
          .then((isMaximized) => {
            if (button.dataset.windowAction === "maximize") {
              setMaximizedState(isMaximized);
            }
          })
          .catch((error) => {
            console.error(`Unable to ${button.dataset.windowAction} window:`, error);
          });
      });
    });

    document.querySelector(".topbar")?.addEventListener("dblclick", (event) => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      windowApi?.toggleMaximizeWindow?.().then(setMaximizedState).catch((error) => {
        console.error("Unable to toggle window maximization:", error);
      });
    });

    if (window.browserAPI?.onURLChanged) {
      window.browserAPI.onURLChanged(recordVisit);
    }

    const savedWater = Number(store.water[formatDateKey(new Date())] ?? 4);
    renderWaterCount(
      Math.max(0, Math.min(8, Number.isFinite(savedWater) ? savedWater : 4)),
    );
    document.getElementById("url").value = activeTab().url;
    renderTabs();
    renderHome();
    renderCalendar();
    initOfficeTimer();
    setPage("dashboard");
    window.setInterval(checkReminders, 30000);
  }

  initializeFeatherIcons();
  init();
})();
