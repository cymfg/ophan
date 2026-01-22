import { promises as fs } from 'fs';
import path from 'path';
import type { Task, TaskLog, Learning, OphanMetrics } from '../types/index.js';

export interface TaskLoggerOptions {
  ophanDir: string;
}

/**
 * Manages task logs and metrics persistence
 */
export class TaskLogger {
  private logsDir: string;
  private ophanDir: string;

  constructor(options: TaskLoggerOptions) {
    this.ophanDir = options.ophanDir;
    this.logsDir = path.join(options.ophanDir, 'logs');
  }

  /**
   * Ensure logs directory exists
   */
  async init(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  /**
   * Save task execution log
   */
  async saveTaskLog(task: Task, logs: TaskLog[]): Promise<string> {
    const logFile = path.join(this.logsDir, `${task.id}.json`);

    const logEntry = {
      task,
      logs,
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(logFile, JSON.stringify(logEntry, null, 2), 'utf-8');
    return logFile;
  }

  /**
   * Load a task log by ID
   */
  async loadTaskLog(
    taskId: string
  ): Promise<{ task: Task; logs: TaskLog[] } | null> {
    const logFile = path.join(this.logsDir, `${taskId}.json`);

    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const parsed = JSON.parse(content);
      return { task: parsed.task, logs: parsed.logs };
    } catch {
      return null;
    }
  }

  /**
   * List recent task logs
   */
  async listRecentLogs(limit: number = 10): Promise<Task[]> {
    try {
      const files = await fs.readdir(this.logsDir);
      const jsonFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit);

      const tasks: Task[] = [];

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(
            path.join(this.logsDir, file),
            'utf-8'
          );
          const parsed = JSON.parse(content);
          tasks.push(parsed.task);
        } catch {
          // Skip invalid files
        }
      }

      return tasks;
    } catch {
      return [];
    }
  }

  /**
   * Calculate metrics from task logs
   */
  async calculateMetrics(lookbackDays: number = 30): Promise<OphanMetrics> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const tasks = await this.loadAllTasksSince(cutoffDate);

    const metrics: OphanMetrics = {
      totalTasks: tasks.length,
      successfulTasks: 0,
      failedTasks: 0,
      escalatedTasks: 0,
      successRate: 0,
      averageIterations: 0,
      maxIterationsHit: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      averageCostPerTask: 0,
      averageTaskDuration: 0,
      totalTimeSpent: 0,
      totalLearnings: 0,
      learningsPromoted: 0,
      patternsDetected: 0,
      periodStart: cutoffDate.toISOString(),
      periodEnd: new Date().toISOString(),
    };

    if (tasks.length === 0) {
      return metrics;
    }

    let totalIterations = 0;
    let totalDuration = 0;

    for (const task of tasks) {
      // Count by status
      switch (task.status) {
        case 'converged':
          metrics.successfulTasks++;
          break;
        case 'failed':
          metrics.failedTasks++;
          break;
        case 'escalated':
          metrics.escalatedTasks++;
          break;
      }

      // Iterations
      totalIterations += task.iterations;
      if (task.iterations >= task.maxIterations) {
        metrics.maxIterationsHit++;
      }

      // Tokens and cost
      metrics.totalTokensUsed += task.tokensUsed;
      metrics.totalCost += task.cost;

      // Duration
      if (task.completedAt) {
        const duration =
          new Date(task.completedAt).getTime() -
          new Date(task.startedAt).getTime();
        totalDuration += duration;
      }
    }

    metrics.successRate =
      tasks.length > 0
        ? (metrics.successfulTasks / tasks.length) * 100
        : 0;
    metrics.averageIterations = tasks.length > 0 ? totalIterations / tasks.length : 0;
    metrics.averageCostPerTask =
      tasks.length > 0 ? metrics.totalCost / tasks.length : 0;
    metrics.averageTaskDuration =
      tasks.length > 0 ? totalDuration / tasks.length / 1000 : 0; // seconds
    metrics.totalTimeSpent = totalDuration / 1000; // seconds

    return metrics;
  }

  /**
   * Load all tasks since a given date
   */
  private async loadAllTasksSince(since: Date): Promise<Task[]> {
    try {
      const files = await fs.readdir(this.logsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      const tasks: Task[] = [];

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(
            path.join(this.logsDir, file),
            'utf-8'
          );
          const parsed = JSON.parse(content);
          const task: Task = parsed.task;

          if (new Date(task.startedAt) >= since) {
            tasks.push(task);
          }
        } catch {
          // Skip invalid files
        }
      }

      return tasks;
    } catch {
      return [];
    }
  }

  /**
   * Save a learning to the learnings file
   */
  async saveLearning(learning: Learning): Promise<void> {
    const learningsFile = path.join(
      this.ophanDir,
      'guidelines',
      'learnings.md'
    );

    try {
      let content = '';
      try {
        content = await fs.readFile(learningsFile, 'utf-8');
      } catch {
        content = '# Learnings\n\nAutomatically extracted learnings from task execution.\n\n';
      }

      const learningEntry = `
## Learning: ${learning.id}

**Context:** ${learning.context}
**Issue:** ${learning.issue}
**Resolution:** ${learning.resolution}
**Guideline Impact:** ${learning.guidelineImpact}

---
`;

      content += learningEntry;
      await fs.writeFile(learningsFile, content, 'utf-8');
    } catch {
      // Log error but don't fail
    }
  }

  /**
   * Format task for display
   */
  formatTask(task: Task): string {
    const statusIcon =
      task.status === 'converged'
        ? '✓'
        : task.status === 'escalated'
          ? '⚠'
          : task.status === 'failed'
            ? '✗'
            : '○';

    const duration = task.completedAt
      ? Math.round(
          (new Date(task.completedAt).getTime() -
            new Date(task.startedAt).getTime()) /
            1000
        )
      : 0;

    return `${statusIcon} ${task.id} (${task.iterations} iter, ${duration}s, $${task.cost.toFixed(4)})
   ${task.description.slice(0, 60)}${task.description.length > 60 ? '...' : ''}`;
  }

  /**
   * Format metrics for display
   */
  formatMetrics(metrics: OphanMetrics): string {
    const lines: string[] = [];

    lines.push('## Tasks');
    lines.push(`  Total:      ${metrics.totalTasks}`);
    lines.push(
      `  Successful: ${metrics.successfulTasks} (${metrics.successRate.toFixed(1)}%)`
    );
    lines.push(`  Failed:     ${metrics.failedTasks}`);
    lines.push(`  Escalated:  ${metrics.escalatedTasks}`);
    lines.push('');
    lines.push('## Iterations');
    lines.push(`  Average:    ${metrics.averageIterations.toFixed(1)} per task`);
    lines.push(`  Max hits:   ${metrics.maxIterationsHit} tasks reached limit`);
    lines.push('');
    lines.push('## Cost');
    lines.push(`  Total:      $${metrics.totalCost.toFixed(4)}`);
    lines.push(`  Per task:   $${metrics.averageCostPerTask.toFixed(4)} avg`);
    lines.push('');
    lines.push('## Time');
    lines.push(`  Total:      ${this.formatDuration(metrics.totalTimeSpent)}`);
    lines.push(`  Per task:   ${this.formatDuration(metrics.averageTaskDuration)} avg`);

    return lines.join('\n');
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      return `${Math.round(seconds / 60)}m`;
    } else {
      return `${(seconds / 3600).toFixed(1)}h`;
    }
  }
}
