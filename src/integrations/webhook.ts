import type {
  WebhookConfig,
  EscalationPayload,
  Task,
  OphanConfig,
} from '../types/index.js';

export type WebhookEventType = 'escalation' | 'task_complete' | 'digest';

export interface TaskCompletePayload {
  type: 'task_complete';
  timestamp: string;
  task: {
    id: string;
    description: string;
    status: Task['status'];
    iterations: number;
    cost: number;
    duration: number;
  };
  project: {
    name: string;
    path: string;
  };
}

export interface DigestPayload {
  type: 'digest';
  timestamp: string;
  summary: {
    totalTasks: number;
    successfulTasks: number;
    failedTasks: number;
    escalatedTasks: number;
    patternsDetected: number;
    learningsPromoted: number;
  };
  digestPath: string;
  project: {
    name: string;
    path: string;
  };
}

export type WebhookPayload =
  | EscalationPayload
  | TaskCompletePayload
  | DigestPayload;

export interface WebhookResult {
  webhook: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Webhook client for sending escalation and event notifications
 */
export class WebhookClient {
  private webhooks: WebhookConfig[];
  private projectName: string;
  private projectPath: string;

  constructor(
    config: OphanConfig,
    projectName: string,
    projectPath: string
  ) {
    this.webhooks = config.escalations?.webhooks ?? [];
    this.projectName = projectName;
    this.projectPath = projectPath;
  }

  /**
   * Send an escalation notification to all configured webhooks
   */
  async sendEscalation(
    task: Task,
    reason: EscalationPayload['reason'],
    context: EscalationPayload['context']
  ): Promise<WebhookResult[]> {
    const payload: EscalationPayload = {
      type: 'escalation',
      timestamp: new Date().toISOString(),
      task: {
        id: task.id,
        description: task.description,
        iterations: task.iterations,
        maxIterations: task.maxIterations,
      },
      reason,
      context,
      project: {
        name: this.projectName,
        path: this.projectPath,
      },
    };

    return this.sendToWebhooks('escalation', payload);
  }

  /**
   * Send a task completion notification
   */
  async sendTaskComplete(
    task: Task,
    duration: number
  ): Promise<WebhookResult[]> {
    const payload: TaskCompletePayload = {
      type: 'task_complete',
      timestamp: new Date().toISOString(),
      task: {
        id: task.id,
        description: task.description,
        status: task.status,
        iterations: task.iterations,
        cost: task.cost,
        duration,
      },
      project: {
        name: this.projectName,
        path: this.projectPath,
      },
    };

    return this.sendToWebhooks('task_complete', payload);
  }

  /**
   * Send a digest notification
   */
  async sendDigest(
    summary: DigestPayload['summary'],
    digestPath: string
  ): Promise<WebhookResult[]> {
    const payload: DigestPayload = {
      type: 'digest',
      timestamp: new Date().toISOString(),
      summary,
      digestPath,
      project: {
        name: this.projectName,
        path: this.projectPath,
      },
    };

    return this.sendToWebhooks('digest', payload);
  }

  /**
   * Send payload to all webhooks configured for the event type
   */
  private async sendToWebhooks(
    eventType: WebhookEventType,
    payload: WebhookPayload
  ): Promise<WebhookResult[]> {
    const relevantWebhooks = this.webhooks.filter((w) =>
      w.events.includes(eventType)
    );

    if (relevantWebhooks.length === 0) {
      return [];
    }

    const results = await Promise.all(
      relevantWebhooks.map((webhook) => this.sendToWebhook(webhook, payload))
    );

    return results;
  }

  /**
   * Send payload to a single webhook
   */
  private async sendToWebhook(
    webhook: WebhookConfig,
    payload: WebhookPayload
  ): Promise<WebhookResult> {
    try {
      // Interpolate environment variables in URL and headers
      const url = this.interpolateEnvVars(webhook.url);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Ophan/0.1.0',
      };

      if (webhook.headers) {
        for (const [key, value] of Object.entries(webhook.headers)) {
          headers[key] = this.interpolateEnvVars(value);
        }
      }

      const response = await fetch(url, {
        method: webhook.method ?? 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return {
          webhook: webhook.name,
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return {
        webhook: webhook.name,
        success: true,
        statusCode: response.status,
      };
    } catch (error) {
      return {
        webhook: webhook.name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Interpolate environment variables in strings
   * Supports ${VAR_NAME} syntax
   */
  private interpolateEnvVars(str: string): string {
    return str.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(
          `Environment variable ${varName} is not set (required for webhook configuration)`
        );
      }
      return value;
    });
  }

  /**
   * Check if any webhooks are configured for escalations
   */
  hasEscalationWebhooks(): boolean {
    return this.webhooks.some((w) => w.events.includes('escalation'));
  }

  /**
   * Check if any webhooks are configured
   */
  hasWebhooks(): boolean {
    return this.webhooks.length > 0;
  }
}
