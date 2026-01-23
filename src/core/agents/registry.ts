/**
 * Agent Registry
 *
 * Central registry for all Ophan agents. Manages agent lifecycle,
 * coordinates outer loop execution across agents, and provides
 * a unified interface for the CLI.
 */

import type {
  BaseAgent,
  AgentId,
  AgentOptions,
  AgentOuterLoopResult,
  AgentMetrics,
} from './types.js';
import type { Proposal } from '../../types/index.js';

/**
 * Result of running all agents' outer loops
 */
export interface RegistryOuterLoopResult {
  /** All proposals from all agents */
  proposals: Proposal[];
  /** Results per agent */
  agentResults: Map<AgentId, AgentOuterLoopResult>;
  /** Aggregate metrics across all agents */
  metrics: AgentMetrics[];
  /** Guidelines that were auto-applied */
  guidelinesUpdated: string[];
}

/**
 * Central registry for managing Ophan agents.
 *
 * Usage:
 * ```typescript
 * const registry = new AgentRegistry();
 * registry.register(new TaskAgent());
 * registry.register(new ContextAgent());
 *
 * await registry.initializeAll(options);
 * const result = await registry.runAllOuterLoops(30, false);
 * ```
 */
export class AgentRegistry {
  private agents: Map<AgentId, BaseAgent> = new Map();
  private initialized: boolean = false;
  private options: AgentOptions | null = null;

  /**
   * Register an agent with the registry.
   * Must be called before initialization.
   *
   * @param agent - The agent to register
   * @throws Error if an agent with the same ID is already registered
   */
  register(agent: BaseAgent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent with ID '${agent.id}' is already registered`);
    }
    this.agents.set(agent.id, agent);
  }

  /**
   * Get an agent by ID
   */
  get(id: AgentId): BaseAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * Get all registered agents
   */
  getAll(): BaseAgent[] {
    return [...this.agents.values()];
  }

  /**
   * Get all agent IDs
   */
  getIds(): AgentId[] {
    return [...this.agents.keys()];
  }

  /**
   * Check if an agent is registered
   */
  has(id: AgentId): boolean {
    return this.agents.has(id);
  }

  /**
   * Initialize all registered agents
   */
  async initializeAll(options: AgentOptions): Promise<void> {
    this.options = options;

    for (const agent of this.agents.values()) {
      await agent.initialize(options);
    }

    this.initialized = true;
  }

  /**
   * Run outer loop for all agents and collect proposals.
   *
   * @param lookbackDays - Number of days to analyze
   * @param autoApplyGuidelines - Whether to auto-apply guideline changes
   * @returns Combined results from all agents
   */
  async runAllOuterLoops(
    lookbackDays: number,
    autoApplyGuidelines: boolean
  ): Promise<RegistryOuterLoopResult> {
    if (!this.initialized) {
      throw new Error('Registry not initialized. Call initializeAll() first.');
    }

    const allProposals: Proposal[] = [];
    const agentResults = new Map<AgentId, AgentOuterLoopResult>();
    const allMetrics: AgentMetrics[] = [];
    const guidelinesUpdated: string[] = [];

    for (const agent of this.agents.values()) {
      try {
        this.log(`Running outer loop for ${agent.name}...`);

        const result = await agent.runOuterLoop(lookbackDays, autoApplyGuidelines);

        agentResults.set(agent.id, result);
        allProposals.push(...result.proposals);
        allMetrics.push(...result.metrics);

        // Track auto-applied guidelines from proposals
        for (const proposal of result.proposals) {
          if (
            proposal.type === 'guideline' &&
            proposal.status === 'approved' &&
            !guidelinesUpdated.includes(proposal.targetFile)
          ) {
            guidelinesUpdated.push(proposal.targetFile);
          }
        }

        this.log(`${agent.name}: ${result.summary}`);
      } catch (error) {
        this.log(`${agent.name} outer loop failed: ${(error as Error).message}`);
      }
    }

    return {
      proposals: allProposals,
      agentResults,
      metrics: allMetrics,
      guidelinesUpdated,
    };
  }

  /**
   * Get metrics from all agents
   */
  async getAllMetrics(): Promise<Map<AgentId, AgentMetrics[]>> {
    const result = new Map<AgentId, AgentMetrics[]>();

    for (const agent of this.agents.values()) {
      try {
        const metrics = await agent.getMetrics();
        result.set(agent.id, metrics);
      } catch {
        result.set(agent.id, []);
      }
    }

    return result;
  }

  /**
   * Get a summary of all registered agents
   */
  getSummary(): Array<{
    id: AgentId;
    name: string;
    description: string;
    guidelineFiles: string[];
    criteriaFiles: string[];
  }> {
    return this.getAll().map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      guidelineFiles: agent.guidance.guidelineFiles,
      criteriaFiles: agent.guidance.criteriaFiles,
    }));
  }

  private log(message: string): void {
    this.options?.onProgress?.(message);
  }
}

/**
 * Global agent registry instance.
 * Use this for accessing agents throughout the application.
 */
let globalRegistry: AgentRegistry | null = null;

/**
 * Get the global agent registry, creating it if necessary.
 */
export function getAgentRegistry(): AgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (primarily for testing)
 */
export function resetAgentRegistry(): void {
  globalRegistry = null;
}
