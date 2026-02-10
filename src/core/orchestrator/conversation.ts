/**
 * Conversation Manager
 *
 * Manages conversation sessions between the Orchestrator and humans.
 * Sessions are persisted to .ophan/orchestrator/sessions/.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { OphanState } from '../../types/index.js';
import { loadGoalFiles } from '../goal-parser.js';

// ============================================================================
// Types
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'orchestrator' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    /** Actions proposed or taken */
    actions?: Array<{ type: string; description: string }>;
    /** Whether this message awaits human confirmation */
    awaitingConfirmation?: boolean;
  };
}

export interface SessionContext {
  /** Active goals summary */
  activeGoals: Array<{
    id: string;
    title: string;
    status: string;
    taskProgress: string;
  }>;
  /** Key metrics */
  metrics: {
    totalTasks: number;
    successRate: number;
    totalCost: number;
    tasksSinceReview: number;
  };
  /** Recent events */
  recentEvents: Array<{
    type: string;
    goalId?: string;
    summary: string;
  }>;
}

export interface ConversationSession {
  id: string;
  startedAt: string;
  lastActiveAt: string;
  messages: ConversationMessage[];
  context: SessionContext;
}

// ============================================================================
// Manager
// ============================================================================

export class ConversationManager {
  private sessionsDir: string;

  constructor(private ophanDir: string) {
    this.sessionsDir = path.join(ophanDir, 'orchestrator', 'sessions');
  }

  /**
   * Create a new conversation session
   */
  async createSession(state: OphanState): Promise<ConversationSession> {
    await fs.mkdir(this.sessionsDir, { recursive: true });

    const now = new Date().toISOString();
    const id = `session-${now.replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    const context = await this.buildSessionContext(state);

    const session: ConversationSession = {
      id,
      startedAt: now,
      lastActiveAt: now,
      messages: [],
      context,
    };

    return session;
  }

  /**
   * Load the most recent session for resumption
   */
  async loadLatestSession(): Promise<ConversationSession | null> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();

      if (sessionFiles.length === 0) return null;

      const content = await fs.readFile(
        path.join(this.sessionsDir, sessionFiles[0]),
        'utf-8'
      );
      return JSON.parse(content) as ConversationSession;
    } catch {
      return null;
    }
  }

  /**
   * Save a session to disk
   */
  async saveSession(session: ConversationSession): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });

    session.lastActiveAt = new Date().toISOString();
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Add a message to a session
   */
  addMessage(session: ConversationSession, message: Omit<ConversationMessage, 'id'>): void {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    session.messages.push({ id, ...message });
    session.lastActiveAt = new Date().toISOString();
  }

  /**
   * Build context from current state for a session
   */
  async buildSessionContext(state: OphanState): Promise<SessionContext> {
    // Load goal file titles
    const goalsDir = path.join(this.ophanDir, 'goals');
    let goalFiles: Array<{ id: string; title: string }> = [];
    try {
      const parsed = await loadGoalFiles(goalsDir);
      goalFiles = parsed.map((g) => ({ id: g.id, title: g.title }));
    } catch {
      // Goals dir might not exist
    }

    // Build active goals summary
    const activeGoals = state.goals
      .filter((g) => !['completed', 'abandoned'].includes(g.status))
      .map((g) => {
        const goalFile = goalFiles.find((gf) => gf.id === g.goalId);
        const completed = g.tasks.filter(
          (t) => t.status === 'converged'
        ).length;
        return {
          id: g.goalId,
          title: goalFile?.title ?? g.goalId,
          status: g.status,
          taskProgress:
            g.tasks.length > 0
              ? `${completed}/${g.tasks.length}`
              : 'no tasks',
        };
      });

    // Build recent events
    const recentEvents: SessionContext['recentEvents'] = [];
    for (const goal of state.goals) {
      if (goal.status === 'completed') {
        recentEvents.push({
          type: 'goal_completed',
          goalId: goal.goalId,
          summary: `Goal completed`,
        });
      }
      if (goal.status === 'blocked') {
        recentEvents.push({
          type: 'goal_blocked',
          goalId: goal.goalId,
          summary: `Goal is blocked`,
        });
      }
      for (const task of goal.tasks) {
        if (task.status === 'failed' || task.status === 'escalated') {
          recentEvents.push({
            type: `task_${task.status}`,
            goalId: goal.goalId,
            summary: `Task "${task.description}" ${task.status}`,
          });
        }
      }
    }

    return {
      activeGoals,
      metrics: {
        totalTasks: state.metrics.totalTasks,
        successRate: state.metrics.successRate,
        totalCost: state.metrics.totalCost,
        tasksSinceReview: state.tasksSinceReview,
      },
      recentEvents: recentEvents.slice(0, 10),
    };
  }

  /**
   * Truncate history to keep context window manageable.
   * Keeps the system message (if any) and the last N messages.
   */
  truncateHistory(
    messages: ConversationMessage[],
    maxMessages: number
  ): ConversationMessage[] {
    if (messages.length <= maxMessages) return messages;

    // Keep system messages and the last N messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');
    const truncated = nonSystem.slice(-maxMessages);

    return [...systemMessages, ...truncated];
  }

  /**
   * Clean up old sessions beyond the retention limit
   */
  async cleanupSessions(maxRetained: number): Promise<number> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();

      let removed = 0;
      for (let i = maxRetained; i < sessionFiles.length; i++) {
        await fs.unlink(path.join(this.sessionsDir, sessionFiles[i]));
        removed++;
      }
      return removed;
    } catch {
      return 0;
    }
  }
}
