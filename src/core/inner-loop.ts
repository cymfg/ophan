import Anthropic from '@anthropic-ai/sdk';
import type {
  OphanConfig,
  Task,
  TaskLog,
  Evaluation,
  Learning,
  EscalationPayload,
} from '../types/index.js';
import { ClaudeClient, OPHAN_TOOLS } from '../llm/claude.js';
import {
  buildSystemPrompt,
  buildTaskMessage,
  buildRegenerationMessage,
  buildLearningExtractionPrompt,
  type TaskContext,
} from '../llm/prompts.js';
import { ToolRunner } from './tool-runner.js';
import { EvaluationEngine } from './evaluation.js';
import { WebhookClient } from '../integrations/webhook.js';

export interface InnerLoopOptions {
  projectRoot: string;
  projectName: string;
  config: OphanConfig;
  guidelines: string;
  criteria: string;
  learnings: string;
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
 * Implements the learn-regenerate paradigm
 */
export class InnerLoop {
  private claude: ClaudeClient;
  private toolRunner: ToolRunner;
  private evaluator: EvaluationEngine;
  private webhookClient: WebhookClient;
  private options: InnerLoopOptions;

  constructor(options: InnerLoopOptions) {
    this.options = options;
    this.claude = new ClaudeClient(options.config);
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

      // Execute agent loop with tools
      const { output, inputTokens, outputTokens, completed } =
        await this.executeAgentLoop(systemPrompt, userMessage);

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

      // Check if we're done
      if (evaluation.passed || completed) {
        task.status = 'converged';
        break;
      }

      // Check cost limit
      const currentCost = this.claude.estimateCost(
        totalInputTokens,
        totalOutputTokens
      );
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
    task.cost = this.claude.estimateCost(totalInputTokens, totalOutputTokens);

    this.log(
      `Task ${task.status}: ${task.iterations} iterations, $${task.cost.toFixed(4)}`
    );

    // Extract learnings from the task
    const learnings = await this.extractLearnings(
      taskDescription,
      task.iterations,
      evaluations.map((e) => this.evaluator.formatEvaluation(e)),
      task.status === 'converged'
        ? 'success'
        : task.status === 'escalated'
          ? 'escalated'
          : 'failure'
    );

    return {
      task,
      logs,
      learnings,
      finalEvaluation: finalEvaluation!,
    };
  }

  /**
   * Execute the agent loop with tool use
   */
  private async executeAgentLoop(
    systemPrompt: string,
    initialMessage: string
  ): Promise<{
    output: string;
    inputTokens: number;
    outputTokens: number;
    completed: boolean;
  }> {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: initialMessage },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let completed = false;
    let output = '';

    // Maximum tool calls per iteration to prevent infinite loops
    const maxToolCalls = 50;
    let toolCallCount = 0;

    while (toolCallCount < maxToolCalls) {
      const response = await this.claude.chatWithTools(
        systemPrompt,
        messages,
        OPHAN_TOOLS
      );

      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;

      if (response.content) {
        output += response.content + '\n';
        this.log(response.content);
      }

      // Check if any tools were called
      if (response.toolCalls.length === 0) {
        // No tool calls and end_turn - we're done
        if (response.stopReason === 'end_turn') {
          break;
        }
      }

      // Process tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolCall of response.toolCalls) {
        toolCallCount++;

        if (toolCall.name === 'task_complete') {
          completed = true;
          const summary = toolCall.input.summary as string;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: `tool_${toolCallCount}`,
            content: `Task marked as complete: ${summary}`,
          });
        } else {
          const result = await this.toolRunner.execute(
            toolCall.name,
            toolCall.input
          );

          this.log(`[${toolCall.name}] ${result.success ? '✓' : '✗'}`);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: `tool_${toolCallCount}`,
            content: result.error
              ? `Error: ${result.error}\n${result.output}`
              : result.output,
            is_error: !result.success,
          });
        }
      }

      // Add assistant message with tool use
      const assistantContent: Anthropic.ContentBlock[] = [];
      if (response.content) {
        assistantContent.push({ type: 'text', text: response.content });
      }
      for (let i = 0; i < response.toolCalls.length; i++) {
        const call = response.toolCalls[i];
        assistantContent.push({
          type: 'tool_use',
          id: `tool_${toolCallCount - response.toolCalls.length + i + 1}`,
          name: call.name,
          input: call.input,
        });
      }

      messages.push({ role: 'assistant', content: assistantContent });

      // Add tool results
      messages.push({
        role: 'user',
        content: toolResults,
      });

      if (completed) {
        break;
      }
    }

    return {
      output,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      completed,
    };
  }

  /**
   * Extract learnings from a completed task
   */
  private async extractLearnings(
    taskDescription: string,
    iterations: number,
    evaluationHistory: string[],
    outcome: 'success' | 'failure' | 'escalated'
  ): Promise<Learning[]> {
    // Only extract learnings if there were multiple iterations or failures
    if (iterations === 1 && outcome === 'success') {
      return [];
    }

    try {
      const prompt = buildLearningExtractionPrompt(
        taskDescription,
        iterations,
        evaluationHistory,
        outcome
      );

      const response = await this.claude.chat(
        'You are a learning extraction assistant. Analyze task outcomes and extract generalizable learnings.',
        [{ role: 'user', content: prompt }]
      );

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return (parsed.learnings || []).map(
        (l: {
          content: string;
          context: string;
          issue: string;
          resolution: string;
          guidelineImpact: string;
        }) => ({
          id: this.generateLearningId(),
          content: l.content,
          context: l.context,
          issue: l.issue,
          resolution: l.resolution,
          guidelineImpact: l.guidelineImpact,
          timestamp: new Date().toISOString(),
          references: 1,
          promoted: false,
        })
      );
    } catch {
      this.log('Failed to extract learnings');
      return [];
    }
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

  private generateTaskId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const random = Math.random().toString(36).slice(2, 6);
    return `task-${date}-${time}-${random}`;
  }

  private generateLearningId(): string {
    const now = new Date();
    return now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  }
}
