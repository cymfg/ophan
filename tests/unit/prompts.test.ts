import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildTaskMessage,
  buildRegenerationMessage,
  buildLearningExtractionPrompt,
  buildEvaluationPrompt,
} from '../../src/llm/prompts.js';

describe('Prompt Templates', () => {
  describe('buildSystemPrompt', () => {
    const baseContext = {
      taskDescription: 'Fix the login bug',
      projectRoot: '/project',
      guidelines: '# Guidelines\nFollow best practices',
      criteria: '# Criteria\nAll tests must pass',
      learnings: '',
      iteration: 1,
      maxIterations: 5,
      regenerationStrategy: 'informed' as const,
    };

    it('should include guidelines and criteria', () => {
      const prompt = buildSystemPrompt(baseContext);

      expect(prompt).toContain('Guidelines');
      expect(prompt).toContain('Follow best practices');
      expect(prompt).toContain('Criteria');
      expect(prompt).toContain('All tests must pass');
    });

    it('should include project root', () => {
      const prompt = buildSystemPrompt(baseContext);

      expect(prompt).toContain('/project');
    });

    it('should include iteration info for later iterations', () => {
      const context = {
        ...baseContext,
        iteration: 2,
        previousEvaluation: 'Tests failed: 2 errors',
      };

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain('Current Iteration: 2/5');
      expect(prompt).toContain('Tests failed');
    });

    it('should include regeneration strategy guidance', () => {
      const contexts = [
        { ...baseContext, iteration: 2, regenerationStrategy: 'full' as const },
        {
          ...baseContext,
          iteration: 2,
          regenerationStrategy: 'informed' as const,
        },
        {
          ...baseContext,
          iteration: 2,
          regenerationStrategy: 'incremental' as const,
        },
      ];

      for (const context of contexts) {
        const prompt = buildSystemPrompt(context);
        expect(prompt).toContain(context.regenerationStrategy);
      }
    });

    it('should include learnings if provided', () => {
      const context = {
        ...baseContext,
        learnings: 'Always run type check first',
      };

      const prompt = buildSystemPrompt(context);

      expect(prompt).toContain('Learnings');
      expect(prompt).toContain('Always run type check first');
    });
  });

  describe('buildTaskMessage', () => {
    it('should include task description', () => {
      const message = buildTaskMessage('Add user authentication');

      expect(message).toContain('Add user authentication');
      expect(message).toContain('task_complete');
    });
  });

  describe('buildRegenerationMessage', () => {
    it('should include iteration number', () => {
      const message = buildRegenerationMessage(
        'Fix the bug',
        'Tests are failing',
        3
      );

      expect(message).toContain('Iteration 3');
    });

    it('should include evaluation feedback', () => {
      const message = buildRegenerationMessage(
        'Fix the bug',
        'TypeScript errors found',
        2
      );

      expect(message).toContain('TypeScript errors found');
    });

    it('should include original task', () => {
      const message = buildRegenerationMessage(
        'Fix the login bug',
        'Tests failing',
        2
      );

      expect(message).toContain('Fix the login bug');
    });
  });

  describe('buildLearningExtractionPrompt', () => {
    it('should include task description', () => {
      const prompt = buildLearningExtractionPrompt(
        'Fix authentication',
        3,
        ['Iter 1: failed', 'Iter 2: failed', 'Iter 3: passed'],
        'success'
      );

      expect(prompt).toContain('Fix authentication');
    });

    it('should include outcome', () => {
      const prompt = buildLearningExtractionPrompt(
        'Task',
        1,
        ['passed'],
        'failure'
      );

      expect(prompt).toContain('failure');
    });

    it('should include iteration count', () => {
      const prompt = buildLearningExtractionPrompt(
        'Task',
        5,
        ['1', '2', '3', '4', '5'],
        'escalated'
      );

      expect(prompt).toContain('5 iteration');
    });

    it('should include evaluation history', () => {
      const prompt = buildLearningExtractionPrompt(
        'Task',
        2,
        ['First evaluation', 'Second evaluation'],
        'success'
      );

      expect(prompt).toContain('First evaluation');
      expect(prompt).toContain('Second evaluation');
    });

    it('should request JSON format', () => {
      const prompt = buildLearningExtractionPrompt('Task', 1, ['eval'], 'success');

      expect(prompt).toContain('JSON');
      expect(prompt).toContain('learnings');
    });
  });

  describe('buildEvaluationPrompt', () => {
    it('should include task description', () => {
      const prompt = buildEvaluationPrompt(
        'Add feature X',
        'All tests pass',
        'Test output here'
      );

      expect(prompt).toContain('Add feature X');
    });

    it('should include criteria', () => {
      const prompt = buildEvaluationPrompt(
        'Task',
        'No TypeScript errors\nNo ESLint warnings',
        'output'
      );

      expect(prompt).toContain('No TypeScript errors');
      expect(prompt).toContain('No ESLint warnings');
    });

    it('should include tool outputs', () => {
      const prompt = buildEvaluationPrompt(
        'Task',
        'Criteria',
        'npm test\nAll 10 tests passed'
      );

      expect(prompt).toContain('npm test');
      expect(prompt).toContain('All 10 tests passed');
    });

    it('should request JSON format', () => {
      const prompt = buildEvaluationPrompt('Task', 'Criteria', 'Output');

      expect(prompt).toContain('JSON');
      expect(prompt).toContain('passed');
      expect(prompt).toContain('score');
    });
  });
});
