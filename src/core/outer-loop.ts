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
import { WebhookClient } from '../integrations/webhook.js';
import {
  AgentRegistry,
  TaskAgent,
  ContextAgent,
  type AgentMetrics,
} from './agents/index.js';

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
  /** All proposals (guidelines + criteria) for interactive review */
  proposalsGenerated: Proposal[];
  learningsConsolidated: {
    kept: number;
    promoted: number;
    removed: number;
  };
  /** Guidelines updated (only populated in auto-apply mode) */
  guidelinesUpdated: string[];
  /** Metrics from all agents */
  agentMetrics: Map<string, AgentMetrics[]>;
  digestPath?: string;
}

export interface OuterLoopExecuteOptions {
  /** Auto-apply guideline changes without interactive review */
  autoApplyGuidelines?: boolean;
}

/**
 * The outer loop execution engine
 *
 * Coordinates all registered agents to:
 * - Analyze task logs and detect patterns
 * - Generate proposals from each agent
 * - Create a consolidated digest report
 */
export class OuterLoop {
  private options: OuterLoopOptions;
  private patternDetector: PatternDetector;
  private webhookClient: WebhookClient;
  private registry: AgentRegistry;

  constructor(options: OuterLoopOptions) {
    this.options = options;

    this.patternDetector = new PatternDetector({
      minOccurrences: options.config.outerLoop.minOccurrences,
      minConfidence: options.config.outerLoop.minConfidence,
    });

    this.webhookClient = new WebhookClient(
      options.config,
      options.projectName,
      options.projectRoot
    );

    // Initialize agent registry with all agents
    this.registry = new AgentRegistry();
    this.registry.register(new TaskAgent());
    this.registry.register(new ContextAgent());
  }

  /**
   * Execute the outer loop review
   */
  async execute(options: OuterLoopExecuteOptions = {}): Promise<OuterLoopResult> {
    this.log('Starting outer loop review...');

    // Initialize all agents
    await this.registry.initializeAll({
      projectRoot: this.options.projectRoot,
      ophanDir: this.options.ophanDir,
      config: this.options.config,
      onProgress: (msg) => this.log(msg),
    });

    // Set state on TaskAgent (it needs learnings for consolidation)
    const taskAgent = this.registry.get('task-agent') as TaskAgent | undefined;
    if (taskAgent) {
      taskAgent.setState(this.options.state);
    }

    // Load task logs for pattern detection and digest
    const taskLogs = await this.loadTaskLogs();
    this.log(`Loaded ${taskLogs.length} task logs`);

    // Detect patterns (still done centrally for digest)
    const patterns = this.patternDetector.detectPatterns(taskLogs);
    this.log(`Detected ${patterns.length} patterns`);

    // Run outer loop for all agents and collect proposals
    this.log('Running agent outer loops...');
    const registryResult = await this.registry.runAllOuterLoops(
      this.options.config.outerLoop.lookbackDays,
      options.autoApplyGuidelines ?? false
    );

    // Collect all proposals (limited by maxProposals)
    const proposals = registryResult.proposals.slice(
      0,
      this.options.config.outerLoop.maxProposals
    );

    this.log(`Generated ${proposals.length} total proposals for review`);

    // Get consolidation stats from task agent result
    const taskAgentResult = registryResult.agentResults.get('task-agent');
    const learningsConsolidated = {
      kept: 0,
      promoted: 0,
      removed: 0,
    };

    // Parse from summary if available (format: "X patterns, Y proposals, Z auto-applied")
    if (taskAgentResult?.summary) {
      // The TaskAgent tracks this internally, for now just report what we have
      // In a future refactor, TaskAgent could expose this more cleanly
    }

    // Generate digest
    const digestPath = await this.generateDigest(
      taskLogs,
      patterns,
      proposals,
      learningsConsolidated,
      registryResult.guidelinesUpdated,
      registryResult.metrics
    );
    this.log(`Generated digest: ${digestPath}`);

    // Send digest webhook notification
    await this.sendDigestWebhook(
      taskLogs,
      patterns,
      learningsConsolidated,
      digestPath
    );

    // Collect metrics by agent
    const agentMetrics = new Map<string, AgentMetrics[]>();
    for (const [agentId, result] of registryResult.agentResults) {
      agentMetrics.set(agentId, result.metrics);
    }

    return {
      patternsDetected: patterns,
      proposalsGenerated: proposals,
      learningsConsolidated,
      guidelinesUpdated: registryResult.guidelinesUpdated,
      agentMetrics,
      digestPath,
    };
  }

  /**
   * Get the agent registry (for CLI commands that need direct access)
   */
  getRegistry(): AgentRegistry {
    return this.registry;
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
   * Generate a digest report
   */
  private async generateDigest(
    taskLogs: TaskLogEntry[],
    patterns: Pattern[],
    proposals: Proposal[],
    consolidation: {
      kept: number;
      promoted: number;
      removed: number;
    },
    guidelinesUpdated: string[],
    agentMetrics: AgentMetrics[]
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

    // Format agent metrics
    const metricsSection = agentMetrics.length > 0
      ? agentMetrics.map((m) => {
          const status = m.passed ? '✓' : '✗';
          const targetStr = m.target !== undefined ? ` (target: ${m.target})` : '';
          return `- ${status} ${m.name}: ${m.value.toFixed(1)}${targetStr}`;
        }).join('\n')
      : 'No agent metrics available.';

    // Group proposals by source
    const taskAgentProposals = proposals.filter((p) => p.source === 'task-agent');
    const contextAgentProposals = proposals.filter((p) => p.source === 'context-agent');

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

## Agent Metrics

${metricsSection}

---

## Patterns Detected

${patterns.length > 0 ? this.patternDetector.formatPatterns(patterns) : 'No significant patterns detected.'}

---

## Learnings Consolidation

- **Kept:** ${consolidation.kept}
- **Promoted to Guidelines:** ${consolidation.promoted}
- **Removed (duplicates/old):** ${consolidation.removed}

---

## Guidelines Updated

${guidelinesUpdated.length > 0 ? guidelinesUpdated.map((f) => `- ${f}`).join('\n') : 'No guidelines updated.'}

---

## Pending Proposals

### Task Agent (${taskAgentProposals.length})

${
  taskAgentProposals.length > 0
    ? taskAgentProposals
        .map(
          (p) => `#### ${p.id}

**Type:** ${p.type}
**Target:** ${p.targetFile}
**Confidence:** ${(p.confidence * 100).toFixed(0)}%

**Reason:** ${p.reason}
`
        )
        .join('\n---\n\n')
    : 'No proposals.'
}

### Context Agent (${contextAgentProposals.length})

${
  contextAgentProposals.length > 0
    ? contextAgentProposals
        .map(
          (p) => `#### ${p.id}

**Type:** ${p.type}
**Target:** ${p.targetFile}
**Confidence:** ${(p.confidence * 100).toFixed(0)}%

**Reason:** ${p.reason}
`
        )
        .join('\n---\n\n')
    : 'No proposals.'
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

*Generated by Ophan Outer Loop (Multi-Agent)*
`;

    await fs.writeFile(digestPath, content, 'utf-8');
    return digestPath;
  }

  /**
   * Send digest webhook notification
   */
  private async sendDigestWebhook(
    taskLogs: TaskLogEntry[],
    patterns: Pattern[],
    consolidation: { kept: number; promoted: number; removed: number },
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
          learningsPromoted: consolidation.promoted,
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
