/**
 * Dev Agent
 *
 * Goal-driven development agent that replaces the reactive TaskAgent.
 * Receives goals externally, decomposes them into tasks via planning,
 * and executes tasks through the inner loop.
 *
 * Lifecycle:
 *   load goals → reconcile with state → plan → execute or idle
 *
 * Guidelines: coding.md, testing.md, learnings.md, planning.md
 * Criteria: quality.md, security.md
 */

import type {
  ExecutableAgent,
  AgentOptions,
  AgentGuidanceConfig,
  AgentMetrics,
  AgentOuterLoopResult,
  ExecutionResult,
} from './types.js';
import type {
  Proposal,
  OphanConfig,
  OphanState,
  Goal,
  GoalTask,
  GoalState,
  GoalStatus,
} from '../../types/index.js';
import { AbstractAgent, IdGenerator, ContentLoader } from './utils.js';
import { InnerLoop, type InnerLoopResult } from '../inner-loop.js';
import { IntelligentAnalyzer, type TaskLogEntry } from '../intelligent-analyzer.js';
import { LearningManager } from '../learning-manager.js';
import { GoalPlanner, type PlanDecision } from '../goal-planner.js';
import { loadGoalFiles, type ParsedGoalFile } from '../goal-parser.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Result of a dev agent run cycle
 */
export interface DevRunResult {
  /** What the planner decided to do */
  decision: PlanDecision;
  /** Goals that were decomposed into tasks */
  goalsPlanned: string[];
  /** Tasks that were executed */
  tasksExecuted: Array<{
    goalId: string;
    taskId: string;
    success: boolean;
    iterations: number;
    cost: number;
  }>;
  /** Goals that completed during this run */
  goalsCompleted: string[];
  /** Whether the agent is idle (nothing to do) */
  idle: boolean;
  /** Updated goals (for state persistence) */
  goals: Goal[];
}

export interface DevRunOptions {
  /** Only work on this specific goal */
  goalId?: string;
  /** Plan without executing (dry run) */
  planOnly?: boolean;
  /** Max tasks to execute in a single run */
  maxTasks?: number;
}

/**
 * Dev Agent - goal-driven development with planning and execution
 */
export class DevAgent extends AbstractAgent implements ExecutableAgent {
  readonly id = 'dev-agent' as const;
  readonly name = 'Development Agent';
  readonly description =
    'Goal-driven development agent that plans work, decomposes goals into tasks, and executes through iterative refinement';
  readonly canExecuteTasks = true as const;

  readonly guidance: AgentGuidanceConfig = {
    guidelineFiles: ['coding.md', 'testing.md', 'learnings.md', 'planning.md'],
    criteriaFiles: ['quality.md', 'security.md'],
  };

  private config: OphanConfig | null = null;
  private state: OphanState | null = null;
  private intelligentAnalyzer: IntelligentAnalyzer | null = null;
  private learningManager: LearningManager | null = null;
  private planner: GoalPlanner | null = null;

  async initialize(options: AgentOptions): Promise<void> {
    this.options = options;
    this.config = options.config;

    this.intelligentAnalyzer = new IntelligentAnalyzer({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
      config: options.config,
      onProgress: (msg) => this.log(msg),
    });

    this.learningManager = new LearningManager({
      ophanDir: options.ophanDir,
      config: options.config,
    });

    this.planner = new GoalPlanner({
      projectRoot: options.projectRoot,
      ophanDir: options.ophanDir,
      config: options.config,
      onProgress: (msg) => this.log(msg),
    });

    this.log('Dev Agent initialized');
  }

  /**
   * Set the current state (loaded from state.json)
   */
  setState(state: OphanState): void {
    this.state = state;
  }

  // =========================================================================
  // Goal-driven execution
  // =========================================================================

  /**
   * Run one planning + execution cycle.
   *
   * Flow:
   *   1. Load goals from .ophan/goals/*.md
   *   2. Reconcile with state.json
   *   3. Plan: categorize goals, decide what to do
   *   4. Execute: decompose a goal or run a task
   *   5. Assess goal completion if all tasks done
   */
  async run(options: DevRunOptions = {}): Promise<DevRunResult> {
    this.ensureInitialized();

    const maxTasks = options.maxTasks ?? 5;
    const goalsPlanned: string[] = [];
    const tasksExecuted: DevRunResult['tasksExecuted'] = [];
    const goalsCompleted: string[] = [];

    // 1. Load and reconcile goals
    let goals = await this.loadGoals();

    // Filter to specific goal if requested
    if (options.goalId) {
      const target = goals.find((g) => g.id === options.goalId);
      if (!target) {
        throw new Error(`Goal not found: ${options.goalId}`);
      }
      goals = [target];
    }

    // 2. Plan + execute loop
    let tasksRun = 0;
    let lastDecision: PlanDecision = { action: 'idle', reason: 'No actions taken' };

    while (tasksRun < maxTasks) {
      const decision = this.planner!.plan(goals);
      lastDecision = decision;

      if (decision.action === 'idle' || decision.action === 'blocked') {
        break;
      }

      if (decision.action === 'plan_goal') {
        if (options.planOnly) {
          this.log(`[dry run] Would decompose goal: ${decision.goalId}`);
          break;
        }

        // Decompose goal into tasks
        const goal = goals.find((g) => g.id === decision.goalId)!;
        goal.status = 'planning';

        const guidelines = await ContentLoader.loadGuidelines(
          this.ophanDir,
          this.guidance.guidelineFiles
        );

        const tasks = await this.planner!.decomposeGoal(goal, guidelines.content);

        if (tasks.length > 0) {
          goal.tasks = tasks;
          goal.status = 'in_progress';
          goalsPlanned.push(goal.id);
          this.log(`Goal "${goal.title}" decomposed into ${tasks.length} tasks`);
        } else {
          this.log(`Warning: Failed to decompose goal "${goal.title}"`);
          goal.status = 'blocked';
        }

        // Save state after planning
        await this.saveGoalState(goals);
        continue; // Loop back to plan next action
      }

      if (decision.action === 'execute_task') {
        if (options.planOnly) {
          this.log(`[dry run] Would execute: ${decision.task.description}`);
          break;
        }

        const goal = goals.find((g) => g.id === decision.goalId)!;
        const task = decision.task;

        // Execute the task
        const result = await this.executeGoalTask(goal, task);
        tasksRun++;

        tasksExecuted.push({
          goalId: goal.id,
          taskId: task.id,
          success: result.success,
          iterations: result.iterations,
          cost: result.cost,
        });

        // Update task status
        task.status = result.success ? 'converged' : 'failed';
        task.result = {
          success: result.success,
          iterations: result.iterations,
          cost: result.cost,
          summary: result.output.slice(0, 500),
        };

        // Check if all tasks for this goal are done
        const allDone = goal.tasks.every(
          (t) => t.status === 'converged' || t.status === 'failed' || t.status === 'skipped'
        );

        if (allDone) {
          // Assess goal completion
          const assessment = await this.planner!.assessGoalCompletion(goal);

          if (assessment.complete && assessment.confidence >= 0.7) {
            goal.status = 'completed';
            goal.completedAt = new Date().toISOString();
            goalsCompleted.push(goal.id);
            this.log(`Goal "${goal.title}" completed (confidence: ${(assessment.confidence * 100).toFixed(0)}%)`);
          } else {
            this.log(
              `Goal "${goal.title}" needs more work. Remaining: ${assessment.remainingCriteria.join(', ')}`
            );
            // Re-plan: the planner will see all tasks done and may decompose additional tasks
            // For now, mark as blocked so the user can intervene
            goal.status = 'blocked';
          }
        }

        // Save state after each task
        await this.saveGoalState(goals);
        goal.updatedAt = new Date().toISOString();
      }
    }

    // Check overall idle state
    const idleCheck = this.planner!.isIdle(goals);

    return {
      decision: lastDecision,
      goalsPlanned,
      tasksExecuted,
      goalsCompleted,
      idle: idleCheck.idle,
      goals,
    };
  }

  // =========================================================================
  // Backward-compatible task execution (no planning)
  // =========================================================================

  /**
   * Execute a single task directly, bypassing the planning system.
   * Used by `ophan task` for backward compatibility.
   */
  async executeTask(taskDescription: string): Promise<ExecutionResult> {
    this.ensureInitialized();

    const guidelines = await ContentLoader.loadGuidelines(
      this.ophanDir,
      this.guidance.guidelineFiles
    );

    const criteria = await ContentLoader.loadCriteria(
      this.ophanDir,
      this.guidance.criteriaFiles
    );

    const learningsPath = path.join(this.ophanDir, 'guidelines', 'learnings.md');
    let learnings = '';
    try {
      learnings = await fs.readFile(learningsPath, 'utf-8');
    } catch {
      // No learnings yet
    }

    const innerLoop = new InnerLoop({
      projectRoot: this.projectRoot,
      projectName: path.basename(this.projectRoot),
      ophanDir: this.ophanDir,
      config: this.config!,
      guidelines: guidelines.content,
      criteria: criteria.content,
      learnings,
      guidelineFiles: guidelines.files,
      criteriaFiles: criteria.files,
      onProgress: (msg) => this.log(msg),
    });

    const result = await innerLoop.execute(taskDescription);
    return this.mapInnerLoopResult(result);
  }

  // =========================================================================
  // Goal management
  // =========================================================================

  /**
   * Load goals from .ophan/goals/*.md and reconcile with state.json
   */
  async loadGoals(): Promise<Goal[]> {
    this.ensureInitialized();

    const goalsDir = path.join(this.ophanDir, 'goals');
    const goalFiles = await loadGoalFiles(goalsDir);

    // Get runtime state from state.json
    const goalStates = this.state?.goals ?? [];

    return this.reconcileGoals(goalFiles, goalStates);
  }

  /**
   * Reconcile goal definitions (from .md files) with runtime state (from state.json).
   *
   * - New goals (in files but not state): create fresh Goal with 'pending' status
   * - Existing goals: merge definition (title, description, criteria) with state (tasks, status)
   * - Deleted goals (in state but not files): mark as 'abandoned'
   */
  private reconcileGoals(defs: ParsedGoalFile[], states: GoalState[]): Goal[] {
    const stateMap = new Map(states.map((s) => [s.goalId, s]));
    const goals: Goal[] = [];
    const now = new Date().toISOString();

    // Process goal files
    for (const def of defs) {
      const state = stateMap.get(def.id);

      if (state) {
        // Existing goal: merge definition with runtime state
        goals.push({
          id: def.id,
          title: def.title,
          description: def.description,
          source: { type: 'file', path: def.filePath },
          status: state.status,
          priority: def.priority,
          acceptanceCriteria: def.acceptanceCriteria,
          tasks: state.tasks,
          tags: def.tags,
          dependsOn: def.dependsOn,
          createdAt: state.startedAt ?? now,
          updatedAt: now,
          completedAt: state.completedAt,
        });
      } else {
        // New goal: create fresh
        goals.push({
          id: def.id,
          title: def.title,
          description: def.description,
          source: { type: 'file', path: def.filePath },
          status: 'pending',
          priority: def.priority,
          acceptanceCriteria: def.acceptanceCriteria,
          tasks: [],
          tags: def.tags,
          dependsOn: def.dependsOn,
          createdAt: now,
          updatedAt: now,
        });
      }

      stateMap.delete(def.id);
    }

    // Handle deleted goals (in state but file removed)
    for (const [goalId, state] of stateMap) {
      if (!['completed', 'abandoned'].includes(state.status)) {
        this.log(`Goal "${goalId}" file was removed — marking as abandoned`);
      }
      // Keep in state as abandoned so history is preserved
      goals.push({
        id: goalId,
        title: goalId,
        description: '',
        source: { type: 'file', path: '' },
        status: 'abandoned' as GoalStatus,
        priority: 99,
        acceptanceCriteria: [],
        tasks: state.tasks,
        createdAt: state.startedAt ?? now,
        updatedAt: now,
        completedAt: state.completedAt,
      });
    }

    return goals;
  }

  // =========================================================================
  // Outer loop (learning from patterns)
  // =========================================================================

  /**
   * Run the outer loop to detect patterns and generate proposals.
   * Same as old TaskAgent — analyzes task logs and proposes improvements.
   */
  async runOuterLoop(
    lookbackDays: number,
    autoApplyGuidelines: boolean
  ): Promise<AgentOuterLoopResult> {
    this.ensureInitialized();

    const proposals: Proposal[] = [];
    const guidelinesUpdated: string[] = [];

    // 1. Load task logs
    const taskLogs = await this.loadTaskLogs(lookbackDays);
    this.log(`Loaded ${taskLogs.length} task logs`);

    if (taskLogs.length === 0) {
      return {
        proposals: [],
        metrics: await this.getMetrics(),
        summary: 'No task logs to analyze',
      };
    }

    // 2. Use intelligent analysis (Claude-powered) for pattern detection
    this.log('Running intelligent pattern analysis...');
    const analysisResult = await this.intelligentAnalyzer!.analyze(taskLogs);
    this.log(
      `Analysis complete: ${analysisResult.patterns.length} patterns, ${analysisResult.proposals.length} recommendations`
    );

    for (const pattern of analysisResult.patterns) {
      const actionable = pattern.isActionable ? '(actionable)' : '(not actionable)';
      this.log(`  - [${pattern.category}] ${pattern.description} ${actionable}`);
    }

    // 3. Consolidate learnings
    const consolidationResult = await this.learningManager!.consolidate(
      this.state?.learnings ?? []
    );
    this.log(
      `Learnings: ${consolidationResult.kept.length} kept, ${consolidationResult.promoted.length} promoted`
    );

    // 4. Generate proposals from promoted learnings
    const learningProposals =
      this.learningManager!.generateGuidelineProposals(consolidationResult.promoted);

    for (const proposal of learningProposals) {
      if (autoApplyGuidelines) {
        try {
          await this.learningManager!.applyGuidelineUpdate(proposal.file, proposal.content);
          guidelinesUpdated.push(proposal.file);
          this.log(`Auto-applied guideline: ${proposal.file}`);
        } catch (error) {
          this.log(`Failed to update ${proposal.file}: ${(error as Error).message}`);
        }
      } else {
        proposals.push({
          id: IdGenerator.proposal(),
          type: 'guideline',
          source: 'dev-agent',
          targetFile: proposal.file,
          change: proposal.content,
          reason: `Promoted from learning: "${proposal.learningContent?.slice(0, 100)}..."`,
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          status: 'pending',
        });
      }
    }

    // 5. Add proposals from intelligent analysis
    for (const aiProposal of analysisResult.proposals) {
      if (autoApplyGuidelines && aiProposal.type === 'guideline') {
        try {
          await this.learningManager!.applyGuidelineUpdate(
            aiProposal.targetFile,
            aiProposal.change
          );
          if (!guidelinesUpdated.includes(aiProposal.targetFile)) {
            guidelinesUpdated.push(aiProposal.targetFile);
          }
          this.log(`Auto-applied AI recommendation: ${aiProposal.targetFile}`);
        } catch (error) {
          this.log(`Failed to apply: ${(error as Error).message}`);
        }
      } else {
        proposals.push(aiProposal);
      }
    }

    // 6. Rewrite learnings file
    await this.learningManager!.rewriteLearningsFile(consolidationResult.kept);

    return {
      proposals,
      metrics: await this.getMetrics(),
      summary: `${analysisResult.patterns.length} patterns, ${proposals.length} proposals, ${guidelinesUpdated.length} auto-applied`,
    };
  }

  // =========================================================================
  // Metrics
  // =========================================================================

  /**
   * Get current metrics for this agent
   */
  async getMetrics(): Promise<AgentMetrics[]> {
    if (!this.state) {
      return [];
    }

    const metrics = this.state.metrics;
    const goals = this.state.goals;

    const baseMetrics: AgentMetrics[] = [
      {
        name: 'Success Rate',
        value: metrics.successRate,
        target: 80,
        passed: metrics.successRate >= 80,
      },
      {
        name: 'Average Iterations',
        value: metrics.averageIterations,
        target: 3,
        passed: metrics.averageIterations <= 3,
      },
      {
        name: 'Average Cost per Task',
        value: metrics.averageCostPerTask,
        target: this.config?.innerLoop.costLimit ?? 1.0,
        passed: metrics.averageCostPerTask <= (this.config?.innerLoop.costLimit ?? 1.0),
      },
    ];

    // Add goal-level metrics if we have goals
    if (goals.length > 0) {
      const completed = goals.filter((g) => g.status === 'completed').length;
      const active = goals.filter(
        (g) => !['completed', 'abandoned'].includes(g.status)
      ).length;

      baseMetrics.push({
        name: 'Goals Completed',
        value: completed,
        passed: true,
      });

      baseMetrics.push({
        name: 'Active Goals',
        value: active,
        passed: true,
      });
    }

    return baseMetrics;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Execute a goal task through the inner loop with merged criteria.
   */
  private async executeGoalTask(goal: Goal, task: GoalTask): Promise<ExecutionResult> {
    this.log(`Executing task for "${goal.title}": ${task.description}`);

    // Mark task as running
    task.status = 'running';

    // Load base guidelines and criteria
    const guidelines = await ContentLoader.loadGuidelines(
      this.ophanDir,
      this.guidance.guidelineFiles
    );

    const baseCriteria = await ContentLoader.loadCriteria(
      this.ophanDir,
      this.guidance.criteriaFiles
    );

    // Merge goal-specific acceptance criteria with global criteria
    const goalCriteriaSection = `\n\n## Goal: ${goal.title}\n\n${goal.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`;
    const mergedCriteria = baseCriteria.content + goalCriteriaSection;

    // Load learnings
    const learningsPath = path.join(this.ophanDir, 'guidelines', 'learnings.md');
    let learnings = '';
    try {
      learnings = await fs.readFile(learningsPath, 'utf-8');
    } catch {
      // No learnings yet
    }

    // Create and run inner loop
    const innerLoop = new InnerLoop({
      projectRoot: this.projectRoot,
      projectName: path.basename(this.projectRoot),
      ophanDir: this.ophanDir,
      config: this.config!,
      guidelines: guidelines.content,
      criteria: mergedCriteria,
      learnings,
      guidelineFiles: guidelines.files,
      criteriaFiles: baseCriteria.files,
      onProgress: (msg) => this.log(msg),
    });

    const result = await innerLoop.execute(task.description);
    return this.mapInnerLoopResult(result);
  }

  /**
   * Save goal state to state.json (via the state object)
   */
  private async saveGoalState(goals: Goal[]): Promise<void> {
    if (!this.state) return;

    this.state.goals = goals.map((g) => ({
      goalId: g.id,
      status: g.status,
      tasks: g.tasks,
      startedAt: g.createdAt,
      completedAt: g.completedAt,
      totalCost: g.tasks.reduce((sum, t) => sum + (t.result?.cost ?? 0), 0),
      totalTokens: 0,
    }));

    this.state.lastPlanningRun = new Date().toISOString();

    // Write state.json
    const stateDir = path.join(this.ophanDir, 'agents', 'dev');
    await fs.mkdir(stateDir, { recursive: true });
    const statePath = path.join(stateDir, 'state.json');
    await fs.writeFile(statePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /**
   * Load task logs from the logs directory
   */
  private async loadTaskLogs(lookbackDays: number): Promise<TaskLogEntry[]> {
    const logsDir = path.join(this.ophanDir, 'agents', 'dev', 'logs');
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

    const results = await ContentLoader.loadJsonFiles<TaskLogEntry>(logsDir);

    return results
      .filter((r) => {
        const taskDate = new Date(r.data.task.startedAt);
        return taskDate >= lookbackDate;
      })
      .map((r) => r.data)
      .sort(
        (a, b) =>
          new Date(a.task.startedAt).getTime() - new Date(b.task.startedAt).getTime()
      );
  }

  /**
   * Map InnerLoopResult to ExecutionResult
   */
  private mapInnerLoopResult(result: InnerLoopResult): ExecutionResult {
    return {
      success: result.task.status === 'converged',
      iterations: result.task.iterations,
      cost: result.task.cost,
      output: result.logs.map((l) => l.output).join('\n'),
      learnings: result.learnings.map((l) => l.content),
    };
  }
}
