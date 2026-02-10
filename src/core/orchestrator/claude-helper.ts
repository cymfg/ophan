/**
 * Claude Helper
 *
 * Shared utility for making Claude SDK query() calls.
 * Extracted from the duplicate implementations in reasoner.ts and goal-planner.ts.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';

export interface ClaudeQueryOptions {
  prompt: string;
  projectRoot: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTurns?: number;
}

/**
 * Find the Claude Code executable path
 */
export function findClaudeCodeExecutable(): string | undefined {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where claude', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const paths = result
        .trim()
        .split('\n')
        .filter((p) => p.trim());
      const nonNodeModules = paths.filter((p) => !p.includes('node_modules'));
      return nonNodeModules[0] || paths[0] || undefined;
    } else {
      const result = execSync('which -a claude', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const paths = result
        .trim()
        .split('\n')
        .filter((p) => p.trim());
      const nonNodeModules = paths.filter((p) => !p.includes('node_modules'));
      return nonNodeModules[0] || paths[0] || undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Run a Claude SDK query and return the text output.
 * Uses allowedTools: [] (reasoning only, no tool access).
 */
export async function runClaude(options: ClaudeQueryOptions): Promise<string> {
  const claudeExecutable = findClaudeCodeExecutable();
  if (!claudeExecutable) {
    throw new Error('Claude Code executable not found');
  }

  // Filter out ANTHROPIC_API_KEY to force subscription auth
  const filteredEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ANTHROPIC_API_KEY') {
      filteredEnv[key] = value;
    }
  }

  let output = '';

  for await (const message of query({
    prompt: options.prompt,
    options: {
      pathToClaudeCodeExecutable: claudeExecutable,
      allowedTools: [],
      permissionMode: 'default',
      model: options.model ?? 'sonnet',
      cwd: options.projectRoot,
      maxTurns: options.maxTurns ?? 5,
      env: filteredEnv,
    },
  })) {
    if (message.type === 'assistant') {
      const assistantMsg = message as {
        type: 'assistant';
        message?: { content?: Array<{ type: string; text?: string }> };
      };
      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text' && block.text) {
            output += block.text;
          }
        }
      }
    } else if (message.type === 'result') {
      const result = message as { type: 'result'; result?: string };
      if (result.result) {
        output += result.result;
      }
    }
  }

  return output;
}

/**
 * Extract the first balanced JSON object from a string.
 * Handles cases where Claude adds explanatory text after the JSON.
 */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Parse a JSON object from Claude's text response.
 * Uses balanced-brace extraction so trailing text doesn't break parsing.
 * Falls back to null if no valid JSON found.
 */
export function parseJsonResponse<T>(raw: string): T | null {
  try {
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) return null;
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}
