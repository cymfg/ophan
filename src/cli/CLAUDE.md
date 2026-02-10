# src/cli/

Command-line interface for Ophan using Commander.js.

## Structure

- `index.ts` — Entry point. Registers all subcommands, supports `--verbose` flag.
- `commands/` — Individual CLI commands (init, task, dev, review, chat, etc.)
- `utils/` — Shared utilities (config, logging, git, spinner, interactive reviewer)

## Patterns

- Commands resolve project root from `--project` option or `findProjectRoot()` (searches for `.ophan.yaml` or `.git`)
- State loaded/saved through `utils/config.ts` (YAML config, JSON state)
- Progress feedback via `logger` (structured output) and `createSpinner()`/`withSpinner()` (async operations)
- Error handling: try-catch with `logger.error()` and `process.exit(1)`
- Common options: `--project` (path), `--json` (machine-readable), `--force` (override checks)

## Adding a New Command

1. Create `src/cli/commands/<name>.ts`
2. Export a `Command` instance (e.g., `export const myCommand = new Command('name')`)
3. Register it in `index.ts` via `program.addCommand(myCommand)`
4. Follow existing patterns: resolve project root, load config/state, use logger for output
