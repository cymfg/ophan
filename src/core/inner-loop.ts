import type {
  OphanConfig,
  Task,
  TaskLog,
  Evaluation,
  Learning,
  EscalationPayload,
  ContextUsageLog,
  FileUsage,
} from '../types/index.js';
import { ClaudeCodeExecutor } from '../llm/claude-code-executor.js';
import {
  buildSystemPrompt,
  buildTaskMessage,
  buildRegenerationMessage,
  type TaskContext,
} from '../llm/prompts.js';
import { ToolRunner } from './tool-runner.js';
import { EvaluationEngine } from './evaluation.js';
import { WebhookClient } from '../integrations/webhook.js';
import { ContextLogger } from './context-logger.js';

export interface InnerLoopOptions {
  projectRoot: string;
  projectName: string;
  ophanDir: string;
  config: OphanConfig;
  guidelines: string;
  criteria: string;
  learnings: string;
  /** File paths of guideline files loaded (for context tracking) */
  guidelineFiles?: string[];
  /** File paths of criteria files loaded (for context tracking) */
  criteriaFiles?: string[];
  onProgress?: (message: string) => void;
  onIteration?: (iteration: number, evaluation: Evaluation) => void;
  onEscalation?: (task: Task, reason: EscalationPayload['reason'], context: EscalationPayload['context']) => void;
}

export interface InnerLoopResult {
  task: Task;
  logs: TaskLog[];
  learnings: Learning[];
  finalEvaluation: Evaluation;
}

/**
 * The inner loop execution engine
 * Implements the learn-regenerate paradigm using Claude Code
 */
export class InnerLoop {
  private claudeCodeExecutor: ClaudeCodeExecutor;
  private toolRunner: ToolRunner;
  private evaluator: EvaluationEngine;
  private webhookClient: WebhookClient;
  private contextLogger: ContextLogger;
  private options: InnerLoopOptions;

  constructor(options: InnerLoopOptions) {
    this.options = options;
    this.contextLogger = new ContextLogger({ ophanDir: options.ophanDir });

    // Initialize Claude Code executor
    this.claudeCodeExecutor = new ClaudeCodeExecutor({
      projectRoot: options.projectRoot,
      config: options.config,
      onProgress: options.onProgress,
      onToolUse: (tool, result) => {
        // Track tool outputs for evaluation
        this.toolRunner.recordToolOutput(tool, { success: true, output: result });
      },
    });

    this.toolRunner = new ToolRunner({
      projectRoot: options.projectRoot,
      config: options.config,
    });
    this.evaluator = new EvaluationEngine(options.config);
    this.webhookClient = new WebhookClient(
      options.config,
      options.projectName,
      options.projectRoot
    );
  }

  /**
   * Execute a task through the inner loop
   */
  async execute(taskDescription: string): Promise<InnerLoopResult> {
    const taskId = this.generateTaskId();

    const task: Task = {
      id: taskId,
      description: taskDescription,
      status: 'running',
      iterations: 0,
      maxIterations: this.options.config.innerLoop.maxIterations,
      startedAt: new Date().toISOString(),
      cost: 0,
      tokensUsed: 0,
    };

    const logs: TaskLog[] = [];
    const evaluations: Evaluation[] = [];
    let finalEvaluation: Evaluation | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    this.log(`Starting task: ${taskDescription}`);

    for (
      let iteration = 1;
      iteration <= this.options.config.innerLoop.maxIterations;
      iteration++
    ) {
      task.iterations = iteration;
      this.log(`Iteration ${iteration}/${task.maxIterations}`);

      // Clear tool outputs for new iteration
      this.toolRunner.clearToolOutputs();

      // Build context for this iteration
      const context: TaskContext = {
        taskDescription,
        projectRoot: this.options.projectRoot,
        guidelines: this.options.guidelines,
        criteria: this.options.criteria,
        learnings: this.options.learnings,
        iteration,
        maxIterations: task.maxIterations,
        previousEvaluation:
          finalEvaluation
            ? this.evaluator.formatEvaluation(finalEvaluation)
            : undefined,
        regenerationStrategy:
          this.options.config.innerLoop.regenerationStrategy,
      };

      const systemPrompt = buildSystemPrompt(context);

      // Build messages for this iteration
      const userMessage =
        iteration === 1
          ? buildTaskMessage(taskDescription)
          : buildRegenerationMessage(
              taskDescription,
              this.evaluator.formatEvaluation(finalEvaluation!),
              iteration
            );

      // Execute with Claude Code
      const { output, inputTokens, outputTokens, completed } =
        await this.executeWithClaudeCode(systemPrompt, userMessage);

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      // Evaluate the iteration
      const evaluation = await this.evaluator.fullEvaluation({
        taskDescription,
        criteria: this.options.criteria,
        toolOutputs: this.toolRunner.getToolOutputs(),
        config: this.options.config,
      });

      finalEvaluation = evaluation;
      evaluations.push(evaluation);

      // Log this iteration
      logs.push({
        taskId,
        timestamp: new Date().toISOString(),
        iteration,
        action: completed ? 'completed' : 'iteration',
        output,
        evaluation,
      });

      this.options.onIteration?.(iteration, evaluation);
      this.log(this.evaluator.formatEvaluation(evaluation));

      // Check if we're done - ONLY converge if evaluation passes
      // The agent signaling "completed" is not enough; criteria must be satisfied
      if (evaluation.passed) {
        task.status = 'converged';
        break;
      }

      // If agent thinks it's done but evaluation failed, continue iterating
      // This forces the agent to address criteria violations

      // Check cost limit
      const currentCost = this.estimateCost(totalInputTokens, totalOutputTokens);
      if (
        this.options.config.innerLoop.costLimit &&
        currentCost >= this.options.config.innerLoop.costLimit
      ) {
        this.log(`Cost limit reached: $${currentCost.toFixed(4)}`);
        task.status = 'escalated';
        await this.triggerEscalation(task, 'cost_limit', {
          lastError: `Cost limit of $${this.options.config.innerLoop.costLimit} exceeded`,
          suggestedAction: 'Increase cost limit or simplify the task',
        });
        break;
      }

      // Check if we're about to exceed max iterations
      if (iteration === this.options.config.innerLoop.maxIterations) {
        task.status = 'escalated';
        await this.triggerEscalation(task, 'max_iterations', {
          lastError: finalEvaluation
            ? `Evaluation failed: ${finalEvaluation.failures.map((f) => f.message).join(', ')}`
            : 'Max iterations reached without convergence',
          suggestedAction: 'Review task complexity or improve guidelines',
        });
      }
    }

    // Finalize task
    if (task.status === 'running') {
      task.status =
        finalEvaluation?.passed ? 'converged' : 'escalated';
    }

    task.completedAt = new Date().toISOString();
    task.tokensUsed = totalInputTokens + totalOutputTokens;
    task.cost = this.estimateCost(totalInputTokens, totalOutputTokens);

    this.log(
      `Task ${task.status}: ${task.iterations} iterations, $${task.cost.toFixed(4)}`
    );

    // Log context usage for the context agent's self-improvement
    await this.logContextUsage(task, totalInputTokens + totalOutputTokens);

    // Note: Learning extraction is not available without API backend
    // Learnings can be manually added or we can implement this via Claude Code in the future
    const learnings: Learning[] = [];

    return {
      task,
      logs,
      learnings,
      finalEvaluation: finalEvaluation!,
    };
  }

  /**
   * Log context usage data for the context agent's evaluation
   */
  private async logContextUsage(task: Task, totalTokens: number): Promise<void> {
    try {
      // Get file usage from Claude Code executor
      const fileUsage: FileUsage = this.claudeCodeExecutor.getFileUsage();

      // Determine provided context files
      const providedFiles = [
        ...(this.options.guidelineFiles ?? []),
        ...(this.options.criteriaFiles ?? []),
      ];

      // Compute metrics
      const metrics = this.contextLogger.computeMetrics(
        providedFiles,
        fileUsage,
        0, // TODO: Track exploration tokens (tokens before first write)
        totalTokens
      );

      // Build and save the context usage log
      const usageLog: ContextUsageLog = {
        taskId: task.id,
        taskDescription: task.description,
        providedContext: {
          guidelines: this.options.guidelineFiles ?? [],
          criteria: this.options.criteriaFiles ?? [],
          files: providedFiles,
        },
        actualUsage: fileUsage,
        metrics,
        timestamp: new Date().toISOString(),
      };

      await this.contextLogger.saveLog(usageLog);
      this.log(`Context usage logged: hit=${metrics.contextHitRate.toFixed(0)}%, miss=${metrics.contextMissRate.toFixed(0)}%`);
    } catch (error) {
      // Don't fail the task if context logging fails
      this.log(`Warning: Failed to log context usage: ${(error as Error).message}`);
    }
  }

  /**
   * Execute using Claude Code
   */
  private async executeWithClaudeCode(
    systemPrompt: string,
    taskMessage: string
  ): Promise<{
    output: string;
    inputTokens: number;
    outputTokens: number;
    completed: boolean;
  }> {
    const result = await this.claudeCodeExecutor.execute(systemPrompt, taskMessage);

    return {
      output: result.output,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      completed: result.completed,
    };
  }

  /**
   * Trigger an escalation notification
   */
  private async triggerEscalation(
    task: Task,
    reason: EscalationPayload['reason'],
    context: EscalationPayload['context']
  ): Promise<void> {
    this.log(`Escalation triggered: ${reason}`);

    // Notify via callback
    this.options.onEscalation?.(task, reason, context);

    // Send webhook notifications
    if (this.webhookClient.hasEscalationWebhooks()) {
      try {
        const results = await this.webhookClient.sendEscalation(task, reason, context);
        for (const result of results) {
          if (result.success) {
            this.log(`Webhook ${result.webhook}: sent successfully`);
          } else {
            this.log(`Webhook ${result.webhook}: failed - ${result.error}`);
          }
        }
      } catch (error) {
        this.log(`Failed to send escalation webhooks: ${(error as Error).message}`);
      }
    }
  }

  private log(message: string): void {
    this.options.onProgress?.(message);
  }

  /**
   * Estimate cost based on token usage
   */
  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Standard Claude pricing
    // Input: $3 per million tokens, Output: $15 per million tokens
    const inputCost = (inputTokens / 1_000_000) * 3;
    const outputCost = (outputTokens / 1_000_000) * 15;
    return inputCost + outputCost;
  }

  private generateTaskId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const random = Math.random().toString(36).slice(2, 6);
    return `task-${date}-${time}-${random}`;
  }
}
