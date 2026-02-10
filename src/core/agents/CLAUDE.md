# src/core/agents/

Multi-agent framework. Each agent owns a (Guidelines, Criteria) pair.

## Files

| File | Key Exports | Purpose |
|------|-------------|---------|
| `types.ts` | `BaseAgent`, `ExecutableAgent`, `AgentId`, `AgentGuidanceConfig` | Core agent interfaces. `isExecutableAgent()` type guard. |
| `utils.ts` | `IdGenerator`, `ContentLoader`, `AbstractAgent` | ID generation (timestamp + random suffix), file loading with date filtering, base class with logging |
| `registry.ts` | `AgentRegistry`, `getAgentRegistry()` | Singleton registry for multi-agent coordination. Aggregate metrics. Deferred initialization. |
| `dev-agent.ts` | `DevAgent` | Goal-driven development executor. Reconciles goal files with state, decomposes via GoalPlanner, runs inner loop. |
| `orchestrator-agent.ts` | `OrchestratorAgent` | Supervisory human-facing agent. Intent classification → context assembly → reasoning → self-evaluation. Daemon mode. |
| `index.ts` | Barrel exports | Re-exports all agent types, registry, utilities, and implementations |

## Architecture

- **No cross-agent imports** — agents communicate via filesystem (goals, guidelines, state.json)
- `DevAgent` implements `ExecutableAgent` (has `execute()` for running goals through inner loop)
- `OrchestratorAgent` implements `BaseAgent` (conversation-based, no `execute()`)
- Both agents implement `runOuterLoop()` for self-improvement
- Registry tracks all agents and collects aggregate results

## DevAgent Flow

1. Load goal files from `.ophan/goals/` → reconcile with runtime state
2. Plan: decompose goals into tasks via `GoalPlanner`
3. Execute: run tasks through `InnerLoop` sequentially
4. Assess: check goal completion after all tasks
5. Outer loop: analyze patterns via `IntelligentAnalyzer`, consolidate learnings

## OrchestratorAgent Flow

1. Classify intent (cheap haiku call)
2. Assemble context (dev state, memory, session history)
3. Reason (sonnet call with intent-specific prompts)
4. Execute actions (create goals, update guidelines)
5. Self-evaluate response quality
6. Distill memory from session on close
