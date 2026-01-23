import { z } from 'zod';

/**
 * Zod schema for .ophan/state.json validation
 */

export const LearningSchema = z.object({
  id: z.string(),
  content: z.string(),
  context: z.string(),
  issue: z.string(),
  resolution: z.string(),
  guidelineImpact: z.string(),
  embedding: z.array(z.number()).optional(),
  timestamp: z.string().datetime(),
  references: z.number().int().nonnegative().default(0),
  promoted: z.boolean().default(false),
});

export const ProposalSchema = z.object({
  id: z.string(),
  type: z.enum(['guideline', 'criteria']),
  /** Which agent generated this proposal */
  source: z.enum(['task-agent', 'context-agent']).default('task-agent'),
  targetFile: z.string(),
  change: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  status: z.enum(['pending', 'approved', 'rejected', 'skipped']).default('pending'),
  /** Human feedback when edited or rejected */
  humanFeedback: z.string().optional(),
  /** When the proposal was reviewed */
  reviewedAt: z.string().datetime().optional(),
  /** Who reviewed (for future multi-user support) */
  reviewedBy: z.string().optional(),
});

export const MetricsSchema = z.object({
  totalTasks: z.number().int().nonnegative().default(0),
  successfulTasks: z.number().int().nonnegative().default(0),
  failedTasks: z.number().int().nonnegative().default(0),
  escalatedTasks: z.number().int().nonnegative().default(0),
  successRate: z.number().min(0).max(100).default(0),
  averageIterations: z.number().nonnegative().default(0),
  maxIterationsHit: z.number().int().nonnegative().default(0),
  totalTokensUsed: z.number().int().nonnegative().default(0),
  totalCost: z.number().nonnegative().default(0),
  averageCostPerTask: z.number().nonnegative().default(0),
  averageTaskDuration: z.number().nonnegative().default(0),
  totalTimeSpent: z.number().nonnegative().default(0),
  totalLearnings: z.number().int().nonnegative().default(0),
  learningsPromoted: z.number().int().nonnegative().default(0),
  patternsDetected: z.number().int().nonnegative().default(0),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

export const OphanStateSchema = z.object({
  version: z.string().default('0.1.0'),
  lastReview: z.string().datetime().nullable().default(null),
  tasksSinceReview: z.number().int().nonnegative().default(0),
  pendingProposals: z.array(ProposalSchema).default([]),
  learnings: z.array(LearningSchema).default([]),
  metrics: MetricsSchema.default(() => {
    const now = new Date().toISOString();
    return {
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      escalatedTasks: 0,
      successRate: 0,
      averageIterations: 0,
      maxIterationsHit: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      averageCostPerTask: 0,
      averageTaskDuration: 0,
      totalTimeSpent: 0,
      totalLearnings: 0,
      learningsPromoted: 0,
      patternsDetected: 0,
      periodStart: now,
      periodEnd: now,
    };
  }),
});

export type OphanStateInput = z.input<typeof OphanStateSchema>;
export type OphanStateOutput = z.output<typeof OphanStateSchema>;

/**
 * Create a fresh state object
 */
export function createInitialState(): OphanStateOutput {
  const now = new Date().toISOString();
  return {
    version: '0.1.0',
    lastReview: null,
    tasksSinceReview: 0,
    pendingProposals: [],
    learnings: [],
    metrics: {
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      escalatedTasks: 0,
      successRate: 0,
      averageIterations: 0,
      maxIterationsHit: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      averageCostPerTask: 0,
      averageTaskDuration: 0,
      totalTimeSpent: 0,
      totalLearnings: 0,
      learningsPromoted: 0,
      patternsDetected: 0,
      periodStart: now,
      periodEnd: now,
    },
  };
}
