import type { Evaluation, EvaluationFailure, OphanConfig } from '../types/index.js';

export interface EvaluationResult extends Evaluation {
  rawResponse?: string;
}

export interface EvaluationOptions {
  taskDescription: string;
  criteria: string;
  toolOutputs: string;
  config: OphanConfig;
}

/**
 * Evaluation engine that checks task output against criteria
 * Uses tool-based evaluation (tests, lint, build checks)
 */
export class EvaluationEngine {
  constructor(_config: OphanConfig) {
    // Config stored for future use if needed
  }

  /**
   * Quick evaluation based on tool outputs alone (no LLM call)
   * Used for basic checks like "did tests pass?"
   */
  evaluateToolOutputs(toolOutputs: string): EvaluationResult {
    const failures: EvaluationFailure[] = [];
    const passedCriteria: string[] = [];

    // Check for common failure patterns
    // NOTE: These patterns must be specific to avoid false positives from
    // unrelated text like log messages, variable names, or LLM commentary.
    // Patterns must match actual test runner output, not generic words.
    const checks = [
      {
        name: 'Tests',
        // Match specific test runner failure formats
        // - Jest: "FAIL src/foo.test.ts", "Tests: 1 failed", "X failing"
        // - npm: "npm ERR! Test failed"
        // Excludes: "0 failed", generic "error", "[tool] ✗"
        failPattern: /(?:FAIL\s+(?:src|test|spec)\/|Tests?:\s*[1-9]\d*\s+failed|[1-9]\d*\s+failing|[1-9]\d*\s+failed,|npm ERR!.*test failed)/i,
        // Match specific test runner success formats
        // - Jest: "Tests: 10 passed", "✓ foo test (10ms)"
        // - Vitest: "10 passed"
        successPattern: /(?:Tests?:\s*\d+\s+passed,?\s*\d*\s*total|All\s+\d+\s+tests?\s+passed|✓.*\(\d+\s*m?s\)|passed,\s*0\s+failed|\d+\s+pass(?:ed)?[,\s]+0\s+fail)/i,
      },
      {
        name: 'TypeScript',
        // Match TypeScript compiler error codes specifically (e.g., "error TS2304:")
        failPattern: /(?:error TS\d{4}:|Found [1-9]\d* errors?)/i,
        successPattern: /(?:Successfully compiled \d+ files|Found 0 errors|no errors)/i,
      },
      {
        name: 'ESLint',
        // Match ESLint's specific error format (e.g., "✖ 5 problems")
        failPattern: /(?:✖\s+[1-9]\d*\s+problems?|[1-9]\d*\s+errors?\s+and\s+\d+\s+warnings?)/i,
        successPattern: /(?:✔\s+No\s+(?:ESLint\s+)?(?:warnings|errors|problems)|0\s+problems?|no\s+problems?)/i,
      },
      {
        name: 'Build',
        // Match specific build failure messages
        failPattern: /(?:Build failed|Failed to compile|Build error:|Compilation failed)/i,
        successPattern: /(?:Build succeeded|Compiled successfully|Build complete|Successfully built)/i,
      },
    ];

    for (const check of checks) {
      const hasFailure = check.failPattern.test(toolOutputs);
      const hasSuccess = check.successPattern.test(toolOutputs);

      // Only evaluate if there's relevant output
      if (!hasFailure && !hasSuccess) {
        continue;
      }

      // If we have clear success and no failure, it's a pass
      // If we have failure (even with some success), it's a failure
      // This handles partial failures like "5 passed, 2 failed"
      if (hasFailure) {
        failures.push({
          criterion: check.name,
          message: `${check.name} check failed - see tool output for details`,
          severity: 'error',
        });
      } else if (hasSuccess) {
        passedCriteria.push(check.name);
      }
    }

    const passed = failures.length === 0;
    const score = passed ? 100 : Math.max(0, 100 - failures.length * 25);

    return {
      passed,
      criteria: passedCriteria,
      failures,
      score,
    };
  }

  /**
   * Full evaluation using tool-based checks
   *
   * Note: LLM-based criteria evaluation is not available without API backend.
   * This uses only tool output analysis (tests, lint, build, etc.)
   */
  async fullEvaluation(options: EvaluationOptions): Promise<EvaluationResult> {
    // Do tool-based evaluation (tests, lint, build, etc.)
    const toolEval = this.evaluateToolOutputs(options.toolOutputs);

    return toolEval;
  }

  /**
   * Format evaluation result for display/logging
   */
  formatEvaluation(evaluation: EvaluationResult): string {
    const lines: string[] = [];

    lines.push(`## Evaluation ${evaluation.passed ? '✓ PASSED' : '✗ FAILED'}`);
    lines.push(`Score: ${evaluation.score}/100`);
    lines.push('');

    if (evaluation.criteria.length > 0) {
      lines.push('### Passed Criteria');
      for (const criterion of evaluation.criteria) {
        lines.push(`- ✓ ${criterion}`);
      }
      lines.push('');
    }

    if (evaluation.failures.length > 0) {
      lines.push('### Failed Criteria');
      for (const failure of evaluation.failures) {
        const icon = failure.severity === 'error' ? '✗' : '⚠';
        lines.push(`- ${icon} ${failure.criterion}: ${failure.message}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
