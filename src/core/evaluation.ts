import type { Evaluation, EvaluationFailure, OphanConfig } from '../types/index.js';
import { ClaudeClient } from '../llm/claude.js';
import { buildEvaluationPrompt } from '../llm/prompts.js';

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
 */
export class EvaluationEngine {
  private claude: ClaudeClient;

  constructor(config: OphanConfig) {
    this.claude = new ClaudeClient(config);
  }

  /**
   * Evaluate task output against criteria using Claude
   */
  async evaluate(options: EvaluationOptions): Promise<EvaluationResult> {
    const { taskDescription, criteria, toolOutputs } = options;

    const prompt = buildEvaluationPrompt(taskDescription, criteria, toolOutputs);

    try {
      const response = await this.claude.chat(
        'You are an evaluation assistant. Analyze the task output against the criteria and respond with a JSON evaluation.',
        [{ role: 'user', content: prompt }]
      );

      // Parse the JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.createErrorEvaluation('Failed to parse evaluation response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const failures: EvaluationFailure[] = [];
      const passedCriteria: string[] = [];

      for (const criterion of parsed.criteria || []) {
        if (criterion.passed) {
          passedCriteria.push(criterion.name);
        } else {
          failures.push({
            criterion: criterion.name,
            message: criterion.message || 'Failed',
            severity: criterion.severity || 'error',
          });
        }
      }

      return {
        passed: parsed.passed ?? failures.length === 0,
        criteria: passedCriteria,
        failures,
        score: parsed.score ?? (parsed.passed ? 100 : 0),
        rawResponse: response.content,
      };
    } catch (error) {
      return this.createErrorEvaluation(
        `Evaluation failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Quick evaluation based on tool outputs alone (no LLM call)
   * Used for basic checks like "did tests pass?"
   */
  evaluateToolOutputs(toolOutputs: string): EvaluationResult {
    const failures: EvaluationFailure[] = [];
    const passedCriteria: string[] = [];

    // Check for common failure patterns
    const checks = [
      {
        name: 'Tests',
        failPattern: /(?:FAIL|failed|error|Error:)/i,
        successPattern: /(?:pass|passed|✓|All tests passed)/i,
      },
      {
        name: 'TypeScript',
        failPattern: /(?:error TS\d+|Type error)/i,
        successPattern: /(?:no errors|successfully compiled)/i,
      },
      {
        name: 'ESLint',
        failPattern: /(?:\d+ error|eslint.*error)/i,
        successPattern: /(?:no problems|0 errors)/i,
      },
      {
        name: 'Build',
        failPattern: /(?:build failed|compilation failed)/i,
        successPattern: /(?:build succeeded|successfully built)/i,
      },
    ];

    for (const check of checks) {
      // Only evaluate if there's relevant output
      const hasRelevantOutput =
        check.failPattern.test(toolOutputs) ||
        check.successPattern.test(toolOutputs);

      if (hasRelevantOutput) {
        if (check.failPattern.test(toolOutputs)) {
          failures.push({
            criterion: check.name,
            message: `${check.name} check failed - see tool output for details`,
            severity: 'error',
          });
        } else if (check.successPattern.test(toolOutputs)) {
          passedCriteria.push(check.name);
        }
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
   * Combine quick evaluation with full LLM evaluation
   *
   * IMPORTANT: Always runs full LLM evaluation to check custom criteria.
   * This ensures that product constraints (like "only build calculator features")
   * are enforced even when tests pass. Critical for autonomous operation.
   */
  async fullEvaluation(options: EvaluationOptions): Promise<EvaluationResult> {
    // First do quick tool-based evaluation (tests, lint, build, etc.)
    const quickEval = this.evaluateToolOutputs(options.toolOutputs);

    // Always run full LLM evaluation to check custom criteria
    // This is essential for enforcing product constraints and guidelines
    const fullEval = await this.evaluate(options);

    // Merge results - task must pass BOTH tool checks AND criteria
    return {
      passed: quickEval.passed && fullEval.passed,
      criteria: [...new Set([...quickEval.criteria, ...fullEval.criteria])],
      failures: [...quickEval.failures, ...fullEval.failures],
      score: Math.min(quickEval.score, fullEval.score),
      rawResponse: fullEval.rawResponse,
    };
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

  private createErrorEvaluation(message: string): EvaluationResult {
    return {
      passed: false,
      criteria: [],
      failures: [
        {
          criterion: 'Evaluation',
          message,
          severity: 'error',
        },
      ],
      score: 0,
    };
  }
}
