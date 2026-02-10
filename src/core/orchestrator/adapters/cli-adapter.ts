/**
 * CLI Adapter
 *
 * Readline-based messaging adapter for terminal conversations.
 * Phase 1 implementation of the MessagingAdapter interface.
 */

import readline from 'readline';
import chalk from 'chalk';
import type {
  MessagingAdapter,
  MessageHandler,
  SendOptions,
  UserPrompt,
  OrchestratorNotification,
} from './types.js';

const gold = chalk.hex('#B9A46D');

export class CLIAdapter implements MessagingAdapter {
  readonly id = 'cli';
  readonly name = 'CLI Chat';

  private handler: MessageHandler | null = null;
  private rl: readline.Interface | null = null;
  private running = false;
  private resolveStop: (() => void) | null = null;

  async start(): Promise<void> {
    this.running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: gold('you > '),
    });

    console.log();
    console.log(gold.bold('Ophan Orchestrator'));
    console.log(gold('═'.repeat(40)));
    console.log(
      chalk.dim('Type a message to chat. Commands: /status, /goals, /help, /quit')
    );
    console.log();

    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }

      if (trimmed === '/quit' || trimmed === '/exit') {
        await this.stop();
        return;
      }

      if (this.handler) {
        try {
          await this.handler({
            content: trimmed,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.log(
            chalk.red(`Error: ${(error as Error).message}`)
          );
        }
      }

      if (this.running) {
        this.rl?.prompt();
      }
    });

    this.rl.on('close', () => {
      this.running = false;
      this.resolveStop?.();
    });

    // Wait until the adapter is stopped
    return new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.rl?.close();
    console.log();
    console.log(gold('Session ended.'));
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(content: string, _options?: SendOptions): Promise<void> {
    console.log();
    console.log(gold('ophan > ') + content);
    console.log();
  }

  async promptUser(prompt: UserPrompt): Promise<string> {
    return new Promise<string>((resolve) => {
      let promptText = prompt.message;

      if (prompt.options && prompt.options.length > 0) {
        promptText += '\n';
        for (let i = 0; i < prompt.options.length; i++) {
          promptText += `  ${chalk.cyan(`${i + 1}.`)} ${prompt.options[i]}\n`;
        }
        if (prompt.allowFreeText) {
          promptText += chalk.dim('  (or type a custom response)\n');
        }
      }

      console.log();
      console.log(gold('ophan > ') + promptText);

      this.rl?.question(gold('you > '), (answer) => {
        const trimmed = answer.trim();

        // Check if it's a number selection
        if (prompt.options) {
          const num = parseInt(trimmed, 10);
          if (num >= 1 && num <= prompt.options.length) {
            resolve(prompt.options[num - 1]);
            return;
          }
        }

        resolve(trimmed);
      });
    });
  }

  async sendNotification(notification: OrchestratorNotification): Promise<void> {
    const priorityIcon =
      notification.priority === 'high'
        ? chalk.red('!!')
        : notification.priority === 'medium'
          ? chalk.yellow('!')
          : chalk.dim('i');

    console.log();
    console.log(`${priorityIcon} ${gold.bold(notification.title)}`);
    console.log(`  ${notification.body}`);

    if (notification.actions && notification.actions.length > 0) {
      for (const action of notification.actions) {
        console.log(`  ${chalk.cyan(`[${action.label}]`)}`);
      }
    }

    console.log();
  }
}
