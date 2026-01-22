import { Command } from 'commander';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
} from '../utils/config.js';
import { TaskLogger } from '../../core/task-logger.js';

interface LogsOptions {
  limit?: number;
  project?: string;
  json?: boolean;
}

export const logsCommand = new Command('logs')
  .description('View recent task execution logs')
  .option('-l, --limit <number>', 'Number of logs to show', parseInt)
  .option('-p, --project <path>', 'Path to the project directory')
  .option('--json', 'Output in JSON format')
  .action(async (options: LogsOptions) => {
    try {
      await viewLogs(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function viewLogs(options: LogsOptions): Promise<void> {
  // Use --project path if provided, otherwise find project root
  const projectRoot = options.project
    ? path.resolve(options.project)
    : findProjectRoot();

  if (!projectRoot) {
    logger.error('Not in an Ophan project. Run `ophan init` first.');
    return;
  }

  if (!isOphanInitialized(projectRoot)) {
    logger.error('Ophan not initialized. Run `ophan init` first.');
    return;
  }

  const ophanDir = path.join(projectRoot, '.ophan');
  const taskLogger = new TaskLogger({ ophanDir });

  const limit = options.limit ?? 10;
  const tasks = await taskLogger.listRecentLogs(limit);

  if (tasks.length === 0) {
    logger.info('No task logs found.');
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  logger.section(`Recent Tasks (${tasks.length})`);
  logger.blank();

  for (const task of tasks) {
    console.log(taskLogger.formatTask(task));
  }

  logger.blank();
  logger.info(`Showing ${tasks.length} most recent tasks.`);
}
