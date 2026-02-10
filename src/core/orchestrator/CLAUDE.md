# src/core/orchestrator/

Orchestrator Agent subsystems — intent classification, reasoning, memory, conversation, and action execution.

## Files

| File | Class | Purpose |
|------|-------|---------|
| `types.ts` | — | Orchestrator-specific types: `OrchestratorState`, `Intent` union, `AssembledContext`, `OrchestratorMemory`, `Preference`, `Episode`, `ProposedAction` |
| `intent-classifier.ts` | `IntentClassifier` | Cheap haiku-based intent routing. Fast-path heuristics for confirmations and status keywords before LLM call. |
| `context-assembler.ts` | `ContextAssembler` | Pre-reasoning hook: state delta computation (hash-based), goal conflict detection, memory retrieval, history truncation |
| `reasoner.ts` | `OrchestratorReasoner` | Main reasoning via Claude SDK `query()`. Intent-specific prompt templates. Response parsing with fallback. |
| `self-evaluator.ts` | `SelfEvaluator` | Heuristic per-message checks (length, clarity, goal quality). Aggregate Claude analysis per outer loop. Generates proposals. |
| `goal-manager.ts` | `GoalManager` | Claude-powered conflict detection, staleness detection (14 days), retirement suggestions, validation before creation |
| `dev-agent-analyzer.ts` | `DevAgentAnalyzer` | Reads DevAgent `state.json`. Produces health status (healthy/degraded/critical), quick alerts, cost summaries. |
| `conversation.ts` | `ConversationManager` | Session persistence as JSON. Context building from state. Message ID generation. History truncation. |
| `memory.ts` | `MemoryManager` | Cross-session memory: preferences + episodes. Distillation via Claude. Duplicate merging. 90-day retention. Low-confidence pruning (0.2 threshold). |
| `claude-helper.ts` | `runClaude()`, `parseJsonResponse()` | Shared Claude SDK wrapper. Balanced JSON extraction. Filters ANTHROPIC_API_KEY for subscription auth. |
| `action-executor.ts` | `ActionExecutor` | Writes to filesystem on behalf of orchestrator: create goals, update guidelines, create criteria proposals |
| `adapters/` | Messaging adapter implementations | Abstract interface for CLI, future Slack/Telegram |

## Processing Pipeline

```
User message → IntentClassifier → ContextAssembler → OrchestratorReasoner → ActionExecutor → SelfEvaluator
```

## Key Patterns

- **Cheap-then-expensive**: Haiku for classification, sonnet for reasoning
- **State delta detection**: Hash-based comparison to avoid redundant context updates
- **Memory distillation**: Full sessions condensed to preferences + episodes via Claude
- **Action execution via filesystem**: Goals and guidelines written as files for DevAgent discovery
