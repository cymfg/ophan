import { describe, it, expect, beforeEach } from 'vitest';
import { LearningManager } from '../../src/core/learning-manager.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';
import type { Learning } from '../../src/types/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('LearningManager', () => {
  let learningManager: LearningManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ophan-learning-test-${Date.now()}`);
    await fs.mkdir(path.join(testDir, 'guidelines'), { recursive: true });

    learningManager = new LearningManager({
      ophanDir: testDir,
      config: DEFAULT_CONFIG,
    });
  });

  function createLearning(
    id: string,
    content: string,
    references: number = 1,
    daysOld: number = 0
  ): Learning {
    const timestamp = new Date();
    timestamp.setDate(timestamp.getDate() - daysOld);

    return {
      id,
      content,
      context: 'Test context',
      issue: 'Test issue',
      resolution: 'Test resolution',
      guidelineImpact: 'Test impact',
      timestamp: timestamp.toISOString(),
      references,
      promoted: false,
    };
  }

  describe('addLearning', () => {
    it('should add a new learning', async () => {
      const learning = createLearning('learn-1', 'Always run tests first');
      const result = await learningManager.addLearning(learning, []);

      expect(result.added).toBe(true);
    });

    it('should reject duplicate learnings', async () => {
      const learning1 = createLearning('learn-1', 'Always run tests first');
      // Use exact same content for true duplicate
      const learning2 = createLearning('learn-2', 'Always run tests first');

      const result = await learningManager.addLearning(learning2, [learning1]);

      expect(result.added).toBe(false);
      expect(result.reason).toContain('Duplicate');
    });

    it('should allow sufficiently different learnings', async () => {
      const learning1 = createLearning('learn-1', 'Always run tests first');
      const learning2 = createLearning(
        'learn-2',
        'Use TypeScript strict mode for better type safety'
      );

      const result = await learningManager.addLearning(learning2, [learning1]);

      expect(result.added).toBe(true);
    });
  });

  describe('consolidate', () => {
    it('should keep unique learnings', async () => {
      const learnings = [
        createLearning('learn-1', 'First learning'),
        createLearning('learn-2', 'Second completely different learning'),
      ];

      const result = await learningManager.consolidate(learnings);

      expect(result.kept.length).toBe(2);
      expect(result.removed.length).toBe(0);
      expect(result.promoted.length).toBe(0);
    });

    it('should remove duplicate learnings', async () => {
      const learnings = [
        createLearning('learn-1', 'Always run tests first', 2),
        // Use exact same text for true duplicate
        createLearning('learn-2', 'Always run tests first', 1),
      ];

      const result = await learningManager.consolidate(learnings);

      expect(result.kept.length).toBe(1);
      expect(result.removed.length).toBe(1);
      // Should keep the one with more references
      expect(result.kept[0].id).toBe('learn-1');
    });

    it('should promote highly referenced learnings', async () => {
      const learnings = [
        createLearning('learn-1', 'Very important learning', 5), // Above promotion threshold
      ];

      const result = await learningManager.consolidate(learnings);

      expect(result.promoted.length).toBe(1);
      expect(result.promoted[0].promoted).toBe(true);
    });

    it('should remove old unreferenced learnings', async () => {
      const learnings = [
        createLearning('learn-1', 'Old learning', 1, 100), // 100 days old
        createLearning('learn-2', 'Recent learning', 1, 1), // 1 day old
      ];

      const result = await learningManager.consolidate(learnings);

      expect(result.kept.length).toBe(1);
      expect(result.removed.length).toBe(1);
      expect(result.kept[0].id).toBe('learn-2');
    });
  });

  describe('generateGuidelineProposals', () => {
    it('should generate proposals for promoted learnings', () => {
      const promotedLearnings = [
        {
          ...createLearning('learn-1', 'Testing is important', 5),
          promoted: true,
        },
      ];

      const proposals =
        learningManager.generateGuidelineProposals(promotedLearnings);

      expect(proposals.length).toBe(1);
      expect(proposals[0].file).toBe('testing.md');
      expect(proposals[0].content).toContain('Testing is important');
    });

    it('should target coding.md for non-test learnings', () => {
      const promotedLearnings = [
        {
          id: 'learn-1',
          content: 'Use proper error handling',
          context: 'Code context',
          issue: 'Code issue',
          resolution: 'Code resolution',
          guidelineImpact: 'Code quality impact',  // No "test" keyword
          timestamp: new Date().toISOString(),
          references: 5,
          promoted: true,
        },
      ];

      const proposals =
        learningManager.generateGuidelineProposals(promotedLearnings);

      expect(proposals[0].file).toBe('coding.md');
    });
  });

  describe('incrementReference', () => {
    it('should increment reference count for a learning', () => {
      const learnings = [
        createLearning('learn-1', 'First learning', 1),
        createLearning('learn-2', 'Second learning', 2),
      ];

      const updated = learningManager.incrementReference(learnings, 'learn-1');

      expect(updated[0].references).toBe(2);
      expect(updated[1].references).toBe(2);
    });

    it('should not change other learnings', () => {
      const learnings = [
        createLearning('learn-1', 'First learning', 1),
        createLearning('learn-2', 'Second learning', 2),
      ];

      const updated = learningManager.incrementReference(learnings, 'learn-1');

      expect(updated[1].references).toBe(2);
    });
  });
});
