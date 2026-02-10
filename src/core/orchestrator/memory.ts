/**
 * Memory System
 *
 * Cross-session memory that outlives individual conversations.
 * Distills raw conversation sessions into structured preferences,
 * episodes, and patterns. Persisted at .ophan/orchestrator/memory.json.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { runClaude, parseJsonResponse } from './claude-helper.js';
import type { ConversationSession } from './conversation.js';
import type {
  OrchestratorMemory,
  Preference,
  Episode,
  MemoryPattern,
  Intent,
} from './types.js';

export interface MemoryManagerOptions {
  ophanDir: string;
  projectRoot: string;
  maxPreferences?: number;
  maxEpisodes?: number;
}

export class MemoryManager {
  private options: MemoryManagerOptions;
  private memory: OrchestratorMemory;
  private memoryPath: string;
  private loaded = false;

  constructor(options: MemoryManagerOptions) {
    this.options = options;
    this.memoryPath = path.join(options.ophanDir, 'orchestrator', 'memory.json');
    this.memory = { preferences: [], episodes: [], patterns: [] };
  }

  /**
   * Load memory from disk.
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.memoryPath, 'utf-8');
      this.memory = JSON.parse(content) as OrchestratorMemory;
    } catch {
      this.memory = { preferences: [], episodes: [], patterns: [] };
    }
    this.loaded = true;
  }

  /**
   * Save memory to disk.
   */
  async save(): Promise<void> {
    const dir = path.dirname(this.memoryPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.memoryPath,
      JSON.stringify(this.memory, null, 2),
      'utf-8'
    );
  }

  /**
   * Get memory relevant to the current intent and context.
   */
  getRelevantMemory(
    _intent?: Intent,
    limit = 10
  ): { preferences: Preference[]; recentEpisodes: Episode[] } {
    if (!this.loaded) {
      return { preferences: [], recentEpisodes: [] };
    }

    // Return top preferences by confidence
    const preferences = [...this.memory.preferences]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    // Return most recent episodes
    const recentEpisodes = [...this.memory.episodes]
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, limit);

    return { preferences, recentEpisodes };
  }

  /**
   * Record or reinforce a user preference.
   */
  recordPreference(text: string, sessionId: string): void {
    // Check for existing similar preference
    const existing = this.memory.preferences.find(
      (p) => p.text.toLowerCase() === text.toLowerCase()
    );

    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.lastReinforced = new Date().toISOString();
    } else {
      this.memory.preferences.push({
        id: `pref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text,
        confidence: 0.5,
        firstSeen: new Date().toISOString(),
        lastReinforced: new Date().toISOString(),
        source: sessionId,
      });
    }

    // Cap preferences
    const max = this.options.maxPreferences ?? 50;
    if (this.memory.preferences.length > max) {
      this.memory.preferences = this.memory.preferences
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, max);
    }
  }

  /**
   * Record a conversation episode.
   */
  recordEpisode(episode: Episode): void {
    this.memory.episodes.push(episode);

    // Cap episodes
    const max = this.options.maxEpisodes ?? 200;
    if (this.memory.episodes.length > max) {
      this.memory.episodes = this.memory.episodes
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
        .slice(0, max);
    }
  }

  /**
   * Distill a completed session into preferences and episodes.
   * Uses Claude (haiku) to extract structured memory from raw messages.
   */
  async distillSession(session: ConversationSession): Promise<void> {
    if (session.messages.length < 3) {
      // Too short to distill meaningfully
      return;
    }

    const messagesText = session.messages
      .filter((m) => m.role !== 'system')
      .slice(-30)
      .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`)
      .join('\n');

    const prompt = `Analyze this conversation between a developer and an AI orchestrator agent. Extract structured memory.

Conversation:
${messagesText}

Respond with ONLY a JSON object (no markdown fences):
{
  "preferences": [
    { "text": "brief preference statement" }
  ],
  "episode": {
    "summary": "1-2 sentence summary of what happened",
    "outcome": "success | partial | abandoned",
    "goalsCreated": ["goal IDs if any were created"],
    "guidelinesUpdated": ["guideline files if any were updated"]
  }
}

Rules:
- Preferences are things the user likes/dislikes or prefers about how development should work
- Only include clear, explicit preferences — not inferred ones
- Episode summary should capture the key outcome of the session
- If no clear preferences expressed, return empty preferences array`;

    try {
      const raw = await runClaude({
        prompt,
        projectRoot: this.options.projectRoot,
        model: 'haiku',
        maxTurns: 1,
      });

      const parsed = parseJsonResponse<{
        preferences?: Array<{ text: string }>;
        episode?: {
          summary: string;
          outcome?: string;
          goalsCreated?: string[];
          guidelinesUpdated?: string[];
        };
      }>(raw);

      if (!parsed) return;

      // Record preferences
      if (parsed.preferences) {
        for (const pref of parsed.preferences) {
          if (pref.text) {
            this.recordPreference(pref.text, session.id);
          }
        }
      }

      // Record episode
      if (parsed.episode?.summary) {
        this.recordEpisode({
          id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sessionId: session.id,
          summary: parsed.episode.summary,
          outcome:
            (parsed.episode.outcome as Episode['outcome']) ?? 'partial',
          goalsCreated: parsed.episode.goalsCreated ?? [],
          guidelinesUpdated: parsed.episode.guidelinesUpdated ?? [],
          timestamp: new Date().toISOString(),
        });
      }

      await this.save();
    } catch {
      // Distillation failed — not critical
    }
  }

  /**
   * Consolidate memory: merge duplicate preferences, prune old episodes.
   * Called during outer loop.
   */
  async consolidate(): Promise<{
    preferencesRemoved: number;
    episodesPruned: number;
    patternsDetected: number;
  }> {
    let preferencesRemoved = 0;
    let episodesPruned = 0;

    // Merge duplicate/similar preferences
    const seen = new Map<string, Preference>();
    const merged: Preference[] = [];

    for (const pref of this.memory.preferences) {
      const key = pref.text.toLowerCase().trim();
      const existing = seen.get(key);
      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + pref.confidence * 0.5);
        existing.lastReinforced = pref.lastReinforced > existing.lastReinforced
          ? pref.lastReinforced
          : existing.lastReinforced;
        preferencesRemoved++;
      } else {
        seen.set(key, pref);
        merged.push(pref);
      }
    }
    this.memory.preferences = merged;

    // Prune low-confidence preferences
    const minConfidence = 0.2;
    const before = this.memory.preferences.length;
    this.memory.preferences = this.memory.preferences.filter(
      (p) => p.confidence >= minConfidence
    );
    preferencesRemoved += before - this.memory.preferences.length;

    // Prune old episodes (keep last 90 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString();
    const epBefore = this.memory.episodes.length;
    this.memory.episodes = this.memory.episodes.filter(
      (e) => e.timestamp > cutoffStr
    );
    episodesPruned = epBefore - this.memory.episodes.length;

    // Detect patterns from episodes
    const patterns = this.detectPatterns();
    const patternsDetected = patterns.length - this.memory.patterns.length;
    this.memory.patterns = patterns;

    await this.save();

    return {
      preferencesRemoved,
      episodesPruned,
      patternsDetected: Math.max(0, patternsDetected),
    };
  }

  private detectPatterns(): MemoryPattern[] {
    // Simple pattern detection: count outcome frequencies
    const patterns: MemoryPattern[] = [];

    // Count outcomes
    const outcomes = { success: 0, partial: 0, abandoned: 0 };
    for (const ep of this.memory.episodes) {
      outcomes[ep.outcome]++;
    }

    if (outcomes.abandoned > 3) {
      patterns.push({
        description: `${outcomes.abandoned} sessions ended without clear outcome`,
        occurrences: outcomes.abandoned,
        lastSeen: new Date().toISOString(),
      });
    }

    if (outcomes.success > 5 && outcomes.success > outcomes.partial * 2) {
      patterns.push({
        description: 'Most sessions end successfully',
        occurrences: outcomes.success,
        lastSeen: new Date().toISOString(),
      });
    }

    return patterns;
  }
}
