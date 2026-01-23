import { promises as fs } from 'fs';
import path from 'path';
import type { Learning, OphanConfig } from '../types/index.js';

export interface LearningManagerOptions {
  ophanDir: string;
  config: OphanConfig;
}

/**
 * Manages learnings - deduplication, consolidation, promotion, and pruning
 */
export class LearningManager {
  private ophanDir: string;
  private config: OphanConfig;

  constructor(options: LearningManagerOptions) {
    this.ophanDir = options.ophanDir;
    this.config = options.config;
  }

  /**
   * Add a new learning, checking for duplicates
   */
  async addLearning(
    learning: Learning,
    existingLearnings: Learning[]
  ): Promise<{ added: boolean; reason?: string }> {
    // Check for duplicates using simple text similarity
    const isDuplicate = existingLearnings.some(
      (existing) =>
        this.calculateSimilarity(learning.content, existing.content) >=
        this.config.outerLoop.learnings.similarityThreshold
    );

    if (isDuplicate) {
      return { added: false, reason: 'Duplicate learning detected' };
    }

    // Add to learnings file
    await this.appendToLearningsFile(learning);

    return { added: true };
  }

  /**
   * Consolidate learnings - dedupe, promote, and prune
   */
  async consolidate(learnings: Learning[]): Promise<{
    kept: Learning[];
    promoted: Learning[];
    removed: Learning[];
  }> {
    const kept: Learning[] = [];
    const promoted: Learning[] = [];
    const removed: Learning[] = [];

    const now = new Date();
    const retentionCutoff = new Date(
      now.getTime() -
        this.config.outerLoop.learnings.retentionDays * 24 * 60 * 60 * 1000
    );

    // Group similar learnings
    const groups = this.groupSimilarLearnings(learnings);

    for (const group of groups) {
      if (group.length === 1) {
        const learning = group[0];

        // Check if old and not referenced recently
        const learningDate = new Date(learning.timestamp);
        if (learningDate < retentionCutoff && learning.references < 2) {
          removed.push(learning);
        } else if (
          learning.references >= this.config.outerLoop.learnings.promotionThreshold
        ) {
          // Single learning with enough references - promote it
          learning.promoted = true;
          promoted.push(learning);
        } else {
          kept.push(learning);
        }
      } else {
        // Multiple similar learnings - keep the most referenced one
        const sorted = [...group].sort(
          (a, b) => b.references - a.references
        );
        const best = sorted[0];

        // Check if should be promoted to guideline
        if (
          best.references >= this.config.outerLoop.learnings.promotionThreshold
        ) {
          best.promoted = true;
          promoted.push(best);
        } else {
          kept.push(best);
        }

        // Remove duplicates
        for (let i = 1; i < sorted.length; i++) {
          removed.push(sorted[i]);
        }
      }
    }

    // Enforce max count
    if (kept.length > this.config.outerLoop.learnings.maxCount) {
      // Remove oldest, least referenced
      const toRemove = kept
        .sort((a, b) => {
          // Sort by references (ascending), then by date (oldest first)
          if (a.references !== b.references) {
            return a.references - b.references;
          }
          return (
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        })
        .slice(0, kept.length - this.config.outerLoop.learnings.maxCount);

      for (const learning of toRemove) {
        const idx = kept.indexOf(learning);
        if (idx !== -1) {
          kept.splice(idx, 1);
          removed.push(learning);
        }
      }
    }

    return { kept, promoted, removed };
  }

  /**
   * Generate guideline update proposals from promoted learnings
   */
  generateGuidelineProposals(
    promotedLearnings: Learning[]
  ): Array<{
    file: string;
    content: string;
    reason: string;
    learningContent?: string;
  }> {
    const proposals: Array<{
      file: string;
      content: string;
      reason: string;
      learningContent?: string;
    }> = [];

    for (const learning of promotedLearnings) {
      const targetFile = this.determineTargetFile(learning);

      proposals.push({
        file: targetFile,
        content: this.formatLearningForGuideline(learning),
        reason: `Learning promoted after ${learning.references} references: ${learning.content.slice(0, 100)}`,
        learningContent: learning.content,
      });
    }

    return proposals;
  }

  /**
   * Apply guideline updates
   */
  async applyGuidelineUpdate(
    file: string,
    content: string
  ): Promise<void> {
    const filePath = path.join(this.ophanDir, 'guidelines', file);

    try {
      let existingContent = '';
      try {
        existingContent = await fs.readFile(filePath, 'utf-8');
      } catch {
        // File doesn't exist, will create it
      }

      // Append the new content
      const newContent = existingContent + '\n\n' + content;
      await fs.writeFile(filePath, newContent, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to update guideline ${file}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Rewrite learnings file with consolidated learnings
   */
  async rewriteLearningsFile(learnings: Learning[]): Promise<void> {
    const filePath = path.join(this.ophanDir, 'guidelines', 'learnings.md');

    let content = `# Learnings

Automatically extracted learnings from task execution.
Last consolidated: ${new Date().toISOString()}

---

`;

    for (const learning of learnings) {
      content += this.formatLearningEntry(learning);
    }

    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Calculate text similarity (simple word overlap)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Group learnings by similarity
   */
  private groupSimilarLearnings(learnings: Learning[]): Learning[][] {
    const groups: Learning[][] = [];
    const assigned = new Set<string>();

    for (const learning of learnings) {
      if (assigned.has(learning.id)) continue;

      const group: Learning[] = [learning];
      assigned.add(learning.id);

      // Find similar learnings
      for (const other of learnings) {
        if (assigned.has(other.id)) continue;

        if (
          this.calculateSimilarity(learning.content, other.content) >=
          this.config.outerLoop.learnings.similarityThreshold
        ) {
          group.push(other);
          assigned.add(other.id);
        }
      }

      groups.push(group);
    }

    return groups;
  }

  /**
   * Determine which guideline file a learning should go into
   */
  private determineTargetFile(learning: Learning): string {
    const content = learning.content.toLowerCase();
    const impact = learning.guidelineImpact.toLowerCase();

    if (
      content.includes('test') ||
      impact.includes('test') ||
      content.includes('coverage')
    ) {
      return 'testing.md';
    }

    return 'coding.md';
  }

  /**
   * Format a learning for inclusion in a guideline
   */
  private formatLearningForGuideline(learning: Learning): string {
    return `## Promoted Learning

**Added:** ${new Date().toISOString()}
**References:** ${learning.references}

${learning.content}

**Context:** ${learning.context}

---
`;
  }

  /**
   * Format a learning entry for the learnings file
   */
  private formatLearningEntry(learning: Learning): string {
    return `## Learning: ${learning.id}

**Context:** ${learning.context}
**Issue:** ${learning.issue}
**Resolution:** ${learning.resolution}
**Guideline Impact:** ${learning.guidelineImpact}
**References:** ${learning.references}
**Promoted:** ${learning.promoted ? 'Yes' : 'No'}

---

`;
  }

  /**
   * Append a learning to the learnings file
   */
  private async appendToLearningsFile(learning: Learning): Promise<void> {
    const filePath = path.join(this.ophanDir, 'guidelines', 'learnings.md');

    try {
      let content = '';
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        content =
          '# Learnings\n\nAutomatically extracted learnings from task execution.\n\n---\n\n';
      }

      content += this.formatLearningEntry(learning);
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to append learning: ${(error as Error).message}`
      );
    }
  }

  /**
   * Increment reference count for a learning
   */
  incrementReference(learnings: Learning[], learningId: string): Learning[] {
    return learnings.map((l) =>
      l.id === learningId ? { ...l, references: l.references + 1 } : l
    );
  }
}
