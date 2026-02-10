/**
 * Intent Classifier
 *
 * Cheap haiku-based classification of user messages before the main
 * reasoner runs. Different intents route to different prompt templates
 * and cost profiles.
 */

import { runClaude, parseJsonResponse } from './claude-helper.js';
import type { ConversationMessage } from './conversation.js';
import type { Intent } from './types.js';

export interface IntentClassifierOptions {
  projectRoot: string;
}

export class IntentClassifier {
  private options: IntentClassifierOptions;

  constructor(options: IntentClassifierOptions) {
    this.options = options;
  }

  /**
   * Classify a user message into a structured intent.
   * Uses haiku for minimal cost.
   */
  async classify(
    message: string,
    recentHistory: ConversationMessage[]
  ): Promise<Intent> {
    // Fast-path: detect confirmations without LLM
    const confirmIntent = this.detectConfirmation(message);
    if (confirmIntent) return confirmIntent;

    // Fast-path: detect slash-like patterns
    const lower = message.toLowerCase().trim();
    if (
      lower.includes('status') ||
      lower.includes('how are things') ||
      lower.includes('what\'s happening')
    ) {
      return { type: 'status_query' };
    }

    // Build classification prompt
    const historyContext = recentHistory
      .slice(-5)
      .map((m) => `[${m.role}]: ${m.content.slice(0, 100)}`)
      .join('\n');

    const prompt = `Classify the user's intent in this conversation. Recent history:

${historyContext}

Current message: "${message}"

Respond with ONLY a JSON object (no markdown fences):
{
  "type": "<one of: status_query, goal_request, feedback, guideline_discussion, question, chitchat, unknown>",
  "rough_description": "<if goal_request: brief description of the goal>",
  "sentiment": "<if feedback: positive, negative, or neutral>",
  "about": "<if feedback: what the feedback is about>",
  "topic": "<if guideline_discussion or question: the topic>"
}

Rules:
- "status_query": asking about progress, metrics, health, results, costs, what happened
- "goal_request": wanting to build, implement, add, create, or fix something
- "feedback": expressing preference, opinion, like/dislike about how things work
- "guideline_discussion": discussing how the DevAgent should work, coding patterns, testing approach
- "question": general questions about the system, project, or capabilities
- "chitchat": greetings, thanks, small talk, off-topic
- "unknown": cannot classify`;

    try {
      const raw = await runClaude({
        prompt,
        projectRoot: this.options.projectRoot,
        model: 'haiku',
        maxTurns: 1,
      });

      const parsed = parseJsonResponse<{
        type?: string;
        rough_description?: string;
        sentiment?: string;
        about?: string;
        topic?: string;
      }>(raw);

      if (!parsed?.type) return { type: 'unknown' };

      return this.mapToIntent(parsed);
    } catch {
      // Classification failed — fall back to unknown
      return { type: 'unknown' };
    }
  }

  private detectConfirmation(message: string): Intent | null {
    const normalized = message.toLowerCase().trim();
    const affirmatives = [
      'yes', 'y', 'yes, proceed', 'approve', 'confirm',
      'ok', 'go ahead', 'do it', 'sure', 'yep', 'yeah',
    ];
    const negatives = [
      'no', 'n', 'cancel', 'deny', 'nope', 'don\'t', 'stop',
      'never mind', 'nevermind', 'skip',
    ];

    if (affirmatives.some((a) => normalized === a || normalized.startsWith(a + ' '))) {
      return { type: 'confirmation', affirms: true };
    }
    if (negatives.some((n) => normalized === n || normalized.startsWith(n + ' '))) {
      return { type: 'confirmation', affirms: false };
    }
    return null;
  }

  private mapToIntent(parsed: {
    type?: string;
    rough_description?: string;
    sentiment?: string;
    about?: string;
    topic?: string;
  }): Intent {
    switch (parsed.type) {
      case 'status_query':
        return { type: 'status_query' };
      case 'goal_request':
        return {
          type: 'goal_request',
          rough_description: parsed.rough_description ?? '',
        };
      case 'feedback':
        return {
          type: 'feedback',
          sentiment: (parsed.sentiment as 'positive' | 'negative' | 'neutral') ?? 'neutral',
          about: parsed.about ?? '',
        };
      case 'guideline_discussion':
        return {
          type: 'guideline_discussion',
          topic: parsed.topic ?? '',
        };
      case 'question':
        return { type: 'question', topic: parsed.topic ?? '' };
      case 'chitchat':
        return { type: 'chitchat' };
      default:
        return { type: 'unknown' };
    }
  }
}
