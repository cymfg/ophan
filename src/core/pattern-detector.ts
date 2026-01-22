import type { Pattern, TaskLog, Task, EvaluationFailure } from '../types/index.js';

export interface PatternDetectorOptions {
  minOccurrences: number;
  minConfidence: number;
}

export interface TaskLogEntry {
  task: Task;
  logs: TaskLog[];
}

/**
 * Detects patterns across task execution logs
 * - Failure patterns: recurring errors or test failures
 * - Iteration patterns: tasks that consistently need multiple iterations
 * - Success patterns: approaches that work well
 */
export class PatternDetector {
  private options: PatternDetectorOptions;

  constructor(options: PatternDetectorOptions) {
    this.options = options;
  }

  /**
   * Analyze task logs and detect patterns
   */
  detectPatterns(taskLogs: TaskLogEntry[]): Pattern[] {
    const patterns: Pattern[] = [];

    // Detect failure patterns
    const failurePatterns = this.detectFailurePatterns(taskLogs);
    patterns.push(...failurePatterns);

    // Detect iteration patterns
    const iterationPatterns = this.detectIterationPatterns(taskLogs);
    patterns.push(...iterationPatterns);

    // Detect success patterns
    const successPatterns = this.detectSuccessPatterns(taskLogs);
    patterns.push(...successPatterns);

    // Filter by thresholds
    return patterns.filter(
      (p) =>
        p.occurrences >= this.options.minOccurrences &&
        p.confidence >= this.options.minConfidence
    );
  }

  /**
   * Detect recurring failure patterns
   */
  private detectFailurePatterns(taskLogs: TaskLogEntry[]): Pattern[] {
    const failureSignatures = new Map<
      string,
      {
        occurrences: number;
        firstSeen: string;
        lastSeen: string;
        affectedTasks: string[];
        failures: EvaluationFailure[];
      }
    >();

    for (const entry of taskLogs) {
      for (const log of entry.logs) {
        if (!log.evaluation.passed && log.evaluation.failures.length > 0) {
          for (const failure of log.evaluation.failures) {
            const signature = this.normalizeFailureSignature(failure);

            if (!failureSignatures.has(signature)) {
              failureSignatures.set(signature, {
                occurrences: 0,
                firstSeen: log.timestamp,
                lastSeen: log.timestamp,
                affectedTasks: [],
                failures: [],
              });
            }

            const data = failureSignatures.get(signature)!;
            data.occurrences++;
            data.lastSeen = log.timestamp;
            if (!data.affectedTasks.includes(entry.task.id)) {
              data.affectedTasks.push(entry.task.id);
            }
            data.failures.push(failure);
          }
        }
      }
    }

    const patterns: Pattern[] = [];

    for (const [signature, data] of failureSignatures) {
      // Calculate confidence based on consistency
      const confidence = Math.min(
        1,
        data.occurrences / Math.max(taskLogs.length, 1)
      );

      patterns.push({
        type: 'failure',
        signature,
        occurrences: data.occurrences,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        affectedTasks: data.affectedTasks,
        confidence,
        suggestedAction: this.suggestActionForFailure(signature, data.failures),
      });
    }

    return patterns;
  }

  /**
   * Detect tasks that consistently require multiple iterations
   */
  private detectIterationPatterns(taskLogs: TaskLogEntry[]): Pattern[] {
    const patterns: Pattern[] = [];

    // Group by task description similarity
    const taskGroups = this.groupSimilarTasks(taskLogs);

    for (const [signature, tasks] of taskGroups) {
      const avgIterations =
        tasks.reduce((sum, t) => sum + t.task.iterations, 0) / tasks.length;

      // Only flag if consistently taking more than 1 iteration
      if (avgIterations > 1.5 && tasks.length >= 2) {
        const confidence = Math.min(1, tasks.length / 5);

        patterns.push({
          type: 'iteration',
          signature: `High iteration count for: ${signature}`,
          occurrences: tasks.length,
          firstSeen: tasks[0].task.startedAt,
          lastSeen: tasks[tasks.length - 1].task.startedAt,
          affectedTasks: tasks.map((t) => t.task.id),
          confidence,
          suggestedAction: {
            target: 'guideline',
            file: 'coding.md',
            change: `Add guidance for handling "${signature}" tasks more efficiently. Average iterations: ${avgIterations.toFixed(1)}`,
          },
        });
      }
    }

    // Also detect tasks hitting max iterations
    const maxIterationTasks = taskLogs.filter(
      (t) => t.task.iterations >= t.task.maxIterations
    );

    if (maxIterationTasks.length >= this.options.minOccurrences) {
      patterns.push({
        type: 'iteration',
        signature: 'Tasks reaching maximum iteration limit',
        occurrences: maxIterationTasks.length,
        firstSeen: maxIterationTasks[0].task.startedAt,
        lastSeen: maxIterationTasks[maxIterationTasks.length - 1].task.startedAt,
        affectedTasks: maxIterationTasks.map((t) => t.task.id),
        confidence: maxIterationTasks.length / taskLogs.length,
        suggestedAction: {
          target: 'guideline',
          file: 'coding.md',
          change:
            'Review workflow for complex tasks. Consider breaking down into smaller subtasks.',
        },
      });
    }

    return patterns;
  }

  /**
   * Detect patterns that lead to successful outcomes
   */
  private detectSuccessPatterns(taskLogs: TaskLogEntry[]): Pattern[] {
    const patterns: Pattern[] = [];

    // Find tasks that converged quickly (1 iteration)
    const quickSuccesses = taskLogs.filter(
      (t) => t.task.status === 'converged' && t.task.iterations === 1
    );

    if (quickSuccesses.length >= this.options.minOccurrences) {
      // Analyze what made them successful
      const commonTraits = this.analyzeSuccessTraits(quickSuccesses);

      if (commonTraits) {
        patterns.push({
          type: 'success',
          signature: `Quick convergence pattern: ${commonTraits}`,
          occurrences: quickSuccesses.length,
          firstSeen: quickSuccesses[0].task.startedAt,
          lastSeen: quickSuccesses[quickSuccesses.length - 1].task.startedAt,
          affectedTasks: quickSuccesses.map((t) => t.task.id),
          confidence: quickSuccesses.length / taskLogs.length,
        });
      }
    }

    // Find high-score completions
    const highScoreTasks = taskLogs.filter((t) => {
      const lastLog = t.logs[t.logs.length - 1];
      return lastLog && lastLog.evaluation.score >= 90;
    });

    if (highScoreTasks.length >= this.options.minOccurrences) {
      patterns.push({
        type: 'success',
        signature: 'High quality completions (score >= 90)',
        occurrences: highScoreTasks.length,
        firstSeen: highScoreTasks[0].task.startedAt,
        lastSeen: highScoreTasks[highScoreTasks.length - 1].task.startedAt,
        affectedTasks: highScoreTasks.map((t) => t.task.id),
        confidence: highScoreTasks.length / taskLogs.length,
      });
    }

    return patterns;
  }

  /**
   * Normalize a failure into a signature for grouping
   */
  private normalizeFailureSignature(failure: EvaluationFailure): string {
    // Extract key parts of the failure
    const criterion = failure.criterion.toLowerCase();
    const message = failure.message
      .toLowerCase()
      // Remove file-specific paths
      .replace(/\/[^\s]+/g, '<path>')
      // Remove line numbers
      .replace(/line \d+/g, 'line <n>')
      .replace(/:\d+:\d+/g, ':<n>:<n>')
      // Remove specific variable names in common patterns
      .replace(/'\w+'/g, "'<name>'")
      .trim();

    return `${criterion}: ${message.slice(0, 100)}`;
  }

  /**
   * Group tasks by description similarity
   */
  private groupSimilarTasks(
    taskLogs: TaskLogEntry[]
  ): Map<string, TaskLogEntry[]> {
    const groups = new Map<string, TaskLogEntry[]>();

    for (const entry of taskLogs) {
      // Extract key verbs/actions from description
      const signature = this.extractTaskSignature(entry.task.description);

      if (!groups.has(signature)) {
        groups.set(signature, []);
      }
      groups.get(signature)!.push(entry);
    }

    return groups;
  }

  /**
   * Extract a normalized signature from a task description
   */
  private extractTaskSignature(description: string): string {
    const lower = description.toLowerCase();

    // Extract the main action verb
    const actionVerbs = [
      'create',
      'add',
      'fix',
      'update',
      'refactor',
      'remove',
      'delete',
      'implement',
      'write',
      'build',
      'test',
    ];

    for (const verb of actionVerbs) {
      if (lower.includes(verb)) {
        // Get the first few words after the verb
        const match = lower.match(new RegExp(`${verb}\\s+(?:a\\s+)?([\\w\\s]{1,30})`));
        if (match) {
          return `${verb} ${match[1].trim()}`;
        }
        return verb;
      }
    }

    // Fallback: first few words
    return lower.split(/\s+/).slice(0, 3).join(' ');
  }

  /**
   * Analyze what makes tasks succeed quickly
   */
  private analyzeSuccessTraits(tasks: TaskLogEntry[]): string | null {
    if (tasks.length === 0) return null;

    // Check for common task types
    const signatures = tasks.map((t) =>
      this.extractTaskSignature(t.task.description)
    );
    const signatureCounts = new Map<string, number>();

    for (const sig of signatures) {
      signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1);
    }

    // Find most common signature
    let maxCount = 0;
    let mostCommon = '';
    for (const [sig, count] of signatureCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = sig;
      }
    }

    if (maxCount >= 2) {
      return mostCommon;
    }

    return 'Simple, well-defined tasks';
  }

  /**
   * Suggest an action to address a failure pattern
   */
  private suggestActionForFailure(
    signature: string,
    _failures: EvaluationFailure[]
  ): Pattern['suggestedAction'] {
    const lowerSig = signature.toLowerCase();

    // TypeScript errors
    if (lowerSig.includes('typescript') || lowerSig.includes('ts')) {
      return {
        target: 'guideline',
        file: 'coding.md',
        change:
          'Add reminder to run type checking before completing tasks. Consider adding TypeScript-specific error handling patterns.',
      };
    }

    // Test failures
    if (lowerSig.includes('test') || lowerSig.includes('fail')) {
      return {
        target: 'guideline',
        file: 'testing.md',
        change:
          'Review testing workflow. Ensure tests are run and analyzed before marking task complete.',
      };
    }

    // Lint errors
    if (lowerSig.includes('lint') || lowerSig.includes('eslint')) {
      return {
        target: 'guideline',
        file: 'coding.md',
        change:
          'Add step to run linter before completing tasks. Document common lint rules to follow.',
      };
    }

    // Build failures
    if (lowerSig.includes('build') || lowerSig.includes('compile')) {
      return {
        target: 'guideline',
        file: 'coding.md',
        change:
          'Verify build succeeds before completing tasks. Check for import errors and missing dependencies.',
      };
    }

    // Default suggestion
    return {
      target: 'guideline',
      file: 'learnings.md',
      change: `Document resolution for: ${signature}`,
    };
  }

  /**
   * Format patterns for display
   */
  formatPatterns(patterns: Pattern[]): string {
    if (patterns.length === 0) {
      return 'No significant patterns detected.';
    }

    const lines: string[] = ['## Detected Patterns\n'];

    const byType = {
      failure: patterns.filter((p) => p.type === 'failure'),
      iteration: patterns.filter((p) => p.type === 'iteration'),
      success: patterns.filter((p) => p.type === 'success'),
    };

    if (byType.failure.length > 0) {
      lines.push('### Failure Patterns\n');
      for (const p of byType.failure) {
        lines.push(
          `- **${p.signature}** (${p.occurrences} occurrences, ${(p.confidence * 100).toFixed(0)}% confidence)`
        );
        if (p.suggestedAction) {
          lines.push(
            `  - Suggested: Update ${p.suggestedAction.file} - ${p.suggestedAction.change}`
          );
        }
      }
      lines.push('');
    }

    if (byType.iteration.length > 0) {
      lines.push('### Iteration Patterns\n');
      for (const p of byType.iteration) {
        lines.push(
          `- **${p.signature}** (${p.occurrences} tasks, ${(p.confidence * 100).toFixed(0)}% confidence)`
        );
        if (p.suggestedAction) {
          lines.push(
            `  - Suggested: Update ${p.suggestedAction.file} - ${p.suggestedAction.change}`
          );
        }
      }
      lines.push('');
    }

    if (byType.success.length > 0) {
      lines.push('### Success Patterns\n');
      for (const p of byType.success) {
        lines.push(
          `- **${p.signature}** (${p.occurrences} tasks, ${(p.confidence * 100).toFixed(0)}% confidence)`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
