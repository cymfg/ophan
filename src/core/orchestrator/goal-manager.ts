/**
 * Goal Lifecycle Manager
 *
 * Provides goal-aware intelligence: conflict detection, dependency
 * validation, retirement recommendations, and prioritization.
 * The ActionExecutor writes files; this manager reasons about
 * goal relationships.
 */

import type { OphanState } from '../../types/index.js';
import { loadGoalFiles, type ParsedGoalFile } from '../goal-parser.js';
import { runClaude, parseJsonResponse } from './claude-helper.js';
import type {
  GoalConflict,
  GoalRecommendation,
  GoalValidation,
  GoalCreationPayload,
} from './types.js';

export interface GoalManagerOptions {
  ophanDir: string;
  projectRoot: string;
}

export class GoalManager {
  private options: GoalManagerOptions;

  constructor(options: GoalManagerOptions) {
    this.options = options;
  }

  /**
   * Detect conflicts between existing goals.
   * Uses Claude (haiku) for semantic overlap detection.
   */
  async detectConflicts(
    goals: ParsedGoalFile[],
    state: OphanState
  ): Promise<GoalConflict[]> {
    if (goals.length < 2) return [];

    // Only analyze active goals
    const activeGoalIds = state.goals
      .filter((g) => !['completed', 'abandoned'].includes(g.status))
      .map((g) => g.goalId);
    const activeGoals = goals.filter((g) => activeGoalIds.includes(g.id));
    if (activeGoals.length < 2) return [];

    const goalSummaries = activeGoals
      .map(
        (g) =>
          `- ${g.id}: "${g.title}" — ${g.description?.slice(0, 150) ?? 'no description'}`
      )
      .join('\n');

    const prompt = `Analyze these development goals for conflicts or overlaps:

${goalSummaries}

Respond with ONLY a JSON object (no markdown fences):
{
  "conflicts": [
    {
      "goalA": "goal-id-1",
      "goalB": "goal-id-2",
      "type": "overlapping_scope | contradictory | dependency_cycle",
      "description": "brief explanation"
    }
  ]
}

Rules:
- "overlapping_scope": goals that would produce duplicate or redundant work
- "contradictory": goals whose outcomes conflict with each other
- "dependency_cycle": goal A depends on B which depends on A
- Only report clear, significant conflicts — not minor overlaps
- If no conflicts, return empty array`;

    try {
      const raw = await runClaude({
        prompt,
        projectRoot: this.options.projectRoot,
        model: 'haiku',
        maxTurns: 1,
      });

      const parsed = parseJsonResponse<{
        conflicts?: GoalConflict[];
      }>(raw);

      return parsed?.conflicts ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Suggest goals that should be retired, reprioritized, merged, or unblocked.
   */
  async suggestRetirements(
    goals: ParsedGoalFile[],
    state: OphanState
  ): Promise<GoalRecommendation[]> {
    const recommendations: GoalRecommendation[] = [];

    for (const goalState of state.goals) {
      const goalFile = goals.find((g) => g.id === goalState.goalId);

      // Stale: active goal with no task activity in a long time
      if (
        ['active', 'planned'].includes(goalState.status) &&
        goalState.tasks.length > 0
      ) {
        // Use startedAt as the reference timestamp for staleness
        const refDate = goalState.startedAt;

        if (refDate) {
          const daysSince =
            (Date.now() - new Date(refDate).getTime()) /
            (1000 * 60 * 60 * 24);
          if (daysSince > 14) {
            recommendations.push({
              type: 'retire',
              goalId: goalState.goalId,
              reason: `No task activity for ${Math.round(daysSince)} days`,
              suggestedAction: `Retire or reassess goal "${goalFile?.title ?? goalState.goalId}"`,
            });
          }
        }
      }

      // All tasks failed
      if (
        goalState.tasks.length > 0 &&
        goalState.tasks.every(
          (t) => t.status === 'failed' || t.status === 'escalated'
        ) &&
        !['completed', 'abandoned'].includes(goalState.status)
      ) {
        recommendations.push({
          type: 'unblock',
          goalId: goalState.goalId,
          reason: 'All tasks have failed',
          suggestedAction: `Review and redefine tasks for "${goalFile?.title ?? goalState.goalId}"`,
        });
      }

      // Blocked
      if (goalState.status === 'blocked') {
        recommendations.push({
          type: 'unblock',
          goalId: goalState.goalId,
          reason: 'Goal is blocked',
          suggestedAction: `Investigate and resolve blockers for "${goalFile?.title ?? goalState.goalId}"`,
        });
      }
    }

    return recommendations;
  }

  /**
   * Validate a proposed new goal against existing goals.
   * Checks for conflicts and provides suggestions.
   */
  async validateNewGoal(
    proposed: GoalCreationPayload,
    existingGoals: ParsedGoalFile[]
  ): Promise<GoalValidation> {
    if (existingGoals.length === 0) {
      return { valid: true, conflicts: [], suggestions: [] };
    }

    const existingSummaries = existingGoals
      .map(
        (g) =>
          `- ${g.id}: "${g.title}" — ${g.description?.slice(0, 100) ?? 'no description'}`
      )
      .join('\n');

    const prompt = `A new goal is being proposed. Check it against existing goals for conflicts.

Proposed goal:
- Title: "${proposed.title}"
- Description: "${proposed.description}"
- Acceptance criteria: ${proposed.acceptanceCriteria.join('; ')}

Existing goals:
${existingSummaries}

Respond with ONLY a JSON object (no markdown fences):
{
  "valid": true/false,
  "conflicts": [
    {
      "goalA": "proposed",
      "goalB": "existing-goal-id",
      "type": "overlapping_scope | contradictory",
      "description": "brief explanation"
    }
  ],
  "suggestions": ["suggestion 1", "suggestion 2"]
}

Rules:
- valid=false only if there's a clear contradictory conflict
- overlapping_scope still allows valid=true, but should be noted
- Suggestions might include: merge with existing goal, adjust scope, add dependency
- If no issues, return valid=true with empty arrays`;

    try {
      const raw = await runClaude({
        prompt,
        projectRoot: this.options.projectRoot,
        model: 'haiku',
        maxTurns: 1,
      });

      const parsed = parseJsonResponse<GoalValidation>(raw);

      return parsed ?? { valid: true, conflicts: [], suggestions: [] };
    } catch {
      return { valid: true, conflicts: [], suggestions: [] };
    }
  }

  /**
   * Get all recommendations (conflicts + retirements) for the current state.
   * Used by daemon cycle and proactive checks.
   */
  async getRecommendations(state: OphanState): Promise<GoalRecommendation[]> {
    const goalsDir = `${this.options.ophanDir}/goals`;
    let goalFiles: ParsedGoalFile[] = [];
    try {
      goalFiles = await loadGoalFiles(goalsDir);
    } catch {
      return [];
    }

    return this.suggestRetirements(goalFiles, state);
  }

  /**
   * Load current goal files from disk.
   */
  async loadGoals(): Promise<ParsedGoalFile[]> {
    const goalsDir = `${this.options.ophanDir}/goals`;
    try {
      return await loadGoalFiles(goalsDir);
    } catch {
      return [];
    }
  }
}
