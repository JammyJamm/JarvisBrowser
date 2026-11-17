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
        const remove = makeElement("button", "produce-remove", "×");
        remove.type = "button";
        remove.dataset.removeProduce = item.id;
        remove.setAttribute("aria-label", `Remove ${item.name}`);
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
      const close = makeElement("button", "browser-tab-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", `Close ${getSiteLabel(tab.url)}`);
      close.tabIndex = -1;

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
      const open = makeElement("button", "site-open-button", "↗");
      open.type = "button";
      open.setAttribute("aria-label", `Open ${getSiteLabel(item.url)}`);
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
    const todaysEvents = store.events
      .filter((event) => event.date === today)
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
      .slice(0, 2);

    if (!todaysEvents.length) {
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

    dates.forEach((date) => {
      const dateKey = formatDateKey(date);
      const cell = makeElement("div", "calendar-day");
      cell.dataset.date = dateKey;
      cell.classList.toggle("outside-month", date.getMonth() !== store.cursor.getMonth() && store.calendarView === "month");
      cell.classList.toggle("today", dateKey === formatDateKey(new Date()));
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

      getEventsForDate(date).slice(0, 3).forEach((event) => {
        const chip = makeElement("button", "calendar-event-chip", event.title);
        chip.type = "button";
        chip.dataset.eventEdit = event.id;
        chip.setAttribute("aria-label", `Edit ${event.title}`);
        cell.append(chip);
      });
      const extraCount = getEventsForDate(date).length - 3;
      if (extraCount > 0) {
        cell.append(makeElement("span", "calendar-event-chip", `+${extraCount} more`));
      }
      grid.append(cell);
    });

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
      const open = makeElement("button", "site-open-button", "↗");
      open.type = "button";
      open.setAttribute("aria-label", `Open ${getSiteLabel(item.url)}`);
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
    setPage("dashboard");
    window.setInterval(checkReminders, 30000);
  }

  init();
})();
