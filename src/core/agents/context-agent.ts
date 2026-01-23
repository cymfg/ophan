/**
 * Context Agent
 *
 * Responsible for improving context selection for future tasks.
 * Analyzes which files were provided vs. actually used to learn
 * better context prediction.
 *
 * Guidelines: context.md
 * Criteria: context-quality.md
 */

import type {
  BaseAgent,
  AgentOptions,
  AgentGuidanceConfig,
  AgentMetrics,
  AgentOuterLoopResult,
} from './types.js';
import type { Proposal, ContextAggregateMetrics } from '../../types/index.js';
import { AbstractAgent, IdGenerator } from './utils.js';
import { ContextLogger } from '../context-logger.js';
import { LearningManager } from '../learning-manager.js';

/**
 * Context Agent - improves context selection through usage analysis
 */
export class ContextAgent extends AbstractAgent implements BaseAgent {
  readonly id = 'context-agent' as const;
  readonly name = 'Context Agent';
  readonly description =
    'Analyzes context usage to improve file selection for future tasks';

  readonly guidance: AgentGuidanceConfig = {
    guidelineFiles: ['context.md'],
    criteriaFiles: ['context-quality.md'],
  };

  private contextLogger: ContextLogger | null = null;
  private learningManager: LearningManager | null = null;

  async initialize(options: AgentOptions): Promise<void> {
    this.options = options;

    this.contextLogger = new ContextLogger({
      ophanDir: options.ophanDir,
    });

    this.learningManager = new LearningManager({
      ophanDir: options.ophanDir,
      config: options.config,
    });

    this.log('Context Agent initialized');
  }

  /**
   * Run the outer loop to analyze context usage and generate proposals
   */
  async runOuterLoop(
    lookbackDays: number,
    autoApplyGuidelines: boolean
  ): Promise<AgentOuterLoopResult> {
    this.ensureInitialized();

    const metrics = await this.contextLogger!.getAggregateMetrics(lookbackDays);

    if (metrics.tasksAnalyzed < 5) {
      return {
        proposals: [],
        metrics: this.mapMetrics(metrics),
        summary: `Not enough data (${metrics.tasksAnalyzed} tasks, need 5+)`,
      };
    }

    const proposals = await this.generateProposals(metrics, autoApplyGuidelines);

    return {
      proposals,
      metrics: this.mapMetrics(metrics),
      summary: `Analyzed ${metrics.tasksAnalyzed} tasks, hit rate ${metrics.averageHitRate.toFixed(0)}%, miss rate ${metrics.averageMissRate.toFixed(0)}%`,
    };
  }

  /**
   * Get current metrics for this agent
   */
  async getMetrics(): Promise<AgentMetrics[]> {
    this.ensureInitialized();

    const metrics = await this.contextLogger!.getAggregateMetrics(30);
    return this.mapMetrics(metrics);
  }

  /**
   * Generate proposals based on context usage metrics
   */
  private async generateProposals(
    metrics: ContextAggregateMetrics,
    autoApplyGuidelines: boolean
  ): Promise<Proposal[]> {
    const proposals: Proposal[] = [];

    // Proposal 1: Add commonly missed files to context guidelines
    if (metrics.commonMisses.length > 0 && metrics.averageMissRate > 20) {
      const proposal = this.createMissedFilesProposal(metrics);

      if (autoApplyGuidelines) {
        try {
          const targetPath = proposal.targetFile.replace('guidelines/', '');
          await this.learningManager!.applyGuidelineUpdate(targetPath, proposal.change);
          this.log(`Auto-applied: ${proposal.targetFile}`);
        } catch (error) {
          this.log(`Failed to update ${proposal.targetFile}: ${(error as Error).message}`);
          proposals.push(proposal);
        }
      } else {
        proposals.push(proposal);
      }
    }

    // Proposal 2: Remove commonly unused files from context
    // Filter out guideline/criteria files first - they are ALWAYS used
    const filteredUnused = metrics.commonUnused.filter(
      (m) => !this.isGuidelineOrCriteriaFile(m.file)
    );
    if (filteredUnused.length > 0 && metrics.averageHitRate < 70) {
      const proposal = this.createUnusedFilesProposal({ ...metrics, commonUnused: filteredUnused });

      if (autoApplyGuidelines) {
        try {
          const targetPath = proposal.targetFile.replace('guidelines/', '');
          await this.learningManager!.applyGuidelineUpdate(targetPath, proposal.change);
          this.log(`Auto-applied: ${proposal.targetFile}`);
        } catch (error) {
          this.log(`Failed to update ${proposal.targetFile}: ${(error as Error).message}`);
          proposals.push(proposal);
        }
      } else {
        proposals.push(proposal);
      }
    }

    // Proposal 3: Update context quality criteria if consistently failing
    if (metrics.averageHitRate < 50 || metrics.averageMissRate > 40) {
      proposals.push(this.createPerformanceAlertProposal(metrics));
    }

    return proposals;
  }

  /**
   * Create proposal for commonly missed files
   */
  private createMissedFilesProposal(metrics: ContextAggregateMetrics): Proposal {
    const topMisses = metrics.commonMisses.slice(0, 3);
    const fileList = topMisses.map((m) => `- \`${m.file}\``).join('\n');
    const patternSuggestions = this.extractPatterns(topMisses.map((m) => m.file));

    return {
      id: IdGenerator.contextProposal(),
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
    };
  }

  /**
   * Create proposal for commonly unused files
   */
  private createUnusedFilesProposal(metrics: ContextAggregateMetrics): Proposal {
    const topUnused = metrics.commonUnused.slice(0, 3);
    const fileList = topUnused.map((m) => `- \`${m.file}\``).join('\n');

    return {
      id: IdGenerator.contextProposal(),
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
    };
  }

  /**
   * Create proposal for performance alert
   */
  private createPerformanceAlertProposal(metrics: ContextAggregateMetrics): Proposal {
    return {
      id: IdGenerator.contextProposal(),
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
      confidence: 0.6,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
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
   * Map context metrics to agent metrics format
   */
  private mapMetrics(metrics: ContextAggregateMetrics): AgentMetrics[] {
    return [
      {
        name: 'Hit Rate',
        value: metrics.averageHitRate,
        target: 70,
        passed: metrics.averageHitRate >= 70,
      },
      {
        name: 'Miss Rate',
        value: metrics.averageMissRate,
        target: 20,
        passed: metrics.averageMissRate <= 20,
      },
      {
        name: 'Tasks Analyzed',
        value: metrics.tasksAnalyzed,
        passed: metrics.tasksAnalyzed >= 5,
      },
    ];
  }
}
