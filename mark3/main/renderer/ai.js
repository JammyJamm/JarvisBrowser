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
    const plannedSteps = Array.isArray(plan.plannedSteps) ? plan.plannedSteps : [];

    const renderSingleStep = (step, idx, execResult = null, isPlannedOnly = false) => {
      const stepEl = document.createElement("div");
      stepEl.className = "agent-step-item";

      const rawStatus = String(execResult?.status || step.status || "").toUpperCase();
      const isDone = !!execResult && !isPlannedOnly;
      const isSuccess = execResult ? execResult.success !== false : false;

      let plannerStatus = rawStatus;
      if (!plannerStatus) {
        if (isDone) plannerStatus = isSuccess ? "COMPLETED" : "FAILED";
        else plannerStatus = "PENDING";
      }

      let statusIcon = "⏳";
      let statusClass = "pending";

      if (plannerStatus === "COMPLETED") {
        statusIcon = execResult?.healing?.recovered ? "🩹" : "✅";
        statusClass = "success";
      } else if (plannerStatus === "FAILED") {
        statusIcon = "❌";
        statusClass = "failure";
      } else if (plannerStatus === "WAITING_FOR_USER") {
        statusIcon = "⏸️";
        statusClass = "waiting";
      } else if (plannerStatus === "IN_PROGRESS") {
        statusIcon = "🔄";
        statusClass = "in-progress";
      } else if (plannerStatus === "SKIPPED") {
        statusIcon = "⏭️";
        statusClass = "skipped";
      }

      stepEl.classList.add(`step-${statusClass}`);

      // Format "where" target preview
      let wherePreview = "";
      if (step.args) {
        if (step.args.url) wherePreview = step.args.url;
        else if (step.args.target) wherePreview = step.args.target;
        else if (step.args.field && step.args.value !== undefined) {
          wherePreview = `${step.args.field} ("${step.args.value}")`;
        } else if (step.args.field) wherePreview = step.args.field;
        else if (step.args.direction) wherePreview = step.args.direction;
      }
      if (!wherePreview) {
        wherePreview = execResult?.browserCheck?.url || "active page";
      }

      stepEl.innerHTML = `
        <span class="step-num">Step ${idx + 1} :</span>
        <span class="step-tool">${escapeHTML(step.tool)}</span>
        <span class="step-args">${escapeHTML(wherePreview)}</span>
        <span class="step-status-pill status-${statusClass}">${statusIcon} ${escapeHTML(plannerStatus)}</span>
      `;

      if ((execResult && execResult.success === false && execResult.error) || plannerStatus === "FAILED") {
        const errNote = document.createElement("div");
        errNote.className = "step-error-note";
        errNote.textContent = `Error: ${execResult?.error || execResult?.evidence || "Failed"}`;
        stepEl.appendChild(errNote);
      }

      stepsList.appendChild(stepEl);
    };

    steps.forEach((step, idx) => {
      const execResult = executedSteps.find((s) => s.step === idx + 1 || s.index === idx);
      renderSingleStep(step, idx, execResult, false);
    });

    plannedSteps.forEach((pStep, pIdx) => {
      renderSingleStep(pStep, steps.length + pIdx, null, true);
    });

    cardBody.appendChild(stepsList);
    scrollConversationToBottom();
  }

  function renderSystemResult(container, result = {}) {
    container.innerHTML = "";
    const action = result.action || "";

    if (action === "code_heal") {
      const ok = result.success !== false;
      const files = Array.isArray(result.modifiedFiles) ? result.modifiedFiles : [];
      const healingHtml =
        result.healed && Array.isArray(result.healingHistory) && result.healingHistory.length
          ? `<div class="agent-summary-warning">🩹 Syntax self-healing used ${result.healingHistory.length} attempt(s).</div>`
          : "";
      container.innerHTML = `
        <div class="system-result-block">
          <div class="${ok ? "agent-summary-success" : "agent-error-banner"}">
            ${ok ? "✅" : "❌"} ${escapeHTML(result.summary || (ok ? "Code updated and verified." : "Code update failed."))}
          </div>
          ${files.length ? `<div><strong>Modified files:</strong></div><div class="system-file-chips">${files.map((file) => `<span class="system-file-chip">${escapeHTML(file)}</span>`).join("")}</div>` : ""}
          ${healingHtml}
          ${result.stderr ? `<pre class="system-terminal-output">${escapeHTML(result.stderr)}</pre>` : ""}
        </div>
      `;
      return;
    }

    if (action === "system_info") {
      const tools = result.tools || {};
      const entries = Array.isArray(result.projectEntries) ? result.projectEntries : [];
      container.innerHTML = `
        <div class="system-result-block">
          <div><strong>Project Root:</strong> <code>${escapeHTML(result.projectRoot || "")}</code></div>
          <div><strong>Platform:</strong> ${escapeHTML(result.platform || "")} (${escapeHTML(result.arch || "")})</div>
          <div class="system-tools-grid">
            <span><strong>Node:</strong> ${escapeHTML(tools.node || "unknown")}</span>
            <span><strong>Python:</strong> ${escapeHTML(tools.python || "unknown")}</span>
            <span><strong>pip:</strong> ${escapeHTML(tools.pip || "unknown")}</span>
            <span><strong>git:</strong> ${escapeHTML(tools.git || "unknown")}</span>
            <span><strong>cli-hub:</strong> ${escapeHTML(tools.cliHub || "not installed")}</span>
          </div>
          <div class="system-file-list-label"><strong>Project Items (${entries.length}):</strong></div>
          <div class="system-file-chips">${entries
            .map((e) => `<span class="system-file-chip ${e.type === "dir" ? "is-dir" : ""}">${e.type === "dir" ? "📁" : "📄"} ${escapeHTML(e.name)}</span>`)
            .join("")}</div>
        </div>
      `;
      return;
    }

    if (action === "list_dir") {
      const entries = Array.isArray(result.entries) ? result.entries : [];
      container.innerHTML = `
        <div class="system-result-block">
          <div><strong>Folder:</strong> <code>${escapeHTML(result.path || "")}</code> (${entries.length} items)</div>
          <div class="system-file-chips">${entries
            .map((e) => `<span class="system-file-chip ${e.type === "dir" ? "is-dir" : ""}">${e.type === "dir" ? "📁" : "📄"} ${escapeHTML(e.name)}</span>`)
            .join("")}</div>
        </div>
      `;
      return;
    }

    if (action === "read_file") {
      container.innerHTML = `
        <div class="system-result-block">
          <div><strong>File:</strong> <code>${escapeHTML(result.path || "")}</code> (${result.size || 0} bytes${result.truncated ? ", truncated" : ""})</div>
          <pre class="system-terminal-output">${escapeHTML(result.content || "")}</pre>
        </div>
      `;
      return;
    }

    const ok = result.success !== false;
    const outputText = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
    const healingHtml =
      result.healed && Array.isArray(result.healingHistory) && result.healingHistory.length
        ? `<div class="agent-summary-warning">🩹 Auto-healed (${result.healingHistory.map((h) => escapeHTML(h.strategy)).join(", ")}): <code>${escapeHTML(result.command || "")}</code></div>`
        : "";
    container.innerHTML = `
      <div class="system-result-block">
        <div class="${ok ? "agent-summary-success" : "agent-error-banner"}">
          ${ok ? "✅" : "❌"} Exit code ${escapeHTML(String(result.exitCode ?? (ok ? 0 : 1)))} · ${escapeHTML(String(result.durationMs || 0))}ms
        </div>
        ${healingHtml}
        <pre class="system-terminal-output">${escapeHTML(outputText)}</pre>
      </div>
    `;
  }

  function renderSystemConfirmation(card, data) {
    const pending = data.pendingAction || {};
    const isCodeHeal = pending.tool === "code_heal";
    const targetFiles = Array.isArray(pending.args?.targetFiles) ? pending.args.targetFiles : [];
    if (card?.header) {
      card.header.querySelector(".agent-title").innerText = isCodeHeal
        ? "Jarvis · Code Update Plan"
        : "Jarvis · Approval Required";
    }
    if (!card?.body) return;

    const installerOptionsHtml = Array.isArray(pending.options) && pending.options.length
      ? `
        <div class="agent-option-chips">
          ${pending.options
            .map(
              (opt, idx) =>
                `<button type="button" class="agent-option-btn ${idx === 0 ? "is-selected" : ""}" data-cmd="${escapeHTML(opt.commandText || "")}">${escapeHTML(opt.label)}</button>`,
            )
            .join("")}
        </div>
      `
      : "";

    card.body.innerHTML = `
      <div class="system-action-card">
        <div class="agent-goal-summary"><strong>${isCodeHeal ? "Code update plan:" : "Action:"}</strong> ${escapeHTML(pending.summary || "Run system command")}</div>
        <div class="system-meta-row"><strong>Folder:</strong> <code>${escapeHTML(pending.cwd || "")}</code></div>
        ${isCodeHeal ? `
          <div class="system-meta-row"><strong>Your request:</strong></div>
          <pre class="system-terminal-output">${escapeHTML(pending.args?.comment || "")}</pre>
          <div class="system-meta-row"><strong>Files to inspect:</strong></div>
          <div class="system-file-chips">${targetFiles.length
            ? targetFiles.map((file) => `<span class="system-file-chip">${escapeHTML(file)}</span>`).join("")
            : "<span>No specific files identified; the agent will search relevant project files.</span>"}</div>
        ` : ""}
        ${installerOptionsHtml}
        ${!isCodeHeal ? `<label class="system-cmd-label">Command to run (editable before approval):
          <textarea class="system-cmd-preview" rows="3" spellcheck="false">${escapeHTML(pending.commandText || "")}</textarea>
        </label>` : ""}
        <div class="system-approval-actions">
          <button type="button" class="system-approve-btn">${isCodeHeal ? "Apply Code Changes" : "Approve &amp; Run"}</button>
          <button type="button" class="system-reject-btn">Cancel</button>
        </div>
        <div class="system-execution-output"></div>
      </div>
    `;

    const cmdInput = card.body.querySelector(".system-cmd-preview");
    card.body.querySelectorAll(".agent-option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        card.body.querySelectorAll(".agent-option-btn").forEach((b) => b.classList.remove("is-selected"));
        btn.classList.add("is-selected");
        if (cmdInput && btn.dataset.cmd) {
          cmdInput.value = btn.dataset.cmd;
        }
      });
    });
    const approveBtn = card.body.querySelector(".system-approve-btn");
    const rejectBtn = card.body.querySelector(".system-reject-btn");
    const outputEl = card.body.querySelector(".system-execution-output");

    approveBtn?.addEventListener("click", async () => {
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      if (cmdInput) cmdInput.disabled = true;
      setStatus(isCodeHeal ? "Applying code changes..." : "Running approved system command...", "working");
      card.header.querySelector(".agent-title").innerText = isCodeHeal
        ? "Jarvis · Updating Code..."
        : "Jarvis · Running...";
      outputEl.innerHTML = `<div class="agent-goal-summary">${isCodeHeal ? "Applying the reviewed code update and verifying the changes..." : "Executing command..."}</div>`;

      try {
        const res = await fetch(`${BACKEND_URL}/system/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actionId: pending.actionId,
            editedCommand: isCodeHeal ? undefined : cmdInput?.value,
          }),
        });
        const approveData = await res.json();
        logToPanel(`/system/approve HTTP ${res.status}`, approveData);

        if (!res.ok || !approveData.success) {
          card.header.querySelector(".agent-title").innerText = "System Action Failed";
          outputEl.innerHTML = `<div class="agent-error-banner">❌ ${escapeHTML(approveData.error || "Command execution failed.")}</div>`;
          setStatus("System action failed", "error");
          return;
        }

        const cmdSuccess = approveData.result?.success !== false;
        card.header.querySelector(".agent-title").innerText = cmdSuccess
          ? (isCodeHeal ? "Jarvis · Code Updated & Verified" : "Jarvis · System Task Completed")
          : (isCodeHeal ? "Jarvis · Code Update Failed" : "Jarvis · Command Exited with Errors");
        renderSystemResult(outputEl, approveData.result || {});
        setStatus(
          cmdSuccess ? "Ready for your next request" : (isCodeHeal ? "Code update failed" : "Command finished with errors"),
          cmdSuccess ? "ready" : "error",
        );
      } catch (err) {
        card.header.querySelector(".agent-title").innerText = "System Error";
        outputEl.innerHTML = `<div class="agent-error-banner">❌ ${escapeHTML(err.message)}</div>`;
        setStatus("System error", "error");
      } finally {
        scrollConversationToBottom();
      }
    });

    rejectBtn?.addEventListener("click", async () => {
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      if (cmdInput) cmdInput.disabled = true;
      try {
        await fetch(`${BACKEND_URL}/system/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId: pending.actionId }),
        });
      } catch {}
      card.header.querySelector(".agent-title").innerText = "Jarvis · Cancelled";
      outputEl.innerHTML = `<div class="agent-summary-warning">Cancelled by user. Nothing was executed.</div>`;
      setStatus("Ready", "ready");
    });
  }

  function renderActionResponse(card, data) {
    if (data.status === "needs_input" && data.pendingPrompt) {
      renderInteractivePrompt(card, data);
      return;
    }

    if (data.status === "waiting_for_user") {
      setStatus("Paused — Waiting for your action in browser", "working");
      if (card?.header) {
        card.header.querySelector(".agent-title").innerText = "svgJarvis · Waiting for User";
      }
      if (card?.body) {
        renderPlanSteps(card.body, data.plan || { steps: [] }, data.steps || []);
        const report = data.completionReport || {};
        const reportDiv = document.createElement("div");
        reportDiv.className = "agent-summary-warning";
        reportDiv.innerHTML = `
          <div><strong>Paused (Not Completed):</strong> ${escapeHTML(data.summary || report.reasonForWaiting || "Waiting for user action in browser.")}</div>
          <div><strong>Completed steps:</strong> ${escapeHTML(String((report.completedSteps || []).length))} · <strong>Remaining steps:</strong> ${escapeHTML(String((report.remainingSteps || []).length))}</div>
          ${report.exactActionRequired ? `<div><strong>Required from you:</strong> ${escapeHTML(report.exactActionRequired)}</div>` : ""}
        `;
        card.body.appendChild(reportDiv);
      }
      scrollConversationToBottom();
      return;
    }

    if (data.status === "cancelled") {
      setStatus("Ready", "ready");
      if (card?.header) {
        card.header.querySelector(".agent-title").innerText = "svgJarvis · Cancelled";
      }
      if (card?.body) {
        renderPlanSteps(card.body, data.plan || { steps: [] }, data.steps || []);
        const cancelDiv = document.createElement("div");
        cancelDiv.className = "agent-summary-warning";
        cancelDiv.textContent = data.summary || "Cancelled by user.";
        card.body.appendChild(cancelDiv);
      }
      return;
    }

    const plan = data.plan || { steps: [] };
    const steps = data.steps || [];
    const isAllSuccessful = steps.every((s) => s.success !== false) && data.goalVerified !== false;

    if (card?.header) {
      card.header.querySelector(".agent-title").innerText = isAllSuccessful
        ? "Task Completed & Verified"
        : "Task Completed with Warnings";
    }

    if (card?.body) {
      renderPlanSteps(card.body, plan, steps);

      const summaryDiv = document.createElement("div");
      summaryDiv.className = isAllSuccessful ? "agent-summary-success" : "agent-summary-warning";
      const durationSec = ((data.statistics?.duration || 0) / 1000).toFixed(1);
      const summaryText = data.summary
        ? escapeHTML(data.summary)
        : isAllSuccessful
          ? "All actions executed and verified on the page."
          : "Some actions encountered issues.";
      summaryDiv.innerHTML = `<span>${summaryText} (${durationSec}s)</span>`;
      card.body.appendChild(summaryDiv);
    }

    setStatus("Ready for your next request", "ready");
    scrollConversationToBottom();
  }

  function renderInteractivePrompt(card, data) {
    const prompt = data.pendingPrompt || {};
    const plan = data.plan || { steps: [] };
    const steps = data.steps || [];

    setStatus("Waiting for your selection / permission", "working");
    if (card?.header) {
      card.header.querySelector(".agent-title").innerText = `Jarvis · ${prompt.title || "Permission Required"}`;
    }
    if (!card?.body) return;

    renderPlanSteps(card.body, plan, steps);

    const box = document.createElement("div");
    box.className = "agent-permission-box";

    const optionsHtml = Array.isArray(prompt.options) && prompt.options.length
      ? `<div class="agent-option-chips">${prompt.options
          .map(
            (opt) =>
              `<button type="button" class="agent-option-btn" data-choice="${escapeHTML(opt.value || opt.label || "")}">${escapeHTML(opt.label || opt.value || "Option")}</button>`,
          )
          .join("")}</div>`
      : "";

    const customHtml = prompt.allowCustomInput !== false
      ? `<div class="agent-custom-reply-row">
          <input type="text" class="agent-custom-reply-input" placeholder="Or type your choice / instruction..." />
          <button type="button" class="system-approve-btn agent-custom-send-btn">Continue</button>
        </div>`
      : "";

    box.innerHTML = `
      <div class="agent-permission-title">${escapeHTML(prompt.title || "Permission Required")}</div>
      <div class="agent-permission-question">${escapeHTML(prompt.question || "Please choose how to proceed.")}</div>
      ${prompt.reason ? `<div class="agent-permission-reason">${escapeHTML(prompt.reason)}</div>` : ""}
      ${optionsHtml}
      ${customHtml}
    `;

    card.body.appendChild(box);
    scrollConversationToBottom();

    const submitReply = async ({ choice = "", customInput = "" }) => {
      box.querySelectorAll("button, input").forEach((el) => {
        el.disabled = true;
      });
      setStatus("Resuming task...", "working");
      if (card?.header) {
        card.header.querySelector(".agent-title").innerText = "Jarvis · Resuming...";
      }
      startShimmer();

      try {
        const res = await fetch(`${BACKEND_URL}/agent/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: data.sessionId,
            promptId: prompt.promptId,
            choice,
            customInput,
            cancelled: choice === "__cancel__",
          }),
        });
        const nextData = await res.json();
        logToPanel(`/agent/respond HTTP ${res.status}`, nextData);

        if (!res.ok || !nextData.success) {
          setStatus("Execution failed", "error");
          if (card?.header) card.header.querySelector(".agent-title").innerText = "Task Failed";
          const errDiv = document.createElement("div");
          errDiv.className = "agent-error-banner";
          errDiv.textContent = nextData.error || "Could not resume interactive session.";
          card.body.appendChild(errDiv);
          return;
        }

        renderActionResponse(card, nextData);
      } catch (err) {
        setStatus("Unable to resume task", "error");
        const errDiv = document.createElement("div");
        errDiv.className = "agent-error-banner";
        errDiv.textContent = err.message;
        card.body.appendChild(errDiv);
      } finally {
        stopShimmer();
        scrollConversationToBottom();
      }
    };

    box.querySelectorAll(".agent-option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        submitReply({ choice: btn.dataset.choice || "" });
      });
    });

    const customInputEl = box.querySelector(".agent-custom-reply-input");
    const customSendBtn = box.querySelector(".agent-custom-send-btn");
    customSendBtn?.addEventListener("click", () => {
      const val = (customInputEl?.value || "").trim();
      if (val) submitReply({ customInput: val });
    });
    customInputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = (customInputEl.value || "").trim();
        if (val) submitReply({ customInput: val });
      }
    });
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

      // SYSTEM / PROJECT / CLI RESPONSE
      if (data.mode === "system") {
        if (data.status === "pending_confirmation") {
          setStatus("Waiting for your approval", "working");
          renderSystemConfirmation(agentCard, data);
          return;
        }

        setStatus("Ready", "ready");
        if (agentCard?.header) {
          agentCard.header.querySelector(".agent-title").innerText = "Jarvis · System";
        }
        if (agentCard?.body) {
          renderSystemResult(agentCard.body, data.result || {});
        }
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
        renderActionResponse(agentCard, data);
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
