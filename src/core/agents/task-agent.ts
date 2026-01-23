/**
 * Task Agent
 *
 * The primary agent responsible for executing coding tasks.
 * Implements both inner loop (task execution) and outer loop (learning).
 *
 * Guidelines: coding.md, testing.md, learnings.md
 * Criteria: quality.md, security.md
 */

import type {
  ExecutableAgent,
  AgentOptions,
  AgentGuidanceConfig,
  AgentMetrics,
  AgentOuterLoopResult,
  ExecutionResult,
} from './types.js';
import type { Proposal, OphanConfig, OphanState } from '../../types/index.js';
import { AbstractAgent, IdGenerator, ContentLoader } from './utils.js';
import { InnerLoop, type InnerLoopResult } from '../inner-loop.js';
import { IntelligentAnalyzer, type TaskLogEntry } from '../intelligent-analyzer.js';
import { LearningManager } from '../learning-manager.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Task Agent - executes coding tasks and learns from patterns
 */
export class TaskAgent extends AbstractAgent implements ExecutableAgent {
  readonly id = 'task-agent' as const;
  readonly name = 'Task Execution Agent';
  readonly description =
    'Executes coding tasks through iterative refinement with evaluation-driven convergence';
  readonly canExecuteTasks = true as const;

  readonly guidance: AgentGuidanceConfig = {
    guidelineFiles: ['coding.md', 'testing.md', 'learnings.md'],
    criteriaFiles: ['quality.md', 'security.md'],
  };

  private config: OphanConfig | null = null;
  private state: OphanState | null = null;
  private intelligentAnalyzer: IntelligentAnalyzer | null = null;
  private learningManager: LearningManager | null = null;

  async initialize(options: AgentOptions): Promise<void> {
    this.options = options;
    this.config = options.config;

    this.intelligentAnalyzer = new IntelligentAnalyzer({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
      config: options.config,
      onProgress: (msg) => this.log(msg),
    });

    this.learningManager = new LearningManager({
      ophanDir: options.ophanDir,
      config: options.config,
    });

    this.log('Task Agent initialized');
  }

  /**
   * Set the current state (loaded from state.json)
   */
  setState(state: OphanState): void {
    this.state = state;
  }

  /**
   * Execute a task through the inner loop
   */
  async executeTask(taskDescription: string): Promise<ExecutionResult> {
    this.ensureInitialized();

    // Load guidelines and criteria
    const guidelines = await ContentLoader.loadGuidelines(
      this.ophanDir,
      this.guidance.guidelineFiles
    );

    const criteria = await ContentLoader.loadCriteria(
      this.ophanDir,
      this.guidance.criteriaFiles
    );

    // Load learnings
    const learningsPath = path.join(this.ophanDir, 'guidelines', 'learnings.md');
    let learnings = '';
    try {
      learnings = await fs.readFile(learningsPath, 'utf-8');
    } catch {
      // No learnings yet
    }

    // Create and run inner loop
    const innerLoop = new InnerLoop({
      projectRoot: this.projectRoot,
      projectName: path.basename(this.projectRoot),
      ophanDir: this.ophanDir,
      config: this.config!,
      guidelines: guidelines.content,
      criteria: criteria.content,
      learnings,
      guidelineFiles: guidelines.files,
      criteriaFiles: criteria.files,
      onProgress: (msg) => this.log(msg),
    });

    const result = await innerLoop.execute(taskDescription);

    return this.mapInnerLoopResult(result);
  }

  /**
   * Run the outer loop to detect patterns and generate proposals
   */
  async runOuterLoop(
    lookbackDays: number,
    autoApplyGuidelines: boolean
  ): Promise<AgentOuterLoopResult> {
    this.ensureInitialized();

    const proposals: Proposal[] = [];
    const guidelinesUpdated: string[] = [];

    // 1. Load task logs
    const taskLogs = await this.loadTaskLogs(lookbackDays);
    this.log(`Loaded ${taskLogs.length} task logs`);

    if (taskLogs.length === 0) {
      return {
        proposals: [],
        metrics: await this.getMetrics(),
        summary: 'No task logs to analyze',
      };
    }

    // 2. Use intelligent analysis (Claude-powered) for pattern detection
    this.log('Running intelligent pattern analysis...');
    const analysisResult = await this.intelligentAnalyzer!.analyze(taskLogs);
    this.log(`Analysis complete: ${analysisResult.patterns.length} patterns, ${analysisResult.proposals.length} recommendations`);

    // Log pattern summary for visibility
    for (const pattern of analysisResult.patterns) {
      const actionable = pattern.isActionable ? '(actionable)' : '(not actionable)';
      this.log(`  - [${pattern.category}] ${pattern.description} ${actionable}`);
    }

    // 3. Consolidate learnings
    const consolidationResult = await this.learningManager!.consolidate(
      this.state?.learnings ?? []
    );
    this.log(
      `Learnings: ${consolidationResult.kept.length} kept, ${consolidationResult.promoted.length} promoted`
    );

    // 4. Generate proposals from promoted learnings
    const learningProposals = this.learningManager!.generateGuidelineProposals(
      consolidationResult.promoted
    );

    for (const proposal of learningProposals) {
      if (autoApplyGuidelines) {
        try {
          await this.learningManager!.applyGuidelineUpdate(
            proposal.file,
            proposal.content
          );
          guidelinesUpdated.push(proposal.file);
          this.log(`Auto-applied guideline: ${proposal.file}`);
        } catch (error) {
          this.log(`Failed to update ${proposal.file}: ${(error as Error).message}`);
        }
      } else {
        proposals.push({
          id: IdGenerator.proposal(),
          type: 'guideline',
          source: 'task-agent',
          targetFile: proposal.file,
          change: proposal.content,
          reason: `Promoted from learning: "${proposal.learningContent?.slice(0, 100)}..."`,
          confidence: 0.8,
          createdAt: new Date().toISOString(),
          status: 'pending',
        });
      }
    }

    // 5. Add proposals from intelligent analysis
    for (const aiProposal of analysisResult.proposals) {
      if (autoApplyGuidelines && aiProposal.type === 'guideline') {
        try {
          await this.learningManager!.applyGuidelineUpdate(
            aiProposal.targetFile,
            aiProposal.change
          );
          if (!guidelinesUpdated.includes(aiProposal.targetFile)) {
            guidelinesUpdated.push(aiProposal.targetFile);
          }
          this.log(`Auto-applied AI recommendation: ${aiProposal.targetFile}`);
        } catch (error) {
          this.log(`Failed to apply: ${(error as Error).message}`);
        }
      } else {
        proposals.push(aiProposal);
      }
    }

    // 6. Rewrite learnings file
    await this.learningManager!.rewriteLearningsFile(consolidationResult.kept);

    return {
      proposals,
      metrics: await this.getMetrics(),
      summary: `${analysisResult.patterns.length} patterns, ${proposals.length} proposals, ${guidelinesUpdated.length} auto-applied`,
    };
  }

  /**
   * Get current metrics for this agent
   */
  async getMetrics(): Promise<AgentMetrics[]> {
    if (!this.state) {
      return [];
    }

    const metrics = this.state.metrics;

    return [
      {
        name: 'Success Rate',
        value: metrics.successRate,
        target: 80,
        passed: metrics.successRate >= 80,
      },
      {
        name: 'Average Iterations',
        value: metrics.averageIterations,
        target: 3,
        passed: metrics.averageIterations <= 3,
      },
      {
        name: 'Average Cost per Task',
        value: metrics.averageCostPerTask,
        target: this.config?.innerLoop.costLimit ?? 1.0,
        passed: metrics.averageCostPerTask <= (this.config?.innerLoop.costLimit ?? 1.0),
      },
    ];
  }

  /**
   * Load task logs from the logs directory
   */
  private async loadTaskLogs(lookbackDays: number): Promise<TaskLogEntry[]> {
    const logsDir = path.join(this.ophanDir, 'logs');
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

    const results = await ContentLoader.loadJsonFiles<TaskLogEntry>(logsDir);

    return results
      .filter((r) => {
        const taskDate = new Date(r.data.task.startedAt);
        return taskDate >= lookbackDate;
      })
      .map((r) => r.data)
      .sort(
        (a, b) =>
          new Date(a.task.startedAt).getTime() - new Date(b.task.startedAt).getTime()
      );
  }

  /**
   * Map InnerLoopResult to ExecutionResult
   */
  private mapInnerLoopResult(result: InnerLoopResult): ExecutionResult {
    return {
      success: result.task.status === 'converged',
      iterations: result.task.iterations,
      cost: result.task.cost,
      output: result.logs.map((l) => l.output).join('\n'),
      learnings: result.learnings.map((l) => l.content),
    };
  }
}
