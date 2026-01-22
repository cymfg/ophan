import { Command } from 'commander';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
  loadConfig,
  loadState,
  saveState,
} from '../utils/config.js';
import { OuterLoop } from '../../core/outer-loop.js';

interface ReviewOptions {
  force?: boolean;
  project?: string;
}

export const reviewCommand = new Command('review')
  .description('Run the outer loop (pattern detection and proposals)')
  .option('-f, --force', 'Run even if task threshold not reached')
  .option('-p, --project <path>', 'Path to the project directory')
  .action(async (options: ReviewOptions) => {
    try {
      await runReview(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runReview(options: ReviewOptions): Promise<void> {
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

  const config = loadConfig(projectRoot);
  const state = loadState(projectRoot);

  // Check if review is needed
  if (
    !options.force &&
    state.tasksSinceReview < config.outerLoop.triggers.afterTasks
  ) {
    logger.info(
      `Only ${state.tasksSinceReview} tasks since last review (threshold: ${config.outerLoop.triggers.afterTasks}).`
    );
    logger.info('Use --force to run anyway.');
    return;
  }

  logger.section('Outer Loop Review');
  logger.keyValue('Tasks since review', state.tasksSinceReview.toString());
  logger.keyValue('Lookback days', config.outerLoop.lookbackDays.toString());
  logger.keyValue(
    'Min occurrences',
    config.outerLoop.minOccurrences.toString()
  );
  logger.keyValue(
    'Min confidence',
    `${(config.outerLoop.minConfidence * 100).toFixed(0)}%`
  );

  logger.blank();

  const ophanDir = path.join(projectRoot, '.ophan');
  const projectName = path.basename(projectRoot);

  // Create and run the outer loop
  const outerLoop = new OuterLoop({
    projectRoot,
    projectName,
    ophanDir,
    config,
    state,
    onProgress: (message) => {
      logger.info(message);
    },
  });

  const result = await outerLoop.execute();

  // Update state
  state.lastReview = new Date().toISOString();
  state.tasksSinceReview = 0;
  state.pendingProposals = [
    ...state.pendingProposals,
    ...result.proposalsGenerated,
  ];
  state.metrics.patternsDetected += result.patternsDetected.length;

  saveState(projectRoot, state);

  // Display summary
  logger.blank();
  logger.section('Review Complete');

  logger.keyValue('Patterns detected', result.patternsDetected.length.toString());
  logger.keyValue(
    'Proposals generated',
    result.proposalsGenerated.length.toString()
  );
  logger.keyValue(
    'Learnings kept',
    result.learningsConsolidated.kept.toString()
  );
  logger.keyValue(
    'Learnings promoted',
    result.learningsConsolidated.promoted.toString()
  );
  logger.keyValue(
    'Learnings removed',
    result.learningsConsolidated.removed.toString()
  );

  if (result.guidelinesUpdated.length > 0) {
    logger.blank();
    logger.info('Guidelines updated:');
    for (const file of result.guidelinesUpdated) {
      logger.listItem(file);
    }
  }

  if (result.proposalsGenerated.length > 0) {
    logger.blank();
    logger.warn(
      `${result.proposalsGenerated.length} proposal(s) require approval.`
    );
    logger.info('Run `ophan approve <id>` to approve a proposal.');
  }

  if (result.digestPath) {
    logger.blank();
    logger.success(`Digest saved: ${result.digestPath}`);
  }
}
