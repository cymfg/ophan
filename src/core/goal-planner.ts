/**
 * Goal Planner
 *
 * Uses Claude to decompose goals into executable tasks and
 * assess whether goal acceptance criteria are satisfied.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import type { Goal, GoalTask, OphanConfig } from '../types/index.js';
import { parseJsonResponse } from './orchestrator/claude-helper.js';

export interface GoalPlannerOptions {
  projectRoot: string;
  ophanDir: string;
  config: OphanConfig;
  onProgress?: (message: string) => void;
}

export interface GoalAssessment {
  complete: boolean;
  remainingCriteria: string[];
  confidence: number;
}

/**
 * The planner's decision about what to do next.
 */
export type PlanDecision =
  | { action: 'plan_goal'; goalId: string; reason: string }
  | { action: 'execute_task'; goalId: string; task: GoalTask; reason: string }
  | { action: 'idle'; reason: string }
  | { action: 'blocked'; goalId: string; reason: string };

/**
 * Find the Claude Code executable path
 */
function findClaudeCodeExecutable(): string | undefined {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const paths = result.trim().split('\n').filter(p => p.trim());
      const nonNodeModules = paths.filter(p => !p.includes('node_modules'));
      return nonNodeModules[0] || paths[0] || undefined;
    } else {
      const result = execSync('which -a claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const paths = result.trim().split('\n').filter(p => p.trim());
      const nonNodeModules = paths.filter(p => !p.includes('node_modules'));
      return nonNodeModules[0] || paths[0] || undefined;
    }
  } catch {
    return undefined;
  }
}

export class GoalPlanner {
  private options: GoalPlannerOptions;

  constructor(options: GoalPlannerOptions) {
    this.options = options;
  }

  /**
   * Decide what to do next based on current goals.
   * This is deterministic — no LLM calls.
   */
  plan(goals: Goal[]): PlanDecision {
    // Filter to active goals (not completed or abandoned)
    const activeGoals = goals
      .filter((g) => !['completed', 'abandoned'].includes(g.status))
      .sort((a, b) => a.priority - b.priority);

    if (activeGoals.length === 0) {
      return { action: 'idle', reason: 'No active goals' };
    }

    // Check for goals that need planning (pending status, no tasks)
    const needsPlanning = activeGoals.filter(
      (g) => g.status === 'pending' || (g.status === 'planning' && g.tasks.length === 0)
    );

    if (needsPlanning.length > 0) {
      const goal = needsPlanning[0];
      return {
        action: 'plan_goal',
        goalId: goal.id,
        reason: `Goal "${goal.title}" needs task decomposition`,
      };
    }

    // Check for goals with pending tasks
    for (const goal of activeGoals) {
      const nextTask = this.findNextTask(goal);
      if (nextTask) {
        return {
          action: 'execute_task',
          goalId: goal.id,
          task: nextTask,
          reason: `Next task for "${goal.title}": ${nextTask.description}`,
        };
      }
    }

    // Check if all active goals are blocked
    const blockedGoals = activeGoals.filter((g) => g.status === 'blocked');
    if (blockedGoals.length > 0) {
      return {
        action: 'blocked',
        goalId: blockedGoals[0].id,
        reason: `Goal "${blockedGoals[0].title}" is blocked`,
      };
    }

    // All active goals have all tasks completed — might need reassessment
    return { action: 'idle', reason: 'All tasks completed, goals may need reassessment' };
  }

  /**
   * Find the next executable task in a goal.
   * Respects ordering and dependencies.
   */
  private findNextTask(goal: Goal): GoalTask | undefined {
    const completedIds = new Set(
      goal.tasks.filter((t) => t.status === 'converged').map((t) => t.id)
    );

    return goal.tasks
      .filter((t) => t.status === 'pending')
      .sort((a, b) => a.order - b.order)
      .find((t) => {
        // Check that all dependencies are satisfied
        if (t.dependsOn && t.dependsOn.length > 0) {
          return t.dependsOn.every((depId) => completedIds.has(depId));
        }
        return true;
      });
  }

  /**
   * Decompose a goal into executable tasks using Claude.
   * Reads the goal description and acceptance criteria to generate
   * a task plan that the inner loop can execute.
   */
  async decomposeGoal(goal: Goal, guidelines: string): Promise<GoalTask[]> {
    this.log(`Decomposing goal "${goal.title}" into tasks...`);

    const prompt = this.buildDecompositionPrompt(goal, guidelines);
    const response = await this.runClaude(prompt);
    const tasks = this.parseDecompositionResponse(response, goal.id);

    this.log(`Decomposed into ${tasks.length} tasks`);
    return tasks;
  }

  /**
   * Assess whether a goal's acceptance criteria are satisfied.
   */
  async assessGoalCompletion(goal: Goal): Promise<GoalAssessment> {
    this.log(`Assessing completion of goal "${goal.title}"...`);

    const completedTasks = goal.tasks.filter((t) => t.status === 'converged');
    if (completedTasks.length === 0) {
      return {
        complete: false,
        remainingCriteria: goal.acceptanceCriteria,
        confidence: 0,
      };
    }

    const prompt = this.buildAssessmentPrompt(goal, completedTasks);
    const response = await this.runClaude(prompt);
    return this.parseAssessmentResponse(response, goal);
  }

  /**
   * Check whether all goals are in a terminal state (idle detection).
   */
  isIdle(goals: Goal[]): { idle: boolean; reason: string } {
    const activeGoals = goals.filter(
      (g) => !['completed', 'abandoned'].includes(g.status)
    );

    if (activeGoals.length === 0) {
      return { idle: true, reason: 'No active goals' };
    }

    const allBlocked = activeGoals.every((g) => g.status === 'blocked');
    if (allBlocked) {
      return { idle: true, reason: `All ${activeGoals.length} active goals are blocked` };
    }

    // Check for pending tasks
    const pendingTasks = activeGoals.flatMap((g) =>
      g.tasks.filter((t) => t.status === 'pending')
    );

    if (pendingTasks.length === 0 && activeGoals.every((g) => g.tasks.length > 0)) {
      return { idle: false, reason: 'All tasks completed, goals need reassessment' };
    }

    return { idle: false, reason: `${pendingTasks.length} tasks pending` };
  }

  private buildDecompositionPrompt(goal: Goal, guidelines: string): string {
    return `You are a development planner. Decompose the following goal into concrete, executable tasks.

## Goal: ${goal.title}

${goal.description}

## Acceptance Criteria

${goal.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}

## Planning Guidelines

${guidelines}

## Instructions

Create a list of tasks to accomplish this goal. For each task:
1. Write a clear, actionable description (this will be given to a coding agent)
2. Specify the order (integer, starting from 1)
3. List any task dependencies (by order number)
4. Explain the rationale briefly

Respond with ONLY a JSON object (no markdown fences):
{
  "tasks": [
    {
      "description": "...",
      "order": 1,
      "dependsOn": [],
      "rationale": "..."
    }
  ]
}

Keep tasks small and focused. Each task should be completable by a coding agent in 1-3 iterations. Prefer more smaller tasks over fewer large ones.`;
  }

  private buildAssessmentPrompt(goal: Goal, completedTasks: GoalTask[]): string {
    return `Assess whether the following goal's acceptance criteria are met based on the completed tasks.

## Goal: ${goal.title}

${goal.description}

## Acceptance Criteria

${goal.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Completed Tasks

${completedTasks.map((t) => `- ${t.description}: ${t.result?.summary ?? 'completed'}`).join('\n')}

## Instructions

For each acceptance criterion, assess whether it is likely met based on the completed tasks.

Respond with ONLY a JSON object (no markdown fences):
{
  "assessments": [
    { "criterion": "...", "met": true, "evidence": "..." }
  ],
  "allMet": true,
  "confidence": 0.85
}`;
  }

  private parseDecompositionResponse(response: string, goalId: string): GoalTask[] {
    try {
      const data = parseJsonResponse<{
        tasks: Array<{
          description: string;
          order: number;
          dependsOn?: number[];
          rationale: string;
        }>;
      }>(response);

      if (!data?.tasks) throw new Error('No tasks found in response');

      return data.tasks.map((t, index) => {
        const taskId = `${goalId}-task-${(index + 1).toString().padStart(2, '0')}`;
        return {
          id: taskId,
          goalId,
          description: t.description,
          order: t.order,
          status: 'pending' as const,
          rationale: t.rationale,
          dependsOn: t.dependsOn?.map(
            (dep) => `${goalId}-task-${dep.toString().padStart(2, '0')}`
          ),
        };
      });
    } catch (error) {
      this.log(`Failed to parse decomposition: ${(error as Error).message}`);
      return [];
    }
  }

  private parseAssessmentResponse(response: string, goal: Goal): GoalAssessment {
    try {
      const data = parseJsonResponse<{
        assessments: Array<{ criterion: string; met: boolean; evidence: string }>;
        allMet: boolean;
        confidence: number;
      }>(response);

      if (!data?.assessments) throw new Error('No assessments found in response');

      const remaining = data.assessments
        .filter((a) => !a.met)
        .map((a) => a.criterion);

      return {
        complete: data.allMet,
        remainingCriteria: remaining,
        confidence: data.confidence,
      };
    } catch (error) {
      this.log(`Failed to parse assessment: ${(error as Error).message}`);
      return {
        complete: false,
        remainingCriteria: goal.acceptanceCriteria,
        confidence: 0,
      };
    }
  }

  private async runClaude(prompt: string): Promise<string> {
    const claudeExecutable = findClaudeCodeExecutable();
    if (!claudeExecutable) {
      throw new Error('Claude Code executable not found');
    }

    // Filter out ANTHROPIC_API_KEY to force subscription auth
    const filteredEnv: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== 'ANTHROPIC_API_KEY') {
        filteredEnv[key] = value;
      }
    }

    const claudeCodeConfig = this.options.config.claudeCode ?? {
      model: 'sonnet' as const,
      permissionMode: 'default' as const,
      allowedTools: [],
      maxTurns: 5,
    };

    let output = '';

    for await (const message of query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: claudeExecutable,
        allowedTools: [],
        permissionMode: 'default',
        model: claudeCodeConfig.model,
        cwd: this.options.projectRoot,
        maxTurns: 5,
        env: filteredEnv,
      },
    })) {
      if (message.type === 'assistant') {
        const assistantMsg = message as {
          type: 'assistant';
          message?: { content?: Array<{ type: string; text?: string }> };
        };
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text' && block.text) {
              output += block.text;
            }
          }
        }
      } else if (message.type === 'result') {
        const result = message as { type: 'result'; result?: string };
        if (result.result) {
          output += result.result;
        }
      }
    }

    return output;
  }

  private log(message: string): void {
    this.options.onProgress?.(message);
  }
}
