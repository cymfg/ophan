/**
 * Orchestrator Agent
 *
 * Supervisory agent that sits on top of the DevAgent within the Two-Loop Paradigm.
 * Converses with humans, reviews DevAgent results, creates goals, and updates guidelines.
 *
 * Key design:
 *   - Communicates with DevAgent via shared filesystem (goals, guidelines)
 *   - Uses Claude SDK query() for reasoning (not InnerLoop)
 *   - Has its own (G,C) pair: orchestration.md, communication.md / orchestration-quality.md
 *   - Supports pluggable messaging adapters (CLI, Slack, Telegram)
 *   - Classifies intent before routing to appropriate handler
 *   - Self-evaluates responses against own criteria
 *   - Maintains cross-session memory
 *   - Manages goal lifecycle (conflicts, retirement)
 *   - Supports standalone daemon mode (wake-check-act)
 *
 * Guidelines: orchestration.md, communication.md
 * Criteria: orchestration-quality.md
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  BaseAgent,
  AgentOptions,
  AgentGuidanceConfig,
  AgentMetrics,
  AgentOuterLoopResult,
} from './types.js';
import type {
  Proposal,
  OphanConfig,
  OphanState,
} from '../../types/index.js';
import { AbstractAgent, ContentLoader, IdGenerator } from './utils.js';
import { ConversationManager, type ConversationSession } from '../orchestrator/conversation.js';
import { OrchestratorReasoner } from '../orchestrator/reasoner.js';
import { DevAgentAnalyzer } from '../orchestrator/dev-agent-analyzer.js';
import { ActionExecutor } from '../orchestrator/action-executor.js';
import { ContextAssembler } from '../orchestrator/context-assembler.js';
import { IntentClassifier } from '../orchestrator/intent-classifier.js';
import { MemoryManager } from '../orchestrator/memory.js';
import { GoalManager } from '../orchestrator/goal-manager.js';
import { SelfEvaluator } from '../orchestrator/self-evaluator.js';
import type { MessagingAdapter } from '../orchestrator/adapters/types.js';
import type {
  OrchestratorState,
  ProposedAction,
  OrchestratorResponse,
  ActionResult,
  GoalCreationPayload,
} from '../orchestrator/types.js';
import { createInitialOrchestratorState } from '../orchestrator/types.js';

// ============================================================================
// Types
// ============================================================================

export interface StartConversationOptions {
  adapter: MessagingAdapter;
  /** Enable proactive monitoring during the session */
  proactiveInterval?: number;
  /** Resume the latest session instead of creating a new one */
  resume?: boolean;
}

export interface DaemonCycleResult {
  acted: boolean;
  summary: string;
}

// ============================================================================
// Agent
// ============================================================================

export class OrchestratorAgent extends AbstractAgent implements BaseAgent {
  readonly id = 'orchestrator' as const;
  readonly name = 'Orchestrator Agent';
  readonly description =
    'Supervisory agent that converses with humans, reviews DevAgent results, creates goals, and updates guidelines';

  readonly guidance: AgentGuidanceConfig = {
    guidelineFiles: ['orchestration.md', 'communication.md'],
    criteriaFiles: ['orchestration-quality.md'],
  };

  private config: OphanConfig | null = null;
  private devAgentState: OphanState | null = null;
  private orchestratorState: OrchestratorState | null = null;
  private conversationManager: ConversationManager | null = null;
  private reasoner: OrchestratorReasoner | null = null;
  private analyzer: DevAgentAnalyzer | null = null;
  private executor: ActionExecutor | null = null;
  private contextAssembler: ContextAssembler | null = null;
  private classifier: IntentClassifier | null = null;
  private memoryManager: MemoryManager | null = null;
  private goalManager: GoalManager | null = null;
  private selfEvaluator: SelfEvaluator | null = null;
  private session: ConversationSession | null = null;
  private pendingActions: ProposedAction[] = [];
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;
  private adapter: MessagingAdapter | null = null;

  async initialize(options: AgentOptions): Promise<void> {
    this.options = options;
    this.config = options.config;

    this.conversationManager = new ConversationManager(options.ophanDir);

    this.reasoner = new OrchestratorReasoner({
      projectRoot: options.projectRoot,
      ophanDir: options.ophanDir,
      config: options.config,
      onProgress: (msg) => this.log(msg),
    });

    this.analyzer = new DevAgentAnalyzer({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
    });

    this.executor = new ActionExecutor({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
    });

    this.contextAssembler = new ContextAssembler({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
      guidance: this.guidance,
    });

    this.classifier = new IntentClassifier({
      projectRoot: options.projectRoot,
    });

    this.memoryManager = new MemoryManager({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
      maxPreferences: options.config.orchestrator?.memory?.maxPreferences ?? 50,
      maxEpisodes: options.config.orchestrator?.memory?.maxEpisodes ?? 200,
    });
    await this.memoryManager.load();

    this.goalManager = new GoalManager({
      ophanDir: options.ophanDir,
      projectRoot: options.projectRoot,
    });

    this.selfEvaluator = new SelfEvaluator({
      projectRoot: options.projectRoot,
      ophanDir: options.ophanDir,
    });

    // Load orchestrator-specific state
    this.orchestratorState = await this.loadOrchestratorState();
    this.contextAssembler.restoreFromState(this.orchestratorState);

    this.log('Orchestrator Agent initialized');
  }

  /**
   * Set the DevAgent state (loaded from state.json)
   */
  setState(state: OphanState): void {
    this.devAgentState = state;
  }

  /**
   * Reload the DevAgent state from disk.
   * Called before every processMessage() so the orchestrator
   * always sees the latest state, even if ophan dev ran concurrently.
   * Also refreshes the session context so status queries reflect reality.
   */
  private async reloadDevAgentState(): Promise<void> {
    const statePath = path.join(this.options!.ophanDir, 'agents', 'dev', 'state.json');
    try {
      const content = await fs.readFile(statePath, 'utf-8');
      this.devAgentState = JSON.parse(content) as OphanState;

      // Refresh session context to match current state
      if (this.session && this.conversationManager) {
        this.session.context =
          await this.conversationManager.buildSessionContext(this.devAgentState);
      }
    } catch {
      // State file doesn't exist yet — leave current state as-is
    }
  }

  // =========================================================================
  // Conversation
  // =========================================================================

  /**
   * Start an interactive conversation session.
   * Wires up the messaging adapter and processes messages in a loop.
   */
  async startConversation(opts: StartConversationOptions): Promise<void> {
    this.ensureInitialized();
    this.adapter = opts.adapter;

    // Create or resume session
    if (opts.resume) {
      this.session = await this.conversationManager!.loadLatestSession();
      if (this.session) {
        this.log(`Resumed session: ${this.session.id}`);
      }
    }

    if (!this.session) {
      if (!this.devAgentState) {
        throw new Error('DevAgent state not set. Call setState() first.');
      }
      this.session = await this.conversationManager!.createSession(this.devAgentState);
      this.log(`Created session: ${this.session.id}`);
    }

    // Track conversation
    this.orchestratorState!.conversationsHandled++;

    // Set up proactive monitoring
    if (opts.proactiveInterval && opts.proactiveInterval > 0) {
      this.startProactiveMode(opts.proactiveInterval);
    }

    // Wire up message handler
    opts.adapter.onMessage(async (msg) => {
      const response = await this.processMessage(msg.content);

      // Send the response text
      await opts.adapter.sendMessage(response.text);

      // If there are actions awaiting confirmation, prompt the user
      if (response.awaitingConfirmation) {
        const answer = await opts.adapter.promptUser({
          message: 'Would you like to proceed with the proposed actions?',
          options: ['Yes, proceed', 'No, cancel'],
          allowFreeText: true,
        });

        if (this.isConfirmation(answer)) {
          const results = await this.confirmPendingActions();
          const summary = results
            .map((r) => `${r.success ? 'Done' : 'Failed'}: ${r.message}`)
            .join('\n');
          await opts.adapter.sendMessage(summary);
        } else {
          this.pendingActions = [];
          await opts.adapter.sendMessage('Actions cancelled.');
        }
      }
    });

    // Start the adapter (blocks until stopped)
    await opts.adapter.start();

    // Cleanup: distill session to memory, save state
    this.stopProactiveMode();
    if (this.session) {
      await this.memoryManager!.distillSession(this.session);
      // Always save memory — distillSession may skip (short session) or fail,
      // but preferences recorded during processMessage() still need persisting
      await this.memoryManager!.save();
      await this.conversationManager!.saveSession(this.session);
    }
    // Save state hash for daemon delta detection
    if (this.contextAssembler) {
      this.orchestratorState!.lastStateHash =
        this.contextAssembler.getStateHash();
    }
    await this.saveOrchestratorState();
  }

  /**
   * Process a single message through the classified reasoning pipeline.
   *
   * Flow:
   * 1. Handle slash commands
   * 2. Classify intent (cheap haiku call or heuristic)
   * 3. Assemble full context (always includes analysis, delta, memory)
   * 4. Route by intent:
   *    - status_query → format analysis directly
   *    - confirmation → handle pending actions
   *    - chitchat → lightweight reasoner
   *    - * → full reasoner with intent-specific prompt
   * 5. Self-evaluate response
   * 6. Record feedback to memory (if intent=feedback)
   * 7. Add to session, save
   */
  async processMessage(message: string): Promise<OrchestratorResponse> {
    this.ensureInitialized();

    if (!this.session) {
      throw new Error('No active session. Call startConversation() first.');
    }

    // 0. Reload dev agent state from disk (it may have changed since last message)
    await this.reloadDevAgentState();

    // 1. Handle slash commands
    const commandResponse = this.handleCommand(message);
    if (commandResponse) {
      return commandResponse;
    }

    // 2. Add user message to session
    this.conversationManager!.addMessage(this.session, {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    });

    // 3. Classify intent
    const intent = await this.classifier!.classify(
      message,
      this.session.messages.slice(-5)
    );
    this.log(`Intent: ${intent.type}`);

    // 4. Handle confirmation intent directly
    if (intent.type === 'confirmation') {
      if (intent.affirms && this.pendingActions.length > 0) {
        const results = await this.confirmPendingActions();
        const summary = results
          .map((r) => `${r.success ? 'Done' : 'Failed'}: ${r.message}`)
          .join('\n');
        const response: OrchestratorResponse = {
          text: summary,
          actions: [],
          awaitingConfirmation: false,
        };
        this.addResponseToSession(response);
        return response;
      } else if (!intent.affirms && this.pendingActions.length > 0) {
        this.pendingActions = [];
        const response: OrchestratorResponse = {
          text: 'Actions cancelled.',
          actions: [],
          awaitingConfirmation: false,
        };
        this.addResponseToSession(response);
        return response;
      }
      // No pending actions — fall through to reasoner
    }

    // 5. Assemble full context
    if (!this.devAgentState) {
      const response: OrchestratorResponse = {
        text: 'No DevAgent state available. Run `ophan dev` first to generate activity.',
        actions: [],
        awaitingConfirmation: false,
      };
      this.addResponseToSession(response);
      return response;
    }

    // Detect goal conflicts for context
    const goals = await this.goalManager!.loadGoals();
    const conflicts = await this.goalManager!.detectConflicts(
      goals,
      this.devAgentState
    );

    // Get relevant memory
    const memory = this.memoryManager!.getRelevantMemory(intent);

    const maxMessages =
      this.config?.orchestrator?.conversation?.maxContextMessages ?? 30;

    const assembledContext = await this.contextAssembler!.assemble(
      this.devAgentState,
      this.session,
      maxMessages,
      memory,
      conflicts
    );

    // 6. Route by intent
    let response: OrchestratorResponse;

    if (intent.type === 'status_query') {
      // Status queries: format analysis directly, no expensive reasoner
      const analysisText = this.analyzer!.formatAnalysis(
        assembledContext.devAgent.analysis
      );
      const deltaText =
        assembledContext.devAgent.delta.summary !== 'no changes' &&
        assembledContext.devAgent.delta.summary !== 'first check'
          ? `\n\n**Since last check:** ${assembledContext.devAgent.delta.summary}`
          : '';
      response = {
        text: analysisText + deltaText,
        actions: [],
        awaitingConfirmation: false,
      };
    } else {
      // All other intents go through the reasoner with context
      const reasonerOutput = await this.reasoner!.reasonWithContext(
        message,
        assembledContext,
        intent
      );

      this.log(`Reasoning: ${reasonerOutput.reasoning}`);

      // Process proposed actions
      this.pendingActions = [];
      for (const action of reasonerOutput.proposedActions) {
        if (!action.requiresConfirmation) {
          await this.executor!.execute(action);
        } else {
          // Validate goal creation before queuing
          if (action.type === 'create_goal' && action.payload.type === 'create_goal') {
            const validation = await this.goalManager!.validateNewGoal(
              action.payload as GoalCreationPayload,
              goals
            );
            if (validation.conflicts.length > 0) {
              // Add conflict warning to response
              const conflictWarning = validation.conflicts
                .map((c) => `- Overlaps with ${c.goalB}: ${c.description}`)
                .join('\n');
              reasonerOutput.responseText += `\n\n**Note:** Potential conflicts detected:\n${conflictWarning}`;
            }
          }
          this.pendingActions.push(action);
        }
      }

      response = {
        text: reasonerOutput.responseText,
        actions: reasonerOutput.proposedActions,
        awaitingConfirmation: this.pendingActions.length > 0,
      };
    }

    // 7. Self-evaluate response
    const evaluation = this.selfEvaluator!.evaluateResponse(
      response,
      assembledContext,
      response.actions
    );
    if (!evaluation.passed) {
      this.log(
        `Self-evaluation: FAILED — ${evaluation.suggestions.join('; ')}`
      );
    }

    // 8. Record feedback to memory
    if (intent.type === 'feedback' && intent.about) {
      this.memoryManager!.recordPreference(
        intent.about,
        this.session.id
      );
    }

    // 9. Add response to session with evaluation metadata
    this.conversationManager!.addMessage(this.session, {
      role: 'orchestrator',
      content: response.text,
      timestamp: new Date().toISOString(),
      metadata: {
        actions: response.actions.map((a) => ({
          type: a.type,
          description: a.description,
        })),
        awaitingConfirmation: response.awaitingConfirmation,
      },
    });

    // 10. Save session
    await this.conversationManager!.saveSession(this.session);

    return response;
  }

  // =========================================================================
  // Daemon Mode (Wake-Check-Act)
  // =========================================================================

  /**
   * Run a single daemon cycle. Checks state, decides whether to act.
   * Called periodically by the daemon command.
   */
  async runDaemonCycle(adapter: MessagingAdapter): Promise<DaemonCycleResult> {
    this.ensureInitialized();

    if (!this.devAgentState) {
      return { acted: false, summary: 'No DevAgent state available' };
    }

    // Assemble context (includes delta detection)
    const maxMessages = 0; // No session history in daemon mode
    const memory = this.memoryManager!.getRelevantMemory();

    // Create a minimal session for context assembly
    const minimalSession = await this.conversationManager!.createSession(
      this.devAgentState
    );

    const context = await this.contextAssembler!.assemble(
      this.devAgentState,
      minimalSession,
      maxMessages,
      memory
    );

    // Check if anything needs attention
    const delta = context.devAgent.delta;
    const alerts = await this.analyzer!.quickCheck(this.devAgentState);
    const recommendations = await this.goalManager!.getRecommendations(
      this.devAgentState
    );

    const shouldAct =
      delta.summary !== 'no changes' &&
      delta.summary !== 'first check' &&
      (alerts.length > 0 ||
        recommendations.length > 0 ||
        delta.newTaskResults.some(
          (t) => t.status === 'failed' || t.status === 'escalated'
        ));

    if (!shouldAct) {
      // Save state hash for next cycle
      if (this.contextAssembler) {
        this.orchestratorState!.lastStateHash =
          this.contextAssembler.getStateHash();
      }
      await this.saveOrchestratorState();
      return { acted: false, summary: 'No action needed' };
    }

    // Deduplicate alerts
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const recentAlertMessages = (this.orchestratorState?.recentAlerts ?? [])
      .filter((a) => a.timestamp > oneHourAgo)
      .map((a) => a.message);
    const newAlerts = alerts.filter(
      (a) => !recentAlertMessages.includes(a.message)
    );

    // Build notification
    const parts: string[] = [];
    if (delta.newTaskResults.length > 0) {
      parts.push(`Changes: ${delta.summary}`);
    }
    for (const alert of newAlerts) {
      parts.push(`[${alert.severity}] ${alert.message}`);
    }
    for (const rec of recommendations.slice(0, 3)) {
      parts.push(`Suggestion: ${rec.suggestedAction}`);
    }

    const body = parts.join('\n');

    // Send notification
    await adapter.sendNotification({
      title: 'Orchestrator Update',
      body,
      priority: newAlerts.some((a) => a.severity === 'critical')
        ? 'high'
        : 'medium',
    });

    // Track alerts
    const now = new Date().toISOString();
    for (const alert of newAlerts) {
      this.orchestratorState!.recentAlerts.push({
        message: alert.message,
        timestamp: now,
      });
    }
    this.orchestratorState!.proactiveAlertsSent += newAlerts.length;

    // Cap recent alerts
    if (this.orchestratorState!.recentAlerts.length > 100) {
      this.orchestratorState!.recentAlerts =
        this.orchestratorState!.recentAlerts.slice(-50);
    }

    this.orchestratorState!.lastProactiveCheck = now;
    if (this.contextAssembler) {
      this.orchestratorState!.lastStateHash =
        this.contextAssembler.getStateHash();
    }
    await this.saveOrchestratorState();

    return { acted: true, summary: body };
  }

  // =========================================================================
  // Outer Loop
  // =========================================================================

  async runOuterLoop(
    _lookbackDays: number,
    _autoApplyGuidelines: boolean
  ): Promise<AgentOuterLoopResult> {
    this.ensureInitialized();

    if (!this.devAgentState) {
      return {
        proposals: [],
        metrics: await this.getMetrics(),
        summary: 'No DevAgent state available for analysis',
      };
    }

    const proposals: Proposal[] = [];

    // 1. Analyze DevAgent performance
    const analysis = await this.analyzer!.analyze(this.devAgentState);
    this.log(`DevAgent health: ${analysis.health}`);

    // 2. Track supervised goal completion rate
    const supervisedGoals = this.devAgentState.goals.filter((g) =>
      this.orchestratorState!.supervisedGoalIds.includes(g.goalId)
    );

    if (supervisedGoals.length > 0) {
      const completed = supervisedGoals.filter(
        (g) => g.status === 'completed'
      ).length;
      this.orchestratorState!.supervisedGoalCompletionRate =
        (completed / supervisedGoals.length) * 100;
    }

    // 3. Generate proposals from DevAgent issues
    for (const issue of analysis.issues) {
      if (issue.severity === 'critical' || issue.severity === 'warning') {
        if (issue.category === 'high_failure_rate') {
          proposals.push({
            id: IdGenerator.proposal('orch'),
            type: 'guideline',
            source: 'orchestrator',
            targetFile: 'coding.md',
            change: `## Auto-detected Issue\n\n${issue.description}\n\nSuggested: ${issue.suggestedAction}`,
            reason: `Orchestrator detected: ${issue.description}`,
            confidence: 0.7,
            createdAt: new Date().toISOString(),
            status: 'pending',
          });
        }
      }
    }

    // 4. Self-evaluation: analyze own conversation quality
    const sessions = await this.loadRecentSessions();
    if (sessions.length > 0) {
      const criteria = await ContentLoader.loadCriteria(
        this.ophanDir,
        this.guidance.criteriaFiles
      );

      const aggregateEval = await this.selfEvaluator!.evaluateAggregate(
        sessions,
        criteria.content
      );

      this.log(
        `Self-evaluation: ${aggregateEval.sessionCount} sessions, ${aggregateEval.weakAreas.length} weak areas`
      );

      // Generate self-improvement proposals
      const selfProposals =
        this.selfEvaluator!.generateProposals(aggregateEval);
      proposals.push(...selfProposals);
    }

    // 5. Consolidate memory
    const consolidation = await this.memoryManager!.consolidate();
    this.log(
      `Memory consolidation: ${consolidation.preferencesRemoved} prefs removed, ${consolidation.episodesPruned} episodes pruned`
    );

    // Save updated state
    await this.saveOrchestratorState();

    return {
      proposals,
      metrics: await this.getMetrics(),
      summary: `Health: ${analysis.health}, ${analysis.issues.length} issues, ${proposals.length} proposals, ${sessions.length} sessions evaluated`,
    };
  }

  // =========================================================================
  // Metrics
  // =========================================================================

  async getMetrics(): Promise<AgentMetrics[]> {
    const state = this.orchestratorState ?? createInitialOrchestratorState();

    const metrics: AgentMetrics[] = [
      {
        name: 'Goals Created',
        value: state.goalsCreated,
        passed: true,
      },
      {
        name: 'Guidelines Updated',
        value: state.guidelinesUpdated,
        passed: true,
      },
      {
        name: 'Conversations Handled',
        value: state.conversationsHandled,
        passed: true,
      },
    ];

    if (state.supervisedGoalIds.length > 0) {
      metrics.push({
        name: 'Supervised Goal Completion Rate',
        value: state.supervisedGoalCompletionRate,
        target: 70,
        passed: state.supervisedGoalCompletionRate >= 70,
      });
    }

    return metrics;
  }

  // =========================================================================
  // Slash Commands
  // =========================================================================

  private handleCommand(message: string): OrchestratorResponse | null {
    const trimmed = message.trim().toLowerCase();

    if (trimmed === '/status') {
      return this.statusCommand();
    }
    if (trimmed === '/goals') {
      return this.goalsCommand();
    }
    if (trimmed === '/help') {
      return this.helpCommand();
    }

    return null;
  }

  private statusCommand(): OrchestratorResponse {
    if (!this.devAgentState) {
      return {
        text: 'No DevAgent state loaded. Run `ophan dev` first to generate activity.',
        actions: [],
        awaitingConfirmation: false,
      };
    }

    const { metrics, goals } = this.devAgentState;
    const activeGoals = goals.filter(
      (g) => !['completed', 'abandoned'].includes(g.status)
    );
    const completedGoals = goals.filter((g) => g.status === 'completed');

    const lines = [
      '**DevAgent Status**',
      '',
      `Tasks: ${metrics.totalTasks} total, ${metrics.successRate.toFixed(0)}% success rate`,
      `Cost: $${metrics.totalCost.toFixed(4)} total, $${metrics.averageCostPerTask.toFixed(4)} avg/task`,
      `Goals: ${activeGoals.length} active, ${completedGoals.length} completed`,
      '',
    ];

    if (activeGoals.length > 0) {
      lines.push('**Active Goals:**');
      for (const g of activeGoals) {
        const completed = g.tasks.filter((t) => t.status === 'converged').length;
        const progress = g.tasks.length > 0 ? `${completed}/${g.tasks.length}` : 'no tasks';
        lines.push(`- ${g.goalId} (${g.status}): ${progress}`);
      }
    }

    return {
      text: lines.join('\n'),
      actions: [],
      awaitingConfirmation: false,
    };
  }

  private goalsCommand(): OrchestratorResponse {
    if (!this.devAgentState || this.devAgentState.goals.length === 0) {
      return {
        text: 'No goals defined. Tell me what you want to build and I\'ll create goals for the DevAgent.',
        actions: [],
        awaitingConfirmation: false,
      };
    }

    const lines = ['**Goals:**', ''];

    for (const g of this.devAgentState.goals) {
      const completed = g.tasks.filter((t) => t.status === 'converged').length;
      const failed = g.tasks.filter(
        (t) => t.status === 'failed' || t.status === 'escalated'
      ).length;
      const progress = g.tasks.length > 0
        ? `${completed}/${g.tasks.length} tasks (${failed} failed)`
        : 'no tasks';
      lines.push(`- **${g.goalId}** [${g.status}]: ${progress}`);
    }

    return {
      text: lines.join('\n'),
      actions: [],
      awaitingConfirmation: false,
    };
  }

  private helpCommand(): OrchestratorResponse {
    return {
      text: [
        '**Commands:**',
        '',
        '`/status` — Show DevAgent metrics and active goals',
        '`/goals` — List all goals',
        '`/help` — Show this help message',
        '`/quit` — End the conversation',
        '',
        'You can also just chat naturally. I can:',
        '- Create development goals for the DevAgent',
        '- Review DevAgent results and suggest improvements',
        '- Update DevAgent guidelines based on patterns',
        '- Propose criteria changes (requires your approval)',
      ].join('\n'),
      actions: [],
      awaitingConfirmation: false,
    };
  }

  // =========================================================================
  // Proactive Mode (in-session)
  // =========================================================================

  private startProactiveMode(intervalMs: number): void {
    this.log(`Proactive mode enabled (interval: ${intervalMs / 60000} min)`);

    this.proactiveTimer = setInterval(async () => {
      try {
        await this.runProactiveCheck();
      } catch (error) {
        this.log(`Proactive check failed: ${(error as Error).message}`);
      }
    }, intervalMs);
  }

  private stopProactiveMode(): void {
    if (this.proactiveTimer) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = null;
    }
  }

  private async runProactiveCheck(): Promise<void> {
    if (!this.devAgentState || !this.adapter) return;

    // Quick check for alerts
    const alerts = await this.analyzer!.quickCheck(this.devAgentState);
    if (alerts.length === 0) return;

    // Deduplicate: skip alerts sent in the last hour
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const recentAlertMessages = (this.orchestratorState?.recentAlerts ?? [])
      .filter((a) => a.timestamp > oneHourAgo)
      .map((a) => a.message);

    const newAlerts = alerts.filter(
      (a) => !recentAlertMessages.includes(a.message)
    );
    if (newAlerts.length === 0) return;

    // Generate a proactive message
    const analysis = await this.analyzer!.analyze(this.devAgentState);
    const guidelines = await ContentLoader.loadGuidelines(
      this.ophanDir,
      this.guidance.guidelineFiles
    );

    const output = await this.reasoner!.generateProactiveMessage(
      this.session!.context,
      analysis,
      guidelines.content
    );

    // Send notification
    await this.adapter.sendNotification({
      title: 'Proactive Update',
      body: output.responseText,
      priority: newAlerts.some((a) => a.severity === 'critical') ? 'high' : 'medium',
    });

    // Track sent alerts
    const now = new Date().toISOString();
    for (const alert of newAlerts) {
      this.orchestratorState!.recentAlerts.push({
        message: alert.message,
        timestamp: now,
      });
    }
    this.orchestratorState!.proactiveAlertsSent += newAlerts.length;

    // Keep only recent alerts (last 100)
    if (this.orchestratorState!.recentAlerts.length > 100) {
      this.orchestratorState!.recentAlerts =
        this.orchestratorState!.recentAlerts.slice(-50);
    }

    this.orchestratorState!.lastProactiveCheck = now;
  }

  // =========================================================================
  // Action Confirmation
  // =========================================================================

  private async confirmPendingActions(): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const action of this.pendingActions) {
      const result = await this.executor!.execute(action);
      results.push(result);

      // Track state changes
      if (result.success) {
        if (action.type === 'create_goal') {
          this.orchestratorState!.goalsCreated++;
          if (result.artifactPath) {
            const goalId = path.basename(result.artifactPath, '.md');
            this.orchestratorState!.supervisedGoalIds.push(goalId);
          }
        } else if (action.type === 'update_guideline') {
          this.orchestratorState!.guidelinesUpdated++;
        } else if (action.type === 'propose_criteria_change') {
          // Criteria proposals go into EITL — add to DevAgent state
          const proposal = this.executor!.createCriteriaProposal(
            action.payload as Parameters<ActionExecutor['createCriteriaProposal']>[0]
          );
          if (this.devAgentState) {
            this.devAgentState.pendingProposals.push(proposal);
          }
        }
      }

      // Add to session log
      if (this.session) {
        this.conversationManager!.addMessage(this.session, {
          role: 'system',
          content: `Action ${action.type}: ${result.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.pendingActions = [];
    await this.saveOrchestratorState();

    return results;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private addResponseToSession(response: OrchestratorResponse): void {
    if (!this.session) return;
    this.conversationManager!.addMessage(this.session, {
      role: 'orchestrator',
      content: response.text,
      timestamp: new Date().toISOString(),
    });
  }

  private isConfirmation(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    return (
      normalized === 'yes' ||
      normalized === 'y' ||
      normalized === 'yes, proceed' ||
      normalized === 'approve' ||
      normalized === 'confirm' ||
      normalized === 'ok' ||
      normalized === 'go ahead' ||
      normalized.startsWith('yes')
    );
  }

  private async loadRecentSessions(): Promise<ConversationSession[]> {
    const sessionsDir = path.join(this.ophanDir, 'agents', 'orchestrator', 'sessions');
    try {
      const files = await fs.readdir(sessionsDir);
      const sessionFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 10); // Last 10 sessions

      const sessions: ConversationSession[] = [];
      for (const file of sessionFiles) {
        try {
          const content = await fs.readFile(
            path.join(sessionsDir, file),
            'utf-8'
          );
          sessions.push(JSON.parse(content) as ConversationSession);
        } catch {
          // Skip invalid files
        }
      }
      return sessions;
    } catch {
      return [];
    }
  }

  // =========================================================================
  // State Persistence
  // =========================================================================

  private async loadOrchestratorState(): Promise<OrchestratorState> {
    const statePath = path.join(
      this.ophanDir,
      'agents',
      'orchestrator',
      'state.json'
    );

    try {
      const content = await fs.readFile(statePath, 'utf-8');
      return JSON.parse(content) as OrchestratorState;
    } catch {
      return createInitialOrchestratorState();
    }
  }

  private async saveOrchestratorState(): Promise<void> {
    if (!this.orchestratorState) return;

    const stateDir = path.join(this.ophanDir, 'agents', 'orchestrator');
    await fs.mkdir(stateDir, { recursive: true });

    const statePath = path.join(stateDir, 'state.json');
    await fs.writeFile(
      statePath,
      JSON.stringify(this.orchestratorState, null, 2),
      'utf-8'
    );
  }
}
