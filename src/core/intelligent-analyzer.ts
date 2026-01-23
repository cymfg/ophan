/**
 * Intelligent Pattern Analyzer
 *
 * Uses Claude Code to analyze task logs and generate meaningful,
 * actionable recommendations for guideline/criteria improvements.
 *
 * Unlike the naive pattern-detector, this actually understands:
 * - What went wrong semantically
 * - Root causes vs symptoms
 * - Infrastructure failures vs workflow issues
 * - Actionable vs unhelpful suggestions
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'child_process';
import type { Proposal, OphanConfig, TaskLog, Task } from '../types/index.js';

export interface TaskLogEntry {
  task: Task;
  logs: TaskLog[];
}

export interface AnalysisResult {
  patterns: AnalyzedPattern[];
  proposals: Proposal[];
  summary: string;
}

export interface AnalyzedPattern {
  /** Human-readable description of what's happening */
  description: string;
  /** Category: infrastructure, workflow, code_quality, testing, etc. */
  category: 'infrastructure' | 'workflow' | 'code_quality' | 'testing' | 'configuration' | 'other';
  /** Root cause analysis */
  rootCause: string;
  /** How many tasks were affected */
  occurrences: number;
  /** Task IDs affected */
  affectedTasks: string[];
  /** Whether this is actionable (vs transient/external issue) */
  isActionable: boolean;
  /** Confidence 0-1 */
  confidence: number;
}

export interface IntelligentAnalyzerOptions {
  ophanDir: string;
  projectRoot: string;
  config: OphanConfig;
  onProgress?: (message: string) => void;
}

/**
 * Find the Claude Code executable path
 */
function findClaudeCodeExecutable(): string | undefined {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const paths = result.trim().split('\n').filter(p => p.trim());
      const nonNodeModules = paths.filter(p => !p.includes('node_modules'));
      return nonNodeModules[0] || paths[0] || undefined;
    } else {
      const result = execSync('which -a claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const paths = result.trim().split('\n').filter(p => p.trim());
      const nonNodeModules = paths.filter(p => !p.includes('node_modules'));
      return nonNodeModules[0] || paths[0] || undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Intelligent analyzer that uses Claude to understand patterns
 */
export class IntelligentAnalyzer {
  private options: IntelligentAnalyzerOptions;

  constructor(options: IntelligentAnalyzerOptions) {
    this.options = options;
  }

  /**
   * Analyze task logs and generate intelligent proposals
   */
  async analyze(taskLogs: TaskLogEntry[]): Promise<AnalysisResult> {
    if (taskLogs.length === 0) {
      return {
        patterns: [],
        proposals: [],
        summary: 'No task logs to analyze',
      };
    }

    this.log(`Analyzing ${taskLogs.length} task logs with Claude...`);

    // Prepare a summary of the task logs for analysis
    const logSummary = this.prepareLogSummary(taskLogs);

    // Use Claude to analyze the patterns
    const analysisPrompt = this.buildAnalysisPrompt(logSummary);

    try {
      const analysis = await this.runClaudeAnalysis(analysisPrompt);
      return this.parseAnalysisResult(analysis, taskLogs);
    } catch (error) {
      this.log(`Analysis failed: ${(error as Error).message}`);
      return {
        patterns: [],
        proposals: [],
        summary: `Analysis failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Prepare a summary of task logs for Claude to analyze
   */
  private prepareLogSummary(taskLogs: TaskLogEntry[]): string {
    const summaries: string[] = [];

    for (const entry of taskLogs) {
      const task = entry.task;
      const lastLog = entry.logs[entry.logs.length - 1];

      // Build a concise summary of each task
      const summary: string[] = [
        `## Task: ${task.id}`,
        `Description: ${task.description}`,
        `Status: ${task.status}`,
        `Iterations: ${task.iterations}/${task.maxIterations}`,
      ];

      // Add evaluation results
      if (lastLog?.evaluation) {
        summary.push(`Final Score: ${lastLog.evaluation.score}/100`);
        summary.push(`Passed: ${lastLog.evaluation.passed}`);

        if (lastLog.evaluation.failures.length > 0) {
          summary.push('Failures:');
          for (const failure of lastLog.evaluation.failures) {
            summary.push(`  - [${failure.severity}] ${failure.criterion}: ${failure.message}`);
          }
        }
      }

      // Add key excerpts from output (truncated to avoid token bloat)
      if (lastLog?.output) {
        const truncatedOutput = lastLog.output.slice(0, 1000);
        if (truncatedOutput.includes('error') || truncatedOutput.includes('Error') || truncatedOutput.includes('fail')) {
          summary.push('Output excerpt (contains errors):');
          summary.push('```');
          summary.push(truncatedOutput);
          summary.push('```');
        }
      }

      summaries.push(summary.join('\n'));
    }

    return summaries.join('\n\n---\n\n');
  }

  /**
   * Build the prompt for Claude to analyze patterns
   */
  private buildAnalysisPrompt(logSummary: string): string {
    return `You are an expert at analyzing software development task logs to identify patterns and suggest improvements.

## Context

I'm running an AI coding agent called Ophan that executes tasks through an iterative loop. After each run, it evaluates the output against criteria. I need you to analyze recent task logs to identify patterns and suggest actionable improvements.

## Task Logs to Analyze

${logSummary}

## Your Analysis Task

Analyze these logs and provide:

1. **Pattern Identification**: What recurring issues or patterns do you see?
   - Distinguish between infrastructure issues (API errors, auth problems, network issues) vs actual workflow problems
   - Infrastructure issues are NOT actionable through guideline changes
   - Workflow issues (test failures, code quality, missing steps) ARE actionable

2. **Root Cause Analysis**: For each pattern, what's the underlying cause?
   - Don't just describe symptoms, explain WHY they're happening
   - Group related failures together

3. **Actionable Recommendations**: For patterns that CAN be fixed through guidelines/criteria changes, suggest specific improvements
   - Be specific: "Add a step to run tests before marking complete" not "improve testing"
   - Target the right file: coding.md for workflow, testing.md for test-related, security.md for security
   - If it's an infrastructure issue (API credits, auth), say so and DON'T suggest a guideline change

## Response Format

Respond with a JSON object in this exact format:

\`\`\`json
{
  "patterns": [
    {
      "description": "Human-readable description of the pattern",
      "category": "infrastructure|workflow|code_quality|testing|configuration|other",
      "rootCause": "Explanation of why this is happening",
      "occurrences": 5,
      "affectedTaskIds": ["task-123", "task-456"],
      "isActionable": true,
      "confidence": 0.85
    }
  ],
  "recommendations": [
    {
      "targetFile": "testing.md",
      "type": "guideline",
      "change": "Specific text to add or change",
      "reason": "Why this will help",
      "confidence": 0.8
    }
  ],
  "summary": "Brief overall assessment of the task execution health"
}
\`\`\`

Important:
- Only include recommendations for patterns where isActionable is true
- Don't suggest guideline changes for infrastructure/external issues
- Be specific and actionable, not generic
- If there are no actionable patterns, return empty arrays for patterns and recommendations`;
  }

  /**
   * Run Claude analysis using the SDK
   */
  private async runClaudeAnalysis(prompt: string): Promise<string> {
    const claudeExecutable = findClaudeCodeExecutable();
    if (!claudeExecutable) {
      throw new Error('Claude Code executable not found');
    }

    // Filter out ANTHROPIC_API_KEY
    const filteredEnv: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== 'ANTHROPIC_API_KEY') {
        filteredEnv[key] = value;
      }
    }

    const claudeCodeConfig = this.options.config.claudeCode ?? {
      model: 'sonnet' as const,
      permissionMode: 'acceptEdits' as const,
      allowedTools: [],
      maxTurns: 5,
    };

    let output = '';

    for await (const message of query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: claudeExecutable,
        allowedTools: [], // No tools needed for analysis
        permissionMode: 'default',
        model: claudeCodeConfig.model,
        cwd: this.options.projectRoot,
        maxTurns: 5,
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
   * Parse Claude's analysis into structured results
   */
  private parseAnalysisResult(rawOutput: string, taskLogs: TaskLogEntry[]): AnalysisResult {
    // Extract JSON from the response
    const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      // Try to find raw JSON
      const rawJsonMatch = rawOutput.match(/\{[\s\S]*"patterns"[\s\S]*\}/);
      if (!rawJsonMatch) {
        this.log('Could not parse analysis result as JSON');
        return {
          patterns: [],
          proposals: [],
          summary: 'Analysis completed but could not parse results',
        };
      }
      return this.parseJson(rawJsonMatch[0], taskLogs);
    }

    return this.parseJson(jsonMatch[1], taskLogs);
  }

  private parseJson(jsonStr: string, taskLogs: TaskLogEntry[]): AnalysisResult {
    try {
      const parsed = JSON.parse(jsonStr) as {
        patterns?: Array<{
          description: string;
          category: string;
          rootCause: string;
          occurrences: number;
          affectedTaskIds?: string[];
          isActionable: boolean;
          confidence: number;
        }>;
        recommendations?: Array<{
          targetFile: string;
          type: string;
          change: string;
          reason: string;
          confidence: number;
        }>;
        summary?: string;
      };

      const patterns: AnalyzedPattern[] = (parsed.patterns ?? []).map(p => ({
        description: p.description,
        category: (p.category as AnalyzedPattern['category']) || 'other',
        rootCause: p.rootCause,
        occurrences: p.occurrences,
        affectedTasks: p.affectedTaskIds ?? [],
        isActionable: p.isActionable,
        confidence: p.confidence,
      }));

      const proposals: Proposal[] = (parsed.recommendations ?? []).map(r => ({
        id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: r.type === 'criteria' ? 'criteria' : 'guideline',
        source: 'task-agent' as const,
        targetFile: r.targetFile,
        change: r.change,
        reason: r.reason,
        confidence: r.confidence,
        createdAt: new Date().toISOString(),
        status: 'pending' as const,
      }));

      return {
        patterns,
        proposals,
        summary: parsed.summary ?? `Analyzed ${taskLogs.length} tasks, found ${patterns.length} patterns`,
      };
    } catch (error) {
      this.log(`JSON parse error: ${(error as Error).message}`);
      return {
        patterns: [],
        proposals: [],
        summary: 'Analysis completed but results could not be parsed',
      };
    }
  }

  private log(message: string): void {
    this.options.onProgress?.(message);
  }
}
