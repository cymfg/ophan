import Anthropic from '@anthropic-ai/sdk';
import type { OphanConfig } from '../types/index.js';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResponse {
  content: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

// Tool definitions for the agent
export const OPHAN_TOOLS: Anthropic.Tool[] = [
  {
    name: 'run_command',
    description:
      'Execute a shell command in the project directory. Use for running tests, linting, building, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file relative to project root',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'Path to the directory relative to project root (default: ".")',
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.ts")',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a pattern in files',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: ".")',
        },
        filePattern: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "*.ts")',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'task_complete',
    description:
      'Signal that the task is complete. Use this when you have finished the requested work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'A brief summary of what was accomplished',
        },
      },
      required: ['summary'],
    },
  },
];

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: OphanConfig) {
    this.client = new Anthropic();
    this.model = config.model.name;
    this.maxTokens = config.model.maxTokens;
  }

  async chat(
    systemPrompt: string,
    messages: ClaudeMessage[]
  ): Promise<ClaudeResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const textContent = response.content.find((c) => c.type === 'text');

    return {
      content: textContent?.text ?? '',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    };
  }

  async chatWithTools(
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[] = OPHAN_TOOLS
  ): Promise<ClaudeToolResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages,
      tools,
    });

    const textContent = response.content.find((c) => c.type === 'text');
    const toolUseBlocks = response.content.filter(
      (c) => c.type === 'tool_use'
    ) as Anthropic.ToolUseBlock[];

    const toolCalls: ToolCall[] = toolUseBlocks.map((block) => ({
      name: block.name,
      input: block.input as Record<string, unknown>,
    }));

    return {
      content: textContent?.text ?? '',
      toolCalls,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason,
    };
  }

  async streamChat(
    systemPrompt: string,
    messages: ClaudeMessage[],
    onChunk: (text: string) => void
  ): Promise<ClaudeResponse> {
    let inputTokens = 0;
    let outputTokens = 0;
    let fullContent = '';
    let stopReason: string | null = null;

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const text = event.delta.text;
        fullContent += text;
        onChunk(text);
      } else if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens;
        stopReason = event.delta.stop_reason;
      }
    }

    return {
      content: fullContent,
      inputTokens,
      outputTokens,
      stopReason,
    };
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    // Pricing for Claude 3.5 Sonnet (as of early 2024)
    // Input: $3 per million tokens
    // Output: $15 per million tokens
    const inputCost = (inputTokens / 1_000_000) * 3;
    const outputCost = (outputTokens / 1_000_000) * 15;
    return inputCost + outputCost;
  }
}
