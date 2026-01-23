/**
 * Agent Framework
 *
 * Multi-agent architecture for Ophan based on the Two-Loop Paradigm.
 * Each agent owns a (G,C) pair and can generate proposals for improvement.
 */

// Types
export type {
  AgentId,
  AgentGuidanceConfig,
  AgentMetrics,
  AgentOuterLoopResult,
  AgentOptions,
  BaseAgent,
  ExecutableAgent,
  ExecutionResult,
} from './types.js';
export { isExecutableAgent } from './types.js';

// Registry
export {
  AgentRegistry,
  getAgentRegistry,
  resetAgentRegistry,
  type RegistryOuterLoopResult,
} from './registry.js';

// Utilities
export { IdGenerator, ContentLoader, AbstractAgent } from './utils.js';

// Agent Implementations
export { TaskAgent } from './task-agent.js';
export { ContextAgent } from './context-agent.js';
