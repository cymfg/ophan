# Ophan

A self-improving AI development agent based on the Two-Loop Paradigm. Separates **Guidelines** (how to work) from **Criteria** (what good looks like), allowing the agent to improve both through observation while preventing reward hacking via expert-in-the-loop oversight for criteria changes.

## Commands

```bash
npm run build          # esbuild bundle → dist/cli/index.js + copies dist/ui/public
npm run dev -- <cmd>   # Run CLI via tsx (e.g., npm run dev -- task "description")
npm test               # Vitest (tests/**/*.test.ts)
npm run test:coverage  # Vitest with v8 coverage
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src --ext .ts
```

Always run `npm run typecheck` and `npm run lint` before committing.

## Architecture

### Two-Loop Paradigm

- **Inner Loop** (`src/core/inner-loop.ts`): Per-task execution — context assembly → Claude Code execution → evaluation → learning extraction → regeneration → convergence
- **Outer Loop** (`src/core/outer-loop.ts`): Periodic learning — log analysis → pattern detection → learning consolidation → proposal generation → expert review

### Multi-Agent Framework

Each agent owns a (Guidelines, Criteria) pair. Agents do NOT import from each other — they communicate via the filesystem (goals, guidelines, `state.json`).

- **Dev Agent** (`src/core/agents/dev-agent.ts`): Goal-driven development executor. Guidelines: `coding.md`, `testing.md`, `planning.md`, `learnings.md`. Criteria: `quality.md`, `security.md`.
- **Orchestrator Agent** (`src/core/agents/orchestrator-agent.ts`): Supervisory, human-facing. Intent classification (haiku), structured reasoning (sonnet), cross-session memory, proactive monitoring, pluggable messaging adapters.

### Key Subsystems

- **Evaluation** (`src/core/evaluation.ts`): Tool-based (regex for test/lint/build failures) + criteria-based (quality, security, acceptance)
- **Learning** (`src/core/learning-manager.ts`): Extraction from failures, deduplication via similarity, promotion after threshold, retention/pruning
- **Context Tracking** (`src/core/context-logger.ts`): Hit/miss rates for provided vs used files, self-improving context compilation
- **Proposals**: Guidelines auto-apply; criteria changes require human approval (expert-in-the-loop)

### Source Layout

```
src/
├── cli/           # CLI commands (init, task, dev, review, chat, etc.) and utilities
├── core/          # Core engines: inner loop, outer loop, agents, evaluation, learning
│   ├── agents/    # Dev agent, orchestrator agent, registry, types, utils
│   └── orchestrator/  # Conversation, intent, reasoning, memory, adapters
├── llm/           # Claude Code SDK executor and system prompts
├── integrations/  # Webhook client for escalations
├── types/         # Core types (index.ts), config schemas (config.ts, Zod), state schemas
├── ui/            # Express server, routes, public assets (dashboard)
└── templates/     # Default initialization templates
```

### Runtime Data (`.ophan/` directory in user projects)

- `.ophan.yaml` — User-editable configuration
- `.ophan/guidelines/` — Agent-editable (learnings promoted here)
- `.ophan/criteria/` — Protected (human approval required)
- `.ophan/agents/dev/state.json` — Dev agent runtime state
- `.ophan/agents/orchestrator/state.json` — Orchestrator state
- `.ophan/agents/orchestrator/memory.json` — Cross-session memory

## Code Conventions

### TypeScript

- **Strict mode** enabled with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- **ESM only** — `"type": "module"` in package.json, ES2022 target
- **Import paths must use `.js` extensions** (ESM requirement even in TypeScript source)
- **Use `import type`** for type-only imports
- No `any` types in production code
- Explicit return types on all functions (including `Promise<Type>` for async)

### Import Order

```typescript
// 1. Node built-ins
import { promises as fs } from 'fs';
import path from 'path';

// 2. Third-party
import { Command } from 'commander';
import type { SomeType } from 'some-package';

// 3. Local (with .js extensions)
import { DevAgent } from './agents/dev-agent.js';
import type { Goal } from '../types/index.js';
```

### Naming

- Classes/interfaces: `PascalCase`
- Functions/methods/variables: `camelCase`
- One main class per file
- Options/config interfaces defined near their class

### Patterns

- Async/await over raw Promises
- `promises as fs` from `'fs'` for all file operations
- Try-catch for file ops that may fail (gracefully ignore missing files)
- Let errors propagate — don't catch and re-throw without adding context
- Zod schemas for all configuration and state validation

### Testing (Vitest)

- Tests live in `tests/unit/` matching `*.test.ts`
- Globals enabled (`describe`, `it`, `expect` available without import)
- Tests must be deterministic — no external service dependencies
- Pattern: Arrange → Act → Assert

### Commits

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Imperative mood, present tense ("Add feature" not "Added feature")
- First line under 72 characters
