import { describe, it, expect } from 'vitest';
import { EvaluationEngine } from '../../src/core/evaluation.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';

describe('EvaluationEngine', () => {
  const evaluator = new EvaluationEngine(DEFAULT_CONFIG);

  describe('evaluateToolOutputs', () => {
    it('should detect passing tests', () => {
      const output = `
        Running tests...
        ✓ test 1 passed
        ✓ test 2 passed
        All tests passed
      `;

      const result = evaluator.evaluateToolOutputs(output);

      expect(result.passed).toBe(true);
      expect(result.criteria).toContain('Tests');
    });

    it('should detect failing tests', () => {
      const output = `
        Running tests...
        FAIL src/test.ts
        ✗ test 1 failed
        Error: Expected 1 but got 2
      `;

      const result = evaluator.evaluateToolOutputs(output);

      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.criterion === 'Tests')).toBe(true);
    });

    it('should detect TypeScript errors', () => {
      const output = `
        src/file.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
      `;

      const result = evaluator.evaluateToolOutputs(output);

      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.criterion === 'TypeScript')).toBe(
        true
      );
    });

    it('should detect ESLint errors', () => {
      const output = `
        src/file.ts
          10:5  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any

        ✖ 1 error found
      `;

      const result = evaluator.evaluateToolOutputs(output);

      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.criterion === 'ESLint')).toBe(true);
    });

    it('should detect build failures', () => {
      const output = `
        Building project...
        build failed: Module not found
      `;

      const result = evaluator.evaluateToolOutputs(output);

      expect(result.passed).toBe(false);
      expect(result.failures.some((f) => f.criterion === 'Build')).toBe(true);
    });

    it('should pass when no issues detected', () => {
      const output = `
        Build completed with no problems
        Task completed
      `;

      const result = evaluator.evaluateToolOutputs(output);

      // When there's no relevant output that triggers checks, it passes
      expect(result.failures.length).toBe(0);
    });

    it('should calculate score based on failures', () => {
      const output = `
        FAIL test
        error TS2322
      `;

      const result = evaluator.evaluateToolOutputs(output);

      expect(result.score).toBeLessThan(100);
    });
  });

  describe('formatEvaluation', () => {
    it('should format passing evaluation', () => {
      const evaluation = {
        passed: true,
        criteria: ['Tests', 'TypeScript'],
        failures: [],
        score: 100,
      };

      const formatted = evaluator.formatEvaluation(evaluation);

      expect(formatted).toContain('PASSED');
      expect(formatted).toContain('Tests');
      expect(formatted).toContain('TypeScript');
    });

    it('should format failing evaluation', () => {
      const evaluation = {
        passed: false,
        criteria: ['TypeScript'],
        failures: [
          {
            criterion: 'Tests',
            message: 'Test failed',
            severity: 'error' as const,
          },
        ],
        score: 50,
      };

      const formatted = evaluator.formatEvaluation(evaluation);

      expect(formatted).toContain('FAILED');
      expect(formatted).toContain('Tests');
      expect(formatted).toContain('Test failed');
    });
  });
});
