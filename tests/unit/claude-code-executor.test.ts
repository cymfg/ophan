import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeExecutor, convertToolOutputs } from '../../src/llm/claude-code-executor.js';
import type { OphanConfig } from '../../src/types/index.js';

// Mock the claude-agent-sdk
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

describe('ClaudeCodeExecutor', () => {
  const mockConfig: OphanConfig = {
    model: {
      name: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    },
    innerLoop: {
      maxIterations: 5,
      regenerationStrategy: 'informed',
    },
    outerLoop: {
      triggers: { afterTasks: 10 },
      minOccurrences: 3,
      minConfidence: 0.7,
      lookbackDays: 30,
      maxProposals: 5,
      learnings: {
        maxCount: 50,
        retentionDays: 90,
        promotionThreshold: 3,
        similarityThreshold: 0.9,
      },
    },
    guardrails: {
      protectedPaths: [],
      blockedCommands: [],
    },
    execution: {
      backend: 'claude-code',
      claudeCode: {
        model: 'sonnet',
        permissionMode: 'acceptEdits',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
        maxTurns: 50,
      },
    },
  };

  const defaultOptions = {
    projectRoot: '/test/project',
    config: mockConfig,
    onProgress: vi.fn(),
    onToolUse: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with valid options', () => {
      const executor = new ClaudeCodeExecutor(defaultOptions);
      expect(executor).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should return true when SDK is available', async () => {
      const available = await ClaudeCodeExecutor.isAvailable();
      expect(available).toBe(true);
    });
  });
});

describe('convertToolOutputs', () => {
  it('should convert tool outputs to expected format', () => {
    const toolOutputs = new Map<string, string[]>();
    toolOutputs.set('tool_1', ['File content here', 'More content']);
    toolOutputs.set('tool_2', ['Error: file not found']);

    const result = convertToolOutputs(toolOutputs);

    expect(result.get('tool_1')).toHaveLength(2);
    expect(result.get('tool_1')![0]).toEqual({
      success: true,
      output: 'File content here',
    });
    expect(result.get('tool_2')![0]).toEqual({
      success: false,
      output: 'Error: file not found',
    });
  });

  it('should handle empty tool outputs', () => {
    const toolOutputs = new Map<string, string[]>();
    const result = convertToolOutputs(toolOutputs);
    expect(result.size).toBe(0);
  });

  it('should detect errors case-insensitively', () => {
    const toolOutputs = new Map<string, string[]>();
    toolOutputs.set('tool_1', ['ERROR: something went wrong']);

    const result = convertToolOutputs(toolOutputs);
    expect(result.get('tool_1')![0].success).toBe(false);
  });
});
