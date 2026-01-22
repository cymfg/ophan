/**
 * Claude Code Executor
 *
 * Executes tasks using the Claude Agent SDK (Claude Code subscription)
 * as an alternative to direct API calls.
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import type { OphanConfig } from '../types/index.js';

/**
 * Find the Claude Code executable path
 */
function findClaudeCodeExecutable(): string | undefined {
  try {
    // Try to find 'claude' in PATH using 'which' (Unix) or 'where' (Windows)
    const command = process.platform === 'win32' ? 'where claude' : 'which claude';
    const result = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const path = result.trim().split('\n')[0]; // Take first result if multiple
    return path || undefined;
  } catch {
    // claude not found in PATH
    return undefined;
  }
}

export interface ClaudeCodeExecutorOptions {
  projectRoot: string;
  config: OphanConfig;
  onProgress?: (message: string) => void;
  onToolUse?: (tool: string, result: string) => void;
}

export interface ClaudeCodeResult {
  output: string;
  completed: boolean;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  toolOutputs: Map<string, string[]>;
}

/**
 * Maps Ophan model names to Claude Code model options
 */
function mapModelName(
  model: 'sonnet' | 'opus' | 'haiku'
): 'sonnet' | 'opus' | 'haiku' {
  return model;
}

/**
 * Executor that uses Claude Agent SDK (Claude Code) for task execution
 */
export class ClaudeCodeExecutor {
  private options: ClaudeCodeExecutorOptions;

  constructor(options: ClaudeCodeExecutorOptions) {
    this.options = options;
  }

  /**
   * Execute a task using Claude Code
   */
  async execute(
    systemPrompt: string,
    taskPrompt: string
  ): Promise<ClaudeCodeResult> {
    const toolOutputs = new Map<string, string[]>();
    let output = '';
    let completed = false;
    let totalCost = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    const claudeCodeConfig = this.options.config.execution?.claudeCode ?? {
      model: 'sonnet' as const,
      permissionMode: 'acceptEdits' as const,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      maxTurns: 50,
    };

    try {
      // Build the full prompt with system context
      const fullPrompt = `${systemPrompt}\n\n---\n\nTask:\n${taskPrompt}`;

      // Find Claude Code executable
      const claudeExecutable = findClaudeCodeExecutable();
      if (!claudeExecutable) {
        throw new Error(
          'Claude Code executable not found. Please ensure Claude Code is installed and available in your PATH. ' +
          'Install it via: npm install -g @anthropic-ai/claude-code'
        );
      }

      const queryOptions = {
        pathToClaudeCodeExecutable: claudeExecutable,
        allowedTools: claudeCodeConfig.allowedTools,
        permissionMode: claudeCodeConfig.permissionMode,
        model: mapModelName(claudeCodeConfig.model),
        cwd: this.options.projectRoot,
        maxTurns: claudeCodeConfig.maxTurns,
        maxBudgetUsd: this.options.config.innerLoop.costLimit,
      };

      this.log(`Starting Claude Code execution (using ${claudeExecutable})...`);

      for await (const message of query({
        prompt: fullPrompt,
        options: queryOptions,
      })) {
        this.processMessage(message, toolOutputs, (text) => {
          output += text + '\n';
        });

        // Check for result message
        if (message.type === 'result') {
          const result = message as {
            type: 'result';
            subtype: string;
            is_error: boolean;
            result?: string;
            total_cost_usd?: number;
            usage?: { input_tokens: number; output_tokens: number };
          };

          completed = !result.is_error && result.subtype === 'success';
          totalCost = result.total_cost_usd ?? 0;
          inputTokens = result.usage?.input_tokens ?? 0;
          outputTokens = result.usage?.output_tokens ?? 0;

          if (result.result) {
            output += result.result + '\n';
          }
        }
      }
    } catch (error) {
      this.log(`Claude Code execution error: ${error}`);
      output += `Error: ${error}\n`;
    }

    return {
      output,
      completed,
      cost: totalCost,
      inputTokens,
      outputTokens,
      toolOutputs,
    };
  }

  /**
   * Process a message from the Claude Agent SDK
   */
  private processMessage(
    message: SDKMessage,
    toolOutputs: Map<string, string[]>,
    appendOutput: (text: string) => void
  ): void {
    switch (message.type) {
      case 'assistant': {
        const assistantMsg = message as {
          type: 'assistant';
          message?: { content?: Array<{ type: string; text?: string; name?: string }> };
        };
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text' && block.text) {
              this.log(block.text);
              appendOutput(block.text);
            } else if (block.type === 'tool_use' && block.name) {
              this.log(`[Tool: ${block.name}]`);
            }
          }
        }
        break;
      }

      case 'user': {
        const userMsg = message as {
          type: 'user';
          message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string }> };
        };
        if (userMsg.message?.content) {
          for (const block of userMsg.message.content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const resultContent = block.content ?? '';
              // Store tool output for evaluation
              const toolId = block.tool_use_id;
              if (!toolOutputs.has(toolId)) {
                toolOutputs.set(toolId, []);
              }
              toolOutputs.get(toolId)!.push(resultContent);

              this.options.onToolUse?.(toolId, resultContent);
            }
          }
        }
        break;
      }

      case 'system':
        // System initialization message
        this.log('Claude Code initialized');
        break;

      default:
        // Ignore other message types (partial updates, etc.)
        break;
    }
  }

  private log(message: string): void {
    this.options.onProgress?.(message);
  }

  /**
   * Check if Claude Code is available
   * (i.e., the user has a subscription and the SDK can connect)
   */
  static async isAvailable(): Promise<boolean> {
    try {
      // Try to import the SDK - if it fails, it's not installed
      await import('@anthropic-ai/claude-agent-sdk');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Convert Claude Code tool outputs to format expected by evaluation
 */
export function convertToolOutputs(
  toolOutputs: Map<string, string[]>
): Map<string, { success: boolean; output: string }[]> {
  const result = new Map<string, { success: boolean; output: string }[]>();

  for (const [toolId, outputs] of toolOutputs) {
    result.set(
      toolId,
      outputs.map((output) => ({
        success: !output.toLowerCase().startsWith('error'),
        output,
      }))
    );
  }

  return result;
}
