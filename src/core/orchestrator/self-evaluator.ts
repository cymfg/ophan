/**
 * Self-Evaluator
 *
 * Evaluates the Orchestrator's own responses against its criteria
 * (orchestration-quality.md). Two modes:
 *
 * 1. Per-message heuristic checks (no LLM cost)
 * 2. Periodic aggregate analysis (Claude call during outer loop)
 */

import type { Proposal } from '../../types/index.js';
import { IdGenerator } from '../agents/utils.js';
import { runClaude, parseJsonResponse } from './claude-helper.js';
import type { ConversationSession } from './conversation.js';
import type {
  OrchestratorResponse,
  AssembledContext,
  SelfEvaluation,
  EvalScore,
  AggregateEvaluation,
  ProposedAction,
} from './types.js';

export interface SelfEvaluatorOptions {
  projectRoot: string;
  ophanDir: string;
}

export class SelfEvaluator {
  private options: SelfEvaluatorOptions;

  constructor(options: SelfEvaluatorOptions) {
    this.options = options;
  }

  /**
   * Evaluate a single response against heuristic criteria.
   * Fast, no LLM call — runs after every message.
   */
  evaluateResponse(
    response: OrchestratorResponse,
    context: AssembledContext,
    actions: ProposedAction[]
  ): SelfEvaluation {
    const scores: EvalScore[] = [];
    const suggestions: string[] = [];

    // 1. Response conciseness (50-2000 chars)
    const len = response.text.length;
    let conciseness = 1;
    if (len < 50) {
      conciseness = len / 50;
      suggestions.push('Response too short — provide more context');
    } else if (len > 2000) {
      conciseness = Math.max(0.3, 2000 / len);
      suggestions.push('Response too long — be more concise');
    }
    scores.push({
      criterion: 'response_conciseness',
      score: conciseness,
      reasoning:
        len < 50
          ? 'Too short'
          : len > 2000
            ? 'Too long'
            : 'Appropriate length',
    });

    // 2. Action clarity — if actions proposed, are they described in the text?
    if (actions.length > 0) {
      const actionsMentioned = actions.filter((a) => {
        const desc = a.description.toLowerCase();
        const text = response.text.toLowerCase();
        // Check if any key words from the action description appear in the response
        const words = desc.split(/\s+/).filter((w) => w.length > 4);
        return words.some((w) => text.includes(w));
      });
      const clarity = actions.length > 0
        ? actionsMentioned.length / actions.length
        : 1;
      scores.push({
        criterion: 'action_clarity',
        score: clarity,
        reasoning:
          clarity < 1
            ? `${actions.length - actionsMentioned.length} action(s) not described in response`
            : 'All actions described',
      });
      if (clarity < 1) {
        suggestions.push('Describe all proposed actions in the response text');
      }
    }

    // 3. Goal quality — if creating a goal, check completeness
    const goalActions = actions.filter((a) => a.type === 'create_goal');
    if (goalActions.length > 0) {
      let goalScore = 1;
      const reasons: string[] = [];

      for (const action of goalActions) {
        const payload = action.payload;
        if (payload.type !== 'create_goal') continue;

        if (!payload.title || payload.title.length < 5) {
          goalScore *= 0.5;
          reasons.push('Goal title too short');
        }
        if (!payload.description || payload.description.length < 20) {
          goalScore *= 0.7;
          reasons.push('Goal description too short');
        }
        if (
          !payload.acceptanceCriteria ||
          payload.acceptanceCriteria.length === 0
        ) {
          goalScore *= 0.5;
          reasons.push('No acceptance criteria');
        }
      }

      scores.push({
        criterion: 'goal_quality',
        score: goalScore,
        reasoning: reasons.length > 0 ? reasons.join('; ') : 'Goals well-defined',
      });
      if (goalScore < 1) {
        suggestions.push(...reasons);
      }
    }

    // 4. Context awareness — did we use the available state data?
    if (
      context.devAgent.analysis.issues.length > 0 &&
      !response.text.toLowerCase().includes('issue') &&
      !response.text.toLowerCase().includes('problem') &&
      !response.text.toLowerCase().includes('warning') &&
      !response.text.toLowerCase().includes('fail')
    ) {
      scores.push({
        criterion: 'context_awareness',
        score: 0.7,
        reasoning: 'Issues exist but were not mentioned in response',
      });
      suggestions.push(
        'Consider mentioning active issues when they are relevant'
      );
    } else {
      scores.push({
        criterion: 'context_awareness',
        score: 1,
        reasoning: 'Context appropriately referenced',
      });
    }

    // Overall pass: all scores above 0.5
    const passed = scores.every((s) => s.score >= 0.5);

    return { scores, passed, suggestions };
  }

  /**
   * Evaluate patterns across multiple sessions.
   * Uses Claude to identify systematic issues. Called during outer loop.
   */
  async evaluateAggregate(
    sessions: ConversationSession[],
    criteria: string
  ): Promise<AggregateEvaluation> {
    if (sessions.length === 0) {
      return {
        sessionCount: 0,
        averageScores: {},
        weakAreas: [],
        proposedGuidelineUpdates: [],
      };
    }

    // Build session summaries
    const summaries = sessions
      .slice(-10) // Limit to last 10 sessions
      .map((s) => {
        const msgCount = s.messages.length;
        const userMsgs = s.messages.filter((m) => m.role === 'user').length;
        const actions = s.messages
          .filter((m) => m.metadata?.actions && m.metadata.actions.length > 0)
          .length;
        const lastMsg = s.messages[s.messages.length - 1];
        return `- Session ${s.id}: ${msgCount} messages (${userMsgs} from user), ${actions} with actions, last active: ${s.lastActiveAt}${lastMsg ? `, last: "${lastMsg.content.slice(0, 80)}..."` : ''}`;
      })
      .join('\n');

    const prompt = `Evaluate this AI orchestrator's performance across multiple conversation sessions.

Sessions:
${summaries}

Evaluation Criteria:
${criteria}

Respond with ONLY a JSON object (no markdown fences):
{
  "averageScores": {
    "criterion_name": 0.8
  },
  "weakAreas": ["area needing improvement"],
  "proposedGuidelineUpdates": [
    {
      "file": "orchestration.md or communication.md",
      "change": "specific text to add or modify",
      "reason": "why this change would help"
    }
  ]
}

Rules:
- Score each criterion from the criteria doc on a 0-1 scale
- Identify patterns of weakness, not one-off issues
- Guideline updates should be concrete and actionable
- Only propose updates if there are clear patterns (not from a single session)`;

    try {
      const raw = await runClaude({
        prompt,
        projectRoot: this.options.projectRoot,
        model: 'haiku',
        maxTurns: 1,
      });

      const parsed = parseJsonResponse<{
        averageScores?: Record<string, number>;
        weakAreas?: string[];
        proposedGuidelineUpdates?: Array<{
          file: string;
          change: string;
          reason: string;
        }>;
      }>(raw);

      return {
        sessionCount: sessions.length,
        averageScores: parsed?.averageScores ?? {},
        weakAreas: parsed?.weakAreas ?? [],
        proposedGuidelineUpdates: parsed?.proposedGuidelineUpdates ?? [],
      };
    } catch {
      return {
        sessionCount: sessions.length,
        averageScores: {},
        weakAreas: [],
        proposedGuidelineUpdates: [],
      };
    }
  }

  /**
   * Generate EITL proposals from aggregate evaluation.
   */
  generateProposals(aggregateEval: AggregateEvaluation): Proposal[] {
    const proposals: Proposal[] = [];

    for (const update of aggregateEval.proposedGuidelineUpdates) {
      // Guideline updates can be auto-applied; criteria changes need EITL
      const isCriteria = update.file.includes('criteria');

      proposals.push({
        id: IdGenerator.proposal('orch-self'),
        type: isCriteria ? 'criteria' : 'guideline',
        source: 'orchestrator',
        targetFile: update.file,
        change: update.change,
        reason: `Self-evaluation (${aggregateEval.sessionCount} sessions): ${update.reason}`,
        confidence: 0.6,
        createdAt: new Date().toISOString(),
        status: 'pending',
      });
    }

    return proposals;
  }
}
