//==========================================================
//
// main/renderer/ai.js
//
// Jarvis Autonomous Agent Frontend Controller
//
// Responsibilities:
// ✔ Real-time SSE streaming for multi-step agent execution
// ✔ Dynamic step-by-step checklist rendering with live highlights
// ✔ Deep reasoning thoughts stream (Thinking Process)
// ✔ Human-in-the-Loop Clarification Question Card (Color/RAM/Storage selector)
// ✔ Interactive Pause, Resume, Stop controls
// ✔ Auto-scroll and instant visual feedback
//
//==========================================================

(() => {
  const BACKEND_URL = window.aiState?.backendUrl || "http://localhost:9000";

  // Elements
  const form = document.getElementById("ai-form");
  const input = document.getElementById("cmd");
  const submitBtn = document.getElementById("submitCmdBtn");

  const goalCard = document.getElementById("goalCard");
  const goalText = document.getElementById("goalText");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressPercent = document.getElementById("progressPercent");
  const stepCounter = document.getElementById("stepCounter");
  const stepsChecklist = document.getElementById("stepsChecklist");
  const clarificationContainer = document.getElementById("clarificationContainer");
  const reasoningStream = document.getElementById("reasoningStream");

  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const btnStop = document.getElementById("btnStop");
  const btnClear = document.getElementById("btnClear");

  let eventSource = null;
  let currentPendingQuestion = null;

  // ==========================================================
  // 1. CONNECT SERVER-SENT EVENTS (SSE)
  // ==========================================================

  function connectAgentEvents() {
    if (eventSource) {
      eventSource.close();
    }

    try {
      eventSource = new EventSource(`${BACKEND_URL}/agent/events`);

      eventSource.addEventListener("open", () => {
        if (typeof log === "function") log("⚡ Connected to Jarvis Agent live event stream", "success");
      });

      // State synchronization
      eventSource.addEventListener("state_sync", (e) => {
        try {
          const state = JSON.parse(e.data);
          if (state && state.goal) {
            renderFullState(state);
          }
        } catch {}
      });

      // Plan created
      eventSource.addEventListener("plan_created", (e) => {
        try {
          const data = JSON.parse(e.data);
          renderPlanCreated(data);
        } catch (err) {
          console.error("plan_created parse error:", err);
        }
      });

      // Step started
      eventSource.addEventListener("step_started", (e) => {
        try {
          const data = JSON.parse(e.data);
          renderStepStarted(data);
        } catch (err) {
          console.error("step_started parse error:", err);
        }
      });

      // Reasoning thought entry
      eventSource.addEventListener("reasoning", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.entry) {
            appendReasoningCard(data.entry);
          }
        } catch (err) {
          console.error("reasoning parse error:", err);
        }
      });

      // Question required (Human-in-the-loop clarification)
      eventSource.addEventListener("question_required", (e) => {
        try {
          const data = JSON.parse(e.data);
          renderClarificationQuestion(data.question);
        } catch (err) {
          console.error("question_required parse error:", err);
        }
      });

      // Question answered
      eventSource.addEventListener("question_answered", (e) => {
        try {
          const data = JSON.parse(e.data);
          dismissClarificationCard();
          if (typeof log === "function") {
            log(`✔ User choice confirmed: "${data.answer}". Continuing execution...`, "success");
          }
        } catch {}
      });

      // Planner Check Required (Unexpected state / Failure / Human Checkpoint)
      eventSource.addEventListener("planner_check_required", (e) => {
        try {
          const data = JSON.parse(e.data);
          renderPlannerCheckCard(data.plannerCheck);
        } catch (err) {
          console.error("planner_check_required parse error:", err);
        }
      });

      // Planner Check Resolved
      eventSource.addEventListener("planner_check_resolved", (e) => {
        try {
          const data = JSON.parse(e.data);
          dismissClarificationCard();
          if (typeof log === "function") {
            log(`✔ Planner check resolved (${data.action}). Resuming execution...`, "success");
          }
        } catch {}
      });

      // Credential Required (Login step needs username & password)
      eventSource.addEventListener("credential_required", (e) => {
        try {
          const data = JSON.parse(e.data);
          renderCredentialPromptCard(data.credentialRequest);
        } catch (err) {
          console.error("credential_required parse error:", err);
        }
      });

      // Credential Provided
      eventSource.addEventListener("credential_provided", (e) => {
        try {
          const data = JSON.parse(e.data);
          dismissClarificationCard();
          if (typeof log === "function") {
            log(`🔑 Credentials provided for "${data.site}". Proceeding with login...`, "success");
          }
        } catch {}
      });

      // Step completed
      eventSource.addEventListener("step_completed", (e) => {
        try {
          const data = JSON.parse(e.data);
          renderStepCompleted(data);
        } catch (err) {
          console.error("step_completed parse error:", err);
        }
      });

      // Goal completed
      eventSource.addEventListener("goal_completed", (e) => {
        try {
          const data = JSON.parse(e.data);
          renderGoalCompleted(data);
        } catch (err) {
          console.error("goal_completed parse error:", err);
        }
      });

      // Execution paused / resumed / stopped
      eventSource.addEventListener("execution_paused", () => {
        if (btnPause) btnPause.style.display = "none";
        if (btnResume) btnResume.style.display = "inline-flex";
        if (typeof setStatus === "function") setStatus("⏸ Execution Paused", "ready");
      });

      eventSource.addEventListener("execution_resumed", () => {
        if (btnResume) btnResume.style.display = "none";
        if (btnPause) btnPause.style.display = "inline-flex";
        if (typeof setStatus === "function") setStatus("⚡ Executing", "running");
      });

      eventSource.addEventListener("execution_stopped", () => {
        resetControls();
        if (typeof setStatus === "function") setStatus("⏹ Execution Stopped", "ready");
      });

      eventSource.addEventListener("error", () => {
        // SSE reconnect attempt silently
      });
    } catch (err) {
      console.warn("EventSource setup failed:", err.message);
    }
  }

  // ==========================================================
  // 2. RENDER PLAN CREATED
  // ==========================================================

  function renderPlanCreated(data) {
    const goal = data.goal || "Autonomous Goal";
    const steps = data.steps || [];

    if (goalCard) goalCard.style.display = "flex";
    if (goalText) goalText.innerText = goal;
    if (progressBarFill) progressBarFill.style.width = "0%";
    if (progressPercent) progressPercent.innerText = "0%";
    if (stepCounter) stepCounter.innerText = `0 / ${steps.length} Steps`;

    if (typeof setStatus === "function") {
      setStatus(`Planned ${steps.length} steps`, "planning");
    }

    if (typeof log === "function") {
      log(`🎯 Plan generated with ${steps.length} execution steps for "${goal}"`, "info");
    }

    // Switch to Planner Tab
    const tabPlannerBtn = document.getElementById("tabPlannerBtn");
    tabPlannerBtn?.click();

    renderStepsChecklist(steps);
    resetClarificationCard();
  }

  function renderStepsChecklist(steps) {
    if (!stepsChecklist) return;
    stepsChecklist.innerHTML = "";

    steps.forEach((step, idx) => {
      const card = document.createElement("div");
      card.id = `step_card_${idx}`;
      card.className = `step-card ${step.status || "pending"}`;

      card.innerHTML = `
        <div class="step-header">
          <div class="step-title-wrap">
            <div class="step-badge">${idx + 1}</div>
            <div class="step-title">${escapeHTML(step.title || `Step ${idx + 1}`)}</div>
          </div>
          <span class="step-status-tag">${formatStatusTag(step.status)}</span>
        </div>
        <div class="step-description">${escapeHTML(step.description || "")}</div>
        <div class="step-tool-badge">tool: ${escapeHTML(step.tool || "action")}</div>
      `;

      stepsChecklist.appendChild(card);
    });
  }

  function formatStatusTag(status) {
    switch (status) {
      case "completed":
        return "✔ Done";
      case "running":
        return "⚡ Running";
      case "waiting_for_user":
        return "❓ Question";
      case "waiting_for_user_check":
        return "⚠️ Check Needed";
      case "failed":
        return "❌ Failed";
      default:
        return "⏳ Pending";
    }
  }

  // ==========================================================
  // 3. RENDER STEP STARTED & COMPLETED
  // ==========================================================

  function renderStepStarted(data) {
    const { stepIndex, step } = data;
    const totalSteps = document.querySelectorAll(".step-card").length || 1;

    // Update Step Card
    const card = document.getElementById(`step_card_${stepIndex}`);
    if (card) {
      card.className = "step-card running";
      const tag = card.querySelector(".step-status-tag");
      if (tag) tag.innerText = "⚡ Running";
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // Update Progress
    const pct = Math.round((stepIndex / totalSteps) * 100);
    if (progressBarFill) progressBarFill.style.width = `${pct}%`;
    if (progressPercent) progressPercent.innerText = `${pct}%`;
    if (stepCounter) stepCounter.innerText = `Step ${stepIndex + 1} of ${totalSteps}`;

    if (typeof setStatus === "function") {
      setStatus(`Step ${stepIndex + 1}/${totalSteps}: ${step.title}`, "running");
    }

    if (typeof log === "function") {
      log(`▶ [Step ${stepIndex + 1}] Starting: ${step.title}`, "info");
    }
  }

  function renderStepCompleted(data) {
    const { stepIndex, step, result } = data;
    const totalSteps = document.querySelectorAll(".step-card").length || 1;

    const card = document.getElementById(`step_card_${stepIndex}`);
    if (card) {
      card.className = "step-card completed";
      const tag = card.querySelector(".step-status-tag");
      if (tag) {
        tag.innerText = step.duration ? `✔ Done (${step.duration}ms)` : "✔ Done";
      }
    }

    const pct = Math.round(((stepIndex + 1) / totalSteps) * 100);
    if (progressBarFill) progressBarFill.style.width = `${pct}%`;
    if (progressPercent) progressPercent.innerText = `${pct}%`;
    if (stepCounter) stepCounter.innerText = `${stepIndex + 1} / ${totalSteps} Completed`;

    if (typeof log === "function") {
      log(`✔ [Step ${stepIndex + 1}] Completed (${step.duration || 0}ms)`, "success");
    }
  }

  function renderGoalCompleted(data) {
    if (progressBarFill) progressBarFill.style.width = "100%";
    if (progressPercent) progressPercent.innerText = "100%";
    if (typeof setStatus === "function") {
      setStatus("✅ Goal Completed Successfully!", "completed");
    }
    if (typeof log === "function") {
      log(`🎉 ${data.summary || "Task finished successfully!"}`, "success");
    }
    resetControls();
  }

  // ==========================================================
  // 4. HUMAN-IN-THE-LOOP CLARIFICATION QUESTION CARD
  // ==========================================================

  function renderClarificationQuestion(question) {
    if (!clarificationContainer || !question) return;

    currentPendingQuestion = question;

    const optionsHtml = (question.options || [])
      .map(
        (opt) => `
        <button type="button" class="option-chip-btn" data-choice="${escapeHTML(opt)}">
          <span>🔹</span>
          <span>${escapeHTML(opt)}</span>
        </button>
      `
      )
      .join("");

    clarificationContainer.innerHTML = `
      <div class="clarification-card">
        <div class="clarification-header">
          <span>❓ Human-in-the-Loop Clarification</span>
        </div>
        <div class="clarification-message">
          ${escapeHTML(question.message || "Please choose an option:")}
        </div>
        <div class="options-grid">
          ${optionsHtml}
        </div>
        <div class="clarification-custom-row">
          <input
            id="clarificationCustomInput"
            type="text"
            class="clarification-input"
            placeholder="Or type custom choice or specification..."
          />
          <button id="clarificationSubmitBtn" type="button" class="clarification-submit-btn">
            Submit Choice →
          </button>
        </div>
      </div>
    `;

    clarificationContainer.style.display = "block";
    clarificationContainer.scrollIntoView({ behavior: "smooth", block: "center" });

    // Option chip click listeners
    const chipBtns = clarificationContainer.querySelectorAll(".option-chip-btn");
    chipBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const choice = btn.getAttribute("data-choice");
        if (choice) submitQuestionAnswer(question.id, choice);
      });
    });

    // Custom input submit listener
    const submitBtn = document.getElementById("clarificationSubmitBtn");
    const customInput = document.getElementById("clarificationCustomInput");

    const handleCustomSubmit = () => {
      const val = customInput ? customInput.value.trim() : "";
      if (val) {
        submitQuestionAnswer(question.id, val);
      }
    };

    submitBtn?.addEventListener("click", handleCustomSubmit);
    customInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCustomSubmit();
      }
    });

    if (typeof setStatus === "function") {
      setStatus("❓ Waiting for your choice...", "question");
    }

    if (typeof log === "function") {
      log(`❓ Agent Clarification: "${question.message}"`, "warn");
    }
  }

  async function submitQuestionAnswer(questionId, answer) {
    if (!answer) return;

    if (typeof log === "function") {
      log(`Submitting choice: "${answer}"...`, "info");
    }

    dismissClarificationCard();

    try {
      const res = await fetch(`${BACKEND_URL}/agent/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, answer }),
      });

      const data = await res.json();
      if (!data.success) {
        if (typeof log === "function") log(`❌ Answer submission failed: ${data.error}`, "error");
      }
    } catch (err) {
      console.error("submitQuestionAnswer error:", err);
      if (typeof log === "function") log(`❌ Error answering question: ${err.message}`, "error");
    }
  }

  function dismissClarificationCard() {
    if (clarificationContainer) {
      clarificationContainer.style.display = "none";
      clarificationContainer.innerHTML = "";
    }
    currentPendingQuestion = null;
  }

  function resetClarificationCard() {
    dismissClarificationCard();
  }

  // ==========================================================
  // 4b. PLANNER CHECK / HUMAN-IN-THE-LOOP FALLBACK CARD
  // ==========================================================

  function renderPlannerCheckCard(plannerCheck) {
    if (!clarificationContainer || !plannerCheck) return;

    // Switch to Planner Tab
    const tabPlannerBtn = document.getElementById("tabPlannerBtn");
    tabPlannerBtn?.click();

    const checkId = plannerCheck.id;
    const reasonText = plannerCheck.reason || "Action did not produce expected outcome or needs manual verification.";
    const stepTitle = plannerCheck.stepTitle || "Active Step";

    clarificationContainer.innerHTML = `
      <div class="planner-check-card">
        <div class="planner-check-header">
          <span>⚠️ Planner Check Required</span>
          <span style="font-size: 11px; opacity: 0.8;">Step ${plannerCheck.stepIndex + 1}</span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #92400e;">
          ${escapeHTML(stepTitle)}
        </div>
        <div class="planner-check-reason">
          <strong>Notice:</strong> ${escapeHTML(reasonText)}
        </div>
        <div style="font-size: 11.5px; color: #78350f; font-weight: 500;">
          Please inspect the browser view (e.g. solve CAPTCHA, enter OTP, check page) and choose an action below:
        </div>
        <div class="planner-check-actions">
          <button type="button" class="planner-check-btn primary" id="btnPlannerResolved">
            ✔ I Handled It in Browser (Continue)
          </button>
          <button type="button" class="planner-check-btn secondary" id="btnPlannerRetry">
            🔄 Retry Step
          </button>
          <button type="button" class="planner-check-btn secondary" id="btnPlannerSkip">
            ⏭ Skip Step
          </button>
          <button type="button" class="planner-check-btn secondary" id="btnPlannerStop" style="color: #ef4444; border-color: #fecaca;">
            ⏹ Stop
          </button>
        </div>
        <div class="planner-instruction-row">
          <input
            id="plannerInstructionInput"
            type="text"
            placeholder="Or type custom instruction for agent (e.g. 'Click the second button instead')..."
          />
          <button type="button" class="clarification-submit-btn" id="btnPlannerSubmitInstruction">
            Send Instruction →
          </button>
        </div>
      </div>
    `;

    clarificationContainer.style.display = "block";
    clarificationContainer.scrollIntoView({ behavior: "smooth", block: "center" });

    // Button event listeners
    document.getElementById("btnPlannerResolved")?.addEventListener("click", () => {
      submitPlannerCheck(checkId, "resolved");
    });

    document.getElementById("btnPlannerRetry")?.addEventListener("click", () => {
      submitPlannerCheck(checkId, "retry");
    });

    document.getElementById("btnPlannerSkip")?.addEventListener("click", () => {
      submitPlannerCheck(checkId, "skip");
    });

    document.getElementById("btnPlannerStop")?.addEventListener("click", () => {
      submitPlannerCheck(checkId, "stop");
    });

    const submitInstruction = () => {
      const inputEl = document.getElementById("plannerInstructionInput");
      const instruction = inputEl ? inputEl.value.trim() : "";
      if (instruction) {
        submitPlannerCheck(checkId, "instruction", instruction);
      }
    };

    document.getElementById("btnPlannerSubmitInstruction")?.addEventListener("click", submitInstruction);
    document.getElementById("plannerInstructionInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitInstruction();
      }
    });

    if (typeof setStatus === "function") {
      setStatus("⚠️ Planner Check: Waiting for your review", "question");
    }

    if (typeof log === "function") {
      log(`⚠️ Planner paused at Step ${plannerCheck.stepIndex + 1}: ${reasonText}`, "warn");
    }
  }

  async function submitPlannerCheck(checkId, action = "resolved", instruction = "") {
    if (typeof log === "function") {
      log(`Submitting planner response: "${action}"...`, "info");
    }

    dismissClarificationCard();

    try {
      const res = await fetch(`${BACKEND_URL}/agent/planner-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId, action, instruction }),
      });

      const data = await res.json();
      if (!data.success) {
        if (typeof log === "function") log(`❌ Failed to resolve planner check: ${data.error}`, "error");
      }
    } catch (err) {
      console.error("submitPlannerCheck error:", err);
      if (typeof log === "function") log(`❌ Error resolving planner check: ${err.message}`, "error");
    }
  }

  // ==========================================================
  // 4c. CREDENTIAL PROMPT CARD (IN-LINE DURING LOGIN STEP)
  // ==========================================================

  function renderCredentialPromptCard(credReq) {
    if (!clarificationContainer || !credReq) return;

    // Switch to Planner Tab
    const tabPlannerBtn = document.getElementById("tabPlannerBtn");
    tabPlannerBtn?.click();

    const site = credReq.site || "Target Website";
    const reqId = credReq.id;
    const isZingHR = Boolean(credReq.isZingHR || site.toLowerCase().includes("zinghr"));

    clarificationContainer.innerHTML = `
      <div class="cred-prompt-card">
        <div class="cred-prompt-header">
          <span>🔐 Login Required for ${escapeHTML(site)}</span>
          <span style="font-size: 11px; opacity: 0.8;">Step ${credReq.stepIndex + 1}</span>
        </div>
        <div style="font-size: 12px; color: #1e3a8a;">
          No saved credentials found. Enter your credentials below to authenticate. They will be securely stored (Local Encrypted / Firebase DB) for future tasks.
        </div>
        <div class="cred-prompt-fields">
          <input
            id="promptUserInput"
            type="text"
            class="cred-prompt-input"
            placeholder="${isZingHR ? "Employee ID / Username" : "Email or Phone Number"}"
          />
          <input
            id="promptPassInput"
            type="password"
            class="cred-prompt-input"
            placeholder="Account Password"
          />
          ${
            isZingHR
              ? `<input id="promptCompanyInput" type="text" class="cred-prompt-input" placeholder="Company Code (e.g. INFOSYS, TECHCORP)" />`
              : ""
          }
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #475569;">
            <span>Save to:</span>
            <select id="promptStorageSelect" style="padding: 3px 6px; border-radius: 4px; border: 1px solid #cbd5e1; font-size: 11px;">
              <option value="both" selected>Both (Local + Firebase)</option>
              <option value="local">Local Encrypted Only</option>
              <option value="firebase">Firebase DB Only</option>
            </select>
          </div>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <button type="button" id="btnSubmitPromptCred" class="clarification-submit-btn">
            Save & Continue Login →
          </button>
          <button type="button" id="btnCancelPromptCred" class="ctrl-btn">
            Skip Login
          </button>
        </div>
      </div>
    `;

    clarificationContainer.style.display = "block";
    clarificationContainer.scrollIntoView({ behavior: "smooth", block: "center" });

    document.getElementById("btnSubmitPromptCred")?.addEventListener("click", () => {
      const user = document.getElementById("promptUserInput")?.value.trim() || "";
      const pass = document.getElementById("promptPassInput")?.value || "";
      const company = document.getElementById("promptCompanyInput")?.value.trim() || "";
      const storage = document.getElementById("promptStorageSelect")?.value || "both";

      if (!user || !pass) {
        alert("Please enter both username and password.");
        return;
      }

      submitCredentialResponse(reqId, user, pass, storage, company ? { companyCode: company } : {});
    });

    document.getElementById("btnCancelPromptCred")?.addEventListener("click", () => {
      dismissClarificationCard();
      submitPlannerCheck("check_" + Date.now(), "skip");
    });

    if (typeof setStatus === "function") {
      setStatus(`🔑 Login needed for ${site}`, "question");
    }

    if (typeof log === "function") {
      log(`🔑 Credentials needed to log into ${site}`, "warn");
    }
  }

  async function submitCredentialResponse(requestId, username, password, storage = "both", extraFields = {}) {
    if (typeof log === "function") {
      log(`Submitting credentials for login (storage: ${storage})...`, "info");
    }

    dismissClarificationCard();

    try {
      const res = await fetch(`${BACKEND_URL}/agent/credential-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, username, password, storage, extraFields }),
      });

      const data = await res.json();
      if (!data.success) {
        if (typeof log === "function") log(`❌ Failed to submit credentials: ${data.error}`, "error");
      }
    } catch (err) {
      console.error("submitCredentialResponse error:", err);
      if (typeof log === "function") log(`❌ Error saving credentials: ${err.message}`, "error");
    }
  }

  // ==========================================================
  // 4d. CREDENTIAL VAULT MANAGEMENT VIEW
  // ==========================================================

  async function loadVaultAccounts() {
    const listContainer = document.getElementById("credentialsList");
    if (!listContainer) return;

    listContainer.innerHTML = '<div class="vault-empty-state">Loading saved accounts from Local Vault & Firebase...</div>';

    try {
      const res = await fetch(`${BACKEND_URL}/api/credentials`);
      const data = await res.json();

      if (!data.success || !data.credentials || data.credentials.length === 0) {
        listContainer.innerHTML = `
          <div class="vault-empty-state">
            No accounts saved yet.<br />
            Click <strong>"+ Add Account"</strong> above to store credentials for Flipkart, ZingHR, Udemy, etc.
          </div>
        `;
        return;
      }

      listContainer.innerHTML = "";
      data.credentials.forEach((item) => {
        const card = document.createElement("div");
        card.className = "vault-item-card";

        const site = escapeHTML(item.site || "website");
        const user = escapeHTML(item.username || "");
        const storage = escapeHTML(item.storage || "local");

        // Choose icon
        let siteIcon = "🌐";
        if (site.includes("flipkart")) siteIcon = "🛍️";
        else if (site.includes("zinghr")) siteIcon = "🏢";
        else if (site.includes("udemy")) siteIcon = "🎓";
        else if (site.includes("amazon")) siteIcon = "📦";

        card.innerHTML = `
          <div class="vault-item-info">
            <div class="vault-item-site">
              <span>${siteIcon}</span>
              <span>${site}</span>
              <span class="vault-item-badge ${storage}">${storage}</span>
            </div>
            <div class="vault-item-user">User: ${user}</div>
          </div>
          <button type="button" class="vault-item-delete-btn" data-site="${site}" title="Delete credential">
            Delete
          </button>
        `;

        card.querySelector(".vault-item-delete-btn")?.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (confirm(`Remove saved credentials for ${item.site}?`)) {
            await deleteVaultCredential(item.site);
          }
        });

        listContainer.appendChild(card);
      });
    } catch (err) {
      console.error("loadVaultAccounts error:", err);
      listContainer.innerHTML = `<div class="vault-empty-state" style="color: #ef4444;">Failed to load vault: ${escapeHTML(err.message)}</div>`;
    }
  }

  async function deleteVaultCredential(site) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/credentials/${encodeURIComponent(site)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        if (typeof log === "function") log(`✔ Deleted credential for "${site}"`, "success");
        loadVaultAccounts();
      }
    } catch (err) {
      alert("Error deleting credential: " + err.message);
    }
  }

  function setupVaultListeners() {
    const btnOpenAdd = document.getElementById("btnOpenAddCredModal");
    const formContainer = document.getElementById("addCredFormContainer");
    const btnCancel = document.getElementById("btnCancelAddCred");
    const btnSave = document.getElementById("btnSaveCredential");
    const btnSync = document.getElementById("btnSyncCredentials");
    const btnTogglePass = document.getElementById("btnTogglePass");
    const passInput = document.getElementById("credPassInput");
    const siteInput = document.getElementById("credSiteInput");
    const compRow = document.getElementById("credCompanyCodeRow");

    btnOpenAdd?.addEventListener("click", () => {
      if (formContainer) {
        const isHidden = formContainer.style.display === "none";
        formContainer.style.display = isHidden ? "flex" : "none";
      }
    });

    btnCancel?.addEventListener("click", () => {
      if (formContainer) formContainer.style.display = "none";
    });

    btnTogglePass?.addEventListener("click", () => {
      if (passInput) {
        passInput.type = passInput.type === "password" ? "text" : "password";
      }
    });

    siteInput?.addEventListener("input", () => {
      const val = siteInput.value.toLowerCase();
      if (compRow) {
        compRow.style.display = val.includes("zinghr") ? "flex" : "none";
      }
    });

    btnSave?.addEventListener("click", async () => {
      const site = document.getElementById("credSiteInput")?.value.trim();
      const username = document.getElementById("credUserInput")?.value.trim();
      const password = document.getElementById("credPassInput")?.value;
      const companyCode = document.getElementById("credCompanyInput")?.value.trim();
      const storage = document.getElementById("credStorageSelect")?.value || "both";

      if (!site || !username || !password) {
        alert("Please enter site, username, and password.");
        return;
      }

      try {
        const extraFields = companyCode ? { companyCode } : {};
        const res = await fetch(`${BACKEND_URL}/api/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site, username, password, storage, extraFields }),
        });

        const data = await res.json();
        if (data.success) {
          if (typeof log === "function") log(`✔ Saved credentials for "${site}" to ${storage}`, "success");
          if (formContainer) formContainer.style.display = "none";
          // Clear inputs
          if (siteInput) siteInput.value = "";
          const userInput = document.getElementById("credUserInput");
          if (userInput) userInput.value = "";
          if (passInput) passInput.value = "";
          const compInput = document.getElementById("credCompanyInput");
          if (compInput) compInput.value = "";
          loadVaultAccounts();
        } else {
          alert("Failed to save: " + data.error);
        }
      } catch (err) {
        alert("Error saving credential: " + err.message);
      }
    });

    btnSync?.addEventListener("click", async () => {
      if (typeof log === "function") log("🔄 Syncing credentials between Local and Firebase...", "info");
      try {
        const res = await fetch(`${BACKEND_URL}/api/credentials/sync`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
          if (typeof log === "function") log("✔ Credentials synced successfully!", "success");
          loadVaultAccounts();
        } else {
          if (typeof log === "function") log(`❌ Sync failed: ${data.error}`, "error");
        }
      } catch (err) {
        if (typeof log === "function") log(`❌ Sync error: ${err.message}`, "error");
      }
    });
  }

  // ==========================================================
  // 5. DEEP REASONING STREAM (THINKING PROCESS)
  // ==========================================================

  function appendReasoningCard(entry) {
    if (!reasoningStream) return;

    // Remove placeholder on first entry
    const placeholder = reasoningStream.querySelector("div[style*='text-align: center']");
    if (placeholder) placeholder.remove();

    const card = document.createElement("div");
    card.className = "reasoning-card";

    const type = entry.type || "thought";
    const timeStr = new Date(entry.timestamp || Date.now()).toLocaleTimeString();

    card.innerHTML = `
      <div class="reasoning-meta">
        <span class="reasoning-type-pill ${escapeHTML(type)}">${escapeHTML(type)}</span>
        <span>${timeStr}</span>
      </div>
      <div class="reasoning-body">${escapeHTML(entry.content || "")}</div>
    `;

    reasoningStream.appendChild(card);
    reasoningStream.scrollTop = reasoningStream.scrollHeight;
  }

  // ==========================================================
  // 6. RENDER FULL STATE (FROM STATE SYNC)
  // ==========================================================

  function renderFullState(state) {
    if (!state) return;

    if (state.goal && goalCard) {
      goalCard.style.display = "flex";
      if (goalText) goalText.innerText = state.goal;
    }

    if (state.steps && state.steps.length) {
      renderStepsChecklist(state.steps);

      const total = state.steps.length;
      const completed = state.steps.filter((s) => s.status === "completed").length;
      const pct = Math.round((completed / total) * 100);

      if (progressBarFill) progressBarFill.style.width = `${pct}%`;
      if (progressPercent) progressPercent.innerText = `${pct}%`;
      if (stepCounter) stepCounter.innerText = `${completed} / ${total} Steps`;
    }

    if (state.reasoningLog && state.reasoningLog.length) {
      if (reasoningStream) reasoningStream.innerHTML = "";
      state.reasoningLog.forEach((entry) => appendReasoningCard(entry));
    }

    if (state.pendingPlannerCheck) {
      renderPlannerCheckCard(state.pendingPlannerCheck);
    } else if (state.pendingCredentialRequest) {
      renderCredentialPromptCard(state.pendingCredentialRequest);
    } else if (state.pendingQuestion) {
      renderClarificationQuestion(state.pendingQuestion);
    }
  }

  // ==========================================================
  // 7. HANDLE USER GOAL SUBMISSION
  // ==========================================================

  async function handleUserGoal(cmd) {
    const goal = String(cmd || "").trim();
    if (!goal) return;

    if (input) input.value = "";

    if (typeof log === "function") {
      log(`🚀 Submitting mission goal: "${goal}"`, "info");
    }

    // Switch to Planner Tab
    const tabPlannerBtn = document.getElementById("tabPlannerBtn");
    tabPlannerBtn?.click();

    // Reset reasoning stream
    if (reasoningStream) {
      reasoningStream.innerHTML = "";
    }

    resetControls();
    if (btnPause) btnPause.style.display = "inline-flex";

    try {
      const res = await fetch(`${BACKEND_URL}/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });

      const data = await res.json();
      if (!data.success) {
        if (typeof log === "function") log(`❌ Failed to start goal: ${data.error}`, "error");
        if (typeof setStatus === "function") setStatus("Error launching goal", "error");
      }
    } catch (err) {
      console.error("handleUserGoal error:", err);
      if (typeof log === "function") log(`❌ Backend request failed: ${err.message}`, "error");
      if (typeof setStatus === "function") setStatus("Backend unavailable", "error");
    }
  }

  // ==========================================================
  // 8. CONTROLS: PAUSE, RESUME, STOP, CLEAR
  // ==========================================================

  function resetControls() {
    if (btnPause) btnPause.style.display = "inline-flex";
    if (btnResume) btnResume.style.display = "none";
  }

  btnPause?.addEventListener("click", async () => {
    try {
      await fetch(`${BACKEND_URL}/agent/pause`, { method: "POST" });
    } catch {}
  });

  btnResume?.addEventListener("click", async () => {
    try {
      await fetch(`${BACKEND_URL}/agent/resume`, { method: "POST" });
    } catch {}
  });

  btnStop?.addEventListener("click", async () => {
    try {
      await fetch(`${BACKEND_URL}/agent/stop`, { method: "POST" });
      resetControls();
      dismissClarificationCard();
    } catch {}
  });

  btnClear?.addEventListener("click", () => {
    if (goalCard) goalCard.style.display = "none";
    if (stepsChecklist) {
      stepsChecklist.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 12px; line-height: 1.6;">
          Autonomous Agent ready. Enter any task below:<br />
          <span style="color: var(--accent-blue); font-weight: 600;">✈️ Book flights &nbsp;|&nbsp; 📅 Calendar &nbsp;|&nbsp; 📝 Notes &nbsp;|&nbsp; 🗺️ Maps &nbsp;|&nbsp; 🛍️ Shopping</span>
        </div>
      `;
    }
    if (reasoningStream) {
      reasoningStream.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 12px;">
          Agent reasoning thoughts will stream live here during planning and decision execution.
        </div>
      `;
    }
    dismissClarificationCard();
    resetControls();
    if (typeof setStatus === "function") setStatus("Ready for mission", "ready");
  });

  // ==========================================================
  // 9. EVENT LISTENERS
  // ==========================================================

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = input.value.trim();
        if (cmd) handleUserGoal(cmd);
      }
    });
  }

  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const cmd = input ? input.value.trim() : "";
      if (cmd) handleUserGoal(cmd);
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      const cmd = input ? input.value.trim() : "";
      if (cmd) handleUserGoal(cmd);
    });
  }

  // Escape HTML helper
  function escapeHTML(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Global exposure
  window.executeUserCommand = handleUserGoal;
  window.handleAISubmit = handleUserGoal;
  window.submitQuestionAnswer = submitQuestionAnswer;
  window.loadVaultAccounts = loadVaultAccounts;

  // Initialize Vault UI & SSE connection on load
  setupVaultListeners();
  connectAgentEvents();
})();
