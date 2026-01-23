import { promises as fs } from 'fs';
import path from 'path';
import type {
  ContextUsageLog,
  ContextUsageMetrics,
  ContextAggregateMetrics,
  FileUsage,
  Proposal,
} from '../types/index.js';

export interface ContextLoggerOptions {
  ophanDir: string;
}

/**
 * Manages context usage logs for the context agent's self-improvement loop.
 * Tracks what files were provided vs what files were actually used.
 */
export class ContextLogger {
  private logsDir: string;

  constructor(options: ContextLoggerOptions) {
    this.logsDir = path.join(options.ophanDir, 'context-logs');
  }

  /**
   * Ensure logs directory exists
   */
  async init(): Promise<void> {
    await fs.mkdir(this.logsDir, { recursive: true });
  }

  /**
   * Save a context usage log
   */
  async saveLog(log: ContextUsageLog): Promise<string> {
    await this.init();
    const logFile = path.join(this.logsDir, `${log.taskId}.json`);
    await fs.writeFile(logFile, JSON.stringify(log, null, 2), 'utf-8');
    return logFile;
  }

  /**
   * Load a context usage log by task ID
   */
  async loadLog(taskId: string): Promise<ContextUsageLog | null> {
    const logFile = path.join(this.logsDir, `${taskId}.json`);

    try {
      const content = await fs.readFile(logFile, 'utf-8');
      return JSON.parse(content) as ContextUsageLog;
    } catch {
      return null;
    }
  }

  /**
   * Load all context usage logs
   */
  async loadAllLogs(): Promise<ContextUsageLog[]> {
    try {
      await this.init();
      const files = await fs.readdir(this.logsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      const logs: ContextUsageLog[] = [];

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(
            path.join(this.logsDir, file),
            'utf-8'
          );
          logs.push(JSON.parse(content) as ContextUsageLog);
        } catch {
          // Skip invalid files
        }
      }

      return logs;
    } catch {
      return [];
    }
  }

  /**
   * Load logs since a given date
   */
  async loadLogsSince(since: Date): Promise<ContextUsageLog[]> {
    const allLogs = await this.loadAllLogs();
    return allLogs.filter((log) => new Date(log.timestamp) >= since);
  }

  /**
   * Compute aggregate metrics from logs
   */
  async getAggregateMetrics(lookbackDays: number = 30): Promise<ContextAggregateMetrics> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

    const logs = await this.loadLogsSince(cutoffDate);

    const metrics: ContextAggregateMetrics = {
      tasksAnalyzed: logs.length,
      averageHitRate: 0,
      averageMissRate: 0,
      averageExplorationTokens: 0,
      commonMisses: [],
      commonUnused: [],
      periodStart: cutoffDate.toISOString(),
      periodEnd: new Date().toISOString(),
    };

    if (logs.length === 0) {
      return metrics;
    }

    // Calculate averages
    let totalHitRate = 0;
    let totalMissRate = 0;
    let totalExplorationTokens = 0;

    // Track file frequencies
    const missedFiles = new Map<string, number>();
    const unusedFiles = new Map<string, number>();

    for (const log of logs) {
      totalHitRate += log.metrics.contextHitRate;
      totalMissRate += log.metrics.contextMissRate;
      totalExplorationTokens += log.metrics.explorationTokens;

      // Track commonly missed files (files used but not provided)
      const providedSet = new Set(log.providedContext.files ?? []);
      const usedFiles = new Set([
        ...log.actualUsage.filesRead,
        ...log.actualUsage.filesWritten,
      ]);

      for (const file of usedFiles) {
        if (!providedSet.has(file)) {
          missedFiles.set(file, (missedFiles.get(file) ?? 0) + 1);
        }
      }

      // Track commonly unused files (files provided but not used)
      // IMPORTANT: Exclude guideline and criteria files - they are always used
      // (injected into the system prompt) even though they're not read via tools
      for (const file of providedSet) {
        if (!usedFiles.has(file) && !this.isGuidelineOrCriteriaFile(file)) {
          unusedFiles.set(file, (unusedFiles.get(file) ?? 0) + 1);
        }
      }
    }

    metrics.averageHitRate = totalHitRate / logs.length;
    metrics.averageMissRate = totalMissRate / logs.length;
    metrics.averageExplorationTokens = totalExplorationTokens / logs.length;

    // Sort and get top missed/unused files
    metrics.commonMisses = [...missedFiles.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    metrics.commonUnused = [...unusedFiles.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return metrics;
  }

  /**
   * Compute context usage metrics for a single task
   */
  computeMetrics(
    providedFiles: string[],
    actualUsage: FileUsage,
    explorationTokens: number,
    totalTokens: number
  ): ContextUsageMetrics {
    const providedSet = new Set(providedFiles);
    const usedFiles = new Set([
      ...actualUsage.filesRead,
      ...actualUsage.filesWritten,
    ]);

    // Hit rate: % of provided files that were actually used
    // IMPORTANT: Guideline/criteria files are always "used" (in the prompt)
    // so we count them as hits and exclude them from the denominator
    let hitCount = 0;
    let nonGuidelineProvided = 0;
    for (const file of providedSet) {
      if (this.isGuidelineOrCriteriaFile(file)) {
        // Guidelines/criteria are always used - count as hit but don't add to denominator
        hitCount++;
      } else {
        nonGuidelineProvided++;
        if (usedFiles.has(file)) {
          hitCount++;
        }
      }
    }
    // Denominator is non-guideline files + guideline files (which all count as hits)
    const guidelineCount = providedSet.size - nonGuidelineProvided;
    const totalForHitRate = nonGuidelineProvided + guidelineCount;
    const contextHitRate =
      totalForHitRate > 0 ? (hitCount / totalForHitRate) * 100 : 100;

    // Miss rate: % of used files that weren't provided
    let missCount = 0;
    for (const file of usedFiles) {
      if (!providedSet.has(file)) {
        missCount++;
      }
    }
    const contextMissRate =
      usedFiles.size > 0 ? (missCount / usedFiles.size) * 100 : 0;

    return {
      contextHitRate,
      contextMissRate,
      explorationTokens,
      totalTokens,
    };
  }

  /**
   * Generate proposals for context guideline improvements based on metrics.
   * These proposals come from the Context Agent's outer loop.
   */
  async generateProposals(lookbackDays: number = 30): Promise<Proposal[]> {
    const metrics = await this.getAggregateMetrics(lookbackDays);
    const proposals: Proposal[] = [];

    if (metrics.tasksAnalyzed < 5) {
      // Not enough data to make meaningful proposals
      return proposals;
    }

    // Proposal 1: Add commonly missed files to context guidelines
    if (metrics.commonMisses.length > 0 && metrics.averageMissRate > 20) {
      const topMisses = metrics.commonMisses.slice(0, 3);
      const fileList = topMisses.map((m) => `- \`${m.file}\``).join('\n');
      const patternSuggestions = this.extractPatterns(topMisses.map((m) => m.file));

      proposals.push({
        id: this.generateProposalId(),
        type: 'guideline',
        source: 'context-agent',
        targetFile: 'guidelines/context.md',
        change: `APPEND:

## Commonly Needed Files

Based on ${metrics.tasksAnalyzed} tasks analyzed, these files are frequently needed but not provided:

${fileList}

${patternSuggestions ? `### Suggested Patterns\n\n${patternSuggestions}` : ''}

*Generated from context usage analysis on ${new Date().toISOString().split('T')[0]}*
`,
        reason: `Miss rate is ${metrics.averageMissRate.toFixed(1)}% (target: <20%). These files were needed in ${topMisses[0].count}+ tasks but not provided.`,
        confidence: Math.min(0.9, 0.5 + (topMisses[0].count / metrics.tasksAnalyzed) * 0.5),
        createdAt: new Date().toISOString(),
        status: 'pending',
      });
    }

    // Proposal 2: Remove commonly unused files from context
    if (metrics.commonUnused.length > 0 && metrics.averageHitRate < 70) {
      const topUnused = metrics.commonUnused.slice(0, 3);
      const fileList = topUnused.map((m) => `- \`${m.file}\``).join('\n');

      proposals.push({
        id: this.generateProposalId(),
        type: 'guideline',
        source: 'context-agent',
        targetFile: 'guidelines/context.md',
        change: `APPEND:

## Files to Exclude from Context

Based on ${metrics.tasksAnalyzed} tasks analyzed, these files are frequently provided but rarely used:

${fileList}

Consider removing these from default context packs to reduce token usage.

*Generated from context usage analysis on ${new Date().toISOString().split('T')[0]}*
`,
        reason: `Hit rate is ${metrics.averageHitRate.toFixed(1)}% (target: >70%). These files were provided but unused in ${topUnused[0].count}+ tasks.`,
        confidence: Math.min(0.8, 0.4 + (topUnused[0].count / metrics.tasksAnalyzed) * 0.4),
        createdAt: new Date().toISOString(),
        status: 'pending',
      });
    }

    // Proposal 3: Update context quality criteria if consistently failing
    if (metrics.averageHitRate < 50 || metrics.averageMissRate > 40) {
      proposals.push({
        id: this.generateProposalId(),
        type: 'criteria',
        source: 'context-agent',
        targetFile: 'criteria/context-quality.md',
        change: `APPEND:

## Performance Alert

Current metrics (${metrics.tasksAnalyzed} tasks):
- Hit Rate: ${metrics.averageHitRate.toFixed(1)}% (target: >70%)
- Miss Rate: ${metrics.averageMissRate.toFixed(1)}% (target: <20%)

Consider adjusting targets or implementing more aggressive context learning.

*Flagged on ${new Date().toISOString().split('T')[0]}*
`,
        reason: `Context prediction is significantly underperforming. Hit rate ${metrics.averageHitRate.toFixed(1)}%, miss rate ${metrics.averageMissRate.toFixed(1)}%.`,
        confidence: 0.6, // Lower confidence for criteria changes
        createdAt: new Date().toISOString(),
        status: 'pending',
      });
    }

    return proposals;
  }

  /**
   * Extract common patterns from file paths
   */
  private extractPatterns(filePaths: string[]): string {
    const patterns: string[] = [];

    // Check for common directories
    const dirs = new Map<string, number>();
    for (const file of filePaths) {
      const dir = file.split('/').slice(0, -1).join('/');
      if (dir) {
        dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
      }
    }

    for (const [dir, count] of dirs) {
      if (count >= 2) {
        patterns.push(`- Files in \`${dir}/\` directory are commonly needed`);
      }
    }

    // Check for common file types
    const extensions = new Map<string, number>();
    for (const file of filePaths) {
      const ext = file.split('.').pop();
      if (ext) {
        extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
      }
    }

    for (const [ext, count] of extensions) {
      if (count >= 2) {
        patterns.push(`- \`.${ext}\` files are commonly needed`);
      }
    }

    return patterns.join('\n');
  }

  private generateProposalId(): string {
    const now = new Date();
    return `ctx-${now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * Check if a file is a guideline or criteria file.
   * These files are always used (injected into the system prompt) even though
   * they're not read via tool calls during task execution.
   */
  private isGuidelineOrCriteriaFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return (
      normalized.includes('.ophan/guidelines/') ||
      normalized.includes('.ophan/criteria/') ||
      normalized.includes('/.ophan/guidelines/') ||
      normalized.includes('/.ophan/criteria/')
    );
  }

  /**
   * Format aggregate metrics for CLI display
   */
  formatMetrics(metrics: ContextAggregateMetrics): string {
    const lines: string[] = [];

    lines.push('Context Usage Statistics');
    lines.push('─'.repeat(45));
    lines.push('');
    lines.push(`Tasks analyzed: ${metrics.tasksAnalyzed}`);
    lines.push(`Period: ${metrics.periodStart.split('T')[0]} to ${metrics.periodEnd.split('T')[0]}`);
    lines.push('');
    lines.push('## Performance Metrics');
    lines.push(`  Average context hit rate:  ${metrics.averageHitRate.toFixed(1)}%`);
    lines.push(`  Average context miss rate: ${metrics.averageMissRate.toFixed(1)}%`);
    lines.push(`  Average exploration tokens: ${Math.round(metrics.averageExplorationTokens).toLocaleString()}`);
    lines.push('');

    if (metrics.commonMisses.length > 0) {
      lines.push('## Most Commonly Needed but Not Provided');
      for (const { file, count } of metrics.commonMisses.slice(0, 5)) {
        lines.push(`  ${file} (${count} tasks)`);
      }
      lines.push('');
    }

    if (metrics.commonUnused.length > 0) {
      lines.push('## Most Commonly Provided but Unused');
      for (const { file, count } of metrics.commonUnused.slice(0, 5)) {
        lines.push(`  ${file} (${count} tasks)`);
      }
    }

    // Add performance assessment
    lines.push('');
    lines.push('## Assessment');
    if (metrics.averageHitRate >= 70) {
      lines.push('  ✓ Hit rate meets target (>70%)');
    } else {
      lines.push('  ✗ Hit rate below target (>70%) - context includes irrelevant files');
    }
    if (metrics.averageMissRate <= 20) {
      lines.push('  ✓ Miss rate meets target (<20%)');
    } else {
      lines.push('  ✗ Miss rate above target (<20%) - context missing important files');
    }

    return lines.join('\n');
  }
}
