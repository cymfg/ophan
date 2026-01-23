/**
 * Core types for Ophan - the self-improving AI development agent
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface OphanConfig {
  /** Claude Code execution configuration */
  claudeCode?: {
    model: 'sonnet' | 'opus' | 'haiku';
    permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
    allowedTools: string[];
    maxTurns: number;
  };

  /** Inner loop settings */
  innerLoop: {
    maxIterations: number;
    regenerationStrategy: 'full' | 'informed' | 'incremental';
    costLimit?: number;
  };

  /** Outer loop settings */
  outerLoop: {
    triggers: {
      afterTasks: number;
      schedule?: string;
    };
    minOccurrences: number;
    minConfidence: number;
    lookbackDays: number;
    maxProposals: number;
    learnings: {
      maxCount: number;
      retentionDays: number;
      promotionThreshold: number;
      similarityThreshold: number;
    };
  };

  /** Guardrails */
  guardrails: {
    protectedPaths: string[];
    allowedCommands: string[];
    blockedCommands: string[];
  };

  /** Escalation configuration */
  escalations?: {
    webhooks: WebhookConfig[];
  };
}

export interface WebhookConfig {
  name: string;
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  events: ('escalation' | 'task_complete' | 'digest')[];
}

// ============================================================================
// State Types
// ============================================================================

export interface OphanState {
  version: string;
  lastReview: string | null;
  tasksSinceReview: number;
  pendingProposals: Proposal[];
  learnings: Learning[];
  metrics: OphanMetrics;
}

export interface Learning {
  id: string;
  content: string;
  context: string;
  issue: string;
  resolution: string;
  guidelineImpact: string;
  embedding?: number[];
  timestamp: string;
  references: number;
  promoted: boolean;
}

export interface Proposal {
  id: string;
  type: 'guideline' | 'criteria';
  /** Which agent generated this proposal */
  source: 'task-agent' | 'context-agent';
  targetFile: string;
  change: string;
  reason: string;
  confidence: number;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  /** Human feedback when edited or rejected */
  humanFeedback?: string;
  /** When the proposal was reviewed */
  reviewedAt?: string;
  /** Who reviewed (for future multi-user support) */
  reviewedBy?: string;
}

/**
 * Result of an interactive review session
 */
export interface ReviewResult {
  /** Proposals that were approved (possibly with edits) */
  approved: Proposal[];
  /** Proposals that were rejected */
  rejected: Proposal[];
  /** Proposals that were skipped for later */
  skipped: Proposal[];
  /** Summary of the review session */
  summary: {
    totalReviewed: number;
    approvedCount: number;
    rejectedCount: number;
    skippedCount: number;
    guidelinesUpdated: string[];
    criteriaUpdated: string[];
  };
}

// ============================================================================
// Task Types
// ============================================================================

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'converged' | 'failed' | 'escalated';
  iterations: number;
  maxIterations: number;
  startedAt: string;
  completedAt?: string;
  cost: number;
  tokensUsed: number;
}

export interface TaskLog {
  taskId: string;
  timestamp: string;
  iteration: number;
  action: string;
  output: string;
  evaluation: Evaluation;
  learningExtracted?: string;
}

export interface Evaluation {
  passed: boolean;
  criteria: string[];
  failures: EvaluationFailure[];
  score: number;
}

export interface EvaluationFailure {
  criterion: string;
  message: string;
  severity: 'error' | 'warning';
}

// ============================================================================
// Pattern Types
// ============================================================================

export interface Pattern {
  type: 'failure' | 'iteration' | 'success';
  signature: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  affectedTasks: string[];
  confidence: number;
  suggestedAction?: {
    target: 'guideline' | 'criteria';
    file: string;
    change: string;
  };
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface OphanMetrics {
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  escalatedTasks: number;
  successRate: number;
  averageIterations: number;
  maxIterationsHit: number;
  totalTokensUsed: number;
  totalCost: number;
  averageCostPerTask: number;
  averageTaskDuration: number;
  totalTimeSpent: number;
  totalLearnings: number;
  learningsPromoted: number;
  patternsDetected: number;
  periodStart: string;
  periodEnd: string;
}

// ============================================================================
// Escalation Types
// ============================================================================

export interface EscalationPayload {
  type: 'escalation';
  timestamp: string;
  task: {
    id: string;
    description: string;
    iterations: number;
    maxIterations: number;
  };
  reason: 'max_iterations' | 'blocked' | 'error' | 'cost_limit';
  context: {
    lastError?: string;
    lastToolOutput?: string;
    suggestedAction?: string;
  };
  project: {
    name: string;
    path: string;
  };
}

// ============================================================================
// EITL Feedback Types
// ============================================================================

export interface EITLFeedback {
  content: string;
  targetType: 'guideline' | 'criteria' | 'unknown';
  suggestedFile?: string;
  confidence: number;
}

// ============================================================================
// Template Types
// ============================================================================

export interface Template {
  name: string;
  extends?: string;
  guidelines: Record<string, TemplateFile>;
  criteria: Record<string, TemplateFile>;
}

export interface TemplateFile {
  content?: string;
  append?: string;
  prepend?: string;
}

// ============================================================================
// Context Usage Types (for self-improving context compilation)
// ============================================================================

/**
 * Tracks which files were accessed during task execution.
 * Used to measure context prediction accuracy.
 */
export interface FileUsage {
  /** Files read via read_file tool */
  filesRead: string[];
  /** Files written via write_file tool */
  filesWritten: string[];
  /** Files matched in search_files results */
  filesSearched: string[];
  /** Commands executed via run_command tool */
  commandsRun: string[];
}

/**
 * Log entry capturing context usage for a single task.
 * Used by the context agent's outer loop to learn patterns.
 */
export interface ContextUsageLog {
  taskId: string;
  taskDescription: string;
  /** Classified task type (populated in Phase 2) */
  taskType?: string;

  /** What context was provided to the inner loop */
  providedContext: {
    /** Which guideline files were loaded */
    guidelines: string[];
    /** Which criteria files were loaded */
    criteria: string[];
    /** Files provided via context pack (if any) */
    files?: string[];
  };

  /** What was actually used during execution */
  actualUsage: FileUsage;

  /** Computed metrics for evaluation */
  metrics: ContextUsageMetrics;

  timestamp: string;
}

/**
 * Metrics for evaluating context prediction quality.
 * These are the criteria (C) for the context agent.
 */
export interface ContextUsageMetrics {
  /** % of provided files that were actually used (target: >70%) */
  contextHitRate: number;
  /** % of used files that weren't provided (target: <20%) */
  contextMissRate: number;
  /** Tokens spent on read_file/search before first write */
  explorationTokens: number;
  /** Total tokens used in the task */
  totalTokens: number;
}

/**
 * Aggregate metrics across multiple tasks.
 * Used for the context-stats command.
 */
export interface ContextAggregateMetrics {
  tasksAnalyzed: number;
  averageHitRate: number;
  averageMissRate: number;
  averageExplorationTokens: number;
  /** Files commonly needed but not provided */
  commonMisses: Array<{ file: string; count: number }>;
  /** Files commonly provided but not used */
  commonUnused: Array<{ file: string; count: number }>;
  periodStart: string;
  periodEnd: string;
}
