/**
 * Orchestrator Agent Types
 *
 * Types for the supervisory agent that manages DevAgent through
 * goals and guidelines, and converses with humans.
 */

import type { OphanState } from '../../types/index.js';
import type { DevAgentAnalysis, GoalProgressEntry } from './dev-agent-analyzer.js';
import type { ConversationMessage, SessionContext } from './conversation.js';
import type { ParsedGoalFile } from '../goal-parser.js';

// ============================================================================
// State
// ============================================================================

/**
 * Orchestrator-specific state, persisted at .ophan/orchestrator/state.json
 */
export interface OrchestratorState {
  version: string;
  /** Total goals created by the orchestrator */
  goalsCreated: number;
  /** Total guideline updates made */
  guidelinesUpdated: number;
  /** Total conversation sessions handled */
  conversationsHandled: number;
  /** Total proactive alerts sent */
  proactiveAlertsSent: number;
  /** Completion rate of goals the orchestrator created */
  supervisedGoalCompletionRate: number;
  /** IDs of goals created by the orchestrator (for tracking) */
  supervisedGoalIds: string[];
  /** Recent alerts (for deduplication) */
  recentAlerts: Array<{
    message: string;
    timestamp: string;
  }>;
  /** Last proactive check timestamp */
  lastProactiveCheck?: string;
  /** Hash of last-seen DevAgent state for delta computation */
  lastStateHash?: string;
}

// ============================================================================
// Intent Classification
// ============================================================================

export type Intent =
  | { type: 'status_query' }
  | { type: 'goal_request'; rough_description: string }
  | { type: 'feedback'; sentiment: 'positive' | 'negative' | 'neutral'; about: string }
  | { type: 'guideline_discussion'; topic: string }
  | { type: 'question'; topic: string }
  | { type: 'confirmation'; affirms: boolean }
  | { type: 'chitchat' }
  | { type: 'unknown' };

// ============================================================================
// Context Assembly
// ============================================================================

export interface StateDelta {
  /** Goal IDs with status or task changes */
  goalsChanged: string[];
  /** Tasks completed since last check */
  newTaskResults: Array<{
    goalId: string;
    taskId: string;
    description: string;
    status: string;
  }>;
  /** Whether overall metrics changed */
  metricsChanged: boolean;
  /** Change in total cost since last check */
  costDelta: number;
  /** Human-readable summary */
  summary: string;
}

export interface AssembledContext {
  devAgent: {
    state: OphanState;
    analysis: DevAgentAnalysis;
    delta: StateDelta;
  };
  goals: {
    active: ParsedGoalFile[];
    recent: GoalProgressEntry[];
    conflicts: GoalConflict[];
  };
  memory: {
    preferences: Preference[];
    recentEpisodes: Episode[];
  };
  session: {
    history: ConversationMessage[];
    context: SessionContext;
  };
  guidelines: string;
  criteria: string;
}

// ============================================================================
// Memory
// ============================================================================

export interface OrchestratorMemory {
  preferences: Preference[];
  episodes: Episode[];
  patterns: MemoryPattern[];
}

export interface Preference {
  id: string;
  text: string;
  /** 0-1, increases with reinforcement */
  confidence: number;
  firstSeen: string;
  lastReinforced: string;
  /** Session ID where first extracted */
  source: string;
}

export interface Episode {
  id: string;
  sessionId: string;
  /** 1-2 sentence summary */
  summary: string;
  outcome: 'success' | 'partial' | 'abandoned';
  goalsCreated: string[];
  guidelinesUpdated: string[];
  timestamp: string;
}

export interface MemoryPattern {
  description: string;
  occurrences: number;
  lastSeen: string;
}

// ============================================================================
// Goal Lifecycle
// ============================================================================

export interface GoalConflict {
  goalA: string;
  goalB: string;
  type: 'overlapping_scope' | 'contradictory' | 'dependency_cycle';
  description: string;
}

export interface GoalRecommendation {
  type: 'retire' | 'reprioritize' | 'merge' | 'unblock';
  goalId: string;
  reason: string;
  suggestedAction: string;
}

export interface GoalValidation {
  valid: boolean;
  conflicts: GoalConflict[];
  suggestions: string[];
}

// ============================================================================
// Self-Evaluation
// ============================================================================

export interface SelfEvaluation {
  scores: EvalScore[];
  passed: boolean;
  suggestions: string[];
}

export interface EvalScore {
  /** Criterion name from orchestration-quality.md */
  criterion: string;
  /** 0-1 */
  score: number;
  reasoning: string;
}

export interface AggregateEvaluation {
  sessionCount: number;
  averageScores: Record<string, number>;
  weakAreas: string[];
  proposedGuidelineUpdates: Array<{
    file: string;
    change: string;
    reason: string;
  }>;
}

export function createInitialOrchestratorState(): OrchestratorState {
  return {
    version: '0.1.0',
    goalsCreated: 0,
    guidelinesUpdated: 0,
    conversationsHandled: 0,
    proactiveAlertsSent: 0,
    supervisedGoalCompletionRate: 0,
    supervisedGoalIds: [],
    recentAlerts: [],
  };
}

// ============================================================================
// Actions
// ============================================================================

/**
 * An action the orchestrator proposes to take.
 * Actions with requiresConfirmation=true wait for human approval.
 */
export interface ProposedAction {
  type: 'create_goal' | 'update_guideline' | 'propose_criteria_change' | 'show_analysis';
  description: string;
  requiresConfirmation: boolean;
  payload: ActionPayload;
}

export type ActionPayload =
  | GoalCreationPayload
  | GuidelineUpdatePayload
  | CriteriaProposalPayload
  | AnalysisPayload;

export interface GoalCreationPayload {
  type: 'create_goal';
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  tags: string[];
  dependsOn: string[];
}

export interface GuidelineUpdatePayload {
  type: 'update_guideline';
  file: string;
  operation: 'append' | 'replace_section' | 'replace_all';
  content: string;
  reason: string;
}

export interface CriteriaProposalPayload {
  type: 'propose_criteria_change';
  targetFile: string;
  change: string;
  reason: string;
  confidence: number;
}

export interface AnalysisPayload {
  type: 'show_analysis';
  analysisMarkdown: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  artifactPath?: string;
}

// ============================================================================
// Response
// ============================================================================

/**
 * Response from the orchestrator after processing a message
 */
export interface OrchestratorResponse {
  /** Natural language response text */
  text: string;
  /** Structured actions (some may need confirmation) */
  actions: ProposedAction[];
  /** Whether any actions are awaiting human confirmation */
  awaitingConfirmation: boolean;
}
