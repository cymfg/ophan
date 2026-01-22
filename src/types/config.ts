import { z } from 'zod';

/**
 * Zod schema for .ophan.yaml configuration validation
 */

export const WebhookConfigSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  method: z.enum(['POST', 'PUT']).default('POST'),
  headers: z.record(z.string()).optional(),
  events: z.array(z.enum(['escalation', 'task_complete', 'digest'])),
});

/**
 * Execution backend configuration
 */
export const ExecutionConfigSchema = z.object({
  backend: z.enum(['api', 'claude-code']).default('api'),

  // Settings for Claude Code backend
  claudeCode: z
    .object({
      model: z.enum(['sonnet', 'opus', 'haiku']).default('sonnet'),
      permissionMode: z
        .enum(['default', 'acceptEdits', 'bypassPermissions'])
        .default('acceptEdits'),
      allowedTools: z
        .array(z.string())
        .default(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']),
      maxTurns: z.number().int().positive().default(50),
    })
    .default({}),
});

export const OphanConfigSchema = z.object({
  // Execution backend configuration
  execution: ExecutionConfigSchema.default({}),

  // Model settings (used by API backend)
  model: z
    .object({
      name: z.string().default('claude-sonnet-4-20250514'),
      maxTokens: z.number().int().positive().default(4096),
    })
    .default({}),

  innerLoop: z
    .object({
      maxIterations: z.number().int().positive().default(5),
      regenerationStrategy: z
        .enum(['full', 'informed', 'incremental'])
        .default('informed'),
      costLimit: z.number().positive().optional(),
    })
    .default({}),

  outerLoop: z
    .object({
      triggers: z
        .object({
          afterTasks: z.number().int().positive().default(10),
          schedule: z.string().optional(),
        })
        .default({}),
      minOccurrences: z.number().int().positive().default(3),
      minConfidence: z.number().min(0).max(1).default(0.7),
      lookbackDays: z.number().int().positive().default(30),
      maxProposals: z.number().int().positive().default(5),
      learnings: z
        .object({
          maxCount: z.number().int().positive().default(50),
          retentionDays: z.number().int().positive().default(90),
          promotionThreshold: z.number().int().positive().default(3),
          similarityThreshold: z.number().min(0).max(1).default(0.9),
        })
        .default({}),
    })
    .default({}),

  guardrails: z
    .object({
      protectedPaths: z.array(z.string()).default(['.ophan/criteria/**']),
      allowedCommands: z.array(z.string()).default([]),
      blockedCommands: z.array(z.string()).default(['rm -rf /', 'sudo rm']),
    })
    .default({}),

  escalations: z
    .object({
      webhooks: z.array(WebhookConfigSchema).default([]),
    })
    .optional(),
});

export type OphanConfigInput = z.input<typeof OphanConfigSchema>;
export type OphanConfigOutput = z.output<typeof OphanConfigSchema>;

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: OphanConfigOutput = OphanConfigSchema.parse({});
