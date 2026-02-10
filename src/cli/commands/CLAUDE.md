# src/cli/commands/

Individual CLI commands registered with Commander.js.

## Commands

| File | Command | Purpose |
|------|---------|---------|
| `init.ts` | `ophan init` | Initialize Ophan in a project (detect type, create `.ophan/` structure) |
| `task.ts` | `ophan task "desc"` | Execute a single task through the inner loop |
| `dev.ts` | `ophan dev` | Run goal-driven development cycle (plan + execute) |
| `chat.ts` | `ophan chat` | Interactive conversation with orchestrator agent |
| `daemon.ts` | `ophan daemon` | Background orchestrator (wake-check-act cycle) |
| `review.ts` | `ophan review` | Run outer loop and review proposals interactively |
| `ui.ts` | `ophan ui` | Start web dashboard server |
| `goals.ts` | `ophan goals` | Manage goals (list, add, show) |
| `status.ts` | `ophan status` | Display metrics and status summary |
| `logs.ts` | `ophan logs` | View recent task execution logs |
| `context-stats.ts` | `ophan context-stats` | Show context usage statistics |

## Patterns

- Each file exports a single `Command` instance
- Commands follow: resolve root → load config → load state → do work → save state → display results
- Use `loadConfig()` and `loadState()`/`saveState()` from `../utils/config.js`
- Use `logger` from `../utils/logger.js` for all output
- Suggest outer loop review when task threshold is reached
