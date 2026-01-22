/**
 * Core types for Ophan - the self-improving AI development agent
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface OphanConfig {
  /** Execution backend configuration */
  execution?: {
    backend: 'api' | 'claude-code';
    claudeCode?: {
      model: 'sonnet' | 'opus' | 'haiku';
      permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
      allowedTools: string[];
      maxTurns: number;
    };
  };

  /** Model configuration (used by API backend) */
  model: {
    name: string;
    maxTokens: number;
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
  targetFile: string;
  change: string;
  reason: string;
  confidence: number;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
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
