import { z } from 'zod';

/**
 * Zod schema for .ophan.yaml configuration validation
 */

export const WebhookConfigSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  method: z.enum(['POST', 'PUT']).default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  events: z.array(z.enum(['escalation', 'task_complete', 'digest'])),
});

/**
 * Claude Code execution configuration
 * Note: Ophan uses Claude Code (subscription) as the only execution backend
 */
export const ClaudeCodeConfigSchema = z.object({
  model: z.enum(['sonnet', 'opus', 'haiku']).default('sonnet'),
  permissionMode: z
    .enum(['default', 'acceptEdits', 'bypassPermissions'])
    .default('acceptEdits'),
  allowedTools: z
    .array(z.string())
    .default(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']),
  maxTurns: z.number().int().positive().default(50),
});

export const OphanConfigSchema = z.object({
  // Claude Code execution configuration
  claudeCode: ClaudeCodeConfigSchema.default(() => ({
    model: 'sonnet' as const,
    permissionMode: 'acceptEdits' as const,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    maxTurns: 50,
  })),

  innerLoop: z
    .object({
      maxIterations: z.number().int().positive().default(5),
      regenerationStrategy: z
        .enum(['full', 'informed', 'incremental'])
        .default('informed'),
      costLimit: z.number().positive().optional(),
    })
    .default(() => ({
      maxIterations: 5,
      regenerationStrategy: 'informed' as const,
      costLimit: undefined,
    })),

  outerLoop: z
    .object({
      triggers: z
        .object({
          afterTasks: z.number().int().positive().default(10),
          schedule: z.string().optional(),
        })
        .default(() => ({ afterTasks: 10, schedule: undefined })),
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
        .default(() => ({
          maxCount: 50,
          retentionDays: 90,
          promotionThreshold: 3,
          similarityThreshold: 0.9,
        })),
    })
    .default(() => ({
      triggers: { afterTasks: 10, schedule: undefined },
      minOccurrences: 3,
      minConfidence: 0.7,
      lookbackDays: 30,
      maxProposals: 5,
      learnings: {
        maxCount: 50,
        retentionDays: 90,
        promotionThreshold: 3,
        similarityThreshold: 0.9,
      },
    })),

  guardrails: z
    .object({
      protectedPaths: z.array(z.string()).default(['.ophan/criteria/**']),
      allowedCommands: z.array(z.string()).default([]),
      blockedCommands: z.array(z.string()).default(['rm -rf /', 'sudo rm']),
    })
    .default(() => ({
      protectedPaths: ['.ophan/criteria/**'],
      allowedCommands: [],
      blockedCommands: ['rm -rf /', 'sudo rm'],
    })),

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
