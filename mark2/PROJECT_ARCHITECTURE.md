# PROJECT ARCHITECTURE & CODEBASE FORENSICS REPORT
**Project:** Friday / Jarvis Browser (v3.0.0)  
**Corpus / Workspace:** JammyJamm/JarvisBrowser (D:\Personal\AI_IPL\mark2)  
**Role:** Principal Browser-Engineering & AI-Agent Architect  
**Date:** September 2026  

---

## Executive Summary

This report delivers an exhaustive forensic inspection of the existing **Friday / Jarvis Browser** codebase. The current system is a hybrid desktop application combining an **Electron 42 (WebContentsView)** client, a local **Express 4/5 backend**, a **Playwright-over-CDP** browser automation controller, an **Ollama (qwen3:8b)** local LLM planner, a custom **DOM Scoring Engine**, an **IFrame/SVG extraction engine**, and a **Google Cloud Firestore (Firebase)** real-time data persistence pipeline.

The goal of this architectural modernization is to upgrade Friday into an **ultra-fast, production-grade agentic browser** incorporating the best architectural patterns from Chromium multi-process design, Jarvis AI browsing, Playwright automation, Model Context Protocol (MCP), and vision-language computer-use agents—**without blindly rewriting working features**.

---

## 1. Existing Architecture

```
                                  [USER]
                                    │
                                    ▼
                     ┌──────────────────────────────┐
                     │ Electron Main (main/main.js) │
                     │  - Remote Debugging: 9222    │
                     │  - WebContentsView (Browser) │
                     │  - BrowserWindow (UI View)   │
                     └──────────────┬───────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               │                                         │
        (Preload IPC)                              (Local HTTP)
               │                                         │
               ▼                                         ▼
   ┌───────────────────────┐                 ┌───────────────────────┐
   │ Frontend UI (Vanilla) │                 │ Express Backend (9000)│
   │ - index.html          │                 │ backend/server.js     │
   │ - ai.js               │                 └───────────┬───────────┘
   │ - styles.css          │                             │
   └───────────────────────┘                             ▼
                                             ┌───────────────────────┐
                                             │    Command Router     │
                                             │ (backend/command-     │
                                             │    router.js)         │
                                             └─────┬───────────┬─────┘
                                                   │           │
                                           [Chat]  │           │  [Action]
                                                   ▼           ▼
                                       ┌──────────────┐  ┌──────────────────┐
                                       │  AI Engine   │  │   Fast-Path      │
                                       │ (aiEngine.js)│  │ (Regex Engine)   │
                                       └──────┬───────┘  └─────────┬────────┘
                                              │                    │ (Miss)
                                              ▼                    ▼
                                       ┌──────────────┐  ┌──────────────────┐
                                       │ Ollama API   │  │  Planner (LLM)   │
                                       │ (qwen3:8b)   │  │  backend/        │
                                       └──────────────┘  │  planner.js      │
                                                         └─────────┬────────┘
                                                                   │
                                                                   ▼
                                                         ┌──────────────────┐
                                                         │     ToolMap      │
                                                         │(backend/tool-    │
                                                         │    map.js)       │
                                                         └─────────┬────────┘
                                                                   │
                                                                   ▼
                                                         ┌──────────────────┐
                                                         │     Resolver     │
                                                         │ (backend/        │
                                                         │  resolver.js)    │
                                                         └─────────┬────────┘
                                                                   │
                                                                   ▼
                                                         ┌──────────────────┐
                                                         │BrowserController │
                                                         │(Playwright CDP   │
                                                         │  -> Port 9222)   │
                                                         └──────────────────┘
```

### Process Layout & Topology
1. **Electron Main Process (`main/main.js`):**
   - Launches Chromium with switch `--remote-debugging-port=9222`.
   - Creates a primary `BrowserWindow` loading `main/renderer/index.html` with `preload.js` (isolated context).
   - Creates a `WebContentsView` (`browserView`) added as a child view to `win.contentView`.
   - Manages bounds resizing by evaluating DOM coordinates of `#browser` in the UI via `executeJavaScript`.
   - Registers IPC handlers for `navigate`, `back`, `forward`, `reload`, `browser-svg`, `browser-container-data`, `browser-execute`, and `browser-dismiss-popup`.
2. **Renderer UI Process (`main/renderer/`):**
   - Built with Vanilla HTML5, CSS3, and JavaScript (`index.html`, `ai.js`, `styles.css`).
   - Hosts the address bar, browser view container, Jarvis status animations, interactive command console, and a **Firebase 4-Values Board**.
   - Contains legacy/test files `browser.js` and `tabs.js` attempting `<webview>` tags (inactive, not loaded by `index.html`).
   - Re-exported by root `renderer/ai.js`.
3. **Backend Control Plane (`backend/server.js`):**
   - Express 4.19 / 5.1 server running on `http://127.0.0.1:9000`.
   - Provides REST endpoints: `/run`, `/init`, `/status`, `/health`, `/snapshot`, `/html`, `/page`, `/svg`, `/iframe/svg`, `/iframe/data`, `/iframe/stream`, `/api/save-round`, `/api/get-rounds`, `/api/dismiss-popup`, `/iframes`, `/tool`, `/tools`, `/history`, `/metrics`, `/cache/clear`.
4. **Browser Automation Layer (`backend/browser-controller.js` & `backend/mcp-client.js`):**
   - Playwright connects via `chromium.connectOverCDP("http://127.0.0.1:9222")`.
   - Filters out DevTools pages (`devtools://*`, `chrome://*`, `chrome-extension://*`).
   - Directly manipulates DOM, frames, and accessibility snapshots.
5. **Database Layer (`database/firebaseConfig.js` & `database/gameservice.js`):**
   - Direct connection to Google Cloud Firestore (`aiproject-e5167`).
   - Custom real-time data persistence engine storing formatted 4-value round arrays into the `Bio_sic` collection organized by date (`YYYY-MM-DD`) and indexed in chunks of 90 items.

---

## 2. Existing AI Models & Providers

| Component | Provider | Model | Endpoint / Protocol | Usage |
|---|---|---|---|---|
| **Chat Engine** (`backend/aiEngine.js`) | Ollama (Local) | `qwen3:8b` | `http://localhost:11434/api/generate` | Conversational browser assistant, direct Q&A, token streaming |
| **LLM Planner** (`backend/planner.js`) | Ollama / OpenAI Compatible | `qwen3:8b` (fallback: OpenAI API) | `http://localhost:11434/api/generate` | Translates user natural language into structured JSON execution steps |
| **Core Planner** (`backend/planner/planner.js`) | Ollama / OpenAI | Configurable via `options.provider` | Configurable | Secondary fallback planning engine with JSON repair |
| **Vision / Multimodal** | **None** | **None** | **None** | Page state is reduced to text snapshots or regex strings; **no vision model is used** |
| **Embeddings** | **None** | **None** | **None** | No embedding model or vector representation exists |

**Key Finding:** Although root `package.json` includes `openai: "^6.32.0"`, the application defaults strictly to local Ollama with zero visual perception.

---

## 3. Existing Agent Runtime

The agent runtime in Friday operates as a linear multi-phase pipeline with deterministic fast-path priority:

1. **Command Router (`backend/command-router.js`):**
   - Classifies input into `chat` or `action`.
   - Detects multi-line numbered action sequences (e.g. `1. Open... 2. Click...`).
2. **Fast-Path Planner (`backend/planner/fast-path.js`):**
   - High-speed regex parser handling common commands without invoking any LLM:
     - Navigation: `go to <url>`, `open <url>`, `back`, `forward`, `reload`.
     - Direct Click: `click <target> button`.
     - Direct Type: `type <value> into <field>`.
     - IFrame / Container Data: `get data from .tzQn0o`, `get svg from <selector>`.
     - Polling Interval: `watch data from .tzQn0o every 5s`, `stop interval`.
3. **LLM Planner & Normalizer (`backend/planner.js`):**
   - If fast-path misses, captures an accessibility text snapshot via `mcp.snapshot()`.
   - Sends the snapshot + user request to `qwen3:8b`.
   - Features custom JSON extraction and repair (`repairJSON()`) to fix malformed model output.
   - Normalizes steps into standardized `{ tool, args }` structures.
4. **DOM Scoring Engine (`backend/planner/scoring-engine.js`):**
   - 2,532-line engine computing weighted scores across exact match, token overlap, Jaro-Winkler distance, Levenshtein edit distance, Dice coefficient, accessibility attributes, visibility, and actionability.
5. **Self-Healing Engine (`backend/planner/self-healing.js`):**
   - 965-line recovery system that classifies failures (stale element, timeout, target invisible, frame detached) and attempts alternative strategies with exponential backoff.
6. **Execution Lock:**
   - Single in-memory run lock (`serverState.runLocked`) in `server.js` preventing concurrent execution of `/run`.

---

## 4. Existing Actions / Tools

Registered tools in `backend/tool-map.js` (lines 433–1280):

| Tool Name | Handler Source | Purpose | Arguments |
|---|---|---|---|
| `click` | `resolver.clickSmart` | Clicks elements using scoring engine ranking | `target`, `selector`, `text` |
| `type` | `resolver.typeSmart` | Focuses and types values into inputs/textareas | `target` / `field`, `value` / `text` |
| `navigate` | `resolver.navigate` / `mcp.goto` | Navigates to a specific URL | `url`, `value` |
| `search` | `resolver.searchSmart` | Types into search inputs and presses Enter | `query`, `text`, `value` |
| `select` | `resolver.select` | Selects options from dropdowns | `target`, `value` |
| `check` | `resolver.check` | Checks checkboxes or radio buttons | `target` |
| `uncheck` | `resolver.uncheck` | Unchecks checkboxes | `target` |
| `hover` | `resolver.hover` | Hovers over an element | `target` |
| `press` | `resolver.press` | Dispatches keyboard events | `key` |
| `wait` | `resolver.wait` | Explicit sleep / wait for condition | `time`, `ms` |
| `snapshot` | `mcp.snapshot` | Captures accessibility DOM snapshot | `{}` |
| `html` | `mcp.html` | Retrieves full HTML markup | `{}` |
| `read` | `resolver.read` | Reads inner text from page or element | `target` |
| `scroll` | `resolver.scroll` | Scrolls viewport or scrollable container | `direction`, `amount` |
| `reload` | `resolver.reload` | Reloads active page | `{}` |
| `back` | `resolver.back` | Navigates back in browser history | `{}` |
| `forward` | `resolver.forward` | Navigates forward in browser history | `{}` |
| `get_svg` | `iframeContent.getFrameSVGs` | Extracts SVG elements, paths, and viewBox | `targetClass`, `onlyIframes` |
| `get_iframe_svg` | `iframeContent.getFrameSVGs` | Extracts SVGs from nested iframes | `parentClass`, `frameUrl` |
| `extract_svg` | `iframeContent.getAllSVGsFromFrames` | Aggregates all SVGs across all document frames | `options` |
| `click_svg` | `iframeContent.clickInsideEvolutionFrame`| Clicks coordinates inside canvas/SVG frames | `selector`, `frameUrl` |
| `get_iframe_data`| `iframeContent.getFrameContainerData`| Extracts container nodes, SVGs, buttons, inputs | `target`, `frameUrl` |
| `watch_iframe_data`| Polling loop in `server.js` | Emits continuous updates for targeted containers | `target`, `interval` |
| `stop_interval` | Polling loop in `server.js` | Terminates active interval watcher | `{}` |
| `dismiss_inactivity_popup` | `iframeContent.dismissInactivityPopup` | Finds and dismisses idle/timeout modals | `{}` |

---

## 5. Existing Playwright Code

- **Controller (`backend/browser-controller.js`):**
  - Uses `playwright` (`chromium.connectOverCDP`).
  - Implements `connectInternal(force)` with automatic reconnection on disconnect.
  - Implements `isAutomationPage(page)`:
    ```javascript
    const blockedProtocols = ["devtools:", "chrome:", "chrome-extension:", "edge:", "about:", "view-source:"];
    ```
  - Subscribes to page events: `dialog`, `download`, `popup`, `close`, `crash`.
- **Client (`backend/mcp-client.js`):**
  - High-level adapter wrapping `BrowserController` methods.
  - Implements `snapshot()`, `html()`, `evaluate()`, and frame enumeration.
- **Embedded MCP Submodule (`backend/playwright-mcp/`):**
  - Contains a complete local checkout of Microsoft's `@playwright/mcp@0.0.75`.

---

## 6. Existing MCP Servers & Clients

- **Root Config (`mcp-config.json`):**
  ```json
  {
    "mcpServers": {
      "playwright": {
        "command": "npx",
        "args": ["@playwright/mcp@0.0.78", "--port", "8931"]
      }
    }
  }
  ```
- **CLI Startup Script (`start-playwright-mcp.cmd`):**
  `npx @playwright/mcp@0.0.78 --port 8931`
- **Installed Packages:**
  - `@modelcontextprotocol/sdk`: `^1.29.0` (in root), `^1.17.5` (in backend).
  - `@playwright/mcp`: `^0.0.75` (in root).
- **Forensic Finding:** `backend/mcp-client.js` is named `PlaywrightMCPClient`, but it connects directly to Electron CDP via Playwright's Node API rather than calling MCP tools over JSON-RPC (Stdio or SSE). The official MCP SDK is present but largely unutilized in the main agent execution path.

---

## 7. Existing Browser APIs

### Exposed via Electron Preload (`main/preload.js`):
```javascript
contextBridge.exposeInMainWorld("electronAPI", {
  resizeBrowser: () => ipcRenderer.invoke("resize-browser"),
});

contextBridge.exposeInMainWorld("browserAPI", {
  navigate: (url) => ipcRenderer.invoke("navigate", url),
  back: () => ipcRenderer.invoke("back"),
  forward: () => ipcRenderer.invoke("forward"),
  reload: () => ipcRenderer.invoke("reload"),
  getSVG: (options) => ipcRenderer.invoke("browser-svg", options),
  getContainerData: (selectorOrClass) => ipcRenderer.invoke("browser-container-data", selectorOrClass),
  getHTML: () => ipcRenderer.invoke("browser-html"),
  getURL: () => ipcRenderer.invoke("browser-url"),
  dismissPopup: () => ipcRenderer.invoke("browser-dismiss-popup"),
});
```

### Electron Main Handlers (`main/main.js`):
- `navigate`: `browserView.webContents.loadURL(url)`
- `back`, `forward`, `reload`: WebContents navigation methods
- `browser-svg`: Executes in-page JavaScript extracting SVG elements, paths, and bounding boxes from the main document and accessible iframes.
- `browser-container-data`: Evaluates target container classes (e.g. `.tzQn0o`, `.dGBOyn`), extracting text, numbers, rotation angles, SVGs, buttons, and inputs.
- `browser-dismiss-popup`: Evaluates DOM to locate modal dialogs with keywords (`inactivity`, `session timeout`, `are you still there`, `keep playing`, `resume game`) or in-game play-button overlays (`data-role="play-button"`, `.A2zb9M`, `.VQJTA7`, `.iTKQgM`, `.E0dFqh`) and triggers click events.

---

## 8. Existing Memory System

1. **Plan LRU Cache (`backend/planner/cache.js`, `planner-cache.js`):**
   - Stores up to 100 planned outputs keyed by sha256/normalized command text.
   - TTL: 30 minutes.
2. **Command History (`backend/planner/command-history.js`):**
   - Ring buffer storing the last 50 executed commands, plans, and success statuses.
3. **DOM Element Cache (`backend/resolver.js`):**
   - In-memory cache of extracted interactive elements (`domCache.elements`).
   - TTL: 5,000ms (`domCacheTTL`). Invalidated on navigation.
4. **Learning Cache (`backend/resolver.js`):**
   - In-memory Map linking `(normalizedTarget + action)` to previously successful selectors/paths.
5. **No Persistent Session Memory:**
   - When the backend restarts, all planner, command history, and learning caches are wiped out.

---

## 9. Existing Vector Database

- **Status:** **Completely Absent.**
- The repository contains zero vector store implementations (no ChromaDB, Milvus, Qdrant, LanceDB, or SQLite-VSS).
- Semantic search in `scoring-engine.js` is simulated via string metric algorithms (Jaro-Winkler, Levenshtein, Dice token overlap) rather than vector embeddings.

---

## 10. Existing Authentication

1. **Credential Manager (`backend/auth/credential-manager.js`):**
   - Uses Node.js deprecated `crypto.createCipher("aes-256-cbc", SECRET)`.
   - Insecure hardcoded key: `"Friday-Super-Secret-Key-Change-Me"`.
   - Stores credentials in `backend/auth/credentials.json`.
2. **Browser Profile Manager (`backend/auth/profile-manager.js`):**
   - Saves and loads Playwright browser storage state (`context.storageState({ path: ... })`) for sites (e.g., `amazon.json`, `flipkart.json`, `github.json`) in `backend/profiles/`.
   - Enables persistent cookies and session tokens.
3. **CDP Port Security:**
   - Remote debugging port `9222` has no authentication token or password, exposing Chromium CDP to any local process.

---

## 11. Existing IPC

- **Electron IPC:** Uses untyped string-channel IPC (`ipcRenderer.invoke` -> `ipcMain.handle`). No TypeScript interfaces or runtime schemas.
- **Dual Control Plane Conflict:**
  - The renderer communicates with Electron Main via `ipcRenderer.invoke` (Preload).
  - The renderer *also* communicates with the Express backend via HTTP `fetch("http://localhost:9000/run")`.
  - The Express backend *then* communicates with Electron Main via Playwright CDP over port 9222.
  - Result: Two separate asynchronous pipelines can drive the same browser view simultaneously.

---

## 12. Existing Security Boundaries

1. **Electron Sandbox:**
   - Main window: `contextIsolation: true`, `nodeIntegration: false`.
   - `WebContentsView`: `contextIsolation: true`.
2. **Missing Permission Engine:**
   - Agent actions (`click`, `type`, `navigate`, `browser-execute`) are executed automatically without human approval gates.
   - Any script can execute arbitrary JavaScript in `browser-execute` via IPC.
3. **CORS:**
   - Express server enables wildcard `cors()` on `http://127.0.0.1:9000`, allowing any website visited in the browser to make cross-origin requests to the local automation server.

---

## 13. Performance Bottlenecks

1. **Cold Start & Double Server Overhead:**
   - Booting Electron, Express, Playwright CDP, and Ollama sequentially causes multi-second initialization delays.
2. **Heavy DOM Injections:**
   - `browser-svg` and `browser-container-data` inject large stringified JavaScript functions (over 200 lines each) into the target page on every poll, causing noticeable micro-stutters.
3. **Ollama Planner Latency:**
   - Snapshot text dumps (often 10,000–30,000 characters) sent to local `qwen3:8b` take 3,000ms–8,000ms to process before the first action can run.
4. **Window Bounds Calculation via JS Eval:**
   - Every resize triggers `win.webContents.executeJavaScript()` to get boundingClientRect of `#browser` instead of using native layout calculations.
5. **No Parallel Execution:**
   - `serverState.runLocked` restricts execution to strictly sequential runs with no task queue or concurrency management.

---

## 14. Race Conditions

1. **Dual Navigation Race:**
   - `index.html` `navigate()` calls `browserAPI.navigate(url)` (Electron native) and immediately calls `backendFetch("/navigate")` or `backendFetch("/init")` (Playwright CDP `page.goto`). If both fire, the page cancels the first navigation mid-flight, causing `ERR_ABORTED`.
2. **Run Lock Deadlock:**
   - If a `/run` request encounters an unhandled exception before reaching `releaseRunLock()`, `serverState.runLocked` remains `true` indefinitely, locking out all subsequent user commands.
3. **Triplicate Inactivity Dismissal Collision:**
   - `ai.js` runs a 5-second interval that simultaneously fires:
     - Express backend `/api/dismiss-popup` (CDP evaluate)
     - Electron IPC `browser-dismiss-popup` (BrowserView evaluate)
     - Local DOM overlay query (`button[data-role="play-button"]`)
   - All three run concurrently and race to click buttons that may be unmounted or transitioning.
4. **DOM Cache Staleness:**
   - `resolver.js` holds a 5-second DOM cache. In single-page applications (SPAs) where elements re-render dynamically, the resolver clicks detached DOM nodes.

---

## 15. Missing Capabilities

1. **No Vision-Language Grounding:** Unable to reason about canvas, video players, WebGL, or complex SVGs without text labels.
2. **No Model Router:** No tiering between ultra-fast models (e.g., Gemini 2.5 Flash / Claude 3.5 Haiku) and deep reasoning models (e.g., Claude 3.7 Sonnet / Gemini 2.5 Pro).
3. **No True MCP Server/Client Layer:** MCP SDK is installed but not exposed as an extensible tool runtime.
4. **No Semantic Vector Memory:** Unable to remember previous user workflows or site-specific navigation tricks.
5. **No Policy Engine / Human Approval Gate:** No safety boundary to prompt the user before sensitive actions (e.g., transactions, credentials, deletions).
6. **No Multi-Tab WebContentsView Management:** Legacy `tabs.js` is disconnected; only a single `WebContentsView` is active.

---

## 16. Recommended Migration Plan

### Phase 1: Structural Stabilization & Safety
- Unify the Dual Control Plane: Route all browser interactions through a single **Typed Main Control Plane**.
- Secure the backend: Bind Express strictly to `127.0.0.1`, restrict CORS to the Electron app origin, upgrade `credential-manager.js` to modern AES-256-GCM with PBKDF2/scrypt key derivation.
- Fix test suite regressions in `test-four-values-db-interval.js` and `test-time-values-popup-db.js`.

### Phase 2: Page Context Engine & Vision Integration
- Build a unified **Page Context Engine** extracting:
  1. DOM Accessibility Tree (AXTree)
  2. Interactive Element Bounding Boxes
  3. Viewport Screenshot with Set-of-Marks (SoM) visual IDs
- Integrate multimodal model routing (Vision + Fast LLM + Deep Reasoning).

### Phase 3: True MCP Tool Architecture & Policy Engine
- Wrap Playwright actions, SVG extractors, and Firebase sync into standard MCP Tools.
- Implement an extensible Policy Engine:
  - `ALLOWED` (auto-execute: navigation, read, scroll)
  - `CONFIRMATION_REQUIRED` (prompts user: click submit, payments, credential fills)
  - `BLOCKED` (file system writes outside sandbox, dangerous protocols)

### Phase 4: Production Agent Runtime & Vector Memory
- Implement an autonomous ReAct loop (Observe → Orient → Decide → Act) with goal replanning.
- Add local vector memory (LanceDB or SQLite-vec) for site recipes, UI patterns, and learned workflows.

---

## Phase 1 Component Preservation & Migration Matrix

| Old Component | Problem | New Component | Migration Strategy | Compatibility |
|---|---|---|---|---|
| `backend/server.js` (Monolithic Express) | Dual control plane, unauthenticated localhost endpoints, deadlock-prone run lock | **Electron Main Control Plane + Typed IPC** (with Express maintained for backward compatibility) | Retain existing `/run`, `/init`, `/api/*` endpoints as an adapter layer forwarding to the central control plane | **100% Backward Compatible** with existing UI & test scripts |
| `backend/planner/fast-path.js` (Regex Planner) | High speed, but rigid regex patterns | **Enhanced Fast-Path Engine** | Retain all existing regex patterns (click, type, svg, .tzQn0o, watch intervals); add fuzzy aliases | **100% Compatible**, preserves zero-latency paths |
| `backend/planner/scoring-engine.js` | 2,500 lines of solid scoring logic, but CPU-bound synchronous loops | **Optimized Scoring Engine** | Keep scoring algorithms (Jaro-Winkler, Levenshtein, Dice); add spatial coordinate awareness | **100% Compatible** |
| `backend/auth/credential-manager.js` | Insecure `createCipher` and hardcoded secret | **Secure Credential Vault** (`crypto.createCipheriv` + AES-256-GCM) | Transparently re-encrypt existing `credentials.json` on startup with migration fallback | **100% Compatible** with existing logins |
| `database/gameservice.js` | Works well, but timestamp ordering discrepancy in tests | **Standardized Game Service** | Preserve Firestore `Bio_sic` 90-item chunk schema; provide explicit chronological sorting options | **100% Compatible** with live Firebase board |
| `main/renderer/ai.js` | Triple-dismiss race condition, monolithic UI script | **Modular Agent UI Controller** | De-duplicate popup dismissers into a unified guarded hook; preserve 4-Values Board UI | **100% Compatible** with existing visual layout |
