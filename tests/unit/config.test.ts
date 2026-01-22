import { describe, it, expect } from 'vitest';
import { OphanConfigSchema, DEFAULT_CONFIG } from '../../src/types/config.js';
import { OphanStateSchema, createInitialState } from '../../src/types/state.js';

describe('OphanConfigSchema', () => {
  it('should parse empty config with defaults', () => {
    const result = OphanConfigSchema.parse({});
    expect(result.model.name).toBe('claude-sonnet-4-20250514');
    expect(result.innerLoop.maxIterations).toBe(5);
    expect(result.innerLoop.regenerationStrategy).toBe('informed');
  });

  it('should parse full config', () => {
    const config = {
      model: {
        name: 'claude-opus-4-20250514',
        maxTokens: 8192,
      },
      innerLoop: {
        maxIterations: 10,
        regenerationStrategy: 'full' as const,
        costLimit: 0.5,
      },
      outerLoop: {
        triggers: {
          afterTasks: 20,
        },
        minOccurrences: 5,
        minConfidence: 0.8,
      },
    };

    const result = OphanConfigSchema.parse(config);
    expect(result.model.name).toBe('claude-opus-4-20250514');
    expect(result.innerLoop.maxIterations).toBe(10);
    expect(result.innerLoop.regenerationStrategy).toBe('full');
    expect(result.innerLoop.costLimit).toBe(0.5);
    expect(result.outerLoop.triggers.afterTasks).toBe(20);
  });

  it('should reject invalid regeneration strategy', () => {
    const config = {
      innerLoop: {
        regenerationStrategy: 'invalid',
      },
    };

    expect(() => OphanConfigSchema.parse(config)).toThrow();
  });

  it('should have sensible defaults', () => {
    expect(DEFAULT_CONFIG.model.maxTokens).toBe(4096);
    expect(DEFAULT_CONFIG.outerLoop.triggers.afterTasks).toBe(10);
    expect(DEFAULT_CONFIG.guardrails.protectedPaths).toContain('.ophan/criteria/**');
  });

  it('should default to api backend', () => {
    const result = OphanConfigSchema.parse({});
    expect(result.execution.backend).toBe('api');
  });

  it('should parse claude-code backend configuration', () => {
    const config = {
      execution: {
        backend: 'claude-code' as const,
        claudeCode: {
          model: 'opus' as const,
          permissionMode: 'bypassPermissions' as const,
          allowedTools: ['Read', 'Write', 'Bash'],
          maxTurns: 100,
        },
      },
    };

    const result = OphanConfigSchema.parse(config);
    expect(result.execution.backend).toBe('claude-code');
    expect(result.execution.claudeCode.model).toBe('opus');
    expect(result.execution.claudeCode.permissionMode).toBe('bypassPermissions');
    expect(result.execution.claudeCode.allowedTools).toEqual(['Read', 'Write', 'Bash']);
    expect(result.execution.claudeCode.maxTurns).toBe(100);
  });

  it('should have sensible claude-code defaults', () => {
    const config = {
      execution: {
        backend: 'claude-code' as const,
      },
    };

    const result = OphanConfigSchema.parse(config);
    expect(result.execution.claudeCode.model).toBe('sonnet');
    expect(result.execution.claudeCode.permissionMode).toBe('acceptEdits');
    expect(result.execution.claudeCode.allowedTools).toContain('Read');
    expect(result.execution.claudeCode.maxTurns).toBe(50);
  });

  it('should reject invalid backend', () => {
    const config = {
      execution: {
        backend: 'invalid',
      },
    };

    expect(() => OphanConfigSchema.parse(config)).toThrow();
  });

  it('should reject invalid permission mode', () => {
    const config = {
      execution: {
        backend: 'claude-code' as const,
        claudeCode: {
          permissionMode: 'invalid',
        },
      },
    };

    expect(() => OphanConfigSchema.parse(config)).toThrow();
  });
});

describe('OphanStateSchema', () => {
  it('should create valid initial state', () => {
    const state = createInitialState();

    expect(state.version).toBe('0.1.0');
    expect(state.lastReview).toBeNull();
    expect(state.tasksSinceReview).toBe(0);
    expect(state.learnings).toEqual([]);
    expect(state.pendingProposals).toEqual([]);
    expect(state.metrics.totalTasks).toBe(0);
  });

  it('should parse state with learnings', () => {
    const state = {
      version: '0.1.0',
      lastReview: null,
      tasksSinceReview: 5,
      pendingProposals: [],
      learnings: [
        {
          id: 'test-1',
          content: 'Test learning',
          context: 'Test context',
          issue: 'Test issue',
          resolution: 'Test resolution',
          guidelineImpact: 'coding.md',
          timestamp: new Date().toISOString(),
          references: 0,
          promoted: false,
        },
      ],
      metrics: {
        totalTasks: 5,
        successfulTasks: 4,
        failedTasks: 1,
        escalatedTasks: 0,
        successRate: 80,
        averageIterations: 2.5,
        maxIterationsHit: 0,
        totalTokensUsed: 10000,
        totalCost: 0.15,
        averageCostPerTask: 0.03,
        averageTaskDuration: 30,
        totalTimeSpent: 150,
        totalLearnings: 1,
        learningsPromoted: 0,
        patternsDetected: 0,
        periodStart: new Date().toISOString(),
        periodEnd: new Date().toISOString(),
      },
    };

    const result = OphanStateSchema.parse(state);
    expect(result.learnings).toHaveLength(1);
    expect(result.metrics.successRate).toBe(80);
  });
});
