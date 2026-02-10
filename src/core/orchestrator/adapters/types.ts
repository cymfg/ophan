/**
 * Messaging Adapter Types
 *
 * Abstract interface for messaging backends.
 * Phase 1: CLI adapter. Future: Slack, Telegram.
 */

/**
 * Handler for incoming user messages
 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>;

/**
 * A message received from the user
 */
export interface IncomingMessage {
  content: string;
  /** Adapter-specific sender info */
  sender?: { id: string; name: string };
  /** For threaded adapters like Slack */
  threadId?: string;
  timestamp: string;
}

/**
 * Options for sending messages
 */
export interface SendOptions {
  format?: 'plain' | 'markdown' | 'rich';
  threadId?: string;
}

/**
 * A structured prompt requiring user input
 */
export interface UserPrompt {
  message: string;
  /** Suggested options (rendered as buttons in Slack, numbered list in CLI) */
  options?: string[];
  /** Whether free-text input is allowed alongside options */
  allowFreeText?: boolean;
}

/**
 * A proactive notification sent to the user
 */
export interface OrchestratorNotification {
  title: string;
  body: string;
  priority: 'low' | 'medium' | 'high';
  /** Actions the user can take directly from the notification */
  actions?: Array<{ label: string; value: string }>;
}

/**
 * Abstract interface for messaging backends.
 * Implementations: CLIAdapter (Phase 1), SlackAdapter, TelegramAdapter (future).
 */
export interface MessagingAdapter {
  /** Unique adapter identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;

  /** Start the adapter (begin listening for messages) */
  start(): Promise<void>;

  /** Stop the adapter */
  stop(): Promise<void>;

  /** Register a handler for incoming user messages */
  onMessage(handler: MessageHandler): void;

  /** Send a message to the user */
  sendMessage(content: string, options?: SendOptions): Promise<void>;

  /** Send a structured prompt requiring user input */
  promptUser(prompt: UserPrompt): Promise<string>;

  /** Send a proactive notification */
  sendNotification(notification: OrchestratorNotification): Promise<void>;
}
