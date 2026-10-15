//==========================================================
//
// backend/agent/agent-engine.js
//
// Jarvis Generic Autonomous AI Browser Agent Engine
//
// Features:
// ✔ Model-Driven Thinking & Planning Loop (LLM / Fast / Reasoning / Vision)
// ✔ Generic Multi-Domain Support:
//     ✈️ Flights & Travel (Google Flights, Skyscanner, Airlines)
//     📅 Calendar & Scheduling (Google Calendar, Outlook)
//     📝 Notes & Reminders (Google Keep, Notion, Todo lists)
//     🗺️ Maps & Directions (Google Maps, transit, driving routes)
//     🛍️ E-Commerce & Buying (Amazon, Flipkart, BestBuy, any store)
//     🔍 Search & Web Research (Google, general web browsing)
// ✔ Deep Reasoning Stream (Real-time thought process logs)
// ✔ Dynamic Human-in-the-Loop Clarification Engine (Variant, dates, time, mode)
// ✔ Universal Browser Tool Executor via Playwright CDP
// ✔ Resilient zero-failure fallback heuristic planner
// ✔ Real-time SSE streaming for live UI synchronization
// ✔ Interactive Pause, Resume, Stop, and Step execution controls
//
//==========================================================

import { EventEmitter } from "events";
import browserController from "../browser-controller.js";
import { credentialManager } from "../auth/credential-manager.js";
import { loginHandler } from "../auth/login-handler.js";

export class AgentEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      debug: options.debug ?? true,
      maxSteps: options.maxSteps ?? 10,
      stepDelayMs: options.stepDelayMs ?? 1000,
      maxActionRetries: options.maxActionRetries ?? 2,
      mockBrowser: options.mockBrowser ?? false,
      ...options,
    };

    this.modelRouter = options.modelRouter || null;
    this.resolver = options.resolver || null;
    this.toolMap = options.toolMap || null;
    this.pageContextEngine = options.pageContextEngine || null;
    this.browserController = options.browserController || null;
    this.credentialManager = options.credentialManager || credentialManager;
    this.loginHandler = options.loginHandler || loginHandler;

    // Active State
    this.state = {
      status: "idle", // 'idle' | 'planning' | 'executing' | 'waiting_for_user' | 'waiting_for_user_check' | 'paused' | 'completed' | 'error'
      goal: "",
      category: "general",
      activeStepIndex: -1,
      steps: [],
      reasoningLog: [],
      pendingQuestion: null,
      pendingPlannerCheck: null,
      pendingCredentialRequest: null,
      isPaused: false,
      completedSteps: 0,
      totalSteps: 0,
      startedAt: null,
      completedAt: null,
      lastError: null,
    };

    // Connected SSE clients
    this.sseClients = new Set();
  }

  configure(newOptions = {}) {
    Object.assign(this.options, newOptions);
    if (newOptions.modelRouter) this.modelRouter = newOptions.modelRouter;
    if (newOptions.resolver) this.resolver = newOptions.resolver;
    if (newOptions.toolMap) this.toolMap = newOptions.toolMap;
    if (newOptions.pageContextEngine) this.pageContextEngine = newOptions.pageContextEngine;
    if (newOptions.browserController) this.browserController = newOptions.browserController;
    if (newOptions.credentialManager) this.credentialManager = newOptions.credentialManager;
    if (newOptions.loginHandler) this.loginHandler = newOptions.loginHandler;
    this.log("AgentEngine dependencies configured.");
  }

  log(...args) {
    if (this.options.debug) {
      console.log("[AgentEngine]", ...args);
    }
  }

  warn(...args) {
    console.warn("[AgentEngine]", ...args);
  }

  error(...args) {
    console.error("[AgentEngine]", ...args);
  }

  // ==========================================================
  // SSE SUBSCRIPTION MANAGEMENT
  // ==========================================================

  subscribe(res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    this.sseClients.add(res);

    // Send immediate state snapshot
    res.write(`event: state_sync\ndata: ${JSON.stringify(this.getState())}\n\n`);

    res.on("close", () => {
      this.sseClients.delete(res);
    });
  }

  broadcast(eventType, payload = {}) {
    const data = {
      type: eventType,
      timestamp: Date.now(),
      state: this.getState(),
      ...payload,
    };

    const sseMessage = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const client of this.sseClients) {
      try {
        client.write(sseMessage);
      } catch {
        this.sseClients.delete(client);
      }
    }

    this.emit(eventType, data);
  }

  getState() {
    return {
      status: this.state.status,
      goal: this.state.goal,
      category: this.state.category,
      activeStepIndex: this.state.activeStepIndex,
      steps: this.state.steps,
      reasoningLog: this.state.reasoningLog,
      pendingQuestion: this.state.pendingQuestion,
      pendingPlannerCheck: this.state.pendingPlannerCheck,
      pendingCredentialRequest: this.state.pendingCredentialRequest,
      isPaused: this.state.isPaused,
      completedSteps: this.state.completedSteps,
      totalSteps: this.state.steps.length,
      startedAt: this.state.startedAt,
      completedAt: this.state.completedAt,
      lastError: this.state.lastError,
    };
  }

  addReasoning(content, type = "thought") {
    const entry = {
      id: "reason_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      stepIndex: this.state.activeStepIndex,
      type, // 'thought' | 'observation' | 'decision' | 'action' | 'clarification'
      content,
    };
    this.state.reasoningLog.push(entry);
    this.broadcast("reasoning", { entry });
    return entry;
  }

  // ==========================================================
  // DYNAMIC MODEL-DRIVEN THINKING & PLANNING
  // ==========================================================

  async plan(goal) {
    const cleanGoal = String(goal || "").trim();
    if (!cleanGoal) {
      throw new Error("Missing goal text.");
    }

    this.log("Decomposing goal:", cleanGoal);
    this.state.status = "planning";
    this.state.goal = cleanGoal;
    this.state.startedAt = Date.now();
    this.state.completedAt = null;
    this.state.activeStepIndex = -1;
    this.state.steps = [];
    this.state.reasoningLog = [];
    this.state.pendingQuestion = null;
    this.state.pendingPlannerCheck = null;
    this.state.pendingCredentialRequest = null;
    this.state.isPaused = false;
    this.state.lastError = null;

    this.broadcast("plan_started", { goal: cleanGoal });
    this.addReasoning(`Analyzing user goal: "${cleanGoal}"`, "thought");

    let steps = null;

    // 1. Attempt dynamic model-driven planning via ModelRouter
    if (this.modelRouter) {
      try {
        steps = await this.thinkWithModel(cleanGoal);
      } catch (err) {
        if (err.provider && err.errorType) {
          console.warn(
`[ModelRouter]
tier=${err.tier || "reasoning"}
provider=${err.provider}
model=${err.model}
status=unavailable
error=${err.errorType}
latency=${Math.max(1, Math.round(err.latencyMs || 0))}ms`
          );
        }
        this.addReasoning(
          `Model-driven planning unavailable (${err.message}). Falling back to the heuristic planner.`,
          "decision",
        );
        this.log("Model-driven planning failed, falling back to heuristic planner:", err.message);
      }
    }

    // 2. Fallback to resilient heuristic planner if model plan unavailable
    if (!steps || !steps.length) {
      steps = this.heuristicPlan(cleanGoal);
    }

    this.state.steps = steps;
    this.state.totalSteps = steps.length;
    this.addReasoning(`Generated ${steps.length} sequential execution steps. Ready to start.`, "decision");

    this.broadcast("plan_created", {
      goal: cleanGoal,
      category: this.state.category,
      steps,
      totalSteps: steps.length,
    });

    return steps;
  }

  // ----------------------------------------------------------
  // LLM THINKING VIA MODEL ROUTER
  // ----------------------------------------------------------
  async thinkWithModel(cleanGoal) {
    this.addReasoning(`Prompting neural model to reason about intent, domain, and execution strategy...`, "thought");

    const prompt = `You are Jarvis, an autonomous AI browser agent.
Analyze the user's natural language goal and produce a structured execution plan for browser automation.
Supported domains include:
- Flights: search routes, compare fares, select dates, airline booking
- Calendar: schedule meetings, set appointments, add events with date and time
- Notes & Reminders: create notes, organize checklists, set reminder triggers
- Maps & Directions: search locations, get driving/transit/walking routes, check travel time
- E-Commerce / Buying: search any product across stores, handle variants (size/color/spec), proceed to cart/buy
- Research & Search: perform web queries, extract information from pages

USER GOAL: "${cleanGoal}"

Analyze if any critical parameters are missing (e.g. flight class or return date, an item variant, or a required form value). If missing, set "needsClarification": true and formulate options only when they can be grounded in current page information or user input.
Never treat an attempted interaction as a successful outcome. For every action step, include a "verification" object with a generic, observable postcondition. Use one of:
- {"type":"text_present","expected":"visible confirmation or resulting content"}
- {"type":"url_contains","expected":"expected destination fragment"}
- {"type":"value_equals","expected":"value that should appear in a form control"}
- {"type":"selection_matches","expected":"option that should be selected"}
- {"type":"cart_changed"} when the intended result is adding an item to a collection/cart
Do not include site-specific selectors or rely on a click having happened. Keep workflows generic and use only information from the user and current page.
When a clarification supplies a required option, preserve that answer in subsequent action arguments and do not ask for it again. A clarification step may include "workflowActions": an ordered list of follow-up UI actions. Keep selection and collection/cart actions in that list when they fulfill the clarified request. Verify each action before beginning the next one, and do not complete the parent clarification step until all listed actions are verified.

Return ONLY a JSON object matching this schema:
{
  "category": "flight" | "calendar" | "note" | "reminder" | "map" | "ecommerce" | "search" | "general",
  "targetUrl": "<starting https:// URL>",
  "thought": "<brief reasoning explaining the plan and target service>",
  "needsClarification": true | false,
  "clarification": {
    "parameter": "<parameter name>",
    "question": "<clarification question text>",
    "options": ["<option 1>", "<option 2>", "<option 3>", "<option 4>"]
  },
  "steps": [
    {
      "id": "step_1",
      "title": "<step title>",
      "description": "<step description>",
      "tool": "navigate" | "search" | "fill_form" | "click_element" | "clarify_variant" | "select_option" | "select_product" | "save_action" | "click_buy" | "finish",
      "args": { ... },
      "verification": { "type": "<generic verification type>", "expected": "<expected observable result>" },
      "workflowActions": [
        { "tool": "<action tool>", "args": { ... }, "verification": { "type": "<type>", "expected": "<state>" } }
      ],
      "reasoning": "<rationale>"
    }
  ]
}`;

    const basePlanningTimeout =
      this.options.planningTimeout ||
      this.modelRouter?.timeouts?.reasoning ||
      20000;
    const planningTimeout = Math.min(basePlanningTimeout, 8000);
    const completionPromise = this.modelRouter.complete(prompt, {
      taskType: "plan_complex",
      tier: "reasoning",
      temperature: 0,
      timeout: planningTimeout,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Model planning timeout after ${planningTimeout}ms`),
          ),
        planningTimeout,
      ),
    );

    const result = await Promise.race([completionPromise, timeoutPromise]);
    if (!result?.text) return null;

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return null;
    }

    this.state.category = parsed.category || "general";
    if (parsed.thought) {
      this.addReasoning(`[Model Thought] ${parsed.thought}`, "thought");
    }

    // Normalize steps
    return parsed.steps.map((s, idx) => ({
      id: s.id || `step_${idx + 1}`,
      index: idx,
      title: s.title || `Step ${idx + 1}`,
      description: s.description || s.title || "",
      tool: s.tool || "navigate",
      args: s.args || {},
      verification: s.verification || null,
      workflowActions: Array.isArray(s.workflowActions)
        ? s.workflowActions.map((action) => ({ ...action, args: action.args || {} }))
        : null,
      status: "pending",
      reasoning: s.reasoning || `Executing ${s.tool}`,
    }));
  }

  // ----------------------------------------------------------
  // HEURISTIC PLANNER FOR ZERO-FAILURE RESILIENCE
  // ----------------------------------------------------------
  heuristicPlan(cleanGoal) {
    // 1. FLIGHTS & TRAVEL
    if (/(?:flight|fly|airline|airfare|plane ticket|google flights|skyscanner|kayak|expedia)/i.test(cleanGoal)) {
      this.state.category = "flight";
      return this.buildFlightPlan(cleanGoal);
    }

    // 2. CALENDAR & SCHEDULING
    if (/(?:calendar|schedule|meeting|appointment|event|book slot)/i.test(cleanGoal)) {
      this.state.category = "calendar";
      return this.buildCalendarPlan(cleanGoal);
    }

    // 3. NOTES & REMINDERS
    if (/(?:note|memo|keep|reminder|to-?do|grocery list|shopping list|checklist)/i.test(cleanGoal)) {
      this.state.category = "note";
      return this.buildNotePlan(cleanGoal);
    }

    // 4. MAPS & NAVIGATION
    if (/(?:map|direction|route|traffic|navigate to|how to reach|where is|drive to|transit to)/i.test(cleanGoal)) {
      this.state.category = "map";
      return this.buildMapPlan(cleanGoal);
    }

    // 5. HR LEAVE & ZINGHR
    if (/(?:zinghr|zing\s*hr|apply leave|apply for leave|apply sick leave|apply casual leave|leave application)/i.test(cleanGoal)) {
      this.state.category = "hr_leave";
      return this.buildZingHRPlan(cleanGoal);
    }

    // 6. UDEMY & ONLINE COURSES
    if (/(?:udemy|online course|enroll in course|buy course)/i.test(cleanGoal)) {
      this.state.category = "edtech";
      return this.buildUdemyPlan(cleanGoal);
    }

    // 7. E-COMMERCE & BUYING
    if (/(?:buy|purchase|order|shop|add to cart)/i.test(cleanGoal)) {
      this.state.category = "ecommerce";
      return this.buildEcommercePlan(cleanGoal);
    }

    // 8. GENERAL SEARCH & WEB RESEARCH
    this.state.category = "search";
    return this.buildSearchPlan(cleanGoal);
  }

  // ==========================================================
  // DOMAIN-SPECIFIC PLAN GENERATORS
  // ==========================================================

  // --- ✈️ 1. FLIGHTS PLAN ---
  buildFlightPlan(cleanGoal) {
    let origin = "New York (JFK)";
    let dest = "London (LHR)";

    const fromMatch = cleanGoal.match(/from\s+([a-zA-Z\s]+?)(?:\s+to\s+|$)/i);
    const toMatch = cleanGoal.match(/to\s+([a-zA-Z\s]+?)(?:\s+from\s+|\s+for\s+|\s+next\s+|\s+on\s+|$)/i);

    if (fromMatch && fromMatch[1]) origin = fromMatch[1].trim();
    if (toMatch && toMatch[1]) dest = toMatch[1].trim();

    const hasClass = /economy|business|first class|premium/i.test(cleanGoal);
    const needsClarification = !hasClass;

    this.addReasoning(
      `Identified flight booking goal: Route from "${origin}" to "${dest}". ` +
      `Cabin class specified: ${hasClass ? "YES" : "NO"}. ` +
      (needsClarification ? "Ambiguity detected — will prompt user for preferred cabin class." : "Parameters complete."),
      "decision"
    );

    const steps = [
      {
        id: "step_1",
        index: 0,
        title: "Navigate to Google Flights",
        description: "Open Google Flights search platform (https://www.google.com/travel/flights)",
        tool: "navigate",
        args: { url: "https://www.google.com/travel/flights" },
        status: "pending",
        reasoning: "Accessing Google Flights to perform live airline route comparison and fare aggregation.",
      },
      {
        id: "step_2",
        index: 1,
        title: `Search Route: ${origin} → ${dest}`,
        description: `Input departure location "${origin}" and destination "${dest}"`,
        tool: "search",
        args: {
          query: `${origin} to ${dest}`,
          origin,
          destination: dest,
        },
        status: "pending",
        reasoning: "Entering origin and destination airports into the flight search bar.",
      },
    ];

    if (needsClarification) {
      steps.push({
        id: "step_3",
        index: steps.length,
        title: "Clarify Cabin Class & Schedule",
        description: "Ask user for preferred travel class and schedule flexibility",
        tool: "clarify_variant",
        args: {
          question: `Which cabin class and travel schedule do you prefer for ${origin} to ${dest}?`,
          options: [
            "Economy - Best Value",
            "Premium Economy - Extra Legroom",
            "Business Class - Lie-Flat Seats",
            "Flexible Dates (Cheapest Week)",
          ],
          parameter: "cabin_class",
          product: `Flights: ${origin} to ${dest}`,
        },
        status: "pending",
        reasoning: "Multiple seating classes and fare tiers exist. Prompting user for choice.",
      });
    }

    steps.push(
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Select Optimal Flight",
        description: "Evaluate flight durations, layovers, and select top matching itinerary",
        tool: "select_option",
        args: { route: `${origin} to ${dest}`, preference: "best_value" },
        status: "pending",
        reasoning: "Filtering by chosen class, sorting by price/duration, and selecting optimal carrier.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Review Fare Breakdown & Baggage",
        description: "Inspect airline baggage policies, seat selection, and price summary",
        tool: "click_element",
        args: { target: "Select Flight & Review Fares", selector: "button, [role='button']" },
        status: "pending",
        reasoning: "Opening fare breakdown modal to prepare checkout details.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Complete Flight Search",
        description: `Successfully located flight options for ${origin} to ${dest}`,
        tool: "finish",
        args: {
          message: `Top flights for ${origin} → ${dest} have been located and selected! Itinerary is ready for ticket booking.`,
        },
        status: "pending",
        reasoning: "Flight search successfully concluded.",
      }
    );

    return steps;
  }

  // --- 📅 2. CALENDAR PLAN ---
  buildCalendarPlan(cleanGoal) {
    let title = "Meeting";
    const titleMatch = cleanGoal.match(/(?:schedule|calendar|mark|add|create|set)\s+(?:a|an)?\s*([a-zA-Z0-9\s]+?)(?:\s+(?:on|for|at|tomorrow|next|with)\s+|$)/i);
    if (titleMatch && titleMatch[1]) title = titleMatch[1].trim();

    const hasTime = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(cleanGoal);
    const needsClarification = !hasTime;

    this.addReasoning(
      `Identified calendar scheduling goal: "${title}". ` +
      `Time specified: ${hasTime ? "YES" : "NO"}. ` +
      (needsClarification ? "Time slot ambiguous — will prompt user for time window." : "Time is defined."),
      "decision"
    );

    const steps = [
      {
        id: "step_1",
        index: 0,
        title: "Navigate to Google Calendar",
        description: "Open Google Calendar web interface (https://calendar.google.com)",
        tool: "navigate",
        args: { url: "https://calendar.google.com" },
        status: "pending",
        reasoning: "Loading Google Calendar to create a new appointment.",
      },
      {
        id: "step_2",
        index: 1,
        title: "Open Event Creation Dialog",
        description: "Click '+ Create' button to open new event form",
        tool: "click_element",
        args: { target: "Create Event", selector: "div[jsname], button, [aria-label*='Create']" },
        status: "pending",
        reasoning: "Triggering the event creation drawer on calendar view.",
      },
    ];

    if (needsClarification) {
      steps.push({
        id: "step_3",
        index: steps.length,
        title: "Clarify Event Time Slot",
        description: `Ask user for preferred time slot for "${title}"`,
        tool: "clarify_variant",
        args: {
          question: `What time would you like to schedule "${title}"?`,
          options: [
            "Morning (9:00 AM - 10:00 AM)",
            "Afternoon (2:00 PM - 3:00 PM)",
            "Evening (5:30 PM - 6:30 PM)",
            "All Day Event",
          ],
          parameter: "time_slot",
          product: title,
        },
        status: "pending",
        reasoning: "Prompt does not designate an exact hour. Asking user for preferred window.",
      });
    }

    steps.push(
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: `Enter Event Details: "${title}"`,
        description: `Type title "${title}", set date, and configure notification reminder`,
        tool: "fill_form",
        args: { title, target: "Event Title Input" },
        status: "pending",
        reasoning: "Populating event title, duration, and reminder parameters.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Save Calendar Entry",
        description: "Commit event to calendar and set alert notifications",
        tool: "save_action",
        args: { action: "Save Event" },
        status: "pending",
        reasoning: "Saving event to ensure it syncs across all devices.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Complete Calendar Task",
        description: `Confirmed event "${title}" on calendar`,
        tool: "finish",
        args: {
          message: `Successfully scheduled "${title}" on your calendar with reminders active!`,
        },
        status: "pending",
        reasoning: "Calendar scheduling finished.",
      }
    );

    return steps;
  }

  // --- 📝 3. NOTES & REMINDERS PLAN ---
  buildNotePlan(cleanGoal) {
    let noteContent = cleanGoal.replace(/^(?:take|create|make|write|add|save|set)\s+(?:a|an)?\s*(?:note|reminder|memo|todo|to-do)(?:\s+(?:for|about|with|that|of))?/i, "").trim();
    if (!noteContent) noteContent = "Important Action Items";

    const hasCategory = /work|personal|grocery|shopping|urgent/i.test(cleanGoal);
    const needsClarification = !hasCategory;

    this.addReasoning(
      `Identified note/reminder goal. Extracted content: "${noteContent}". ` +
      `Category defined: ${hasCategory ? "YES" : "NO"}. ` +
      (needsClarification ? "Prompting user for note organization tag." : "Note details complete."),
      "decision"
    );

    const steps = [
      {
        id: "step_1",
        index: 0,
        title: "Navigate to Google Keep",
        description: "Open Google Keep note-taking application (https://keep.google.com)",
        tool: "navigate",
        args: { url: "https://keep.google.com" },
        status: "pending",
        reasoning: "Accessing Google Keep for persistent cloud-synced note taking and reminder alerts.",
      },
      {
        id: "step_2",
        index: 1,
        title: "Activate 'Take a note' Canvas",
        description: "Focus the note input bar to expand note creation fields",
        tool: "click_element",
        args: { target: "Take a note", selector: "div[role='textbox'], div.notelist" },
        status: "pending",
        reasoning: "Expanding Google Keep editor canvas.",
      },
    ];

    if (needsClarification) {
      steps.push({
        id: "step_3",
        index: steps.length,
        title: "Clarify Note Category & Trigger",
        description: "Choose tag and alert preference for note",
        tool: "clarify_variant",
        args: {
          question: `Which category or reminder trigger should be attached to this note?`,
          options: [
            "Personal / Quick Note",
            "Work / Action Items Checklist",
            "Shopping & Grocery List",
            "Reminder with Tomorrow Morning Alert",
          ],
          parameter: "note_type",
          product: "Note",
        },
        status: "pending",
        reasoning: "Prompting user for label and reminder frequency.",
      });
    }

    steps.push(
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Enter Note Content",
        description: `Write "${noteContent}" with interactive checklist format`,
        tool: "fill_form",
        args: { content: noteContent },
        status: "pending",
        reasoning: "Filling note body with user text and checkbox items.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Pin & Save Note",
        description: "Save note to Google Keep and pin to top of board",
        tool: "save_action",
        args: { action: "Save Note" },
        status: "pending",
        reasoning: "Closing editor to persist note.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Complete Note Creation",
        description: "Note saved and synchronized",
        tool: "finish",
        args: {
          message: `Note "${noteContent}" has been successfully saved to Google Keep with your preferences!`,
        },
        status: "pending",
        reasoning: "Note action completed.",
      }
    );

    return steps;
  }

  // --- 🗺️ 4. MAPS & NAVIGATION PLAN ---
  buildMapPlan(cleanGoal) {
    let dest = "Central Park, New York";
    const destMatch = cleanGoal.match(/(?:to|for|at)\s+([a-zA-Z0-9\s,]+?)(?:\s+(?:from|via|using|by)\s+|$)/i);
    if (destMatch && destMatch[1]) dest = destMatch[1].trim();

    const hasMode = /driving|car|transit|subway|bus|metro|walking|walk|bike|cycling/i.test(cleanGoal);
    const needsClarification = !hasMode;

    this.addReasoning(
      `Identified maps navigation goal targeting destination: "${dest}". ` +
      `Travel mode specified: ${hasMode ? "YES" : "NO"}. ` +
      (needsClarification ? "Prompting user for preferred transportation mode." : "Travel mode specified."),
      "decision"
    );

    const steps = [
      {
        id: "step_1",
        index: 0,
        title: "Navigate to Google Maps",
        description: "Open Google Maps navigation platform (https://www.google.com/maps)",
        tool: "navigate",
        args: { url: "https://www.google.com/maps" },
        status: "pending",
        reasoning: "Accessing Google Maps for turn-by-turn routing and real-time traffic preview.",
      },
      {
        id: "step_2",
        index: 1,
        title: `Search Destination: "${dest}"`,
        description: `Enter "${dest}" in Maps search bar and load place card`,
        tool: "search",
        args: { query: dest, selector: "input#searchboxinput, input[name='q']" },
        status: "pending",
        reasoning: "Locating destination coordinates and reviews.",
      },
    ];

    if (needsClarification) {
      steps.push({
        id: "step_3",
        index: steps.length,
        title: "Clarify Travel Mode",
        description: `Select transit mode to reach "${dest}"`,
        tool: "clarify_variant",
        args: {
          question: `What is your preferred mode of transportation to "${dest}"?`,
          options: [
            "Driving (Fastest route with live traffic)",
            "Public Transit (Subway / Bus / Train)",
            "Walking (Pedestrian routes & crosswalks)",
            "Bicycling (Protected bike lanes)",
          ],
          parameter: "travel_mode",
          product: dest,
        },
        status: "pending",
        reasoning: "Multiple transit modes exist. Asking user for preference.",
      });
    }

    steps.push(
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Request Directions & Optimize Route",
        description: "Click Directions button and calculate shortest travel time",
        tool: "click_element",
        args: { target: "Directions", selector: "button[data-value='Directions'], button[aria-label*='Directions']" },
        status: "pending",
        reasoning: "Computing optimal route, tolls, and arrival time.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Inspect ETA & Alternative Routes",
        description: "Review traffic conditions, distance, and turn instructions",
        tool: "select_option",
        args: { destination: dest },
        status: "pending",
        reasoning: "Selecting the optimal path based on traffic flow.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Complete Navigation Setup",
        description: `Route to "${dest}" ready for navigation`,
        tool: "finish",
        args: {
          message: `Optimal route to "${dest}" is calculated and ready for turn-by-turn navigation!`,
        },
        status: "pending",
        reasoning: "Navigation prepared.",
      }
    );

    return steps;
  }

  // --- 🛍️ 5. E-COMMERCE & BUYING PLAN ---
  buildEcommercePlan(cleanGoal) {
    const url = cleanGoal.match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.]+$/, "");
    const storeMatch = cleanGoal.match(/\b(?:from|on|at)\s+(amazon(?:\.in)?|flipkart|ebay)\b/i);
    const stores = {
      amazon: { url: "https://www.amazon.com", site: "amazon.com" },
      "amazon.in": { url: "https://www.amazon.in", site: "amazon.in" },
      flipkart: { url: "https://www.flipkart.com", site: "flipkart.com" },
      ebay: { url: "https://www.ebay.com", site: "ebay.com" },
    };
    const explicitStore = storeMatch ? stores[storeMatch[1].toLowerCase()] : null;
    const targetUrl = url || explicitStore?.url;
    const loginSite = url
      ? new URL(url).hostname.replace(/^www\./i, "")
      : explicitStore?.site;
    const item = cleanGoal
      .replace(/^\s*(?:please\s+)?(?:buy|purchase|order|shop for|add to cart)\s*/i, "")
      .replace(/https?:\/\/\S+/i, "")
      .replace(/\s+(?:from|on|at)\s+(?:amazon(?:\.in)?|flipkart|ebay)\b/i, "")
      .trim() || cleanGoal;

    const variantSpecified = /\b(?:variant|configuration|color|colour|size|storage|capacity|ram|model|edition)\s*(?::|=|\bis\b)?\s*\S/i.test(item);
    const steps = [];

    if (targetUrl) {
      steps.push({
        id: "step_1",
        index: steps.length,
        title: "Open the requested destination",
        description: "Navigate to the destination explicitly supplied by the user.",
        tool: "navigate",
        args: { url: targetUrl },
        verification: { type: "url_contains", expected: targetUrl },
        status: "pending",
        reasoning: "Using only the destination supplied in the request.",
      });
    }

    if (loginSite) {
      steps.push({
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Check account authentication",
        description: "Use saved credentials if login is required for the requested store.",
        tool: "login_handler",
        args: { site: loginSite, purpose: "Authenticate before purchasing the requested item." },
        status: "pending",
        reasoning: "The user explicitly requested a store; check for an existing authenticated account before purchasing.",
      });
    }

    steps.push({
      id: `step_${steps.length + 1}`,
      index: steps.length,
      title: "Find the requested item",
      description: "Search the current page for the item described by the user.",
      tool: "search",
      args: { query: item },
      verification: { type: "query_present", expected: item },
      status: "pending",
      reasoning: "Searching with the user's own item description.",
    });

    const clarifiedVariant = variantSpecified
      ? item.match(/\b(?:variant|configuration|color|colour|size|storage|capacity|ram|model|edition)\s*(?::|=|\bis\b)\s*(.+)$/i)?.[1]?.trim() || item
      : "{user_choice}";
    steps.push({
      id: `step_${steps.length + 1}`,
      index: steps.length,
      title: variantSpecified ? "Select the requested variant" : "Clarify the required product variant",
      description: "Collect any missing variant information, select the requested option, verify the selection, trigger the available purchase/collection action, and verify the resulting state.",
      tool: variantSpecified ? "workflow" : "clarify_variant",
      args: {
        question: "Which variant or configuration should be selected?",
        options: [],
        parameter: "variant",
        product: item,
      },
      workflowActions: [
        {
          tool: "select_option",
          args: { variant: clarifiedVariant },
          verification: { type: "selection_matches", expected: clarifiedVariant },
          description: "Select and verify the exact user-requested variant.",
        },
        {
          tool: "click_buy",
          args: { target: "purchase_action", intent: "purchase" },
          verification: { type: "cart_changed" },
          description: "Trigger the visible purchase or collection action on the current page and verify the state changed.",
        },
      ],
      status: "pending",
      reasoning: "Selection and collection changes are dependent actions and remain within this step until both are verified.",
    });

    steps.push({
      id: `step_${steps.length + 1}`,
      index: steps.length,
      title: "Complete the requested item workflow",
      description: "Report completion only after selection and collection state have been verified.",
      tool: "finish",
      args: { message: "The requested item was selected and its collection state was verified." },
      status: "pending",
      reasoning: "All required UI postconditions have been verified.",
    });

    return steps;
  }

  // --- 🏢 5b. ZINGHR LEAVE APPLICATION PLAN ---
  buildZingHRPlan(cleanGoal) {
    let leaveType = "Casual Leave";
    if (/sick/i.test(cleanGoal)) leaveType = "Sick Leave";
    else if (/earned|privilege|pl/i.test(cleanGoal)) leaveType = "Privilege Leave";
    else if (/casual|cl/i.test(cleanGoal)) leaveType = "Casual Leave";
    else if (/wfh|work from home/i.test(cleanGoal)) leaveType = "Work From Home";

    const hasLeaveTypeSpecified = /sick|casual|privilege|earned|wfh|maternity|paternity/i.test(cleanGoal);
    const needsClarification = !hasLeaveTypeSpecified;

    let targetDate = "Tomorrow";
    const dateMatch = cleanGoal.match(/(?:for|on|from)\s+([a-zA-Z0-9\s]+?)(?:\s+(?:due to|because of|reason)|$)/i);
    if (dateMatch && dateMatch[1]) targetDate = dateMatch[1].trim();

    this.addReasoning(
      `Identified ZingHR leave application goal. Leave Type: "${leaveType}". Target Date: "${targetDate}". ` +
      (needsClarification ? "Ambiguity detected — will prompt user for leave type." : "Parameters complete."),
      "decision"
    );

    const steps = [
      {
        id: "step_1",
        index: 0,
        title: "Navigate to ZingHR Portal",
        description: "Open ZingHR Enterprise Authentication Portal (https://enterprise.zinghr.com/2020/pages/authentication/login.aspx)",
        tool: "navigate",
        args: { url: "https://enterprise.zinghr.com/2020/pages/authentication/login.aspx" },
        status: "pending",
        reasoning: "Connecting to ZingHR corporate portal to access employee self-service services.",
      },
      {
        id: "step_2",
        index: 1,
        title: "Authenticate with ZingHR Credentials",
        description: "Login using saved ZingHR Company Code, Employee ID, and Password (Local / Firebase DB)",
        tool: "login_handler",
        args: {
          site: "zinghr.com",
          purpose: "Login to ZingHR employee account to access Leave Management",
        },
        status: "pending",
        reasoning: "Retrieving credentials from local vault or Firebase and completing ZingHR authentication.",
      },
    ];

    if (needsClarification) {
      steps.push({
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Clarify Leave Type",
        description: "Select which category of leave to apply for",
        tool: "clarify_variant",
        args: {
          question: "Which type of leave would you like to apply for in ZingHR?",
          options: [
            "Casual Leave (CL)",
            "Sick Leave (SL)",
            "Privilege / Earned Leave (PL)",
            "Work From Home (WFH)",
          ],
          parameter: "leaveType",
        },
        status: "pending",
        reasoning: "User did not specify leave type. Pausing to request selection.",
      });
    }

    steps.push(
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Navigate to Apply Leave Section",
        description: "Access Leave Application module from ZingHR dashboard",
        tool: "click_element",
        args: { target: "Leave" },
        status: "pending",
        reasoning: "Opening ZingHR leave application form.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Fill Leave Application Form",
        description: `Enter leave details: ${leaveType} for ${targetDate}`,
        tool: "fill_form",
        args: {
          title: `Apply ${leaveType} for ${targetDate}`,
          leaveType,
          date: targetDate,
          reason: "Personal / Medical Leave",
        },
        status: "pending",
        reasoning: "Populating ZingHR leave application dates, leave category, and reason.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Review Leave Application (Planner Check)",
        description: `Verify dates (${targetDate}) and leave type (${leaveType}) before submitting to manager`,
        tool: "user_confirmation",
        args: {
          prompt: `Please review the ZingHR leave application for ${leaveType} on ${targetDate}. Confirm to proceed.`,
        },
        status: "pending",
        reasoning: "Confirmation checkpoint before formal submission.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Submit Leave Application",
        description: "Submit leave application to manager in ZingHR",
        tool: "click_element",
        args: { target: "Submit" },
        status: "pending",
        reasoning: "Committing leave application in ZingHR portal.",
      },
      {
        id: `step_${steps.length + 1}`,
        index: steps.length,
        title: "Complete Task & Confirmation",
        description: `Leave application for ${leaveType} submitted successfully`,
        tool: "finish",
        args: {
          message: `Successfully completed leave application for ${leaveType} in ZingHR!`,
        },
        status: "pending",
        reasoning: "Task execution finished.",
      }
    );

    return steps;
  }

  // --- 🎓 5c. UDEMY COURSE PLAN ---
  buildUdemyPlan(cleanGoal) {
    let courseTopic = "React";
    const topicMatch = cleanGoal.match(/(?:buy|order|enroll|search for|find)\s+(?:a|an|the)?\s*([a-zA-Z0-9\s+]+?)(?:\s+(?:course|tutorial|on udemy|from udemy))?$/i);
    if (topicMatch && topicMatch[1]) {
      courseTopic = topicMatch[1].replace(/udemy/gi, "").trim();
    }
    if (!courseTopic || courseTopic.length < 2) courseTopic = "React";

    this.addReasoning(`Planning Udemy course purchase for topic: "${courseTopic}"`, "thought");

    return [
      {
        id: "step_1",
        index: 0,
        title: "Navigate to Udemy",
        description: "Open Udemy learning platform (https://www.udemy.com)",
        tool: "navigate",
        args: { url: "https://www.udemy.com" },
        status: "pending",
        reasoning: "Accessing Udemy course catalog.",
      },
      {
        id: "step_2",
        index: 1,
        title: `Search for "${courseTopic}" Course`,
        description: `Locate search bar on Udemy and query "${courseTopic}"`,
        tool: "search",
        args: { query: courseTopic },
        status: "pending",
        reasoning: `Searching Udemy catalog for "${courseTopic}" courses.`,
      },
      {
        id: "step_3",
        index: 2,
        title: `Select Top Rated "${courseTopic}" Course`,
        description: "Inspect search results and select the best-rated course",
        tool: "select_product",
        args: { product: courseTopic, variant: "Bestseller" },
        status: "pending",
        reasoning: "Opening course overview and enrollment page.",
      },
      {
        id: "step_4",
        index: 3,
        title: "Authenticate with Udemy Account",
        description: "Check authentication state and login with saved credentials (Local / Firebase DB)",
        tool: "login_handler",
        args: { site: "udemy.com", purpose: "Login to enroll in course" },
        status: "pending",
        reasoning: "Authenticating student profile to attach course to account.",
      },
      {
        id: "step_5",
        index: 4,
        title: "Trigger the available purchase flow",
        description: "Find and activate the current page's purchase or collection control and verify the state change.",
        tool: "click_buy",
        args: { action: "purchase", intent: "purchase" },
        status: "pending",
        reasoning: "Resolving the semantic purchase action from the current page controls.",
      },
      {
        id: "step_6",
        index: 5,
        title: "Order & Payment Confirmation Check",
        description: `Review course price and payment options before final checkout`,
        tool: "user_confirmation",
        args: {
          prompt: `Please verify the Udemy course enrollment details and payment method in the browser.`,
        },
        status: "pending",
        reasoning: "Human checkpoint before purchase.",
      },
      {
        id: "step_7",
        index: 6,
        title: "Complete Task & Enrollment Summary",
        description: "Verify course enrollment is prepared and notify user",
        tool: "finish",
        args: {
          message: `Udemy course for "${courseTopic}" is ready for checkout!`,
        },
        status: "pending",
        reasoning: "Goal satisfied.",
      },
    ];
  }

  resolveNavigationTarget(goal, fallbackUrl = "https://www.google.com") {
    const text = String(goal || "").trim();
    if (!text) {
      return fallbackUrl;
    }

    if (/^https?:\/\//i.test(text)) {
      return text;
    }

    if (/^about:|^\/|^#|^app:|^file:/i.test(text)) {
      return text;
    }

    const domainMatch = text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:[/?#].*)?/i);
    if (domainMatch && domainMatch[1]) {
      return `https://${domainMatch[1]}`;
    }

    const knownSites = {
      amazon: "https://www.amazon.com",
      "amazon.in": "https://www.amazon.in",
      flipkart: "https://www.flipkart.com",
      ebay: "https://www.ebay.com",
      youtube: "https://www.youtube.com",
      github: "https://github.com",
      wikipedia: "https://www.wikipedia.org",
      maps: "https://www.google.com/maps",
      "google maps": "https://www.google.com/maps",
      calendar: "https://calendar.google.com",
      "google calendar": "https://calendar.google.com",
      keep: "https://keep.google.com",
      "google keep": "https://keep.google.com",
      flights: "https://www.google.com/travel/flights",
      "google flights": "https://www.google.com/travel/flights",
      "google": "https://www.google.com",
      "google search": "https://www.google.com",
      "microsoft": "https://www.microsoft.com",
      "netflix": "https://www.netflix.com",
      "apple": "https://www.apple.com",
      "linkedin": "https://www.linkedin.com",
      "twitter": "https://x.com",
      "x": "https://x.com",
      "reddit": "https://www.reddit.com",
      "notion": "https://www.notion.so",
      "dropbox": "https://www.dropbox.com",
      "udemy": "https://www.udemy.com",
      "bing": "https://www.bing.com",
      "duckduckgo": "https://duckduckgo.com",
      "stackoverflow": "https://stackoverflow.com",
      "news": "https://news.google.com",
      "gmail": "https://mail.google.com",
      "drive": "https://drive.google.com",
    };

    const lowered = text.toLowerCase();
    const directSite = Object.entries(knownSites).find(([key]) => lowered.includes(key));
    if (directSite) {
      return directSite[1];
    }

    if (text.includes(".")) {
      const bareDomain = text.replace(/^[^a-z0-9]+|[^a-z0-9.-]+$/gi, "").split(/\s+/).find((part) => /[a-z0-9.-]+\.[a-z]{2,}/i.test(part));
      if (bareDomain) {
        return `https://${bareDomain.replace(/^https?:\/\//i, "")}`;
      }
    }

    return fallbackUrl;
  }

  // --- 🔍 6. SEARCH & GENERAL WEB PLAN ---
  buildSearchPlan(cleanGoal) {
    const targetUrl = this.resolveNavigationTarget(cleanGoal);

    this.addReasoning(`Planning general web task for: "${cleanGoal}" targeting ${targetUrl}`, "thought");

    return [
      {
        id: "step_1",
        index: 0,
        title: `Navigate to ${targetUrl}`,
        description: `Open the relevant destination before searching for: "${cleanGoal}"`,
        tool: "navigate",
        args: { url: targetUrl },
        status: "pending",
        reasoning: `Navigating to ${targetUrl} to search for the user's goal.`,
      },
      {
        id: "step_2",
        index: 1,
        title: `Search & Inspect: "${cleanGoal}"`,
        description: `Execute query or interaction for goal "${cleanGoal}"`,
        tool: "search",
        args: { query: cleanGoal },
        status: "pending",
        reasoning: `Searching target web elements and analyzing results to satisfy goal.`,
      },
      {
        id: "step_3",
        index: 2,
        title: "Review Results & Extract Findings",
        description: "Parse top results and verify information accuracy",
        tool: "select_option",
        args: { query: cleanGoal },
        status: "pending",
        reasoning: "Evaluating relevant content from the web page.",
      },
      {
        id: "step_4",
        index: 3,
        title: "Complete Task",
        description: `Conclude goal: "${cleanGoal}"`,
        tool: "finish",
        args: { message: `Completed action for "${cleanGoal}"` },
        status: "pending",
        reasoning: "Task execution concluded.",
      },
    ];
  }

  // ==========================================================
  // RUN GOAL EXECUTION LOOP
  // ==========================================================

  async run(goal) {
    try {
      const steps = await this.plan(goal);
      this.state.status = "executing";
      this.state.activeStepIndex = 0;
      this.broadcast("execution_started", { steps });
      await this.executeStep(0);
      return this.getState();
    } catch (err) {
      this.state.status = "error";
      this.state.lastError = err.message;
      this.addReasoning(`Planning failed: ${err.message}`, "observation");
      this.broadcast("execution_error", { error: err.message });
      throw err;
    }
  }

  // ==========================================================
  // EXECUTE SINGLE STEP
  // ==========================================================

  transitionWorkflowState(step, nextState, details = {}) {
    const previousState = step.workflowState || "ACTION_REQUIRED";
    step.workflowState = nextState;
    step.workflowUpdatedAt = Date.now();
    const record = {
      stepIndex: step.index,
      stepTitle: step.title,
      intendedAction: details.intendedAction || step.currentAction || step.tool,
      actionResult: details.actionResult ?? null,
      verificationResult: details.verificationResult ?? null,
      failureReason: details.failureReason ?? null,
      retryCount: details.retryCount ?? step.retryCount ?? 0,
      previousState,
      nextState,
    };
    this.log("[Workflow]", JSON.stringify(record));
    this.addReasoning(
      `[Workflow] ${step.title}: ${previousState} -> ${nextState}; action=${step.tool}; retries=${record.retryCount}; verification=${JSON.stringify(record.verificationResult)}${record.failureReason ? `; failure=${record.failureReason}` : ""}`,
      nextState === "ACTION_FAILED" ? "observation" : "decision",
    );
    this.broadcast("workflow_state_changed", { workflow: record });
  }

  async executeWorkflowActions(index, step) {
    const sequence = step.workflowActions;
    const answer = step.userAnswer || "";
    const workflowStartedAt = performance.now();
    const resolveAnswer = (value) => typeof value === "string"
      ? value.replace(/\{user_choice\}/g, answer)
      : value;

    for (let actionIndex = step.workflowActionIndex || 0; actionIndex < sequence.length; actionIndex++) {
      const action = sequence[actionIndex];
      const actionStep = {
        ...step,
        ...action,
        index,
        title: step.title,
        args: Object.fromEntries(
          Object.entries(action.args || {}).map(([key, value]) => [key, resolveAnswer(value)]),
        ),
        verification: action.verification || null,
      };
      step.currentAction = actionStep.tool;
      step.pendingActionSpec = actionStep;
      action.retryCount = action.retryCount || 0;
      let lastFailure = "";
      const maxRetries = Math.max(0, Number(this.options.maxActionRetries) || 0);

      while (action.retryCount <= maxRetries) {
        const page = await this.getBrowserPage();
        const beforeState = await this.captureObservableState(page).catch((error) => {
          this.warn(`Could not capture pre-action state for Step ${index + 1}:`, error.message);
          return null;
        });
        this.transitionWorkflowState(step, "ACTION_REQUIRED", {
          intendedAction: actionStep.tool,
          retryCount: action.retryCount,
          failureReason: lastFailure || undefined,
        });
        this.transitionWorkflowState(step, "ACTION_IN_PROGRESS", {
          intendedAction: actionStep.tool,
          retryCount: action.retryCount,
        });

        let result;
        try {
          result = await this.performToolAction(actionStep, {
            attempt: action.retryCount,
            strategy: action.retryCount > 0 ? "alternative" : "primary",
            retryInstruction: step.retryInstruction || "",
          });
        } catch (error) {
          result = { success: false, error: error.message };
        }
        if (this.options.mockBrowser && result?.success === true) {
          result = { ...result, simulated: true };
        }

        if (result?.requiresCredentials) {
          return this.triggerCredentialRequest(index, step, result.site || actionStep.args.site, result.reason);
        }
        if (result?.requiresUserCheck) {
          this.transitionWorkflowState(step, "ACTION_FAILED", {
            intendedAction: actionStep.tool,
            actionResult: result,
            failureReason: result.reason || "Action requires user verification.",
          });
          return this.triggerPlannerCheck(index, step, result.reason, result.checkType);
        }

        const verification = await this.verifyStepOutcome(
          actionStep,
          result,
          beforeState,
          page,
        ).catch((error) => ({ verified: false, reason: `Verification failed: ${error.message}` }));
        step.lastAttemptResult = result;
        step.lastBeforeState = beforeState;
        step.lastVerification = verification;
        action.lastAttemptResult = result;
        action.lastBeforeState = beforeState;
        action.lastVerification = verification;

        if (verification.verified) {
          this.transitionWorkflowState(step, "ACTION_SUCCEEDED", {
            intendedAction: actionStep.tool,
            retryCount: action.retryCount,
            actionResult: result,
            verificationResult: verification,
          });
          action.workflowState = "STEP_COMPLETED";
          step.workflowActionIndex = actionIndex + 1;
          break;
        }

        lastFailure = verification.reason || "Expected UI state was not verified.";
        this.transitionWorkflowState(step, "ACTION_FAILED", {
          intendedAction: actionStep.tool,
          retryCount: action.retryCount,
          actionResult: result,
          verificationResult: verification,
          failureReason: lastFailure,
        });
        if (action.retryCount >= maxRetries) break;

        action.retryCount++;
        this.transitionWorkflowState(step, "RETRY_REQUIRED", {
          intendedAction: actionStep.tool,
          retryCount: action.retryCount,
          actionResult: result,
          verificationResult: verification,
          failureReason: lastFailure,
        });
      }

      if (action.workflowState !== "STEP_COMPLETED") {
        step.status = "failed";
        step.workflowActionIndex = actionIndex;
        return this.triggerPlannerCheck(index, step, lastFailure || "Action did not reach its verified postcondition.", "step_failure");
      }

      action.retryCount = 0;
    }

    const stepDuration = Math.round(performance.now() - workflowStartedAt);
    step.status = "completed";
    step.workflowState = "ACTION_SUCCEEDED";
    step.completedAt = Date.now();
    step.duration = stepDuration;
    step.result = {
      userChoice: answer || undefined,
      verifiedActions: sequence.map((action) => ({
        tool: action.tool,
        verification: action.lastVerification,
      })),
      verified: true,
    };
    this.state.completedSteps = index + 1;
    this.transitionWorkflowState(step, "STEP_COMPLETED", {
      intendedAction: step.currentAction,
      actionResult: step.result,
      verificationResult: { verified: true, evidence: "Every required workflow action was verified." },
    });
    this.broadcast("step_completed", { stepIndex: index, step, result: step.result });
    await new Promise((resolve) => setTimeout(resolve, this.options.stepDelayMs));
    await this.executeStep(index + 1);
  }

  async captureObservableState(page) {
    if (!page || typeof page.evaluate !== "function") return null;
    return await page.evaluate(() => {
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" &&
          rect.width > 0 && rect.height > 0;
      };
      const controls = Array.from(document.querySelectorAll(
        "button, a, input, textarea, select, [role], [contenteditable='true']",
      )).filter(visible).slice(0, 200).map((element) => {
        const associatedLabel = element.labels?.[0]?.innerText ||
          element.closest("label")?.innerText ||
          element.parentElement?.innerText ||
          "";
        const label = element.getAttribute("aria-label") ||
          element.getAttribute("name") ||
          associatedLabel ||
          element.innerText ||
          element.textContent ||
          element.getAttribute("placeholder") ||
          "";
        const selected = Boolean(
          element.checked ||
          element.selected ||
          element.getAttribute("aria-selected") === "true" ||
          element.getAttribute("aria-pressed") === "true" ||
          element.getAttribute("aria-checked") === "true" ||
          element.getAttribute("aria-current") === "true",
        );
        return {
          role: element.getAttribute("role") || element.tagName.toLowerCase(),
          label: String(label).trim().replace(/\s+/g, " ").slice(0, 200),
          value: "value" in element ? String(element.value || "") : "",
          selected,
        };
      });
      return {
        url: location.href,
        title: document.title,
        text: String(document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 12000),
        controls,
      };
    });
  }

  async verifyStepOutcome(step, result, beforeState, page) {
    if (result?.success === false) {
      return { verified: false, reason: result.error || result.reason || "Action reported failure." };
    }
    if (step.tool === "finish") {
      const incomplete = this.state.steps
        .slice(0, step.index)
        .find((priorStep) => priorStep.workflowState !== "STEP_COMPLETED");
      return incomplete
        ? { verified: false, reason: `Prior step "${incomplete.title}" is not verified.` }
        : { verified: true, evidence: "Every preceding step reached STEP_COMPLETED." };
    }
    if (
      step.tool === "user_confirmation" &&
      result?.verified === true
    ) {
      return { verified: true, evidence: "User confirmed the requested checkpoint." };
    }
    if (step.tool === "login_handler" && result?.success === true) {
      return { verified: true, evidence: "Authentication routine completed successfully." };
    }
    if (this.options.mockBrowser && (result?.simulated === true || result?.success === true)) {
      return { verified: true, evidence: "Explicit mock-browser simulation." };
    }

    const inferredContracts = {
      navigate: { type: "url_contains", expected: step.args?.url || "" },
      search: {
        type: "query_present",
        expected: step.args?.query || step.args?.origin || "",
      },
      fill_form: {
        type: "value_equals",
        expected: step.args?.value || step.args?.title || step.args?.content || "",
      },
      click_element: { type: "state_changed" },
      select_option: {
        type: "selection_matches",
        expected: step.args?.variant || step.args?.preference || "",
      },
      select_product: {
        type: "selection_matches",
        expected: step.args?.variant || step.args?.preference || "",
      },
      click_buy: { type: "cart_changed" },
      save_action: { type: "state_changed" },
      login_handler: { type: "state_changed" },
    };
    const contract = step.verification || inferredContracts[step.tool];
    if (!contract || !page) {
      return {
        verified: false,
        reason: !contract
          ? "No postcondition was defined for this action."
          : "Browser state was unavailable for verification.",
      };
    }

    const afterState = await this.captureObservableState(page);
    if (!afterState) return { verified: false, reason: "Could not capture browser state after action." };
    const expected = String(contract.expected || "").trim().toLowerCase();
    let verified = false;
    let evidence = "";

    switch (contract.type) {
      case "text_present":
        verified = Boolean(expected && afterState.text.toLowerCase().includes(expected));
        evidence = verified ? `Visible page text contains "${contract.expected}".` : `Expected text "${contract.expected}" was not visible.`;
        break;
      case "url_contains":
        verified = Boolean(expected && afterState.url.toLowerCase().includes(expected));
        evidence = verified ? `Current URL contains "${contract.expected}".` : `Current URL did not contain "${contract.expected}".`;
        break;
      case "value_equals":
        verified = afterState.controls.some((control) =>
          control.value.trim().toLowerCase() === expected,
        );
        evidence = verified ? "A visible control contains the expected value." : "No visible control contains the expected value.";
        break;
      case "query_present":
        verified = Boolean(expected && (
          afterState.text.toLowerCase().includes(expected) ||
          afterState.url.toLowerCase().includes(encodeURIComponent(contract.expected).toLowerCase())
        ));
        evidence = verified ? "The requested query is visible in page content or the resulting URL." : "The requested query was not found in resulting page content or URL.";
        break;
      case "selection_matches":
        verified = afterState.controls.some((control) =>
          control.selected && control.label.toLowerCase().includes(expected),
        );
        evidence = verified ? "A matching visible control is selected." : "No matching visible selected control was found.";
        break;
      case "cart_changed": {
        const beforeText = beforeState?.text?.toLowerCase() || "";
        const afterText = afterState.text.toLowerCase();
        const beforeCount = beforeState?.controls?.find((control) =>
          /\b(cart|basket)\b/i.test(control.label),
        )?.label || "";
        const afterCount = afterState.controls.find((control) =>
          /\b(cart|basket)\b/i.test(control.label),
        )?.label || "";
        verified = afterText !== beforeText &&
          (afterCount !== beforeCount || /\b(added|in cart|in your basket|item added)\b/i.test(afterText));
        evidence = verified ? "Observable cart/collection state changed after the action." : "No verifiable cart/collection change was observed.";
        break;
      }
      case "state_changed":
        verified = Boolean(beforeState) && (
          beforeState.url !== afterState.url ||
          beforeState.title !== afterState.title ||
          beforeState.text !== afterState.text ||
          JSON.stringify(beforeState.controls) !== JSON.stringify(afterState.controls)
        );
        evidence = verified ? "Observable page state changed after the action." : "No observable page state change was detected.";
        break;
      default:
        return { verified: false, reason: `Unsupported verification type "${contract.type}".` };
    }
    return { verified, evidence };
  }

  async executeStep(index) {
    if (this.state.isPaused) {
      this.log("Execution paused at step", index);
      this.state.status = "paused";
      this.broadcast("execution_paused", { stepIndex: index });
      return;
    }

    if (index >= this.state.steps.length) {
      if (this.state.steps.some((step) => step.workflowState !== "STEP_COMPLETED")) {
        this.state.status = "error";
        this.state.lastError = "Workflow cannot complete while one or more steps are unverified.";
        this.error(this.state.lastError);
        this.broadcast("execution_error", { error: this.state.lastError });
        return;
      }
      this.state.status = "completed";
      this.state.completedAt = Date.now();
      this.addReasoning("All planned execution steps completed successfully! 🎉", "decision");
      this.broadcast("goal_completed", {
        summary: `Goal completed: "${this.state.goal}"`,
        steps: this.state.steps,
      });
      return;
    }

    const step = this.state.steps[index];
    if (index > 0 && this.state.steps[index - 1].workflowState !== "STEP_COMPLETED") {
      this.warn(
        `Blocked advancement to Step ${index + 1}; Step ${index} has not reached STEP_COMPLETED.`,
      );
      this.state.activeStepIndex = index - 1;
      return;
    }
    if (step.workflowActions?.length) {
      this.state.activeStepIndex = index;
      step.status = "running";
      step.startedAt = step.startedAt || Date.now();
      if (!step.workflowActionIndex) {
        step.workflowState = "CURRENT_STEP";
      }
      this.log(`Executing verified action sequence for step ${index + 1}: ${step.title}`);
      this.addReasoning(`[Step ${index + 1}/${this.state.steps.length}] ${step.title}`, "action");
      this.broadcast("step_started", { stepIndex: index, step });
      if (
        (step.tool === "clarify_variant" || step.tool === "clarify_parameter" || step.tool === "ask_question") &&
        !step.userAnswer
      ) {
        this.state.status = "waiting_for_user";
        step.status = "waiting_for_user";
        const questionId = "q_" + Date.now();
        this.state.pendingQuestion = {
          id: questionId,
          stepIndex: index,
          title: step.title,
          message: step.args.question || "Please select your preferred option:",
          options: step.args.options || [],
          parameter: step.args.parameter || "choice",
          product: step.args.product || "Task",
        };
        this.transitionWorkflowState(step, "ACTION_REQUIRED", {
          failureReason: "Waiting for required user input.",
        });
        this.broadcast("question_required", { question: this.state.pendingQuestion });
        return;
      }
      return this.executeWorkflowActions(index, step);
    }
    this.state.activeStepIndex = index;
    step.status = "running";
    step.startedAt = Date.now();
    step.retryCount = step.retryCount || 0;
    step.workflowState = "CURRENT_STEP";

    this.log(`Executing step ${index + 1}/${this.state.steps.length}: ${step.title}`);
    this.addReasoning(`[Step ${index + 1}/${this.state.steps.length}] ${step.title}: ${step.reasoning}`, "action");
    this.broadcast("step_started", { stepIndex: index, step });

    // --------------------------------------------------------
    // INTERACTIVE CLARIFICATION (HUMAN-IN-THE-LOOP)
    // --------------------------------------------------------
    if (
      (step.tool === "clarify_variant" || step.tool === "clarify_parameter" || step.tool === "ask_question") &&
      !step.userAnswer
    ) {
      this.state.status = "waiting_for_user";
      step.status = "waiting_for_user";

      const questionId = "q_" + Date.now();
      this.state.pendingQuestion = {
        id: questionId,
        stepIndex: index,
        title: step.title,
        message: step.args.question || "Please select your preferred option:",
        options: step.args.options || [],
        parameter: step.args.parameter || "choice",
        product: step.args.product || "Task",
      };

      this.addReasoning(
        `❓ Pausing execution: Waiting for user to clarify: "${this.state.pendingQuestion.message}"`,
        "clarification"
      );

      this.broadcast("question_required", {
        question: this.state.pendingQuestion,
      });
      this.transitionWorkflowState(step, "ACTION_REQUIRED", {
        failureReason: "Waiting for required user input.",
      });

      return;
    }

    // --------------------------------------------------------
    // REAL PLAYWRIGHT CDP AUTOMATION ACTION
    // --------------------------------------------------------
    try {
      const stepStart = performance.now();
      let lastFailure = "";
      const maxRetries = Math.max(0, Number(this.options.maxActionRetries) || 0);

      while (step.retryCount <= maxRetries) {
        const page = await this.getBrowserPage();
        const beforeState = await this.captureObservableState(page).catch((error) => {
          this.warn(`Could not capture pre-action state for Step ${index + 1}:`, error.message);
          return null;
        });
        this.transitionWorkflowState(step, "ACTION_REQUIRED", {
          failureReason: lastFailure || undefined,
        });
        this.transitionWorkflowState(step, "ACTION_IN_PROGRESS");

        let result;
        try {
          result = await this.performToolAction(step, {
            attempt: step.retryCount,
            strategy: step.retryCount > 0 ? "alternative" : "primary",
            retryInstruction: step.retryInstruction || "",
          });
        } catch (error) {
          result = { success: false, error: error.message };
        }
        if (this.options.mockBrowser && result?.success === true) {
          result = { ...result, simulated: true };
        }

        if (result?.requiresCredentials) {
          return this.triggerCredentialRequest(index, step, result.site || step.args.site, result.reason);
        }
        if (result?.requiresUserCheck) {
          this.transitionWorkflowState(step, "ACTION_FAILED", {
            actionResult: result,
            failureReason: result.reason || "Action requires user verification.",
          });
          return this.triggerPlannerCheck(index, step, result.reason, result.checkType);
        }

        const verification = await this.verifyStepOutcome(step, result, beforeState, page).catch((error) => ({
          verified: false,
          reason: `Verification failed: ${error.message}`,
        }));
        step.lastAttemptResult = result;
        step.lastBeforeState = beforeState;
        step.lastVerification = verification;
        step.actionResult = result;
        step.verificationResult = verification;

        if (verification.verified) {
          this.transitionWorkflowState(step, "ACTION_SUCCEEDED", {
            actionResult: result,
            verificationResult: verification,
          });
          break;
        }

        lastFailure = verification.reason || "Expected UI state was not verified.";
        this.transitionWorkflowState(step, "ACTION_FAILED", {
          actionResult: result,
          verificationResult: verification,
          failureReason: lastFailure,
        });
        if (step.retryCount >= maxRetries) break;

        step.retryCount++;
        step.status = "retrying";
        this.transitionWorkflowState(step, "RETRY_REQUIRED", {
          actionResult: result,
          verificationResult: verification,
          failureReason: lastFailure,
        });
      }

      if (step.workflowState !== "ACTION_SUCCEEDED") {
        step.status = "failed";
        return this.triggerPlannerCheck(index, step, lastFailure || "Action did not reach its verified postcondition.", "step_failure");
      }

      const stepDuration = Math.round(performance.now() - stepStart);
      step.status = "completed";
      step.completedAt = Date.now();
      step.duration = stepDuration;
      step.result = { ...step.lastAttemptResult, verified: true, verification: step.lastVerification };
      this.state.completedSteps = index + 1;
      this.transitionWorkflowState(step, "STEP_COMPLETED", {
        actionResult: step.lastAttemptResult,
        verificationResult: step.lastVerification,
      });
      this.broadcast("step_completed", { stepIndex: index, step, result: step.result });
      await new Promise((r) => setTimeout(r, this.options.stepDelayMs));
      await this.executeStep(index + 1);
    } catch (err) {
      this.warn(`Step ${index + 1} execution error:`, err.message);
      step.status = "failed";
      this.transitionWorkflowState(step, "ACTION_FAILED", { failureReason: err.message });
      return this.triggerPlannerCheck(index, step, err.message, "step_failure");
    }
  }

  async getBrowserPage() {
    if (this.options.mockBrowser) return null;
    const controller = this.browserController || this.options.browserController || browserController;
    try {
      const pagePromise = controller.getPage();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("CDP connection timed out (Browser not open)")), 800)
      );
      return await Promise.race([pagePromise, timeoutPromise]);
    } catch (err) {
      this.warn("Browser page unavailable, running in simulated execution mode:", err.message);
      return null;
    }
  }

  // ==========================================================
  // UNIVERSAL TOOL ACTION EXECUTOR
  // ==========================================================

  async resolveSemanticPurchaseAction(page) {
    const purchasePatterns = [
      /\b(?:buy\s+now|buy|purchase|pay|pay\s+now|checkout|place\s+order|complete\s+purchase|proceed|continue|add\s+to\s+(?:cart|bag)|add\s+(?:to\s+)?(?:cart|bag)|add\s+item|shop\s+now)\b/i,
    ];

    const textCandidates = [
      page.getByRole("button"),
      page.getByRole("link"),
      page.locator("button, a, input[type='submit'], input[type='button']"),
    ];

    for (const list of textCandidates) {
      try {
        const count = await list.count();
        for (let i = 0; i < count; i++) {
          const candidate = list.nth(i);
          try {
            const text = await candidate.textContent().catch(() => "");
            const aria = await candidate.getAttribute("aria-label").catch(() => "");
            const value = await candidate.getAttribute("value").catch(() => "");
            const combined = `${text || ""} ${aria || ""} ${value || ""}`;
            if (purchasePatterns.some((pattern) => pattern.test(combined))) {
              if (await candidate.isVisible().catch(() => false)) {
                await candidate.click({ timeout: 3000 }).catch(() => {});
                return true;
              }
            }
          } catch {}
        }
      } catch {}
    }

    return false;
  }

  async clickGenericTarget(page, target, attempt = 0) {
    const label = String(target || "").trim();
    if (!label) return false;

    const semanticPurchase = /(?:purchase|checkout|buy|add\s+to\s+(?:cart|bag)|add\s+(?:item|to\s+cart)|proceed|continue|place\s+order)/i.test(label);
    if (semanticPurchase && (await this.resolveSemanticPurchaseAction(page))) {
      return true;
    }

    const clickByText = async (exact) => {
      try {
        const locator = page.getByText(label, { exact }).first();
        if (await locator.isVisible()) {
          await locator.click({ timeout: 3000 });
          return true;
        }
      } catch {}
      return false;
    };
    if (attempt > 0 && await clickByText(false)) return true;

    const roleOrder = attempt > 0
      ? ["radio", "option", "button", "link", "checkbox", "tab"]
      : ["button", "link", "radio", "option", "checkbox", "tab"];
    for (const role of roleOrder) {
      try {
        const locator = page.getByRole(role, { name: label, exact: attempt === 0 }).first();
        if (await locator.isVisible()) {
          await locator.click({ timeout: 3000 });
          return true;
        }
      } catch {}
    }

    return await clickByText(false);
  }

  async performToolAction(step, context = {}) {
    if (this.options.mockBrowser) {
      return {
        success: true,
        simulated: true,
        action: step.tool,
        args: step.args,
      };
    }
    let page = await this.getBrowserPage();

    switch (step.tool) {
      case "navigate": {
        const url = step.args.url;
        if (!url) return { success: false, error: "Navigation step has no destination." };
        this.addReasoning(`Navigating to ${url}...`, "action");

        if (!page) return { success: false, error: "Browser page is unavailable." };
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        return { success: true, attempted: true, action: "navigate", url };
      }

      case "search": {
        const query = step.args.query || step.args.origin;
        if (!query) return { success: false, error: "Search step has no query." };
        this.addReasoning(`Searching for query "${query}" on page...`, "action");

        if (!page) return { success: false, error: "Browser page is unavailable." };
        let searchBox = null;
        for (const role of ["searchbox", "textbox"]) {
          try {
            const candidate = page.getByRole(role).first();
            if (await candidate.isVisible()) {
              searchBox = candidate;
              break;
            }
          } catch {}
        }
        if (!searchBox) return { success: false, error: "No visible search field was found." };
        await searchBox.fill(query);
        await searchBox.press("Enter");
        return { success: true, attempted: true, action: "search", query };
      }

      case "fill_form": {
        const title = step.args.value || step.args.title || step.args.content;
        if (!title) return { success: false, error: "Form step has no value to enter." };
        this.addReasoning(`Filling form fields with: "${title}"...`, "action");

        if (!page) return { success: false, error: "Browser page is unavailable." };
        let textbox = null;
        try {
          const candidate = page.getByRole("textbox").first();
          if (await candidate.isVisible()) textbox = candidate;
        } catch {}
        if (!textbox) return { success: false, error: "No visible text field was found." };
        await textbox.fill(title);
        return { success: true, attempted: true, action: "fill_form", content: title };
      }

      case "click_element": {
        const target = step.args.target;
        if (!target) return { success: false, error: "Click step has no target." };
        this.addReasoning(`Interacting with: "${target}"...`, "action");

        if (!page) return { success: false, error: "Browser page is unavailable." };
        const clicked = await this.clickGenericTarget(page, target, context.attempt);
        return clicked
          ? { success: true, attempted: true, action: "click_element", target }
          : { success: false, error: `No visible control matching "${target}" was found.` };
      }

      case "select_product":
      case "select_option": {
        const variant = step.args.variant || step.args.preference;
        this.addReasoning(`Selecting option matching: "${variant}"...`, "thought");
        if (!variant) return { success: false, error: "Selection step has no requested option." };
        if (!page) return { success: false, error: "Browser page is unavailable." };
        const selected = await this.clickGenericTarget(page, variant, context.attempt);
        return selected
          ? { success: true, attempted: true, action: "select_option", variant }
          : { success: false, error: `No visible option matching "${variant}" was found.` };
      }

      case "click_buy": {
        const target = step.args.target || step.args.action || step.args.intent || "purchase";
        this.addReasoning(`Locating the current page's purchase or collection action...`, "action");
        if (!page) return { success: false, error: "Browser page is unavailable." };
        const clicked = await this.clickGenericTarget(page, target, context.attempt);
        return clicked
          ? { success: true, attempted: true, action: "click_buy", target }
          : { success: false, error: `No visible purchase or collection control was found for the current page.` };
      }

      case "save_action": {
        const target = step.args.target || step.args.action;
        if (!target) return { success: false, error: "Save step has no target control." };
        this.addReasoning(`Saving changes using "${target}"...`, "action");
        if (!page) return { success: false, error: "Browser page is unavailable." };
        const clicked = await this.clickGenericTarget(page, target, context.attempt);
        return clicked
          ? { success: true, attempted: true, action: "save_action", target }
          : { success: false, error: `No visible control matching "${target}" was found.` };
      }

      case "login_handler": {
        const site = step.args.site || step.args.domain || "generic";
        const purpose = step.args.purpose || "Authentication";
        this.addReasoning(`Checking credentials & executing login handler for "${site}" (${purpose})...`, "action");

        if (this.options.mockBrowser) {
          this.addReasoning(`[Simulated] Verified session credentials for "${site}".`, "observation");
          return { success: true, site, status: "authenticated", simulated: true };
        }

        const creds = await this.credentialManager.get(site);
        if (!creds || !creds.username) {
          this.addReasoning(`No saved credentials in Local Vault or Firebase for "${site}". Pausing to request credentials.`, "decision");
          return {
            requiresCredentials: true,
            site,
            reason: `Authentication needed for ${site}. Please provide your username & password (stored in Local / Firebase).`,
          };
        }

        this.addReasoning(`Found credentials for "${creds.username}" from ${creds.source || "store"}. Executing automated login...`, "action");
        const loginResult = await this.loginHandler.login(page, site, creds);

        if (loginResult && loginResult.requiresUserCheck) {
          return {
            requiresUserCheck: true,
            reason: loginResult.reason || `Authentication check or OTP verification needed on ${site}.`,
            checkType: loginResult.checkType || "login_verification",
          };
        }

        if (loginResult && loginResult.requiresCredentials) {
          return {
            requiresCredentials: true,
            site,
            reason: loginResult.reason,
          };
        }

        this.addReasoning(`✔ Authentication step finished for ${site}!`, "observation");
        return { success: true, site, loginResult };
      }

      case "user_confirmation": {
        const prompt = step.args.prompt || step.description || "Please review and verify before proceeding.";
        this.addReasoning(`User confirmation checkpoint: "${prompt}"`, "thought");

        if (this.options.mockBrowser) {
          this.addReasoning("[Simulated] User confirmation checkpoint approved.", "observation");
          return { success: true, verified: true, simulated: true };
        }

        return {
          requiresUserCheck: true,
          reason: prompt,
          checkType: "user_confirmation",
        };
      }

      case "finish": {
        const msg = step.args.message || "Goal successfully completed!";
        this.addReasoning(`🏁 ${msg}`, "decision");
        return { success: true, verified: true, evidence: "All preceding workflow steps reached STEP_COMPLETED.", message: msg };
      }

      default: {
        this.addReasoning(`Executing tool "${step.tool}"...`, "action");
        return { success: true, tool: step.tool, args: step.args };
      }
    }
  }

  // ==========================================================
  // HUMAN-IN-THE-LOOP: PLANNER CHECK & FALLBACK ESCALATION
  // ==========================================================

  triggerPlannerCheck(index, step, reason, checkType = "step_check") {
    this.state.status = "waiting_for_user_check";
    if (step.workflowState !== "ACTION_FAILED") {
      step.status = "waiting_for_user_check";
    }

    const checkId = "check_" + Date.now();
    this.state.pendingPlannerCheck = {
      id: checkId,
      stepIndex: index,
      stepTitle: step.title,
      stepTool: step.tool,
      reason: reason || "Action did not produce expected outcome or needs manual verification.",
      checkType,
      message: `Planner check required at Step ${index + 1} (${step.title}): ${reason}`,
      options: [
        "✔ I resolved it in the browser — Continue",
        "🔄 Retry this step",
        "✔ Verify the current state",
        "⏹ Stop execution",
      ],
      timestamp: Date.now(),
    };

    this.addReasoning(
      `⚠️ Planner issue / check needed on Step ${index + 1}: "${reason}". Pausing and waiting for user response.`,
      "clarification"
    );

    this.broadcast("planner_check_required", {
      plannerCheck: this.state.pendingPlannerCheck,
    });

    return this.state.pendingPlannerCheck;
  }

  async resolvePlannerCheck(checkId, action = "resolved", customInstruction = "") {
    if (!this.state.pendingPlannerCheck) {
      this.warn("No active planner check to resolve, ignoring.");
      return this.getState();
    }

    const check = this.state.pendingPlannerCheck;
    const stepIndex = check.stepIndex;
    const step = this.state.steps[stepIndex];
    const normalizedAction = String(action || "").toLowerCase();

    this.log(`Resolving planner check (${checkId}) with action: "${action}"`);
    this.state.pendingPlannerCheck = null;

    // Acknowledging an issue never completes it; verify the resulting UI state first.
    if (
      normalizedAction.includes("resolved") ||
      normalizedAction.includes("solved") ||
      normalizedAction.includes("continue") ||
      normalizedAction.includes("approve") ||
      normalizedAction.includes("approved") ||
      normalizedAction.includes("yes") ||
      normalizedAction.includes("do it") ||
      normalizedAction.includes("ok") ||
      normalizedAction.includes("proceed") ||
      normalizedAction.includes("confirm") ||
      normalizedAction.includes("authorized") ||
      normalizedAction.includes("complete it") ||
      normalizedAction.includes("handle this") ||
      normalizedAction.includes("submit")
    ) {
      let verification = { verified: false, reason: "No action result is available to verify." };
      if (check.checkType === "user_confirmation") {
        verification = { verified: true, evidence: "User confirmed the requested review checkpoint." };
      } else if (step?.lastAttemptResult) {
        const page = await this.getBrowserPage();
        verification = await this.verifyStepOutcome(
          step.pendingActionSpec || step,
          { ...step.lastAttemptResult, success: true, verified: false },
          step.lastBeforeState,
          page,
        ).catch((error) => ({
          verified: false,
          reason: `Verification failed: ${error.message}`,
        }));
      } else if (normalizedAction.includes("resolved") || normalizedAction.includes("solved")) {
        verification = { verified: true, evidence: "User resolved issue in browser." };
      }
      step.lastVerification = verification;
      if (!verification.verified) {
        step.status = "failed";
        this.state.pendingPlannerCheck = check;
        this.state.status = "waiting_for_user_check";
        this.transitionWorkflowState(step, "ACTION_FAILED", {
          intendedAction: step.pendingActionSpec?.tool || step.tool,
          actionResult: step.lastAttemptResult,
          verificationResult: verification,
          failureReason: verification.reason,
        });
        this.addReasoning(
          `Cannot advance from Step ${stepIndex + 1}; verification failed: ${verification.reason}`,
          "observation",
        );
        this.broadcast("planner_check_required", { plannerCheck: check });
        return this.getState();
      }

      if (step.workflowActions?.length) {
        const actionIndex = step.workflowActionIndex || 0;
        const pendingAction = step.workflowActions[actionIndex];
        if (pendingAction) {
          pendingAction.workflowState = "STEP_COMPLETED";
          pendingAction.lastVerification = verification;
          step.workflowActionIndex = actionIndex + 1;
          pendingAction.retryCount = 0;
        }
        step.status = "running";
        step.lastVerification = verification;
        this.state.status = "executing";
        this.transitionWorkflowState(step, "ACTION_SUCCEEDED", {
          intendedAction: step.pendingActionSpec?.tool,
          actionResult: step.lastAttemptResult,
          verificationResult: verification,
        });
        this.broadcast("planner_check_resolved", { checkId, action: "resolved" });
        await this.executeStep(stepIndex);
        return this.getState();
      }

      step.status = "completed";
      step.workflowState = "ACTION_SUCCEEDED";
      step.completedAt = Date.now();
      step.result = {
        ...(step.lastAttemptResult || {}),
        verified: true,
        verification,
        resolvedByUser: true,
      };
      this.state.completedSteps = stepIndex + 1;
      this.state.status = "executing";
      this.transitionWorkflowState(step, "STEP_COMPLETED", {
        actionResult: step.lastAttemptResult,
        verificationResult: verification,
      });
      this.addReasoning(
        `✔ Step ${stepIndex + 1} postcondition verified. Resuming execution to Step ${stepIndex + 2}...`,
        "decision"
      );
      this.broadcast("planner_check_resolved", { checkId, action: "resolved" });

      await this.executeStep(stepIndex + 1);
      return this.getState();
    }

    // 2. Retry this step
    if (normalizedAction.includes("retry")) {
      step.status = "pending";
      step.retryCount = 0;
      if (step.workflowActions?.length) {
        const action = step.workflowActions[step.workflowActionIndex || 0];
        if (action) action.retryCount = 0;
      }
      step.retryInstruction = customInstruction || "";
      this.state.status = "executing";

      this.transitionWorkflowState(step, "RETRY_REQUIRED", {
        failureReason: "User requested a retry of the same step.",
      });
      this.addReasoning(`🔄 Retrying Step ${stepIndex + 1}: "${step.title}" per user request...`, "decision");
      this.broadcast("planner_check_resolved", { checkId, action: "retry" });

      await this.executeStep(stepIndex);
      return this.getState();
    }

    // 3. Skip this step
    if (normalizedAction.includes("skip")) {
      this.addReasoning(`⛔ Step ${stepIndex + 1} cannot be skipped because its postcondition is unverified.`, "observation");
      this.state.pendingPlannerCheck = check;
      this.state.status = "waiting_for_user_check";
      return this.getState();
    }

    // 4. Stop
    if (normalizedAction.includes("stop") || normalizedAction.includes("cancel")) {
      return this.stop();
    }

    // 5. Custom instruction provided
    if (customInstruction || action) {
      const instruction = customInstruction || action;
      step.retryInstruction = instruction;
      step.retryCount = 0;
      if (step.workflowActions?.length) {
        const pendingAction = step.workflowActions[step.workflowActionIndex || 0];
        if (pendingAction) pendingAction.retryCount = 0;
      }
      step.status = "pending";
      this.state.status = "executing";

      this.transitionWorkflowState(step, "RETRY_REQUIRED", {
        failureReason: "User provided an alternative instruction; the step remains incomplete.",
      });
      this.addReasoning(`💬 User instruction received: "${instruction}". Retrying the current step...`, "decision");
      this.broadcast("planner_check_resolved", { checkId, action: "instruction", instruction });

      await this.executeStep(stepIndex);
      return this.getState();
    }

    return this.getState();
  }

  // ==========================================================
  // HUMAN-IN-THE-LOOP: CREDENTIAL REQUEST & SAVING
  // ==========================================================

  triggerCredentialRequest(index, step, site, message) {
    this.state.status = "waiting_for_user";
    step.status = "waiting_for_user";

    const reqId = "cred_" + Date.now();
    this.state.pendingCredentialRequest = {
      id: reqId,
      stepIndex: index,
      site: site || "Target Site",
      domain: (site || "").toLowerCase(),
      message: message || `Please provide username and password for ${site}:`,
      isZingHR: (site || "").toLowerCase().includes("zinghr"),
      timestamp: Date.now(),
    };

    this.addReasoning(
      `🔑 Missing credentials for "${site}". Pausing to request user credentials (Local / Firebase storage).`,
      "clarification"
    );

    this.broadcast("credential_required", {
      credentialRequest: this.state.pendingCredentialRequest,
    });

    return this.state.pendingCredentialRequest;
  }

  async provideCredentials(requestId, username, password, options = {}) {
    if (!this.state.pendingCredentialRequest) {
      throw new Error("No active credential request waiting for input.");
    }

    const req = this.state.pendingCredentialRequest;
    const site = req.site || options.site;
    const stepIndex = req.stepIndex;

    this.log(`Saving provided credentials for "${site}" (storage: ${options.storage || "both"})...`);
    await this.credentialManager.save(site, username, password, {
      storage: options.storage || "both",
      extraFields: options.extraFields || {},
    });

    this.addReasoning(
      `🔑 Credentials for "${site}" saved to ${options.storage || "Local & Firebase"}. Resuming login step...`,
      "decision"
    );

    this.state.pendingCredentialRequest = null;
    this.state.status = "executing";

    this.broadcast("credential_provided", {
      requestId,
      site,
      storage: options.storage || "both",
    });

    // Re-execute the login step with the newly saved credentials
    await this.executeStep(stepIndex);
    return this.getState();
  }

  // ==========================================================
  // ANSWER USER CLARIFICATION QUESTION
  // ==========================================================

  async answerQuestion(questionId, answer) {
    // If answering a planner check
    if (this.state.pendingPlannerCheck) {
      return await this.resolvePlannerCheck(questionId, answer);
    }

    if (!this.state.pendingQuestion) {
      throw new Error("No active clarification question waiting for an answer.");
    }

    if (questionId && this.state.pendingQuestion.id !== questionId) {
      this.warn("Question ID mismatch, accepting anyway:", questionId);
    }

    const cleanAnswer = String(answer || "").trim();
    if (!cleanAnswer) {
      throw new Error("Answer cannot be empty.");
    }

    const currentStepIndex = this.state.pendingQuestion.stepIndex;
    const currentStep = this.state.steps[currentStepIndex];

    this.log(`User answered question: "${cleanAnswer}"`);
    this.addReasoning(
      `💬 User choice received: "${cleanAnswer}". Incorporating choice into subsequent execution steps.`,
      "decision"
    );

    if (currentStep.workflowActions?.length) {
      currentStep.userAnswer = cleanAnswer;
      currentStep.args.variant = cleanAnswer;
      for (const action of currentStep.workflowActions) {
        action.args = Object.fromEntries(
          Object.entries(action.args || {}).map(([key, value]) => [
            key,
            typeof value === "string" ? value.replace(/\{user_choice\}/g, cleanAnswer) : value,
          ]),
        );
        if (action.verification?.expected === "{user_choice}") {
          action.verification.expected = cleanAnswer;
        }
      }
      this.state.pendingQuestion = null;
      this.state.status = "executing";
      this.broadcast("question_answered", {
        questionId,
        answer: cleanAnswer,
        stepIndex: currentStepIndex,
      });
      await this.executeStep(currentStepIndex);
      return this.getState();
    }

    // Complete clarification step
    currentStep.status = "completed";
    currentStep.completedAt = Date.now();
    currentStep.result = { userChoice: cleanAnswer };
    this.state.completedSteps = currentStepIndex + 1;
    this.transitionWorkflowState(currentStep, "STEP_COMPLETED", {
      actionResult: { userChoice: cleanAnswer },
      verificationResult: { verified: true, evidence: "Required user information was received." },
    });

    // Propagate answer forward to downstream steps
    for (let i = currentStepIndex + 1; i < this.state.steps.length; i++) {
      const s = this.state.steps[i];
      if (s.tool === "select_product" || s.tool === "select_option") {
        s.args.variant = cleanAnswer;
        s.description = `Apply preference: ${cleanAnswer}`;
        if (s.verification?.type === "selection_matches") {
          s.verification.expected = cleanAnswer;
        }
      }
    }

    this.state.pendingQuestion = null;
    this.state.status = "executing";

    this.broadcast("question_answered", {
      questionId,
      answer: cleanAnswer,
      stepIndex: currentStepIndex,
    });

    // Resume execution with next step
    await this.executeStep(currentStepIndex + 1);
    return this.getState();
  }

  // ==========================================================
  // EXECUTION CONTROLS: PAUSE, RESUME, STOP, MANUAL STEP
  // ==========================================================

  pause() {
    this.state.isPaused = true;
    this.state.status = "paused";
    this.addReasoning("Execution paused by user.", "decision");
    this.broadcast("execution_paused", { activeStepIndex: this.state.activeStepIndex });
    return this.getState();
  }

  resume() {
    if (!this.state.isPaused) return this.getState();
    this.state.isPaused = false;
    this.state.status = "executing";
    this.addReasoning("Execution resumed by user.", "decision");
    this.broadcast("execution_resumed", { activeStepIndex: this.state.activeStepIndex });
    this.executeStep(this.state.activeStepIndex);
    return this.getState();
  }

  stop() {
    this.state.status = "idle";
    this.state.isPaused = false;
    this.state.pendingQuestion = null;
    this.state.pendingPlannerCheck = null;
    this.state.pendingCredentialRequest = null;
    this.addReasoning("Execution stopped and cancelled by user.", "decision");
    this.broadcast("execution_stopped", {});
    return this.getState();
  }

  async manualStep() {
    if (this.state.status === "waiting_for_user") {
      throw new Error("Cannot advance step while waiting for clarification question.");
    }
    this.state.isPaused = true;
    const nextIdx = this.state.activeStepIndex + 1;
    await this.executeStep(nextIdx);
    return this.getState();
  }
}

export const agentEngine = new AgentEngine();
export default agentEngine;
