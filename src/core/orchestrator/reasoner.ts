/**
 * Orchestrator Reasoner
 *
 * The Orchestrator's reasoning engine. Uses Claude SDK query()
 * to analyze context and generate responses with structured actions.
 *
 * Now accepts AssembledContext + Intent for scoped prompts per intent type.
 */

import type { OphanConfig } from '../../types/index.js';
import type { ConversationMessage, SessionContext } from './conversation.js';
import type { DevAgentAnalysis } from './dev-agent-analyzer.js';
import type { ProposedAction, AssembledContext, Intent } from './types.js';
import { runClaude, parseJsonResponse } from './claude-helper.js';

// ============================================================================
// Types
// ============================================================================

export interface ReasonerInput {
  userMessage: string;
  history: ConversationMessage[];
  context: SessionContext;
  analysis?: DevAgentAnalysis;
  guidelines: string;
  criteria: string;
}

export interface ReasonerOutput {
  responseText: string;
  proposedActions: ProposedAction[];
  needsMoreInfo: boolean;
  reasoning: string;
}

export interface OrchestratorReasonerOptions {
  projectRoot: string;
  ophanDir: string;
  config: OphanConfig;
  onProgress?: (message: string) => void;
}

// ============================================================================
// Reasoner
// ============================================================================

export class OrchestratorReasoner {
  constructor(private options: OrchestratorReasonerOptions) {}

  /**
   * Process input through the reasoning loop.
   * Legacy method — still works but prefer reasonWithContext().
   */
  async reason(input: ReasonerInput): Promise<ReasonerOutput> {
    const prompt = this.buildPrompt(input);
    const response = await this.runQuery(prompt);
    return this.parseResponse(response);
  }

  /**
   * Process input with assembled context and classified intent.
   * New primary entry point — uses intent-specific prompt templates.
   */
  async reasonWithContext(
    userMessage: string,
    context: AssembledContext,
    intent: Intent
  ): Promise<ReasonerOutput> {
    const prompt = this.buildContextPrompt(userMessage, context, intent);
    const response = await this.runQuery(prompt);
    return this.parseResponse(response);
  }

  /**
   * Generate a proactive analysis message (no user input)
   */
  async generateProactiveMessage(
    context: SessionContext,
    analysis: DevAgentAnalysis,
    guidelines: string
  ): Promise<ReasonerOutput> {
    const prompt = this.buildProactivePrompt(context, analysis, guidelines);
    const response = await this.runQuery(prompt);
    return this.parseResponse(response);
  }

  // =========================================================================
  // Context-aware prompts (new)
  // =========================================================================

  private buildContextPrompt(
    userMessage: string,
    context: AssembledContext,
    intent: Intent
  ): string {
    const baseSystem = this.buildSystemSection(
      context.guidelines,
      context.criteria
    );

    // Format state context
    const stateContext = this.formatSessionContext(context.session.context);
    const analysisSection = this.formatAnalysis(context.devAgent.analysis);

    // Format delta
    const deltaSection =
      context.devAgent.delta.summary !== 'no changes' &&
      context.devAgent.delta.summary !== 'first check'
        ? `\n## Recent Changes\n\n${context.devAgent.delta.summary}`
        : '';

    // Format memory
    const memorySection =
      context.memory.preferences.length > 0
        ? `\n## User Preferences\n\n${context.memory.preferences.map((p) => `- ${p.text} (confidence: ${p.confidence.toFixed(1)})`).join('\n')}`
        : '';

    // Format goal conflicts
    const conflictsSection =
      context.goals.conflicts.length > 0
        ? `\n## Goal Conflicts\n\n${context.goals.conflicts.map((c) => `- ${c.goalA} ↔ ${c.goalB}: ${c.description} (${c.type})`).join('\n')}`
        : '';

    // Intent-specific instructions
    const intentInstructions = this.getIntentInstructions(intent);

    // Conversation history
    const historySection = context.session.history
      .slice(-20)
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');

    return `${baseSystem}

## Current Project State

${stateContext}

## DevAgent Analysis

${analysisSection}
${deltaSection}
${memorySection}
${conflictsSection}

## Intent Classification

The user's message has been classified as: **${intent.type}**
${intentInstructions}

## Conversation History

${historySection}

## Current Message

[user]: ${userMessage}

Respond with a JSON object as described above.`;
  }

  private getIntentInstructions(intent: Intent): string {
    switch (intent.type) {
      case 'goal_request':
        return `The user wants to create or work toward a goal. Focus on:
- Understanding their needs fully before proposing
- Creating a well-structured goal with clear acceptance criteria
- Checking for conflicts with existing goals`;
      case 'feedback':
        return `The user is giving feedback (${(intent as { type: 'feedback'; sentiment: string }).sentiment}). Focus on:
- Acknowledging their feedback
- Understanding what they want changed
- Proposing concrete actions if applicable`;
      case 'guideline_discussion':
        return `The user wants to discuss how the DevAgent works. Focus on:
- Explaining current guideline behavior
- Suggesting specific guideline improvements if appropriate
- Being specific about what would change`;
      case 'question':
        return `The user has a question. Focus on:
- Giving a clear, direct answer
- Using actual data from the project state
- Suggesting next steps if relevant`;
      case 'chitchat':
        return `This is casual conversation. Keep it brief and friendly. No need for detailed analysis.`;
      default:
        return '';
    }
  }

  // =========================================================================
  // Legacy prompts (kept for backward compatibility)
  // =========================================================================

  private buildPrompt(input: ReasonerInput): string {
    const systemSection = this.buildSystemSection(input.guidelines, input.criteria);
    const contextSection = this.formatSessionContext(input.context);
    const analysisSection = input.analysis
      ? `\n## DevAgent Analysis\n\n${this.formatAnalysis(input.analysis)}`
      : '';

    const historySection = input.history
      .slice(-20)
      .map((m) => `[${m.role}]: ${m.content}`)
      .join('\n');

    return `${systemSection}

## Current Project State

${contextSection}
${analysisSection}

## Conversation History

${historySection}

## Current Message

[user]: ${input.userMessage}

Respond with a JSON object as described above.`;
  }

  private buildProactivePrompt(
    context: SessionContext,
    analysis: DevAgentAnalysis,
    guidelines: string
  ): string {
    return `You are the Orchestrator Agent for Ophan. You are sending a proactive status update.

## Your Guidelines

${guidelines}

## Current Project State

${this.formatSessionContext(context)}

## DevAgent Analysis

${this.formatAnalysis(analysis)}

## Instructions

Based on the current state, generate a proactive update for the human developer.
Focus on:
- Issues that need attention
- Goals that are blocked or failing
- Suggestions for improvement

Respond with a JSON object:
{
  "responseText": "Your message to the developer",
  "proposedActions": [],
  "needsMoreInfo": false,
  "reasoning": "Why you are sending this update"
}

Keep the message concise and actionable.`;
  }

  private buildSystemSection(guidelines: string, criteria: string): string {
    return `You are the Orchestrator Agent for Ophan, a self-improving AI development system.

## Your Role

You supervise a Development Agent (DevAgent) that executes coding tasks. You do NOT write code yourself.
You analyze DevAgent results, converse with the human developer, create development goals,
and update the DevAgent's guidelines to improve its performance.

## Your Guidelines

${guidelines}

## Your Criteria

${criteria}

## What You Can Do

1. **Create Goals**: Propose new .ophan/goals/*.md files for the DevAgent to work on
2. **Update Guidelines**: Propose modifications to .ophan/guidelines/*.md to improve DevAgent behavior
3. **Propose Criteria Changes**: Submit proposals for .ophan/criteria/*.md (requires human approval via EITL)
4. **Analyze**: Review DevAgent metrics, goal progress, and task outcomes
5. **Advise**: Help the human understand what's happening and what to do next

## Response Format

Respond with ONLY a JSON object (no markdown fences):
{
  "responseText": "Your natural language response to the human",
  "proposedActions": [
    {
      "type": "create_goal",
      "description": "What this goal achieves",
      "requiresConfirmation": true,
      "payload": {
        "type": "create_goal",
        "title": "Goal title",
        "description": "Detailed description",
        "acceptanceCriteria": ["criterion 1", "criterion 2"],
        "priority": 10,
        "tags": [],
        "dependsOn": []
      }
    }
  ],
  "needsMoreInfo": false,
  "reasoning": "Your internal reasoning (not shown to user)"
}

## Rules

- ALWAYS set requiresConfirmation: true for create_goal and update_guideline actions
- Present proposed actions clearly in responseText so the human knows what you want to do
- If proposing a goal, include full details (title, description, acceptance criteria, priority)
- For guideline updates, explain what you want to change and why
- If the user is just chatting or asking questions, respond conversationally with no actions
- If you need more information to take action, set needsMoreInfo: true and ask in responseText`;
  }

  private formatSessionContext(context: SessionContext): string {
    const lines: string[] = [];

    lines.push('**Metrics:**');
    lines.push(`- Total tasks: ${context.metrics.totalTasks}`);
    lines.push(`- Success rate: ${context.metrics.successRate.toFixed(0)}%`);
    lines.push(`- Total cost: $${context.metrics.totalCost.toFixed(4)}`);
    lines.push(`- Tasks since review: ${context.metrics.tasksSinceReview}`);
    lines.push('');

    if (context.activeGoals.length > 0) {
      lines.push('**Active Goals:**');
      for (const g of context.activeGoals) {
        lines.push(`- ${g.title} (${g.status}, ${g.taskProgress})`);
      }
      lines.push('');
    } else {
      lines.push('**Active Goals:** None');
      lines.push('');
    }

    if (context.recentEvents.length > 0) {
      lines.push('**Recent Events:**');
      for (const e of context.recentEvents) {
        lines.push(`- [${e.type}] ${e.summary}`);
      }
    }

    return lines.join('\n');
  }

  private formatAnalysis(analysis: DevAgentAnalysis): string {
    const lines: string[] = [];

    lines.push(`**Health:** ${analysis.health}`);
    lines.push('');

    if (analysis.issues.length > 0) {
      lines.push('**Issues:**');
      for (const issue of analysis.issues) {
        lines.push(`- [${issue.severity}] ${issue.description}`);
        lines.push(`  Suggested: ${issue.suggestedAction}`);
      }
      lines.push('');
    }

    if (analysis.recentFailures.length > 0) {
      lines.push('**Recent Failures:**');
      for (const f of analysis.recentFailures.slice(0, 5)) {
        lines.push(`- [${f.goalId}] ${f.description}: ${f.failureReason}`);
      }
      lines.push('');
    }

    lines.push(
      `**Cost:** $${analysis.costSummary.totalCost.toFixed(4)} total, $${analysis.costSummary.averageCostPerTask.toFixed(4)} avg/task`
    );

    return lines.join('\n');
  }

  private parseResponse(raw: string): ReasonerOutput {
    const data = parseJsonResponse<{
      responseText?: string;
      proposedActions?: ProposedAction[];
      needsMoreInfo?: boolean;
      reasoning?: string;
    }>(raw);

    if (!data) {
      return this.fallbackResponse(raw);
    }

    return {
      responseText: data.responseText ?? raw,
      proposedActions: data.proposedActions ?? [],
      needsMoreInfo: data.needsMoreInfo ?? false,
      reasoning: data.reasoning ?? '',
    };
  }

  private fallbackResponse(raw: string): ReasonerOutput {
    return {
      responseText: raw,
      proposedActions: [],
      needsMoreInfo: false,
      reasoning: 'Failed to parse structured response, returning raw text',
    };
  }

  private async runQuery(prompt: string): Promise<string> {
    const model =
      this.options.config.orchestrator?.model ??
      this.options.config.claudeCode?.model ??
      'sonnet';

    return runClaude({
      prompt,
      projectRoot: this.options.projectRoot,
      model,
      maxTurns: 5,
    });
  }
}
