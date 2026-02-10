# src/cli/utils/

Shared utilities used across CLI commands.

## Files

| File | Key Exports | Purpose |
|------|-------------|---------|
| `config.ts` | `findProjectRoot()`, `loadConfig()`, `saveConfig()`, `loadState()`, `saveState()`, `getOphanPaths()`, `interpolateEnvVars()` | Config/state file management. YAML for config, JSON for state. Zod validation. |
| `logger.ts` | `logger`, `setLogLevel()`, `getLogLevel()` | Styled logging with level filtering (debug/info/warn/error). Brand color: Ophan gold (#B9A46D). |
| `spinner.ts` | `createSpinner()`, `withSpinner()` | Ora-based loading indicators for async operations |
| `git.ts` | `isGitRepository()`, `getCurrentBranch()`, `createBranch()`, `commit()`, etc. | Wraps `simple-git` for git operations |
| `interactive-reviewer.ts` | `InteractiveReviewer` class | Human-in-the-loop proposal review. Supports interactive/non-interactive/auto modes. Uses `inquirer`. |

## Patterns

- `findProjectRoot()` searches parent directories for `.ophan.yaml` or `.git`
- `interpolateEnvVars()` replaces `${VAR_NAME}` in strings with environment variables
- `getOphanPaths()` returns all standard `.ophan/` directory paths
- `InteractiveReviewer` applies proposals using REPLACE, APPEND, or PREPEND directives
