# src/

All source code for Ophan. Built with strict TypeScript (ES2022, ESM).

## Module Overview

| Directory | Purpose |
|-----------|---------|
| `cli/` | Commander.js CLI — commands, utilities, interactive reviewer |
| `core/` | Execution engines — inner loop, outer loop, agents, evaluation, learning |
| `llm/` | Claude Code SDK executor and prompt templates |
| `types/` | Core type definitions and Zod validation schemas |
| `ui/` | Express web dashboard with WebSocket real-time updates |
| `integrations/` | External services (webhook client) |
| `templates/` | Default project initialization templates |

## Key Rules

- All imports must use `.js` extensions (ESM requirement)
- Use `import type` for type-only imports
- One main class per file
- Agents communicate via filesystem only — no cross-agent imports
- File I/O uses `promises as fs` from `'fs'`
- Zod schemas validate all config and state at runtime
