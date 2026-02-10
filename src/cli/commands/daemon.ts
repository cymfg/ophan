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

interface DaemonOptions {
  interval?: number;
  project?: string;
}

export const daemonCommand = new Command('daemon')
  .description(
    'Run the Orchestrator as a background daemon (wake-check-act cycle)'
  )
  .option(
    '--interval <minutes>',
    'Check interval in minutes (default: from config or 30)',
    parseInt
  )
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (options: DaemonOptions) => {
    try {
      await runDaemon(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runDaemon(options: DaemonOptions): Promise<void> {
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
  const ophanDir = path.join(projectRoot, '.ophan');

  // Determine interval
  const intervalMinutes =
    options.interval ??
    config.orchestrator?.daemon?.intervalMinutes ??
    config.orchestrator?.proactive?.intervalMinutes ??
    30;
  const intervalMs = intervalMinutes * 60 * 1000;

  // Initialize the Orchestrator Agent
  const agent = new OrchestratorAgent();
  await agent.initialize({
    projectRoot,
    ophanDir,
    config,
    onProgress: (msg) => logger.debug(msg),
  });

  // Create adapter for notifications only (no interactive chat)
  const adapter = new CLIAdapter();

  logger.info(
    `Orchestrator daemon started (checking every ${intervalMinutes} min)`
  );
  logger.info('Press Ctrl+C to stop.\n');

  // Run first cycle immediately
  await runCycle(agent, projectRoot, adapter);

  // Set up interval
  const timer = setInterval(async () => {
    await runCycle(agent, projectRoot!, adapter);
  }, intervalMs);

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info('\nDaemon shutting down...');
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process alive
  await new Promise(() => {
    // Never resolves — daemon runs until killed
  });
}

async function runCycle(
  agent: OrchestratorAgent,
  projectRoot: string,
  adapter: CLIAdapter
): Promise<void> {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  logger.debug(`[${now}] Running daemon cycle...`);

  try {
    // Reload state from disk (may have changed since last cycle)
    const state = loadState(projectRoot);
    agent.setState(state);

    // Run the daemon cycle
    const result = await agent.runDaemonCycle(adapter);

    if (result.acted) {
      logger.info(`[${now}] ${result.summary}`);
    } else {
      logger.debug(`[${now}] ${result.summary}`);
    }
  } catch (error) {
    logger.error(
      `[${now}] Daemon cycle failed: ${(error as Error).message}`
    );
  }
}
