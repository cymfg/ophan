import { Command } from 'commander';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
  loadConfig,
  loadState,
} from '../utils/config.js';

export const statusCommand = new Command('status')
  .description('Show Ophan status and metrics')
  .action(async () => {
    try {
      await runStatus();
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runStatus(): Promise<void> {
  const projectRoot = findProjectRoot();

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
  const metrics = state.metrics;

  // Header
  console.log();
  console.log(chalk.bold('Ophan Status'));
  console.log(chalk.dim('═'.repeat(40)));
  console.log();

  // Tasks section
  logger.section('Tasks');
  logger.keyValue('Total', metrics.totalTasks.toString());
  logger.keyValue(
    'Successful',
    `${metrics.successfulTasks} (${metrics.successRate.toFixed(1)}%)`
  );
  logger.keyValue('Failed', metrics.failedTasks.toString());
  logger.keyValue('Escalated', metrics.escalatedTasks.toString());
  console.log();

  // Iterations section
  logger.section('Iterations');
  logger.keyValue('Average', metrics.averageIterations.toFixed(1) + ' per task');
  logger.keyValue(
    'Max limit hits',
    `${metrics.maxIterationsHit} tasks reached limit`
  );
  logger.keyValue('Max iterations', config.innerLoop.maxIterations.toString());
  console.log();

  // Cost section
  logger.section('Cost');
  logger.keyValue('Total', `$${metrics.totalCost.toFixed(2)}`);
  logger.keyValue('Per task', `$${metrics.averageCostPerTask.toFixed(2)} avg`);
  if (config.innerLoop.costLimit) {
    logger.keyValue('Limit', `$${config.innerLoop.costLimit} per task`);
  }
  console.log();

  // Learnings section
  logger.section('Learnings');
  logger.keyValue('Active', state.learnings.filter((l) => !l.promoted).length.toString());
  logger.keyValue('Promoted', metrics.learningsPromoted.toString());
  logger.keyValue('Patterns detected', metrics.patternsDetected.toString());
  console.log();

  // Review status
  logger.section('Outer Loop');
  if (state.lastReview) {
    const lastReview = new Date(state.lastReview);
    const daysSince = Math.floor(
      (Date.now() - lastReview.getTime()) / (1000 * 60 * 60 * 24)
    );
    logger.keyValue('Last review', `${daysSince} days ago`);
  } else {
    logger.keyValue('Last review', 'Never');
  }
  logger.keyValue('Tasks since review', state.tasksSinceReview.toString());
  logger.keyValue('Trigger threshold', config.outerLoop.triggers.afterTasks.toString());

  if (state.tasksSinceReview >= config.outerLoop.triggers.afterTasks) {
    console.log();
    logger.warn('Outer loop review recommended. Run `ophan review`.');
  }

  // Pending proposals
  if (state.pendingProposals.length > 0) {
    console.log();
    logger.section('Pending Proposals');
    for (const proposal of state.pendingProposals) {
      const icon = proposal.type === 'criteria' ? '🔒' : '📝';
      logger.listItem(
        `${icon} ${proposal.type}: ${proposal.targetFile} (${(proposal.confidence * 100).toFixed(0)}% confidence)`
      );
    }
  }

  console.log();
}
