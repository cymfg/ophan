# src/core/

Core execution engines implementing the Two-Loop Paradigm.

## Structure

- `agents/` — Multi-agent framework (DevAgent, OrchestratorAgent, registry)
- `orchestrator/` — Orchestrator subsystems (intent, reasoning, memory, adapters)
- Root files — Shared engines used by agents

## Root Files

| File | Class/Export | Purpose |
|------|-------------|---------|
| `inner-loop.ts` | `InnerLoop` | Per-task execution: context assembly → Claude Code → evaluation → learning → regeneration → convergence |
| `outer-loop.ts` | `OuterLoop` | Periodic review: load logs → run agent outer loops → consolidate learnings → generate digest |
| `evaluation.ts` | `EvaluationEngine` | Evaluates task output via regex (test/lint/build failures) + criteria assessment |
| `tool-runner.ts` | `ToolRunner` | Executes tools with guardrails (blocked commands, protected paths). Tracks file usage. |
| `pattern-detector.ts` | `PatternDetector` | Detects failure/iteration/success patterns across task logs |
| `learning-manager.ts` | `LearningManager` | Deduplication (Jaccard similarity), promotion (refs >= 3), retention (90-day pruning) |
| `intelligent-analyzer.ts` | `IntelligentAnalyzer` | Claude-powered semantic pattern analysis. Generates proposals. |
| `goal-planner.ts` | `GoalPlanner` | Decomposes goals into tasks. Assesses completion. Uses Claude. |
| `goal-parser.ts` | `parseGoalFile()`, `loadGoalFiles()`, `serializeGoalFile()` | Parses goal `.md` files with YAML frontmatter |
| `task-logger.ts` | `TaskLogger` | Persists task logs as JSON. Calculates metrics (success rate, avg iterations, cost). |
| `context-logger.ts` | `ContextLogger` | Tracks context hit/miss rates. Generates proposals for guideline refinement. |

## Key Design Decisions

- **Learn-Regenerate, not Edit-Revise**: Inner loop starts fresh each iteration with accumulated learnings rather than patching previous output
- **Only converge when evaluation passes**: Success requires both tool checks passing and criteria assessment
- **Regex-first evaluation**: Tool-based checks (test failures, TS errors, lint problems) use specific regex patterns to avoid false positives — no LLM call needed
- **Agents own their outer loops**: `OuterLoop` coordinates but each agent runs its own analysis
