let tabs = [];
let activeTab = null;

function newTab(url = "https://google.com") {
  const id = Date.now();

  tabs.push({ id, url });
  activeTab = id;

  renderTabs();
  renderBrowser();
}

function switchTab(id) {
  activeTab = id;
  renderTabs();
  renderBrowser();
}

function renderTabs() {
  const container = document.getElementById("tabs");
  container.innerHTML = "";

  tabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab " + (t.id === activeTab ? "active" : "");
    el.innerText = "New Tab";
    el.onclick = () => switchTab(t.id);
    container.appendChild(el);
  });
}

window.newTab = newTab;
window.switchTab = switchTab;

newTab();
