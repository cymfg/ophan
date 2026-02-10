/**
 * Context Assembler
 *
 * Pre-hook that builds a complete AssembledContext from all data sources
 * before every reasoner invocation. Replaces the ad-hoc context building
 * scattered across processMessage().
 */

import { createHash } from 'crypto';
import type { OphanState } from '../../types/index.js';
import { ContentLoader } from '../agents/utils.js';
import { loadGoalFiles, type ParsedGoalFile } from '../goal-parser.js';
import { DevAgentAnalyzer } from './dev-agent-analyzer.js';
import { ConversationManager, type ConversationSession } from './conversation.js';
import type {
  AssembledContext,
  StateDelta,
  GoalConflict,
  Preference,
  Episode,
  OrchestratorState,
} from './types.js';
import type { AgentGuidanceConfig } from '../agents/types.js';

export interface ContextAssemblerOptions {
  ophanDir: string;
  projectRoot: string;
  guidance: AgentGuidanceConfig;
}

export class ContextAssembler {
  private analyzer: DevAgentAnalyzer;
  private conversationManager: ConversationManager;
  private options: ContextAssemblerOptions;
  private previousStateHash: string | null = null;
  private previousState: OphanState | null = null;

  constructor(options: ContextAssemblerOptions) {
    this.options = options;
    this.analyzer = new DevAgentAnalyzer({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
    });
    this.conversationManager = new ConversationManager(options.ophanDir);
  }

  /**
   * Restore the last known state hash from persisted orchestrator state.
   */
  restoreFromState(orchestratorState: OrchestratorState): void {
    this.previousStateHash = orchestratorState.lastStateHash ?? null;
  }

  /**
   * Build a complete context snapshot before every reasoner call.
   */
  async assemble(
    state: OphanState,
    session: ConversationSession,
    maxHistoryMessages: number,
    memory?: { preferences: Preference[]; recentEpisodes: Episode[] },
    goalConflicts?: GoalConflict[]
  ): Promise<AssembledContext> {
    // Always compute analysis (not just for "status" messages)
    const analysis = await this.analyzer.analyze(state);

    // Compute delta from previous state
    const delta = this.computeDelta(state);

    // Load goal files from disk
    const goalsDir = `${this.options.ophanDir}/goals`;
    let activeGoals: ParsedGoalFile[] = [];
    try {
      const allGoals = await loadGoalFiles(goalsDir);
      const activeGoalIds = state.goals
        .filter((g) => !['completed', 'abandoned'].includes(g.status))
        .map((g) => g.goalId);
      activeGoals = allGoals.filter((g) => activeGoalIds.includes(g.id));
    } catch {
      // Goals dir might not exist
    }

    // Get goal progress from analysis
    const goalProgress = analysis.goalProgress;

    // Build session context
    const sessionContext = await this.conversationManager.buildSessionContext(state);

    // Truncate history
    const history = this.conversationManager.truncateHistory(
      session.messages,
      maxHistoryMessages
    );

    // Load guidelines and criteria
    const guidelines = await ContentLoader.loadGuidelines(
      this.options.ophanDir,
      this.options.guidance.guidelineFiles
    );
    const criteria = await ContentLoader.loadCriteria(
      this.options.ophanDir,
      this.options.guidance.criteriaFiles
    );

    // Snapshot state for next delta
    this.snapshotState(state);

    return {
      devAgent: {
        state,
        analysis,
        delta,
      },
      goals: {
        active: activeGoals,
        recent: goalProgress,
        conflicts: goalConflicts ?? [],
      },
      memory: {
        preferences: memory?.preferences ?? [],
        recentEpisodes: memory?.recentEpisodes ?? [],
      },
      session: {
        history,
        context: sessionContext,
      },
      guidelines: guidelines.content,
      criteria: criteria.content,
    };
  }

  /**
   * Compute what changed since the last state snapshot.
   */
  computeDelta(current: OphanState): StateDelta {
    const currentHash = this.hashState(current);

    // No previous state — first run
    if (!this.previousState || !this.previousStateHash) {
      return {
        goalsChanged: [],
        newTaskResults: [],
        metricsChanged: false,
        costDelta: 0,
        summary: 'first check',
      };
    }

    // Hash match — nothing changed
    if (currentHash === this.previousStateHash) {
      return {
        goalsChanged: [],
        newTaskResults: [],
        metricsChanged: false,
        costDelta: 0,
        summary: 'no changes',
      };
    }

    const prev = this.previousState;
    const goalsChanged: string[] = [];
    const newTaskResults: StateDelta['newTaskResults'] = [];

    // Detect goal-level changes
    for (const currentGoal of current.goals) {
      const prevGoal = prev.goals.find((g) => g.goalId === currentGoal.goalId);

      if (!prevGoal) {
        goalsChanged.push(currentGoal.goalId);
        continue;
      }

      // Status changed
      if (prevGoal.status !== currentGoal.status) {
        goalsChanged.push(currentGoal.goalId);
      }

      // New task results
      for (const task of currentGoal.tasks) {
        const prevTask = prevGoal.tasks.find((t) => t.id === task.id);
        if (!prevTask || prevTask.status !== task.status) {
          if (['converged', 'failed', 'escalated'].includes(task.status)) {
            newTaskResults.push({
              goalId: currentGoal.goalId,
              taskId: task.id,
              description: task.description,
              status: task.status,
            });
            if (!goalsChanged.includes(currentGoal.goalId)) {
              goalsChanged.push(currentGoal.goalId);
            }
          }
        }
      }
    }

    const metricsChanged =
      prev.metrics.totalTasks !== current.metrics.totalTasks ||
      prev.metrics.successRate !== current.metrics.successRate;
    const costDelta = current.metrics.totalCost - prev.metrics.totalCost;

    // Build summary
    const parts: string[] = [];
    if (newTaskResults.length > 0) {
      const completed = newTaskResults.filter((t) => t.status === 'converged').length;
      const failed = newTaskResults.filter(
        (t) => t.status === 'failed' || t.status === 'escalated'
      ).length;
      if (completed > 0) parts.push(`${completed} task(s) completed`);
      if (failed > 0) parts.push(`${failed} task(s) failed`);
    }
    if (costDelta > 0) parts.push(`cost +$${costDelta.toFixed(4)}`);
    if (goalsChanged.length > 0 && newTaskResults.length === 0) {
      parts.push(`${goalsChanged.length} goal(s) changed`);
    }

    return {
      goalsChanged,
      newTaskResults,
      metricsChanged,
      costDelta,
      summary: parts.length > 0 ? parts.join(', ') : 'minor changes',
    };
  }

  /**
   * Store current state for next delta comparison.
   */
  snapshotState(state: OphanState): void {
    this.previousState = JSON.parse(JSON.stringify(state));
    this.previousStateHash = this.hashState(state);
  }

  /**
   * Get the current state hash for persistence.
   */
  getStateHash(): string | undefined {
    return this.previousStateHash ?? undefined;
  }

  private hashState(state: OphanState): string {
    // Hash the parts that matter for delta detection
    const relevant = {
      goals: state.goals.map((g) => ({
        id: g.goalId,
        status: g.status,
        tasks: g.tasks.map((t) => ({ id: t.id, status: t.status })),
      })),
      metrics: state.metrics,
    };
    return createHash('sha256')
      .update(JSON.stringify(relevant))
      .digest('hex')
      .slice(0, 16);
  }
}
