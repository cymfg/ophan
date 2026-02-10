# src/types/

Core type definitions and Zod validation schemas.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Core TypeScript interfaces: `OphanConfig`, `OphanState`, `Task`, `TaskLog`, `Evaluation`, `Learning`, `Proposal`, `Goal`, `GoalTask`, `GoalState`, `Pattern`, `FileUsage`, `ContextUsageLog`, `EscalationPayload`, `WebhookConfig` |
| `config.ts` | Zod schemas for `.ophan.yaml` validation: `OphanConfigSchema`, `ClaudeCodeConfigSchema`, `DEFAULT_CONFIG` |
| `state.ts` | Zod schemas for `state.json` validation: `OphanStateSchema`, `LearningSchema`, `ProposalSchema`, `MetricsSchema`, `GoalTaskSchema`, `GoalStateSchema`, `createInitialState()` |

## Conventions

- `index.ts` defines the TypeScript interfaces (shape of data)
- `config.ts` and `state.ts` define Zod schemas (runtime validation with defaults)
- Schemas provide sensible defaults so partial configs are valid
- Types are imported throughout the codebase via `import type { Foo } from '../types/index.js'`

## Key Type Relationships

- `OphanConfig` — loaded from `.ophan.yaml`, validated by `OphanConfigSchema`
- `OphanState` — loaded from `state.json`, validated by `OphanStateSchema`
- `Goal` (definition in `.md` files) vs `GoalState` (runtime in `state.json`) — separated for independent evolution
- `Learning` → `Proposal` → guideline/criteria change (the self-improvement pipeline)
- `Proposal.source`: `'dev-agent' | 'task-agent' | 'context-logger' | 'orchestrator'`
