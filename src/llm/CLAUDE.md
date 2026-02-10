# src/llm/

Claude Code SDK integration and prompt engineering.

## Files

| File | Key Exports | Purpose |
|------|-------------|---------|
| `claude-code-executor.ts` | `ClaudeCodeExecutor`, `ClaudeCodeResult`, `convertToolOutputs()` | Executes tasks via Claude Agent SDK. Streams messages, tracks file usage, enforces cost limits. |
| `prompts.ts` | `buildSystemPrompt()`, `buildTaskMessage()`, `buildRegenerationMessage()`, `buildLearningExtractionPrompt()`, `buildEvaluationPrompt()` | Dynamic prompt templates for inner loop execution |

## ClaudeCodeExecutor

- Finds Claude Code executable from system PATH (filters out `node_modules` versions)
- Filters `ANTHROPIC_API_KEY` from environment to force subscription-based auth
- Processes streaming messages to capture tool calls and results
- Tracks file usage (read/written/searched) for context logger
- Supports regeneration strategies: `full` (discard all), `informed` (keep structure), `incremental` (minimal edits)
- Tracks cost and token usage for budget enforcement

## Prompt System

- System prompt is dynamically assembled from: guidelines, criteria, learnings, iteration context
- Emphasizes workflow: **Understand -> Plan -> Implement -> Verify -> TASK COMPLETE**
- Explicitly instructs against extras, refactoring, or unnecessary exploration
- Regeneration messages include previous evaluation feedback
- Learning extraction and evaluation prompts output structured JSON
