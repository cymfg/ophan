/**
 * Claude Code Executor
 *
 * Executes tasks using the Claude Agent SDK (Claude Code subscription)
 * as an alternative to direct API calls.
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import type { OphanConfig, FileUsage } from '../types/index.js';

/**
 * Find the Claude Code executable path
 *
 * Prefers the user's shell PATH over any node_modules installations
 * to avoid using potentially outdated or differently-configured local installs.
 */
function findClaudeCodeExecutable(): string | undefined {
  try {
    // Use 'which -a' (Unix) to get ALL matches, then filter out node_modules
    // This ensures we use the user's actual claude installation, not a local npm one
    if (process.platform === 'win32') {
      const result = execSync('where claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const paths = result.trim().split('\n').filter(p => p.trim());
      // On Windows, prefer paths that aren't in node_modules
      const nonNodeModules = paths.filter(p => !p.includes('node_modules'));
      return nonNodeModules[0] || paths[0] || undefined;
    } else {
      // Unix: use 'which -a' to get all matches
      const result = execSync('which -a claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const paths = result.trim().split('\n').filter(p => p.trim());

      // Filter out node_modules paths - these are local npm installs that may have different credentials
      const nonNodeModules = paths.filter(p => !p.includes('node_modules'));

      if (nonNodeModules.length > 0) {
        return nonNodeModules[0];
      }

      // Fall back to first result if all are in node_modules
      return paths[0] || undefined;
    }
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

  // File usage tracking for context agent evaluation
  private fileUsage: {
    read: Set<string>;
    written: Set<string>;
    searched: Set<string>;
    commands: string[];
  } = {
    read: new Set(),
    written: new Set(),
    searched: new Set(),
    commands: [],
  };

  // Track pending tool calls to match with results
  private pendingToolCalls: Map<string, { name: string; input: Record<string, unknown> }> = new Map();

  // Track when first write happens
  private firstWriteOccurred: boolean = false;

  constructor(options: ClaudeCodeExecutorOptions) {
    this.options = options;
  }

  /**
   * Get file usage data for context evaluation
   */
  getFileUsage(): FileUsage {
    return {
      filesRead: [...this.fileUsage.read],
      filesWritten: [...this.fileUsage.written],
      filesSearched: [...this.fileUsage.searched],
      commandsRun: [...this.fileUsage.commands],
    };
  }

  /**
   * Check if first write has occurred
   */
  hasFirstWriteOccurred(): boolean {
    return this.firstWriteOccurred;
  }

  /**
   * Clear file usage data (for new task)
   */
  clearFileUsage(): void {
    this.fileUsage = {
      read: new Set(),
      written: new Set(),
      searched: new Set(),
      commands: [],
    };
    this.pendingToolCalls.clear();
    this.firstWriteOccurred = false;
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

    const claudeCodeConfig = this.options.config.claudeCode ?? {
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

      // Filter out ANTHROPIC_API_KEY from environment so Claude Code uses subscription auth
      // instead of trying to use API key authentication (which may have no credits)
      const filteredEnv: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (key !== 'ANTHROPIC_API_KEY') {
          filteredEnv[key] = value;
        }
      }

      const queryOptions = {
        pathToClaudeCodeExecutable: claudeExecutable,
        allowedTools: claudeCodeConfig.allowedTools,
        permissionMode: claudeCodeConfig.permissionMode,
        model: mapModelName(claudeCodeConfig.model),
        cwd: this.options.projectRoot,
        maxTurns: claudeCodeConfig.maxTurns,
        maxBudgetUsd: this.options.config.innerLoop.costLimit,
        env: filteredEnv,
      };

      this.log(`Starting Claude Code execution (using ${claudeExecutable})...`);

      for await (const message of query({
        prompt: fullPrompt,
        options: queryOptions,
      })) {
        this.processMessage(message, toolOutputs, (text) => {
          output += text + '\n';
          // Check if the agent signaled completion via text
          if (/TASK\s+COMPLETE/i.test(text)) {
            completed = true;
          }
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

          // Mark as completed if SDK says success OR if agent signaled completion
          completed = completed || (!result.is_error && result.subtype === 'success');
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
          message?: { content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> };
        };
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text' && block.text) {
              this.log(block.text);
              appendOutput(block.text);
            } else if (block.type === 'tool_use' && block.name) {
              this.log(`[Tool: ${block.name}]`);
              // Track pending tool call for later matching with result
              if (block.id && block.input) {
                this.pendingToolCalls.set(block.id, {
                  name: block.name,
                  input: block.input,
                });
                // Track file usage based on tool call
                this.trackToolCall(block.name, block.input);
              }
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

              // Track file usage from tool result
              const pendingCall = this.pendingToolCalls.get(toolId);
              if (pendingCall) {
                this.trackToolResult(pendingCall.name, pendingCall.input, resultContent);
                this.pendingToolCalls.delete(toolId);
              }

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

  /**
   * Track file usage from tool call input
   */
  private trackToolCall(toolName: string, input: Record<string, unknown>): void {
    // Claude Code tool names are capitalized (Read, Write, Edit, Bash, Glob, Grep)
    const name = toolName.toLowerCase();

    if (name === 'read' && input.file_path) {
      this.fileUsage.read.add(String(input.file_path));
    } else if ((name === 'write' || name === 'edit') && input.file_path) {
      this.fileUsage.written.add(String(input.file_path));
      this.firstWriteOccurred = true;
    } else if (name === 'bash' && input.command) {
      this.fileUsage.commands.push(String(input.command));
    }
  }

  /**
   * Track file usage from tool result (for search results)
   */
  private trackToolResult(toolName: string, _input: Record<string, unknown>, result: string): void {
    const name = toolName.toLowerCase();

    // Extract file paths from Grep/Glob results
    if (name === 'grep' || name === 'glob') {
      const lines = result.split('\n');
      for (const line of lines) {
        // Grep format: "file.ts:123: matched content" or just file paths
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const filePath = line.substring(0, colonIndex);
          // Avoid adding line numbers as file paths
          if (!filePath.match(/^\d+$/)) {
            this.fileUsage.searched.add(filePath);
          }
        } else if (line.trim() && !line.startsWith('(') && !line.includes(' ')) {
          // Plain file path from Glob
          this.fileUsage.searched.add(line.trim());
        }
      }
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
