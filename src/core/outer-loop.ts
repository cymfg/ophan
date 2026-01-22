import { promises as fs } from 'fs';
import path from 'path';
import type {
  OphanConfig,
  OphanState,
  Pattern,
  Proposal,
  Task,
  TaskLog,
} from '../types/index.js';
import {
  PatternDetector,
  type TaskLogEntry,
} from './pattern-detector.js';
import { LearningManager } from './learning-manager.js';
import { WebhookClient } from '../integrations/webhook.js';

export interface OuterLoopOptions {
  projectRoot: string;
  projectName: string;
  ophanDir: string;
  config: OphanConfig;
  state: OphanState;
  onProgress?: (message: string) => void;
}

export interface OuterLoopResult {
  patternsDetected: Pattern[];
  proposalsGenerated: Proposal[];
  learningsConsolidated: {
    kept: number;
    promoted: number;
    removed: number;
  };
  guidelinesUpdated: string[];
  digestPath?: string;
}

/**
 * The outer loop execution engine
 * Analyzes task logs, detects patterns, consolidates learnings, and generates proposals
 */
export class OuterLoop {
  private options: OuterLoopOptions;
  private patternDetector: PatternDetector;
  private learningManager: LearningManager;
  private webhookClient: WebhookClient;

  constructor(options: OuterLoopOptions) {
    this.options = options;
    this.patternDetector = new PatternDetector({
      minOccurrences: options.config.outerLoop.minOccurrences,
      minConfidence: options.config.outerLoop.minConfidence,
    });
    this.learningManager = new LearningManager({
      ophanDir: options.ophanDir,
      config: options.config,
    });
    this.webhookClient = new WebhookClient(
      options.config,
      options.projectName,
      options.projectRoot
    );
  }

  /**
   * Execute the outer loop review
   */
  async execute(): Promise<OuterLoopResult> {
    this.log('Starting outer loop review...');

    // 1. Load task logs
    const taskLogs = await this.loadTaskLogs();
    this.log(`Loaded ${taskLogs.length} task logs`);

    // 2. Detect patterns
    this.log('Analyzing patterns...');
    const patterns = this.patternDetector.detectPatterns(taskLogs);
    this.log(`Detected ${patterns.length} patterns`);

    // 3. Consolidate learnings
    this.log('Consolidating learnings...');
    const consolidationResult = await this.learningManager.consolidate(
      this.options.state.learnings
    );
    this.log(
      `Learnings: ${consolidationResult.kept.length} kept, ${consolidationResult.promoted.length} promoted, ${consolidationResult.removed.length} removed`
    );

    // 4. Generate proposals from patterns
    this.log('Generating proposals...');
    const proposals = this.generateProposals(patterns);
    this.log(`Generated ${proposals.length} proposals`);

    // 5. Apply guideline updates (automatic for guidelines, proposals for criteria)
    const guidelinesUpdated: string[] = [];

    // Auto-apply guideline updates from promoted learnings
    const guidelineProposals = this.learningManager.generateGuidelineProposals(
      consolidationResult.promoted
    );

    for (const proposal of guidelineProposals) {
      try {
        await this.learningManager.applyGuidelineUpdate(
          proposal.file,
          proposal.content
        );
        guidelinesUpdated.push(proposal.file);
        this.log(`Updated guideline: ${proposal.file}`);
      } catch (error) {
        this.log(`Failed to update ${proposal.file}: ${(error as Error).message}`);
      }
    }

    // Auto-apply pattern-based guideline updates
    for (const pattern of patterns) {
      if (pattern.suggestedAction?.target === 'guideline') {
        const file = pattern.suggestedAction.file;
        const content = `\n## Pattern-Based Update\n\n**Detected:** ${new Date().toISOString()}\n**Pattern:** ${pattern.signature}\n**Occurrences:** ${pattern.occurrences}\n\n${pattern.suggestedAction.change}\n\n---\n`;

        try {
          await this.learningManager.applyGuidelineUpdate(file, content);
          if (!guidelinesUpdated.includes(file)) {
            guidelinesUpdated.push(file);
          }
          this.log(`Updated guideline from pattern: ${file}`);
        } catch (error) {
          this.log(`Failed to update ${file}: ${(error as Error).message}`);
        }
      }
    }

    // 6. Rewrite learnings file with consolidated learnings
    await this.learningManager.rewriteLearningsFile(consolidationResult.kept);
    this.log('Updated learnings file');

    // 7. Generate digest
    const digestPath = await this.generateDigest(
      taskLogs,
      patterns,
      proposals,
      consolidationResult,
      guidelinesUpdated
    );
    this.log(`Generated digest: ${digestPath}`);

    // 8. Send digest webhook notification
    await this.sendDigestWebhook(taskLogs, patterns, consolidationResult, digestPath);

    return {
      patternsDetected: patterns,
      proposalsGenerated: proposals,
      learningsConsolidated: {
        kept: consolidationResult.kept.length,
        promoted: consolidationResult.promoted.length,
        removed: consolidationResult.removed.length,
      },
      guidelinesUpdated,
      digestPath,
    };
  }

  /**
   * Load task logs from the logs directory
   */
  private async loadTaskLogs(): Promise<TaskLogEntry[]> {
    const logsDir = path.join(this.options.ophanDir, 'logs');
    const lookbackDate = new Date();
    lookbackDate.setDate(
      lookbackDate.getDate() - this.options.config.outerLoop.lookbackDays
    );

    const entries: TaskLogEntry[] = [];

    try {
      const files = await fs.readdir(logsDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(logsDir, file), 'utf-8');
          const data = JSON.parse(content) as {
            task: Task;
            logs: TaskLog[];
          };

          // Check if within lookback period
          const taskDate = new Date(data.task.startedAt);
          if (taskDate >= lookbackDate) {
            entries.push(data);
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Logs directory might not exist yet
    }

    // Sort by date
    return entries.sort(
      (a, b) =>
        new Date(a.task.startedAt).getTime() -
        new Date(b.task.startedAt).getTime()
    );
  }

  /**
   * Generate proposals from patterns
   */
  private generateProposals(patterns: Pattern[]): Proposal[] {
    const proposals: Proposal[] = [];

    // Only create proposals for criteria changes (guidelines are auto-applied)
    for (const pattern of patterns) {
      if (pattern.suggestedAction?.target === 'criteria') {
        proposals.push({
          id: this.generateProposalId(),
          type: 'criteria',
          targetFile: pattern.suggestedAction.file,
          change: pattern.suggestedAction.change,
          reason: `Detected pattern: ${pattern.signature} (${pattern.occurrences} occurrences, ${(pattern.confidence * 100).toFixed(0)}% confidence)`,
          confidence: pattern.confidence,
          createdAt: new Date().toISOString(),
          status: 'pending',
        });
      }
    }

    // Limit to maxProposals
    return proposals.slice(0, this.options.config.outerLoop.maxProposals);
  }

  /**
   * Generate a digest report
   */
  private async generateDigest(
    taskLogs: TaskLogEntry[],
    patterns: Pattern[],
    proposals: Proposal[],
    consolidation: {
      kept: unknown[];
      promoted: unknown[];
      removed: unknown[];
    },
    guidelinesUpdated: string[]
  ): Promise<string> {
    const digestsDir = path.join(this.options.ophanDir, 'digests');
    await fs.mkdir(digestsDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const digestPath = path.join(digestsDir, `${date}.md`);

    // Calculate metrics
    const totalTasks = taskLogs.length;
    const successfulTasks = taskLogs.filter(
      (t) => t.task.status === 'converged'
    ).length;
    const failedTasks = taskLogs.filter((t) => t.task.status === 'failed').length;
    const escalatedTasks = taskLogs.filter(
      (t) => t.task.status === 'escalated'
    ).length;
    const avgIterations =
      totalTasks > 0
        ? taskLogs.reduce((sum, t) => sum + t.task.iterations, 0) / totalTasks
        : 0;
    const totalCost = taskLogs.reduce((sum, t) => sum + t.task.cost, 0);

    const content = `# Ophan Review Digest

**Generated:** ${new Date().toISOString()}
**Lookback Period:** ${this.options.config.outerLoop.lookbackDays} days
**Tasks Analyzed:** ${totalTasks}

---

## Summary

| Metric | Value |
|--------|-------|
| Total Tasks | ${totalTasks} |
| Successful | ${successfulTasks} (${totalTasks > 0 ? ((successfulTasks / totalTasks) * 100).toFixed(1) : 0}%) |
| Failed | ${failedTasks} |
| Escalated | ${escalatedTasks} |
| Avg Iterations | ${avgIterations.toFixed(2)} |
| Total Cost | $${totalCost.toFixed(4)} |

---

## Patterns Detected

${patterns.length > 0 ? this.patternDetector.formatPatterns(patterns) : 'No significant patterns detected.'}

---

## Learnings Consolidation

- **Kept:** ${consolidation.kept.length}
- **Promoted to Guidelines:** ${consolidation.promoted.length}
- **Removed (duplicates/old):** ${consolidation.removed.length}

---

## Guidelines Updated

${guidelinesUpdated.length > 0 ? guidelinesUpdated.map((f) => `- ${f}`).join('\n') : 'No guidelines updated.'}

---

## Pending Proposals

${
  proposals.length > 0
    ? proposals
        .map(
          (p) => `### ${p.id}

**Type:** ${p.type}
**Target:** ${p.targetFile}
**Confidence:** ${(p.confidence * 100).toFixed(0)}%

**Change:**
${p.change}

**Reason:**
${p.reason}
`
        )
        .join('\n---\n\n')
    : 'No proposals generated.'
}

---

## Recent Tasks

${taskLogs
  .slice(-10)
  .reverse()
  .map(
    (t) =>
      `- **${t.task.id}** - ${t.task.status} (${t.task.iterations} iter, $${t.task.cost.toFixed(4)})
  ${t.task.description.slice(0, 80)}${t.task.description.length > 80 ? '...' : ''}`
  )
  .join('\n')}

---

*Generated by Ophan Outer Loop*
`;

    await fs.writeFile(digestPath, content, 'utf-8');
    return digestPath;
  }

  private generateProposalId(): string {
    const now = new Date();
    return `proposal-${now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
  }

  /**
   * Send digest webhook notification
   */
  private async sendDigestWebhook(
    taskLogs: TaskLogEntry[],
    patterns: Pattern[],
    consolidation: { kept: unknown[]; promoted: unknown[]; removed: unknown[] },
    digestPath: string
  ): Promise<void> {
    const totalTasks = taskLogs.length;
    const successfulTasks = taskLogs.filter(
      (t) => t.task.status === 'converged'
    ).length;
    const failedTasks = taskLogs.filter((t) => t.task.status === 'failed').length;
    const escalatedTasks = taskLogs.filter(
      (t) => t.task.status === 'escalated'
    ).length;

    try {
      const results = await this.webhookClient.sendDigest(
        {
          totalTasks,
          successfulTasks,
          failedTasks,
          escalatedTasks,
          patternsDetected: patterns.length,
          learningsPromoted: consolidation.promoted.length,
        },
        digestPath
      );

      for (const result of results) {
        if (result.success) {
          this.log(`Webhook ${result.webhook}: digest sent`);
        } else {
          this.log(`Webhook ${result.webhook}: failed - ${result.error}`);
        }
      }
    } catch (error) {
      this.log(`Failed to send digest webhooks: ${(error as Error).message}`);
    }
  }

  private log(message: string): void {
    this.options.onProgress?.(message);
  }
}
