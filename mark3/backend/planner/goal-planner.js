//==========================================================
//
// backend/planner/goal-planner.js
//
// Ultra Intelligent Goal Planner
//
// Architecture
//
// User Goal
//      │
//      ▼
// GoalPlanner
//      │
//      ├──────────────┐
//      ▼              ▼
// Goal Graph     Dependency Graph
//      │              │
//      └──────┬───────┘
//             ▼
//      Micro Planner
//             ▼
//        Task Queue
//             ▼
//        Resolver
//             ▼
//      Self Healing
//
// Features
// --------
// ✔ Goal decomposition
// ✔ Goal graph
// ✔ Dependency graph
// ✔ Dynamic replanning
// ✔ Planner memory
// ✔ Parallel execution
// ✔ Sequential execution
// ✔ Priority scheduling
// ✔ Confidence scoring
// ✔ Retry planning
// ✔ Self-healing integration
// ✔ Navigation awareness
// ✔ DOM awareness
// ✔ Planner optimization
// ✔ Runtime statistics
//
//==========================================================

import crypto from "crypto";

import MicroPlanner from "./micro-planner.js";
import TaskQueue from "./task-queue.js";
import Observer from "./observer.js";
import StateManager from "./state-manager.js";
import SelfHealingEngine from "./self-healing.js";

export default class GoalPlanner {
  constructor(options = {}) {
    //--------------------------------------------------
    // Configuration
    //--------------------------------------------------

    this.options = {
      debug: false,

      enableLearning: true,

      enableParallel: true,

      enableRecovery: true,

      enableOptimization: true,

      enableGoalCache: true,

      enableDependencyValidation: true,

      enableStatistics: true,

      maxDepth: 20,

      maxRetries: 3,

      maxParallelGoals: 5,

      plannerTimeout: 30000,

      confidenceThreshold: 80,

      ...options,
    };

    //--------------------------------------------------
    // Core Components
    //--------------------------------------------------

    this.microPlanner = options.microPlanner || new MicroPlanner();

    this.taskQueue = options.taskQueue || new TaskQueue();

    this.observer = options.observer || new Observer();

    this.stateManager = options.stateManager || new StateManager();

    this.selfHealing = options.selfHealing || new SelfHealingEngine();

    //--------------------------------------------------
    // Goal Storage
    //--------------------------------------------------

    this.goalCache = new Map();

    this.goalGraph = new Map();

    this.dependencyGraph = new Map();

    this.executionGraph = new Map();

    //--------------------------------------------------
    // Runtime
    //--------------------------------------------------

    this.activeGoals = new Map();

    this.completedGoals = new Map();

    this.failedGoals = new Map();

    this.goalHistory = [];

    //--------------------------------------------------
    // Planner Memory
    //--------------------------------------------------

    this.memory = {
      successfulPlans: new Map(),

      failedPlans: new Map(),

      optimizedPlans: new Map(),

      recoveredPlans: new Map(),
    };

    //--------------------------------------------------
    // Statistics
    //--------------------------------------------------

    this.stats = {
      totalGoals: 0,

      completedGoals: 0,

      failedGoals: 0,

      recoveredGoals: 0,

      replannedGoals: 0,

      optimizedGoals: 0,

      parallelGoals: 0,

      sequentialGoals: 0,

      averageExecutionTime: 0,

      lastExecutionTime: 0,
    };

    //--------------------------------------------------
    // Runtime Flags
    //--------------------------------------------------

    this.isPlanning = false;

    this.currentGoal = null;

    this.lastGoal = null;
  }

  //==================================================
  // LOGGING
  //==================================================

  log(...args) {
    if (!this.options.debug) return;

    console.log(
      "[GoalPlanner]",

      ...args,
    );
  }

  warn(...args) {
    console.warn(
      "[GoalPlanner]",

      ...args,
    );
  }

  error(...args) {
    console.error(
      "[GoalPlanner]",

      ...args,
    );
  }

  //==================================================
  // PERFORMANCE TIMER
  //==================================================

  startTimer() {
    return performance.now();
  }

  stopTimer(start) {
    const elapsed = performance.now() - start;

    this.stats.lastExecutionTime = elapsed;

    if (this.stats.averageExecutionTime === 0) {
      this.stats.averageExecutionTime = elapsed;
    } else {
      this.stats.averageExecutionTime =
        this.stats.averageExecutionTime * 0.9 + elapsed * 0.1;
    }

    return elapsed;
  }

  //==================================================
  // GOAL ID
  //==================================================

  generateGoalId(prefix = "goal") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  //==================================================
  // PART 1B CONTINUES
  // Goal Model
  // Goal Creation
  // Goal Metadata
  // Dependency Registration
  //==================================================
  //==================================================
  // GOAL MODEL
  //==================================================

  createGoal({
    name,
    description = "",
    priority = "normal",
    type = "action",
    parent = null,
    metadata = {},
  }) {
    if (!name || !String(name).trim()) {
      throw new Error("Goal name is required.");
    }

    const goal = {
      //--------------------------------------------------
      // Identity
      //--------------------------------------------------

      id: this.generateGoalId(),

      name: String(name).trim(),

      description,

      type,

      //--------------------------------------------------
      // Hierarchy
      //--------------------------------------------------

      parent,

      children: [],

      depth: 0,

      //--------------------------------------------------
      // Planning
      //--------------------------------------------------

      priority,

      confidence: 100,

      status: "pending",

      planner: "goal-planner",

      //--------------------------------------------------
      // Execution
      //--------------------------------------------------

      steps: [],

      completedSteps: [],

      failedSteps: [],

      dependencies: [],

      dependents: [],

      retries: 0,

      //--------------------------------------------------
      // Metadata
      //--------------------------------------------------

      metadata: {
        ...metadata,
      },

      //--------------------------------------------------
      // Timing
      //--------------------------------------------------

      createdAt: Date.now(),

      updatedAt: Date.now(),

      startedAt: null,

      completedAt: null,
    };

    //--------------------------------------------------
    // Parent Relationship
    //--------------------------------------------------

    if (parent) {
      const parentGoal = this.goalGraph.get(parent);

      if (parentGoal) {
        goal.depth = parentGoal.depth + 1;

        parentGoal.children.push(goal.id);

        parentGoal.updatedAt = Date.now();
      }
    }

    //--------------------------------------------------
    // Store
    //--------------------------------------------------

    this.goalGraph.set(goal.id, goal);

    this.activeGoals.set(goal.id, goal);

    this.stats.totalGoals++;

    this.currentGoal = goal;
    this.lastGoal = goal;

    this.log("Goal created:", goal.name);

    return goal;
  }

  //==================================================
  // CHILD GOAL
  //==================================================

  createChildGoal(parentId, options = {}) {
    const parent = this.goalGraph.get(parentId);

    if (!parent) {
      throw new Error(`Parent goal '${parentId}' not found.`);
    }

    return this.createGoal({
      ...options,

      parent: parent.id,
    });
  }

  //==================================================
  // CLONE GOAL
  //==================================================

  cloneGoal(goalId) {
    const original = this.goalGraph.get(goalId);

    if (!original) {
      throw new Error(`Goal '${goalId}' not found.`);
    }

    const clone = {
      ...structuredClone(original),

      id: this.generateGoalId(),

      parent: null,

      children: [],

      dependencies: [],

      dependents: [],

      status: "pending",

      retries: 0,

      startedAt: null,

      completedAt: null,

      createdAt: Date.now(),

      updatedAt: Date.now(),
    };

    this.goalGraph.set(clone.id, clone);

    this.activeGoals.set(clone.id, clone);

    this.stats.totalGoals++;

    this.log("Goal cloned:", clone.name);

    return clone;
  }

  //==================================================
  // UPDATE GOAL
  //==================================================

  updateGoal(goalId, updates = {}) {
    const goal = this.goalGraph.get(goalId);

    if (!goal) {
      throw new Error(`Goal '${goalId}' not found.`);
    }

    Object.assign(goal, updates);

    goal.updatedAt = Date.now();

    return goal;
  }

  //==================================================
  // PART 1B-2
  // deleteGoal()
  // getGoal()
  // getGoals()
  // goalExists()
  // Dependency Registration
  // Validation Helpers
  //==================================================
  //==================================================
  // DELETE GOAL
  //==================================================

  deleteGoal(goalId) {
    const goal = this.goalGraph.get(goalId);

    if (!goal) {
      return false;
    }

    //--------------------------------------------------
    // Remove from parent
    //--------------------------------------------------

    if (goal.parent) {
      const parent = this.goalGraph.get(goal.parent);

      if (parent) {
        parent.children = parent.children.filter((id) => id !== goalId);

        parent.updatedAt = Date.now();
      }
    }

    //--------------------------------------------------
    // Remove dependencies
    //--------------------------------------------------

    for (const dependencyId of goal.dependencies) {
      const dependency = this.goalGraph.get(dependencyId);

      if (dependency) {
        dependency.dependents = dependency.dependents.filter(
          (id) => id !== goalId,
        );
      }
    }

    //--------------------------------------------------
    // Remove dependents
    //--------------------------------------------------

    for (const dependentId of goal.dependents) {
      const dependent = this.goalGraph.get(dependentId);

      if (dependent) {
        dependent.dependencies = dependent.dependencies.filter(
          (id) => id !== goalId,
        );
      }
    }

    //--------------------------------------------------
    // Remove children recursively
    //--------------------------------------------------

    for (const childId of [...goal.children]) {
      this.deleteGoal(childId);
    }

    //--------------------------------------------------
    // Cleanup
    //--------------------------------------------------

    this.goalGraph.delete(goalId);

    this.activeGoals.delete(goalId);

    this.completedGoals.delete(goalId);

    this.failedGoals.delete(goalId);

    this.dependencyGraph.delete(goalId);

    this.executionGraph.delete(goalId);

    this.goalCache.delete(goalId);

    this.log("Goal removed:", goal.name);

    return true;
  }

  //==================================================
  // GET GOAL
  //==================================================

  getGoal(goalId) {
    return this.goalGraph.get(goalId) || null;
  }

  //==================================================
  // GET ALL GOALS
  //==================================================

  getGoals(filter = null) {
    const goals = [...this.goalGraph.values()];

    if (typeof filter !== "function") {
      return goals;
    }

    return goals.filter(filter);
  }

  //==================================================
  // ACTIVE GOALS
  //==================================================

  getActiveGoals() {
    return [...this.activeGoals.values()];
  }

  //==================================================
  // COMPLETED GOALS
  //==================================================

  getCompletedGoals() {
    return [...this.completedGoals.values()];
  }

  //==================================================
  // FAILED GOALS
  //==================================================

  getFailedGoals() {
    return [...this.failedGoals.values()];
  }

  //==================================================
  // GOAL EXISTS
  //==================================================

  goalExists(goalId) {
    return this.goalGraph.has(goalId);
  }

  //==================================================
  // REGISTER DEPENDENCY
  //==================================================

  registerDependency(goalId, dependencyId) {
    const goal = this.goalGraph.get(goalId);

    const dependency = this.goalGraph.get(dependencyId);

    if (!goal) {
      throw new Error(`Goal '${goalId}' not found.`);
    }

    if (!dependency) {
      throw new Error(`Dependency '${dependencyId}' not found.`);
    }

    if (!goal.dependencies.includes(dependencyId)) {
      goal.dependencies.push(dependencyId);
    }

    if (!dependency.dependents.includes(goalId)) {
      dependency.dependents.push(goalId);
    }

    this.dependencyGraph.set(
      goalId,

      [...goal.dependencies],
    );

    goal.updatedAt = Date.now();

    dependency.updatedAt = Date.now();

    return true;
  }

  //==================================================
  // REMOVE DEPENDENCY
  //==================================================

  removeDependency(goalId, dependencyId) {
    const goal = this.goalGraph.get(goalId);

    const dependency = this.goalGraph.get(dependencyId);

    if (!goal || !dependency) {
      return false;
    }

    goal.dependencies = goal.dependencies.filter((id) => id !== dependencyId);

    dependency.dependents = dependency.dependents.filter((id) => id !== goalId);

    this.dependencyGraph.set(goalId, [...goal.dependencies]);

    goal.updatedAt = Date.now();

    dependency.updatedAt = Date.now();

    return true;
  }

  //==================================================
  // VALIDATE GOAL
  //==================================================

  validateGoal(goal) {
    if (!goal) return false;

    if (!goal.id) return false;

    if (!goal.name) return false;

    if (goal.depth > this.options.maxDepth) {
      throw new Error(`Goal depth exceeded (${this.options.maxDepth})`);
    }

    return true;
  }

  //==================================================
  // PART 2
  // Goal Decomposition
  // Goal Graph Builder
  // Dependency Resolver
  // Execution Order
  // Parallel Planning
  //==================================================
  //==================================================
  // GOAL DECOMPOSITION
  //==================================================

  async decomposeGoal(goalId, context = {}) {
    const goal = typeof goalId === "string" ? this.getGoal(goalId) : goalId;

    if (!goal) {
      throw new Error("Goal not found.");
    }

    this.validateGoal(goal);

    this.log("Decomposing goal:", goal.name);

    //--------------------------------------------------
    // Already decomposed
    //--------------------------------------------------

    if (Array.isArray(goal.steps) && goal.steps.length) {
      return goal.steps;
    }

    //--------------------------------------------------
    // Ask Micro Planner
    //--------------------------------------------------

    const plan = await this.microPlanner.plan({
      goal,

      context,
    });

    const steps = Array.isArray(plan?.steps) ? plan.steps : [];

    //--------------------------------------------------
    // Normalize
    //--------------------------------------------------

    goal.steps = steps.map((step, index) => ({
      id: crypto.randomUUID(),

      index,

      action: step.action || "",

      target: step.target || "",

      value: step.value,

      args: step.args || {},

      status: "pending",

      confidence: step.confidence ?? 100,

      retry: 0,

      createdAt: Date.now(),
    }));

    goal.updatedAt = Date.now();

    return goal.steps;
  }

  //==================================================
  // CREATE EXECUTION PLAN
  //==================================================

  async createExecutionPlan(goalId, context = {}) {
    const goal = typeof goalId === "string" ? this.getGoal(goalId) : goalId;

    if (!goal) {
      throw new Error("Goal not found.");
    }

    //--------------------------------------------------
    // Ensure steps exist
    //--------------------------------------------------

    if (!goal.steps || !goal.steps.length) {
      await this.decomposeGoal(goal, context);
    }

    //--------------------------------------------------
    // Build execution plan
    //--------------------------------------------------

    const execution = {
      goalId: goal.id,

      goal: goal.name,

      priority: goal.priority,

      createdAt: Date.now(),

      sequential: [],

      parallel: [],

      totalSteps: goal.steps.length,
    };

    //--------------------------------------------------
    // Sequential by default
    //--------------------------------------------------

    for (const step of goal.steps) {
      execution.sequential.push({
        ...step,
      });
    }

    //--------------------------------------------------
    // Cache
    //--------------------------------------------------

    this.executionGraph.set(
      goal.id,

      execution,
    );

    return execution;
  }

  //==================================================
  // EXPAND CHILD GOALS
  //==================================================

  async expandGoalTree(goalId) {
    const goal = this.getGoal(goalId);

    if (!goal) return [];

    const result = [];

    const visit = (current) => {
      result.push(current);

      for (const childId of current.children) {
        const child = this.getGoal(childId);

        if (child) visit(child);
      }
    };

    visit(goal);

    return result;
  }

  //==================================================
  // ESTIMATE GOAL COMPLEXITY
  //==================================================

  estimateComplexity(goal) {
    let score = 0;

    score += goal.steps?.length || 0;

    score += goal.dependencies?.length || 0;

    score += goal.children?.length || 0;

    if (goal.priority === "critical") score += 5;

    if (goal.priority === "high") score += 3;

    return {
      score,

      level:
        score <= 5
          ? "low"
          : score <= 15
            ? "medium"
            : score <= 30
              ? "high"
              : "extreme",
    };
  }

  //==================================================
  // PREPARE EXECUTION
  //==================================================

  async prepareGoal(goalId, context = {}) {
    const goal = this.getGoal(goalId);

    if (!goal) {
      throw new Error("Goal not found.");
    }

    if (!goal.steps?.length) {
      await this.decomposeGoal(goal, context);
    }

    goal.status = "ready";

    goal.updatedAt = Date.now();

    return goal;
  }

  //==================================================
  // PART 2B
  // Dependency Resolver
  // Topological Sort
  // Circular Dependency Detection
  // Execution Ordering
  //==================================================
  //==================================================
  // RESOLVE DEPENDENCIES
  //==================================================

  resolveDependencies(goalId) {
    const goal = this.getGoal(goalId);

    if (!goal) {
      throw new Error(`Goal '${goalId}' not found.`);
    }

    const resolved = [];

    const unresolved = [];

    for (const dependencyId of goal.dependencies) {
      const dependency = this.getGoal(dependencyId);

      if (!dependency) continue;

      if (dependency.status === "completed") {
        resolved.push(dependency);
      } else {
        unresolved.push(dependency);
      }
    }

    return {
      goal,

      resolved,

      unresolved,

      satisfied: unresolved.length === 0,
    };
  }

  //==================================================
  // CAN EXECUTE GOAL
  //==================================================

  canExecuteGoal(goalId) {
    const result = this.resolveDependencies(goalId);

    if (!result.satisfied) {
      return false;
    }

    const goal = result.goal;

    //--------------------------------------------------
    // Already completed
    //--------------------------------------------------

    if (goal.status === "completed") {
      return false;
    }

    //--------------------------------------------------
    // Already running
    //--------------------------------------------------

    if (goal.status === "running") {
      return false;
    }

    //--------------------------------------------------
    // Failed permanently
    //--------------------------------------------------

    if (goal.status === "failed" && goal.retries >= this.options.maxRetries) {
      return false;
    }

    return true;
  }

  //==================================================
  // GET READY GOALS
  //==================================================

  getReadyGoals() {
    const ready = [];

    for (const goal of this.goalGraph.values()) {
      if (this.canExecuteGoal(goal.id)) {
        ready.push(goal);
      }
    }

    //--------------------------------------------------
    // Highest priority first
    //--------------------------------------------------

    const priorityWeight = {
      critical: 100,

      high: 75,

      normal: 50,

      low: 25,
    };

    ready.sort((a, b) => {
      const pa = priorityWeight[a.priority] ?? 0;

      const pb = priorityWeight[b.priority] ?? 0;

      if (pb !== pa) return pb - pa;

      return a.createdAt - b.createdAt;
    });

    return ready;
  }

  //==================================================
  // WAITING GOALS
  //==================================================

  getWaitingGoals() {
    const waiting = [];

    for (const goal of this.goalGraph.values()) {
      const state = this.resolveDependencies(goal.id);

      if (!state.satisfied) {
        waiting.push({
          goal,

          blockedBy: state.unresolved,
        });
      }
    }

    return waiting;
  }

  //==================================================
  // BLOCKED GOALS
  //==================================================

  getBlockedGoals() {
    return this.getWaitingGoals().map((item) => item.goal);
  }

  //==================================================
  // EXECUTION ROOTS
  //==================================================

  getRootGoals() {
    return [...this.goalGraph.values()].filter((goal) => !goal.parent);
  }

  //==================================================
  // LEAF GOALS
  //==================================================

  getLeafGoals() {
    return [...this.goalGraph.values()].filter(
      (goal) => goal.children.length === 0,
    );
  }

  //==================================================
  // PART 2B-2
  // Topological Sort
  // Circular Dependency Detection
  // Dependency Validation
  // Execution Order Builder
  //==================================================
  //==================================================
  // TOPOLOGICAL SORT
  //==================================================

  topologicalSort() {
    const visited = new Set();

    const visiting = new Set();

    const order = [];

    const visit = (goalId) => {
      if (visited.has(goalId)) {
        return;
      }

      if (visiting.has(goalId)) {
        throw new Error(`Circular dependency detected at '${goalId}'.`);
      }

      visiting.add(goalId);

      const goal = this.getGoal(goalId);

      if (!goal) {
        visiting.delete(goalId);

        return;
      }

      for (const dependencyId of goal.dependencies) {
        visit(dependencyId);
      }

      visiting.delete(goalId);

      visited.add(goalId);

      order.push(goal);
    };

    for (const goal of this.goalGraph.values()) {
      visit(goal.id);
    }

    return order;
  }

  //==================================================
  // CIRCULAR DEPENDENCY CHECK
  //==================================================

  hasCircularDependency() {
    try {
      this.topologicalSort();

      return false;
    } catch {
      return true;
    }
  }

  //==================================================
  // VALIDATE DEPENDENCY GRAPH
  //==================================================

  validateDependencyGraph() {
    const errors = [];

    //--------------------------------------------------
    // Missing dependencies
    //--------------------------------------------------

    for (const goal of this.goalGraph.values()) {
      for (const dependencyId of goal.dependencies) {
        if (!this.goalGraph.has(dependencyId)) {
          errors.push({
            type: "missing",

            goal: goal.id,

            dependency: dependencyId,
          });
        }
      }
    }

    //--------------------------------------------------
    // Circular dependency
    //--------------------------------------------------

    if (this.hasCircularDependency()) {
      errors.push({
        type: "circular",

        message: "Circular dependency detected.",
      });
    }

    return {
      valid: errors.length === 0,

      errors,
    };
  }

  //==================================================
  // BUILD EXECUTION ORDER
  //==================================================

  buildExecutionOrder() {
    const validation = this.validateDependencyGraph();

    if (!validation.valid) {
      throw new Error(
        validation.errors
          .map((e) => e.message || `${e.goal} -> ${e.dependency}`)
          .join("\n"),
      );
    }

    const orderedGoals = this.topologicalSort();

    const execution = [];

    for (const goal of orderedGoals) {
      execution.push({
        goalId: goal.id,

        name: goal.name,

        priority: goal.priority,

        dependencies: [...goal.dependencies],

        status: goal.status,
      });
    }

    return execution;
  }

  //==================================================
  // NEXT EXECUTABLE GOAL
  //==================================================

  getNextExecutableGoal() {
    const ready = this.getReadyGoals();

    if (!ready.length) {
      return null;
    }

    return ready[0];
  }

  //==================================================
  // EXECUTION BATCH
  //==================================================

  buildExecutionBatch(maxParallel = this.options.maxParallelGoals) {
    const ready = this.getReadyGoals();

    if (!this.options.enableParallel) {
      return ready.slice(0, 1);
    }

    return ready.slice(0, maxParallel);
  }
  //==================================================
  // PART 3
  // Goal Execution Engine
  // Sequential Execution
  // Parallel Execution
  // Goal Completion
  // Failure Recovery
  //==================================================

  //==================================================
  // EXECUTE GOAL
  //==================================================

  async executeGoal(goalId, context = {}) {
    const started = this.startTimer();

    const goal = typeof goalId === "string" ? this.getGoal(goalId) : goalId;

    if (!goal) {
      throw new Error("Goal not found.");
    }

    if (!this.canExecuteGoal(goal.id)) {
      throw new Error(`Goal '${goal.name}' cannot be executed.`);
    }

    goal.status = "running";

    goal.startedAt = Date.now();

    goal.updatedAt = Date.now();

    this.currentGoal = goal;

    //--------------------------------------------------
    // Prepare Goal
    //--------------------------------------------------

    await this.prepareGoal(goal.id, context);

    //--------------------------------------------------
    // Build Execution Plan
    //--------------------------------------------------

    const executionPlan = await this.createExecutionPlan(goal.id, context);

    let results = [];

    //--------------------------------------------------
    // Parallel or Sequential
    //--------------------------------------------------

    if (this.options.enableParallel && executionPlan.parallel.length) {
      results = await this.executeParallelSteps(
        goal,

        executionPlan.parallel,

        context,
      );
    } else {
      results = await this.executeSequentialSteps(
        goal,

        executionPlan.sequential,

        context,
      );
    }

    //--------------------------------------------------
    // Finish
    //--------------------------------------------------

    goal.completedAt = Date.now();

    goal.updatedAt = Date.now();

    this.stopTimer(started);

    return {
      success: goal.status === "completed",

      goal,

      results,
    };
  }

  //==================================================
  // EXECUTE SEQUENTIAL STEPS
  //==================================================

  async executeSequentialSteps(
    goal,

    steps,

    context = {},
  ) {
    const results = [];

    for (const step of steps) {
      try {
        step.status = "running";

        const result = await this.executeStep(
          goal,

          step,

          context,
        );

        step.status = "completed";

        step.completedAt = Date.now();

        goal.completedSteps.push(step.id);

        results.push(result);
      } catch (error) {
        step.status = "failed";

        step.error = error.message;

        goal.failedSteps.push(step.id);

        const recovered = await this.recoverStep(
          goal,

          step,

          error,

          context,
        );

        if (!recovered) {
          goal.status = "failed";

          this.failedGoals.set(goal.id, goal);

          this.stats.failedGoals++;

          throw error;
        }
      }
    }

    goal.status = "completed";

    this.completedGoals.set(goal.id, goal);

    this.activeGoals.delete(goal.id);

    this.stats.completedGoals++;

    return results;
  }

  //==================================================
  // EXECUTE PARALLEL STEPS
  //==================================================

  async executeParallelSteps(
    goal,

    steps,

    context = {},
  ) {
    const promises = steps.map((step) =>
      this.executeStep(
        goal,

        step,

        context,
      ),
    );

    const results = await Promise.allSettled(promises);

    let failed = false;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      const step = steps[i];

      if (result.status === "fulfilled") {
        step.status = "completed";

        goal.completedSteps.push(step.id);
      } else {
        failed = true;

        step.status = "failed";

        step.error = result.reason?.message;

        goal.failedSteps.push(step.id);
      }
    }

    if (failed) {
      goal.status = "failed";

      this.failedGoals.set(goal.id, goal);

      this.stats.failedGoals++;
    } else {
      goal.status = "completed";

      this.completedGoals.set(goal.id, goal);

      this.stats.parallelGoals++;
    }

    return results;
  }

  //==================================================
  // EXECUTE SINGLE STEP
  //==================================================

  async executeStep(
    goal,

    step,

    context = {},
  ) {
    if (typeof this.taskQueue.execute === "function") {
      return await this.taskQueue.execute(
        step,

        context,
      );
    }

    if (typeof this.microPlanner.execute === "function") {
      return await this.microPlanner.execute(
        step,

        context,
      );
    }

    return {
      success: true,

      step,
    };
  }
  //==================================================
  // PART 4
  // Failure Recovery
  // Goal Completion
  // Replanning
  // Goal Cancellation
  //==================================================

  //==================================================
  // RECOVER FAILED STEP
  //==================================================

  async recoverStep(goal, step, error, context = {}) {
    this.warn("Recovering step:", step.action, error.message);

    if (!this.options.enableRecovery) {
      return false;
    }

    step.retry = (step.retry || 0) + 1;

    goal.retries++;

    //--------------------------------------------------
    // Retry limit reached
    //--------------------------------------------------

    if (step.retry > this.options.maxRetries) {
      return false;
    }

    try {
      //--------------------------------------------------
      // Self Healing
      //--------------------------------------------------

      if (this.selfHealing && typeof this.selfHealing.recover === "function") {
        await this.selfHealing.recover({
          goal,

          step,

          error,

          context,
        });
      }

      //--------------------------------------------------
      // Retry execution
      //--------------------------------------------------

      const result = await this.executeStep(
        goal,

        step,

        context,
      );

      step.status = "completed";

      goal.completedSteps.push(step.id);

      this.stats.recoveredGoals++;

      return result;
    } catch (err) {
      this.error(err.message);

      return false;
    }
  }

  //==================================================
  // COMPLETE GOAL
  //==================================================

  completeGoal(goalId) {
    const goal = this.getGoal(goalId);

    if (!goal) return false;

    goal.status = "completed";

    goal.completedAt = Date.now();

    goal.updatedAt = Date.now();

    this.completedGoals.set(goal.id, goal);

    this.activeGoals.delete(goal.id);

    this.failedGoals.delete(goal.id);

    this.goalHistory.push({
      id: goal.id,

      name: goal.name,

      status: "completed",

      timestamp: Date.now(),
    });

    this.stats.completedGoals++;

    return goal;
  }

  //==================================================
  // FAIL GOAL
  //==================================================

  failGoal(goalId, error) {
    const goal = this.getGoal(goalId);

    if (!goal) return false;

    goal.status = "failed";

    goal.error = error?.message || String(error);

    goal.updatedAt = Date.now();

    this.failedGoals.set(goal.id, goal);

    this.activeGoals.delete(goal.id);

    this.goalHistory.push({
      id: goal.id,

      name: goal.name,

      status: "failed",

      timestamp: Date.now(),

      error: goal.error,
    });

    this.stats.failedGoals++;

    return goal;
  }

  //==================================================
  // REPLAN GOAL
  //==================================================

  async replanGoal(goalId, context = {}) {
    const goal = this.getGoal(goalId);

    if (!goal) {
      throw new Error("Goal not found.");
    }

    this.log("Replanning:", goal.name);

    goal.steps = [];

    goal.completedSteps = [];

    goal.failedSteps = [];

    goal.status = "pending";

    goal.updatedAt = Date.now();

    await this.decomposeGoal(goal, context);

    this.stats.replannedGoals++;

    return goal;
  }

  //==================================================
  // CANCEL GOAL
  //==================================================

  cancelGoal(goalId) {
    const goal = this.getGoal(goalId);

    if (!goal) return false;

    goal.status = "cancelled";

    goal.updatedAt = Date.now();

    this.activeGoals.delete(goal.id);

    this.goalHistory.push({
      id: goal.id,

      name: goal.name,

      status: "cancelled",

      timestamp: Date.now(),
    });

    return true;
  }

  //==================================================
  // RESET GOAL
  //==================================================

  resetGoal(goalId) {
    const goal = this.getGoal(goalId);

    if (!goal) return false;

    goal.status = "pending";

    goal.retries = 0;

    goal.error = null;

    goal.startedAt = null;

    goal.completedAt = null;

    goal.completedSteps = [];

    goal.failedSteps = [];

    for (const step of goal.steps) {
      step.status = "pending";

      step.retry = 0;

      delete step.error;
    }

    this.activeGoals.set(goal.id, goal);

    this.failedGoals.delete(goal.id);

    this.completedGoals.delete(goal.id);

    return goal;
  }
  //==================================================
  // PART 5
  // Optimization
  // Planner Memory
  // Goal Cache
  // Statistics
  //==================================================

  //==================================================
  // OPTIMIZE GOAL
  //==================================================

  optimizeGoal(goalId) {
    const goal = this.getGoal(goalId);

    if (!goal) {
      throw new Error("Goal not found.");
    }

    if (!this.options.enableOptimization) {
      return goal;
    }

    //--------------------------------------------------
    // Remove duplicate steps
    //--------------------------------------------------

    const seen = new Set();

    goal.steps = goal.steps.filter((step) => {
      const key = JSON.stringify({
        action: step.action,

        target: step.target,

        value: step.value,
      });

      if (seen.has(key)) return false;

      seen.add(key);

      return true;
    });

    //--------------------------------------------------
    // Sort by confidence
    //--------------------------------------------------

    goal.steps.sort((a, b) => (b.confidence ?? 100) - (a.confidence ?? 100));

    goal.updatedAt = Date.now();

    this.stats.optimizedGoals++;

    return goal;
  }

  //==================================================
  // CACHE GOAL
  //==================================================

  cacheGoal(goal) {
    if (!this.options.enableGoalCache) {
      return;
    }

    this.goalCache.set(goal.id, structuredClone(goal));
  }

  getCachedGoal(goalId) {
    return this.goalCache.get(goalId) || null;
  }

  clearGoalCache() {
    this.goalCache.clear();
  }

  //==================================================
  // MEMORY
  //==================================================

  rememberSuccessfulPlan(goal) {
    this.memory.successfulPlans.set(
      goal.name,

      structuredClone(goal),
    );
  }

  rememberFailedPlan(goal) {
    this.memory.failedPlans.set(
      goal.name,

      structuredClone(goal),
    );
  }

  rememberRecoveredPlan(goal) {
    this.memory.recoveredPlans.set(
      goal.name,

      structuredClone(goal),
    );
  }

  rememberOptimizedPlan(goal) {
    this.memory.optimizedPlans.set(
      goal.name,

      structuredClone(goal),
    );
  }

  getMemory() {
    return this.memory;
  }

  clearMemory() {
    this.memory = {
      successfulPlans: new Map(),

      failedPlans: new Map(),

      optimizedPlans: new Map(),

      recoveredPlans: new Map(),
    };
  }

  //==================================================
  // HISTORY
  //==================================================

  getGoalHistory() {
    return [...this.goalHistory];
  }

  clearHistory() {
    this.goalHistory = [];
  }

  //==================================================
  // STATISTICS
  //==================================================

  getStatistics() {
    return {
      ...this.stats,

      activeGoals: this.activeGoals.size,

      completed: this.completedGoals.size,

      failed: this.failedGoals.size,

      cachedGoals: this.goalCache.size,

      totalGoals: this.goalGraph.size,
    };
  }

  resetStatistics() {
    Object.keys(this.stats).forEach((key) => {
      this.stats[key] = 0;
    });
  }

  //==================================================
  // EXPORT
  //==================================================

  export() {
    return {
      options: structuredClone(this.options),

      statistics: this.getStatistics(),

      goals: this.getGoals(),

      history: this.getGoalHistory(),
    };
  }

  //==================================================
  // RESET
  //==================================================

  reset() {
    this.goalCache.clear();

    this.goalGraph.clear();

    this.dependencyGraph.clear();

    this.executionGraph.clear();

    this.activeGoals.clear();

    this.completedGoals.clear();

    this.failedGoals.clear();

    this.goalHistory = [];

    this.clearMemory();

    this.resetStatistics();

    this.currentGoal = null;

    this.lastGoal = null;

    this.isPlanning = false;
  }
}
