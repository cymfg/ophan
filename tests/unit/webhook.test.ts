import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookClient } from '../../src/integrations/webhook.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';
import type { OphanConfig, Task } from '../../src/types/index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('WebhookClient', () => {
  let webhookClient: WebhookClient;
  let configWithWebhooks: OphanConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    configWithWebhooks = {
      ...DEFAULT_CONFIG,
      escalations: {
        webhooks: [
          {
            name: 'slack-alerts',
            url: 'https://hooks.slack.com/test',
            events: ['escalation', 'digest'],
          },
          {
            name: 'custom-endpoint',
            url: 'https://api.example.com/webhook',
            method: 'POST',
            headers: {
              'X-Custom-Header': 'test-value',
            },
            events: ['escalation', 'task_complete'],
          },
        ],
      },
    };

    webhookClient = new WebhookClient(
      configWithWebhooks,
      'test-project',
      '/path/to/project'
    );
  });

  describe('hasWebhooks', () => {
    it('should return true when webhooks are configured', () => {
      expect(webhookClient.hasWebhooks()).toBe(true);
    });

    it('should return false when no webhooks configured', () => {
      const emptyClient = new WebhookClient(
        DEFAULT_CONFIG,
        'test-project',
        '/path/to/project'
      );
      expect(emptyClient.hasWebhooks()).toBe(false);
    });
  });

  describe('hasEscalationWebhooks', () => {
    it('should return true when escalation webhooks are configured', () => {
      expect(webhookClient.hasEscalationWebhooks()).toBe(true);
    });

    it('should return false when no escalation webhooks', () => {
      const digestOnlyConfig: OphanConfig = {
        ...DEFAULT_CONFIG,
        escalations: {
          webhooks: [
            {
              name: 'digest-only',
              url: 'https://example.com/digest',
              events: ['digest'],
            },
          ],
        },
      };
      const client = new WebhookClient(
        digestOnlyConfig,
        'test-project',
        '/path/to/project'
      );
      expect(client.hasEscalationWebhooks()).toBe(false);
    });
  });

  describe('sendEscalation', () => {
    const mockTask: Task = {
      id: 'task-123',
      description: 'Test task',
      status: 'escalated',
      iterations: 5,
      maxIterations: 5,
      startedAt: '2024-01-01T00:00:00Z',
      cost: 0.5,
      tokensUsed: 10000,
    };

    it('should send escalation to configured webhooks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const results = await webhookClient.sendEscalation(
        mockTask,
        'max_iterations',
        { lastError: 'Test error' }
      );

      // Should send to both webhooks that have 'escalation' event
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Check first call (slack-alerts)
      const firstCall = mockFetch.mock.calls[0];
      expect(firstCall[0]).toBe('https://hooks.slack.com/test');
      expect(firstCall[1].method).toBe('POST');

      const payload = JSON.parse(firstCall[1].body);
      expect(payload.type).toBe('escalation');
      expect(payload.task.id).toBe('task-123');
      expect(payload.reason).toBe('max_iterations');
      expect(payload.project.name).toBe('test-project');
    });

    it('should include custom headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      await webhookClient.sendEscalation(mockTask, 'error', {});

      // Second call should have custom headers
      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[1].headers['X-Custom-Header']).toBe('test-value');
    });

    it('should handle webhook failures gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

      const results = await webhookClient.sendEscalation(
        mockTask,
        'blocked',
        {}
      );

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].statusCode).toBe(500);
      expect(results[1].error).toContain('500');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const results = await webhookClient.sendEscalation(
        mockTask,
        'error',
        {}
      );

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Network error');
    });

    it('should return empty array when no escalation webhooks', async () => {
      const noEscalationClient = new WebhookClient(
        DEFAULT_CONFIG,
        'test-project',
        '/path/to/project'
      );

      const results = await noEscalationClient.sendEscalation(
        mockTask,
        'max_iterations',
        {}
      );

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('sendTaskComplete', () => {
    const mockTask: Task = {
      id: 'task-456',
      description: 'Completed task',
      status: 'converged',
      iterations: 2,
      maxIterations: 5,
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T00:05:00Z',
      cost: 0.25,
      tokensUsed: 5000,
    };

    it('should send task complete to configured webhooks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const results = await webhookClient.sendTaskComplete(mockTask, 300);

      // Only custom-endpoint has task_complete event
      expect(results).toHaveLength(1);
      expect(results[0].webhook).toBe('custom-endpoint');
      expect(results[0].success).toBe(true);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.type).toBe('task_complete');
      expect(payload.task.status).toBe('converged');
      expect(payload.task.duration).toBe(300);
    });
  });

  describe('sendDigest', () => {
    it('should send digest to configured webhooks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const results = await webhookClient.sendDigest(
        {
          totalTasks: 10,
          successfulTasks: 8,
          failedTasks: 1,
          escalatedTasks: 1,
          patternsDetected: 3,
          learningsPromoted: 2,
        },
        '/path/to/.ophan/digests/2024-01-01.md'
      );

      // Only slack-alerts has digest event
      expect(results).toHaveLength(1);
      expect(results[0].webhook).toBe('slack-alerts');
      expect(results[0].success).toBe(true);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.type).toBe('digest');
      expect(payload.summary.totalTasks).toBe(10);
      expect(payload.summary.successfulTasks).toBe(8);
      expect(payload.digestPath).toContain('2024-01-01.md');
    });
  });

  describe('environment variable interpolation', () => {
    beforeEach(() => {
      process.env.TEST_WEBHOOK_URL = 'https://env-test.example.com';
      process.env.TEST_AUTH_TOKEN = 'secret-token';
    });

    afterEach(() => {
      delete process.env.TEST_WEBHOOK_URL;
      delete process.env.TEST_AUTH_TOKEN;
    });

    it('should interpolate environment variables in URL', async () => {
      const envConfig: OphanConfig = {
        ...DEFAULT_CONFIG,
        escalations: {
          webhooks: [
            {
              name: 'env-webhook',
              url: '${TEST_WEBHOOK_URL}/hook',
              events: ['escalation'],
            },
          ],
        },
      };

      const client = new WebhookClient(
        envConfig,
        'test-project',
        '/path/to/project'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const mockTask: Task = {
        id: 'task-789',
        description: 'Test',
        status: 'escalated',
        iterations: 5,
        maxIterations: 5,
        startedAt: '2024-01-01T00:00:00Z',
        cost: 0,
        tokensUsed: 0,
      };

      await client.sendEscalation(mockTask, 'max_iterations', {});

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://env-test.example.com/hook'
      );
    });

    it('should interpolate environment variables in headers', async () => {
      const envConfig: OphanConfig = {
        ...DEFAULT_CONFIG,
        escalations: {
          webhooks: [
            {
              name: 'env-webhook',
              url: 'https://example.com/hook',
              headers: {
                Authorization: 'Bearer ${TEST_AUTH_TOKEN}',
              },
              events: ['escalation'],
            },
          ],
        },
      };

      const client = new WebhookClient(
        envConfig,
        'test-project',
        '/path/to/project'
      );

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      });

      const mockTask: Task = {
        id: 'task-789',
        description: 'Test',
        status: 'escalated',
        iterations: 5,
        maxIterations: 5,
        startedAt: '2024-01-01T00:00:00Z',
        cost: 0,
        tokensUsed: 0,
      };

      await client.sendEscalation(mockTask, 'max_iterations', {});

      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(
        'Bearer secret-token'
      );
    });

    it('should throw error for missing environment variable', async () => {
      const envConfig: OphanConfig = {
        ...DEFAULT_CONFIG,
        escalations: {
          webhooks: [
            {
              name: 'missing-env',
              url: '${MISSING_VAR}/hook',
              events: ['escalation'],
            },
          ],
        },
      };

      const client = new WebhookClient(
        envConfig,
        'test-project',
        '/path/to/project'
      );

      const mockTask: Task = {
        id: 'task-789',
        description: 'Test',
        status: 'escalated',
        iterations: 5,
        maxIterations: 5,
        startedAt: '2024-01-01T00:00:00Z',
        cost: 0,
        tokensUsed: 0,
      };

      const results = await client.sendEscalation(mockTask, 'max_iterations', {});

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('MISSING_VAR');
    });
  });
});
