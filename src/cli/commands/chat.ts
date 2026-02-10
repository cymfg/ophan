import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
  loadConfig,
  loadState,
} from '../utils/config.js';
import { OrchestratorAgent } from '../../core/agents/orchestrator-agent.js';
import { CLIAdapter } from '../../core/orchestrator/adapters/cli-adapter.js';

interface ChatOptions {
  resume?: boolean;
  proactive?: boolean;
  proactiveInterval?: number;
  project?: string;
}

export const chatCommand = new Command('chat')
  .description('Start an interactive conversation with the Orchestrator')
  .option('--resume', 'Resume the most recent session')
  .option('--proactive', 'Enable proactive monitoring during session')
  .option(
    '--proactive-interval <minutes>',
    'Proactive check interval in minutes (default: 30)',
    parseInt
  )
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (options: ChatOptions) => {
    try {
      await runChat(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runChat(options: ChatOptions): Promise<void> {
  let projectRoot: string | null;

  if (options.project) {
    projectRoot = path.resolve(options.project);
    try {
      await fs.access(projectRoot);
    } catch {
      logger.error(`Project path does not exist: ${projectRoot}`);
      return;
    }
  } else {
    projectRoot = findProjectRoot();
  }

  if (!projectRoot) {
    logger.error('Not in an Ophan project. Run `ophan init` first.');
    return;
  }

  if (!isOphanInitialized(projectRoot)) {
    logger.error('Ophan not initialized. Run `ophan init` first.');
    return;
  }

  const config = loadConfig(projectRoot);
  const state = loadState(projectRoot);
  const ophanDir = path.join(projectRoot, '.ophan');

  // Initialize the Orchestrator Agent
  const agent = new OrchestratorAgent();
  await agent.initialize({
    projectRoot,
    ophanDir,
    config,
    onProgress: (msg) => logger.debug(msg),
  });
  agent.setState(state);

  // Create the CLI adapter
  const adapter = new CLIAdapter();

  // Determine proactive interval
  let proactiveInterval: number | undefined;
  if (options.proactive || options.proactiveInterval) {
    const minutes = options.proactiveInterval
      ?? config.orchestrator?.proactive?.intervalMinutes
      ?? 30;
    proactiveInterval = minutes * 60 * 1000;
  }

  // Start the conversation (blocks until /quit)
  await agent.startConversation({
    adapter,
    proactiveInterval,
    resume: options.resume,
  });
}
