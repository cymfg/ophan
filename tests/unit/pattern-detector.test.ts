import { describe, it, expect } from 'vitest';
import { PatternDetector } from '../../src/core/pattern-detector.js';
import type { Task, TaskLog, Evaluation } from '../../src/types/index.js';

describe('PatternDetector', () => {
  const detector = new PatternDetector({
    minOccurrences: 2,
    minConfidence: 0.3,
  });

  function createTaskLog(
    id: string,
    description: string,
    status: Task['status'],
    iterations: number,
    evaluation: Partial<Evaluation> = {}
  ) {
    const task: Task = {
      id,
      description,
      status,
      iterations,
      maxIterations: 5,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cost: 0.1,
      tokensUsed: 1000,
    };

    const log: TaskLog = {
      taskId: id,
      timestamp: new Date().toISOString(),
      iteration: iterations,
      action: 'completed',
      output: 'Task output',
      evaluation: {
        passed: evaluation.passed ?? true,
        criteria: evaluation.criteria ?? [],
        failures: evaluation.failures ?? [],
        score: evaluation.score ?? 100,
      },
    };

    return { task, logs: [log] };
  }

  describe('detectPatterns', () => {
    it('should return empty array when no patterns meet threshold', () => {
      const taskLogs = [
        createTaskLog('task-1', 'create file', 'converged', 1),
      ];

      const patterns = detector.detectPatterns(taskLogs);
      expect(patterns).toHaveLength(0);
    });

    it('should detect failure patterns', () => {
      const taskLogs = [
        createTaskLog('task-1', 'fix bug', 'failed', 3, {
          passed: false,
          failures: [
            { criterion: 'Tests', message: 'Test failed', severity: 'error' },
          ],
        }),
        createTaskLog('task-2', 'fix another bug', 'failed', 2, {
          passed: false,
          failures: [
            { criterion: 'Tests', message: 'Test failed', severity: 'error' },
          ],
        }),
      ];

      const patterns = detector.detectPatterns(taskLogs);
      const failurePatterns = patterns.filter((p) => p.type === 'failure');

      expect(failurePatterns.length).toBeGreaterThan(0);
      expect(failurePatterns[0].signature).toContain('test');
    });

    it('should detect success patterns', () => {
      const taskLogs = [
        createTaskLog('task-1', 'create file', 'converged', 1, { score: 95 }),
        createTaskLog('task-2', 'create another file', 'converged', 1, {
          score: 92,
        }),
        createTaskLog('task-3', 'create third file', 'converged', 1, {
          score: 98,
        }),
      ];

      // Need to lower threshold for this test
      const lowThresholdDetector = new PatternDetector({
        minOccurrences: 2,
        minConfidence: 0.5,
      });

      const patterns = lowThresholdDetector.detectPatterns(taskLogs);
      const successPatterns = patterns.filter((p) => p.type === 'success');

      expect(successPatterns.length).toBeGreaterThan(0);
    });

    it('should not detect patterns below occurrence threshold', () => {
      const highThresholdDetector = new PatternDetector({
        minOccurrences: 10,
        minConfidence: 0.5,
      });

      const taskLogs = [
        createTaskLog('task-1', 'fix bug', 'failed', 3, {
          passed: false,
          failures: [
            { criterion: 'Tests', message: 'Test failed', severity: 'error' },
          ],
        }),
        createTaskLog('task-2', 'fix another bug', 'failed', 2, {
          passed: false,
          failures: [
            { criterion: 'Tests', message: 'Test failed', severity: 'error' },
          ],
        }),
      ];

      const patterns = highThresholdDetector.detectPatterns(taskLogs);
      expect(patterns).toHaveLength(0);
    });
  });

  describe('formatPatterns', () => {
    it('should format empty patterns', () => {
      const formatted = detector.formatPatterns([]);
      expect(formatted).toContain('No significant patterns detected');
    });

    it('should format patterns by type', () => {
      const patterns = [
        {
          type: 'failure' as const,
          signature: 'Test failure',
          occurrences: 5,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          affectedTasks: ['task-1', 'task-2'],
          confidence: 0.8,
          suggestedAction: {
            target: 'guideline' as const,
            file: 'testing.md',
            change: 'Update testing workflow',
          },
        },
        {
          type: 'success' as const,
          signature: 'Quick convergence',
          occurrences: 10,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          affectedTasks: ['task-3', 'task-4'],
          confidence: 0.9,
        },
      ];

      const formatted = detector.formatPatterns(patterns);

      expect(formatted).toContain('Failure Patterns');
      expect(formatted).toContain('Success Patterns');
      expect(formatted).toContain('Test failure');
      expect(formatted).toContain('Quick convergence');
    });
  });
});
