/**
 * DevAgent Analyzer
 *
 * Reads DevAgent state from the shared filesystem and produces
 * structured analysis for the Orchestrator's reasoning.
 */

import type { OphanState, GoalState } from '../../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface DevAgentAnalysis {
  health: 'healthy' | 'degraded' | 'critical';
  goalProgress: GoalProgressEntry[];
  recentFailures: FailureEntry[];
  issues: AnalysisIssue[];
  costSummary: CostSummary;
}

export interface GoalProgressEntry {
  goalId: string;
  status: string;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalCost: number;
  blockers: string[];
}

export interface FailureEntry {
  goalId: string;
  taskId: string;
  description: string;
  failureReason: string;
}

export interface AnalysisIssue {
  severity: 'info' | 'warning' | 'critical';
  category:
    | 'goal_blocked'
    | 'high_failure_rate'
    | 'cost_overrun'
    | 'stale_goal'
    | 'no_goals';
  description: string;
  suggestedAction: string;
}

export interface CostSummary {
  totalCost: number;
  costPerGoal: Record<string, number>;
  averageCostPerTask: number;
}

export interface QuickAlert {
  severity: 'warning' | 'critical';
  message: string;
}

export interface DevAgentAnalyzerOptions {
  ophanDir: string;
  projectRoot: string;
}

// ============================================================================
// Analyzer
// ============================================================================

export class DevAgentAnalyzer {
  constructor(_options: DevAgentAnalyzerOptions) {}

  /**
   * Produce a full analysis of the DevAgent's current state
   */
  async analyze(state: OphanState): Promise<DevAgentAnalysis> {
    const goalProgress = this.analyzeGoalProgress(state.goals);
    const recentFailures = this.extractRecentFailures(state.goals);
    const issues = this.detectIssues(state, goalProgress);
    const health = this.computeHealth(state.metrics, issues);
    const costSummary = this.computeCostSummary(state.goals, state.metrics);

    return {
      health,
      goalProgress,
      recentFailures,
      issues,
      costSummary,
    };
  }

  /**
   * Quick check for proactive mode — returns alerts needing attention
   */
  async quickCheck(state: OphanState): Promise<QuickAlert[]> {
    const alerts: QuickAlert[] = [];

    // Blocked goals
    for (const goal of state.goals) {
      if (goal.status === 'blocked') {
        alerts.push({
          severity: 'warning',
          message: `Goal "${goal.goalId}" is blocked`,
        });
      }
    }

    // Low success rate
    if (state.metrics.totalTasks > 5 && state.metrics.successRate < 50) {
      alerts.push({
        severity: 'critical',
        message: `DevAgent success rate is ${state.metrics.successRate.toFixed(0)}% (below 50%)`,
      });
    }

    // High cost per task
    if (
      state.metrics.totalTasks > 0 &&
      state.metrics.averageCostPerTask > 2.0
    ) {
      alerts.push({
        severity: 'warning',
        message: `Average cost per task is $${state.metrics.averageCostPerTask.toFixed(2)} (high)`,
      });
    }

    // Goals with all tasks failed
    for (const goal of state.goals) {
      if (goal.tasks.length > 0) {
        const allFailed = goal.tasks.every(
          (t) => t.status === 'failed' || t.status === 'escalated'
        );
        if (allFailed && !['completed', 'abandoned'].includes(goal.status)) {
          alerts.push({
            severity: 'critical',
            message: `All tasks failed for goal "${goal.goalId}"`,
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Format analysis as markdown for conversation context
   */
  formatAnalysis(analysis: DevAgentAnalysis): string {
    const lines: string[] = [];

    lines.push(`**Health:** ${analysis.health}`);
    lines.push('');

    if (analysis.goalProgress.length > 0) {
      lines.push('**Goal Progress:**');
      for (const g of analysis.goalProgress) {
        const progress =
          g.tasksTotal > 0
            ? `${g.tasksCompleted}/${g.tasksTotal} tasks`
            : 'no tasks yet';
        lines.push(`- ${g.goalId} (${g.status}): ${progress}`);
        if (g.tasksFailed > 0) {
          lines.push(`  - ${g.tasksFailed} failed tasks`);
        }
        if (g.blockers.length > 0) {
          lines.push(`  - Blockers: ${g.blockers.join(', ')}`);
        }
      }
      lines.push('');
    }

    if (analysis.recentFailures.length > 0) {
      lines.push('**Recent Failures:**');
      for (const f of analysis.recentFailures) {
        lines.push(`- [${f.goalId}] ${f.description}: ${f.failureReason}`);
      }
      lines.push('');
    }

    if (analysis.issues.length > 0) {
      lines.push('**Issues:**');
      for (const issue of analysis.issues) {
        const icon =
          issue.severity === 'critical'
            ? '!!'
            : issue.severity === 'warning'
              ? '!'
              : 'i';
        lines.push(`- [${icon}] ${issue.description}`);
        lines.push(`  Suggested: ${issue.suggestedAction}`);
      }
      lines.push('');
    }

    lines.push('**Cost:**');
    lines.push(`- Total: $${analysis.costSummary.totalCost.toFixed(4)}`);
    lines.push(
      `- Avg per task: $${analysis.costSummary.averageCostPerTask.toFixed(4)}`
    );

    return lines.join('\n');
  }

  private analyzeGoalProgress(goals: GoalState[]): GoalProgressEntry[] {
    return goals.map((g) => {
      const completedTasks = g.tasks.filter(
        (t) => t.status === 'converged'
      ).length;
      const failedTasks = g.tasks.filter(
        (t) => t.status === 'failed' || t.status === 'escalated'
      ).length;

      const blockers: string[] = [];
      if (g.status === 'blocked') {
        blockers.push('Goal is marked as blocked');
      }
      const escalatedTasks = g.tasks.filter((t) => t.status === 'escalated');
      for (const t of escalatedTasks) {
        blockers.push(`Task "${t.description}" was escalated`);
      }

      return {
        goalId: g.goalId,
        status: g.status,
        tasksTotal: g.tasks.length,
        tasksCompleted: completedTasks,
        tasksFailed: failedTasks,
        totalCost: g.totalCost,
        blockers,
      };
    });
  }

  private extractRecentFailures(goals: GoalState[]): FailureEntry[] {
    const failures: FailureEntry[] = [];

    for (const goal of goals) {
      for (const task of goal.tasks) {
        if (task.status === 'failed' || task.status === 'escalated') {
          failures.push({
            goalId: goal.goalId,
            taskId: task.id,
            description: task.description,
            failureReason:
              task.result?.summary ?? `Task ${task.status}`,
          });
        }
      }
    }

    return failures;
  }

  private detectIssues(
    state: OphanState,
    goalProgress: GoalProgressEntry[]
  ): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];

    // No goals defined
    if (state.goals.length === 0) {
      issues.push({
        severity: 'info',
        category: 'no_goals',
        description: 'No development goals defined',
        suggestedAction:
          'Create goals with `ophan goals add` or through conversation',
      });
    }

    // Blocked goals
    for (const g of goalProgress) {
      if (g.status === 'blocked') {
        issues.push({
          severity: 'warning',
          category: 'goal_blocked',
          description: `Goal "${g.goalId}" is blocked`,
          suggestedAction:
            'Review blockers and either resolve or abandon the goal',
        });
      }
    }

    // High failure rate
    if (state.metrics.totalTasks > 5 && state.metrics.successRate < 60) {
      issues.push({
        severity: 'critical',
        category: 'high_failure_rate',
        description: `Task success rate is ${state.metrics.successRate.toFixed(0)}%`,
        suggestedAction:
          'Review DevAgent guidelines and criteria for improvement opportunities',
      });
    }

    // Cost overrun
    if (state.metrics.totalCost > 10) {
      issues.push({
        severity: 'warning',
        category: 'cost_overrun',
        description: `Total cost has reached $${state.metrics.totalCost.toFixed(2)}`,
        suggestedAction: 'Consider adjusting cost limits or task granularity',
      });
    }

    return issues;
  }

  private computeHealth(
    metrics: OphanState['metrics'],
    issues: AnalysisIssue[]
  ): DevAgentAnalysis['health'] {
    const criticalCount = issues.filter(
      (i) => i.severity === 'critical'
    ).length;
    const warningCount = issues.filter(
      (i) => i.severity === 'warning'
    ).length;

    if (criticalCount > 0) return 'critical';
    if (warningCount > 1) return 'degraded';
    if (metrics.totalTasks > 0 && metrics.successRate < 70) return 'degraded';
    return 'healthy';
  }

  private computeCostSummary(
    goals: GoalState[],
    metrics: OphanState['metrics']
  ): CostSummary {
    const costPerGoal: Record<string, number> = {};
    for (const goal of goals) {
      costPerGoal[goal.goalId] = goal.totalCost;
    }

    return {
      totalCost: metrics.totalCost,
      costPerGoal,
      averageCostPerTask:
        metrics.totalTasks > 0
          ? metrics.totalCost / metrics.totalTasks
          : 0,
    };
  }
}
