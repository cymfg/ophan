/**
 * UI Command
 *
 * Starts the Ophan web UI for viewing status and editing configuration.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import {
  findProjectRoot,
  isOphanInitialized,
} from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { createUIServer } from '../../ui/server.js';

const DEFAULT_PORT = 4040;

export function createUICommand(): Command {
  const command = new Command('ui')
    .description('Start the Ophan web UI')
    .option('-p, --port <number>', 'Port to run the server on', String(DEFAULT_PORT))
    .option('--no-open', 'Do not open browser automatically')
    .option('--project <path>', 'Path to the project directory')
    .action(async (options) => {
      await runUI(options);
    });

  return command;
}

interface UIOptions {
  port: string;
  open: boolean;
  project?: string;
}

async function runUI(options: UIOptions): Promise<void> {
  const port = parseInt(options.port) || DEFAULT_PORT;

  // Find project root
  const projectRoot = options.project ?? findProjectRoot();

  if (!projectRoot) {
    logger.error('Not in an Ophan project. Run `ophan init` first.');
    process.exit(1);
  }

  if (!isOphanInitialized(projectRoot)) {
    logger.error('Ophan is not initialized in this project. Run `ophan init` first.');
    process.exit(1);
  }

  logger.blank();
  logger.info(chalk.bold('Starting Ophan UI...'));
  logger.keyValue('Project', projectRoot);
  logger.keyValue('Port', String(port));
  logger.blank();

  try {
    const server = createUIServer({
      projectRoot,
      port,
      open: options.open,
    });

    await server.start();

    const url = `http://localhost:${port}`;
    logger.success(`Ophan UI running at ${chalk.cyan(url)}`);
    logger.blank();
    logger.info('Press Ctrl+C to stop');

    // Open browser
    if (options.open !== false) {
      await open(url);
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.blank();
      logger.info('Shutting down...');
      await server.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    if (error instanceof Error && error.message.includes('EADDRINUSE')) {
      logger.error(`Port ${port} is already in use. Try a different port with --port`);
    } else {
      logger.error(`Failed to start UI server: ${error}`);
    }
    process.exit(1);
  }
}

export default createUICommand;
