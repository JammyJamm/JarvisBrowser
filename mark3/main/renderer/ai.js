//==========================================================
//
// main/renderer/ai.js
//
// Jarvis Agentic AI Controller (#cmd)
//
// Primary Natural-Language Interface for Browser Automation:
// ✔ Understands user intent for web page actions
// ✔ Visualizes execution plans with sequential steps
// ✔ Displays live verification badges (Verified / Failed)
// ✔ Supports conversational replies and follow-ups
// ✔ Enforces page-only boundary (no OS/desktop control)
//
//==========================================================

(() => {
  const BACKEND_URL = window.aiState?.backendUrl || "http://localhost:9000";

  const form = document.getElementById("ai-form");
  const input = document.getElementById("cmd");
  const submitBtn = document.getElementById("submitCmdBtn");

  let isExecuting = false;
  let activeAbortController = null;

  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(text, state = "ready") {
    const statusEl = document.getElementById("statusText");
    if (statusEl) {
      statusEl.innerText = text;
      const statusBlock = statusEl.closest(".statusBlock");
      if (statusBlock) {
        statusBlock.dataset.state = state;
      }
    }
  }

  function scrollConversationToBottom() {
    const conversation = document.getElementById("assistantConversation");
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }

  function startShimmer() {
    const anim = document.querySelector(".animation");
    if (anim) anim.classList.add("active");
  }

  function stopShimmer() {
    const anim = document.querySelector(".animation");
    if (anim) anim.classList.remove("active");
  }

  function logToPanel(message, details = null) {
    const logs = document.getElementById("logs");
    if (logs) {
      const timeStr = new Date().toLocaleTimeString();
      const div = document.createElement("div");
      div.className = "log-entry";
      div.innerHTML = `<span class="log-time">[${timeStr}]</span> ${escapeHTML(message)}`;
      if (details) {
        const pre = document.createElement("pre");
        pre.className = "log-details";
        pre.textContent = typeof details === "string" ? details : JSON.stringify(details, null, 2);
        div.appendChild(pre);
      }
      logs.appendChild(div);
      logs.scrollTop = logs.scrollHeight;
    }

    if (typeof window.jarvisLog === "function") {
      window.jarvisLog(`[#cmd] ${message}`);
    }
  }

  // ==========================================================
  // CONVERSATION UI BUILDERS
  // ==========================================================

  function appendUserMessage(text) {
    const conversation = document.getElementById("assistantConversation");
    if (!conversation) return null;

    const block = document.createElement("div");
    block.className = "msg-block";

    const user = document.createElement("div");
    user.className = "user-msg";
    user.innerText = text;

    block.appendChild(user);
    conversation.appendChild(block);
    scrollConversationToBottom();

    return block;
  }

  function appendAgentCard(parentBlock, initialStatus = "Thinking...") {
    const conversation = document.getElementById("assistantConversation");
    if (!conversation) return null;

    const aiMsg = document.createElement("div");
    aiMsg.className = "ai-msg agent-plan-card";

    const header = document.createElement("div");
    header.className = "agent-card-header";
    header.innerHTML = `
      <span class="agent-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg></span>
      <span class="agent-title">${escapeHTML(initialStatus)}</span>
    `;

    const body = document.createElement("div");
    body.className = "agent-card-body";

    aiMsg.appendChild(header);
    aiMsg.appendChild(body);

    if (parentBlock) {
      parentBlock.appendChild(aiMsg);
    } else {
      conversation.appendChild(aiMsg);
    }

    scrollConversationToBottom();
    return { container: aiMsg, header, body };
  }

  function renderPlanSteps(cardBody, plan, executedSteps = []) {
    cardBody.innerHTML = "";

    if (plan.goal || plan.summary) {
      const goalEl = document.createElement("div");
      goalEl.className = "agent-goal-summary";
      goalEl.innerHTML = `<strong>Goal:</strong> ${escapeHTML(plan.goal || plan.summary || "Execute browser task")}`;
      cardBody.appendChild(goalEl);
    }

    const stepsList = document.createElement("div");
    stepsList.className = "agent-steps-list";

    const steps = Array.isArray(plan.steps) ? plan.steps : [];

    steps.forEach((step, idx) => {
      const stepEl = document.createElement("div");
      stepEl.className = "agent-step-item";

      const execResult = executedSteps.find((s) => s.step === idx + 1 || s.index === idx);
      const isDone = !!execResult;
      const isSuccess = execResult ? execResult.success !== false : false;

      let statusIcon = "⏳";
      let statusClass = "pending";

      if (isDone) {
        if (isSuccess) {
          statusIcon = "✅";
          statusClass = "success";
        } else {
          statusIcon = "❌";
          statusClass = "failure";
        }
      }

      stepEl.classList.add(`step-${statusClass}`);

      // Format args preview
      let argsPreview = "";
      if (step.args) {
        if (step.args.url) argsPreview = `"${step.args.url}"`;
        else if (step.args.target) argsPreview = `"${step.args.target}"`;
        else if (step.args.field && step.args.value !== undefined) {
          argsPreview = `"${step.args.field}" = "${step.args.value}"`;
        } else if (step.args.direction) argsPreview = `${step.args.direction}`;
      }

      stepEl.innerHTML = `
        <span class="step-badge">${statusIcon}</span>
        <span class="step-num">${idx + 1}.</span>
        <span class="step-tool">${escapeHTML(step.tool)}</span>
        <span class="step-args">${escapeHTML(argsPreview)}</span>
        ${execResult?.duration ? `<span class="step-duration">${Math.round(execResult.duration)}ms</span>` : ""}
      `;

      if (execResult && execResult.verification) {
        const verifyNote = document.createElement("div");
        verifyNote.className = "step-verify-note";
        verifyNote.textContent = `Verification: ${execResult.verification.message || "Verified page state"}`;
        stepEl.appendChild(verifyNote);
      }

      if (execResult && execResult.success === false && execResult.error) {
        const errNote = document.createElement("div");
        errNote.className = "step-error-note";
        errNote.textContent = `Error: ${execResult.error}`;
        stepEl.appendChild(errNote);
      }

      stepsList.appendChild(stepEl);
    });

    cardBody.appendChild(stepsList);
    scrollConversationToBottom();
  }

  // ==========================================================
  // INACTIVITY POPUP AUTO-DISMISS
  // ==========================================================
  async function autoDismissInactivityPopups() {
    try {
      if (window.browserAPI && typeof window.browserAPI.dismissPopup === "function") {
        const res = await window.browserAPI.dismissPopup();
        if (res && res.dismissed) {
          logToPanel(`Dismissed inactivity popup (${res.count})`);
          return res;
        }
      }
    } catch (e) {}

    return { dismissed: false, count: 0 };
  }

  // ==========================================================
  // SUBMIT USER COMMAND TO #CMD
  // ==========================================================
  async function handleUserCommand(cmd) {
    if (!cmd || !cmd.trim()) return;
    const commandText = cmd.trim();

    if (isExecuting) {
      logToPanel("A browser command is already executing. Please wait.");
      return;
    }

    isExecuting = true;
    startShimmer();
    setStatus("Analyzing instruction...", "analyzing");

    const messageBlock = appendUserMessage(commandText);
    const agentCard = appendAgentCard(messageBlock, "Analyzing instruction...");

    logToPanel(`Command submitted: "${commandText}"`);

    activeAbortController = new AbortController();

    try {
      // Get current active tab URL and tabId to pass to planner for fast-path & context
      let currentUrl = "";
      let currentTabId = "";
      if (window.browserAPI && typeof window.browserAPI.getActiveTab === "function") {
        const activeTab = await window.browserAPI.getActiveTab();
        if (activeTab) {
          currentUrl = activeTab.url || "";
          currentTabId = activeTab.id || "";
        }
      }

      setStatus("Planning task...", "working");
      if (agentCard?.header) {
        agentCard.header.querySelector(".agent-title").innerText = "Planning task...";
      }

      const res = await fetch(`${BACKEND_URL}/run`, {
        method: "POST",
        signal: activeAbortController.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: commandText,
          currentUrl,
          tabId: currentTabId,
        }),
      });

      const data = await res.json();

      logToPanel(`/run HTTP ${res.status}`, data);

      if (!res.ok || !data.success) {
        const errorMsg = data.error || "The browser agent could not complete that request.";
        setStatus("Execution failed", "error");
        if (agentCard?.header) {
          agentCard.header.querySelector(".agent-title").innerText = "Task Failed";
        }
        if (agentCard?.body) {
          agentCard.body.innerHTML = `
            <div class="agent-error-banner">
              <strong>Action Failed:</strong> ${escapeHTML(errorMsg)}
            </div>
          `;
        }
        logToPanel(`Task failed: ${errorMsg}`);
        return;
      }

      // CHAT RESPONSE
      if (data.mode === "chat") {
        setStatus("Ready", "ready");
        if (agentCard?.header) {
          agentCard.header.querySelector(".agent-title").innerText = "Jarvis";
        }
        if (agentCard?.body) {
          agentCard.body.innerHTML = `<div class="agent-chat-reply">${escapeHTML(data.reply || "Done.")}</div>`;
        }
        return;
      }

      // ACTION EXECUTION RESPONSE
      if (data.mode === "action") {
        const plan = data.plan || { steps: [] };
        const steps = data.steps || [];
        const isAllSuccessful = steps.every((s) => s.success !== false);

        if (agentCard?.header) {
          agentCard.header.querySelector(".agent-title").innerText = isAllSuccessful
            ? "Task Completed"
            : "Task Completed with Warnings";
        }

        if (agentCard?.body) {
          renderPlanSteps(agentCard.body, plan, steps);

          const summaryDiv = document.createElement("div");
          summaryDiv.className = isAllSuccessful ? "agent-summary-success" : "agent-summary-warning";
          const durationSec = ((data.statistics?.duration || 0) / 1000).toFixed(1);
          summaryDiv.innerHTML = `
            <span>${isAllSuccessful ? "All actions executed and verified on the page." : "Some actions encountered issues."} (${durationSec}s)</span>
          `;
          agentCard.body.appendChild(summaryDiv);
        }

        setStatus("Ready for your next request", "ready");
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Command cancelled", "ready");
        if (agentCard?.header) agentCard.header.querySelector(".agent-title").innerText = "Cancelled";
      } else {
        console.error("AI command error:", err);
        setStatus("Unable to complete request", "error");
        if (agentCard?.header) agentCard.header.querySelector(".agent-title").innerText = "Execution Error";
        if (agentCard?.body) {
          agentCard.body.innerHTML = `<div class="agent-error-banner">❌ ${escapeHTML(err.message)}</div>`;
        }
      }
    } finally {
      isExecuting = false;
      activeAbortController = null;
      stopShimmer();
      scrollConversationToBottom();
    }
  }

  // ==========================================================
  // EVENT LISTENERS & INITIALIZATION
  // ==========================================================
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = input.value.trim();
        if (cmd) {
          input.value = "";
          handleUserCommand(cmd);
        }
      }
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      const cmd = input ? input.value.trim() : "";
      if (cmd) {
        if (input) input.value = "";
        handleUserCommand(cmd);
      }
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const cmd = input ? input.value.trim() : "";
      if (cmd) {
        if (input) input.value = "";
        handleUserCommand(cmd);
      }
    });
  }

  // Dismiss popup button listener in logs panel
  document.getElementById("assistantDismissPopupBtn")?.addEventListener("click", async () => {
    await autoDismissInactivityPopups();
  });

  // Expose globally
  window.handleAISubmit = handleUserCommand;
  window.executeUserCommand = handleUserCommand;
  window.autoDismissInactivityPopups = autoDismissInactivityPopups;

  if (window.aiState) {
    window.aiState.ready = true;
    window.aiState.backendReady = true;
  }
})();
