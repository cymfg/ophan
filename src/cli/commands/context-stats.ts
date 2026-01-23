import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
} from '../utils/config.js';
import { ContextLogger } from '../../core/context-logger.js';

// Brand color: Ophan gold (#B9A46D)
const gold = chalk.hex('#B9A46D');

interface ContextStatsOptions {
  days?: number;
  json?: boolean;
  project?: string;
}

export const contextStatsCommand = new Command('context-stats')
  .description('Show context usage statistics for the context agent')
  .option('-d, --days <number>', 'Number of days to analyze (default: 30)', parseInt)
  .option('--json', 'Output as JSON')
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (options: ContextStatsOptions) => {
    try {
      await runContextStats(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runContextStats(options: ContextStatsOptions): Promise<void> {
  // Use --project path if provided, otherwise find project root
  let projectRoot: string | null;

  if (options.project) {
    projectRoot = path.resolve(options.project);
    // Verify the path exists
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

  const ophanDir = path.join(projectRoot, '.ophan');
  const contextLogger = new ContextLogger({ ophanDir });

  const days = options.days ?? 30;
  const metrics = await contextLogger.getAggregateMetrics(days);

  if (options.json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  // Header
  console.log();
  console.log(gold.bold('Context Agent Statistics'));
  console.log(gold('═'.repeat(45)));
  console.log();

  if (metrics.tasksAnalyzed === 0) {
    logger.info('No tasks analyzed yet. Run some tasks to see context usage statistics.');
    console.log();
    return;
  }

  // Overview
  logger.section('Overview');
  logger.keyValue('Tasks analyzed', metrics.tasksAnalyzed.toString());
  logger.keyValue(
    'Period',
    `${metrics.periodStart.split('T')[0]} to ${metrics.periodEnd.split('T')[0]}`
  );
  console.log();

  // Performance metrics
  logger.section('Performance Metrics');

  // Hit rate with target indicator
  const hitRateStatus = metrics.averageHitRate >= 70 ? chalk.green('✓') : chalk.red('✗');
  logger.keyValue(
    'Context hit rate',
    `${metrics.averageHitRate.toFixed(1)}% ${hitRateStatus} (target: >70%)`
  );

  // Miss rate with target indicator
  const missRateStatus = metrics.averageMissRate <= 20 ? chalk.green('✓') : chalk.red('✗');
  logger.keyValue(
    'Context miss rate',
    `${metrics.averageMissRate.toFixed(1)}% ${missRateStatus} (target: <20%)`
  );

  logger.keyValue(
    'Avg exploration tokens',
    Math.round(metrics.averageExplorationTokens).toLocaleString()
  );
  console.log();

  // Most commonly needed but not provided
  if (metrics.commonMisses.length > 0) {
    logger.section('Most Commonly Needed but Not Provided');
    for (const { file, count } of metrics.commonMisses.slice(0, 5)) {
      // Shorten the file path for display
      const shortPath = file.length > 50 ? '...' + file.slice(-47) : file;
      logger.listItem(`${shortPath} (${count} tasks)`);
    }
    console.log();
  }

  // Most commonly provided but unused
  if (metrics.commonUnused.length > 0) {
    logger.section('Most Commonly Provided but Unused');
    for (const { file, count } of metrics.commonUnused.slice(0, 5)) {
      const shortPath = file.length > 50 ? '...' + file.slice(-47) : file;
      logger.listItem(`${shortPath} (${count} tasks)`);
    }
    console.log();
  }

  // Assessment
  logger.section('Assessment');

  const hitRatePassed = metrics.averageHitRate >= 70;
  const missRatePassed = metrics.averageMissRate <= 20;

  if (hitRatePassed && missRatePassed) {
    logger.success('Context prediction is performing well!');
  } else {
    if (!hitRatePassed) {
      logger.warn('Hit rate below target - context includes irrelevant files');
      logger.info('  Suggestion: Review "commonly provided but unused" files above');
    }
    if (!missRatePassed) {
      logger.warn('Miss rate above target - context missing important files');
      logger.info('  Suggestion: Review "commonly needed but not provided" files above');
      logger.info('  Consider adding these patterns to .ophan/guidelines/context.md');
    }
  }

  console.log();
}
