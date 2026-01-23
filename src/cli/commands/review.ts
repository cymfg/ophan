import { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
  loadConfig,
  loadState,
  saveState,
} from '../utils/config.js';
import { OuterLoop } from '../../core/outer-loop.js';
import { InteractiveReviewer } from '../utils/interactive-reviewer.js';

// Brand color: Ophan gold (#B9A46D)
const gold = chalk.hex('#B9A46D');

interface ReviewOptions {
  force?: boolean;
  project?: string;
  auto?: boolean;
  nonInteractive?: boolean;
  pending?: boolean;
}

export const reviewCommand = new Command('review')
  .description('Run the outer loop and review proposals interactively')
  .option('-f, --force', 'Run even if task threshold not reached')
  .option('-p, --project <path>', 'Path to the project directory')
  .option(
    '--auto',
    'Auto-approve guideline changes (criteria still require approval)'
  )
  .option(
    '--non-interactive',
    'Skip interactive review, save proposals to pending'
  )
  .option('--pending', 'Review pending proposals from previous runs')
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
  const ophanDir = path.join(projectRoot, '.ophan');
  const projectName = path.basename(projectRoot);

  // If --pending, just review pending proposals
  if (options.pending) {
    await reviewPendingProposals(projectRoot, state, options);
    return;
  }

  // Check if review is needed
  if (
    !options.force &&
    state.tasksSinceReview < config.outerLoop.triggers.afterTasks
  ) {
    logger.info(
      `Only ${state.tasksSinceReview} tasks since last review (threshold: ${config.outerLoop.triggers.afterTasks}).`
    );
    logger.info('Use --force to run anyway.');

    // If there are pending proposals, offer to review them
    if (state.pendingProposals.length > 0) {
      logger.blank();
      logger.info(
        `${state.pendingProposals.length} pending proposal(s) from previous reviews.`
      );
      logger.info('Run `ophan review --pending` to review them.');
    }
    return;
  }

  // Display header
  console.log();
  console.log(gold.bold('Outer Loop Review'));
  console.log(gold('═'.repeat(40)));
  console.log();

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

  if (options.auto) {
    logger.keyValue('Mode', chalk.yellow('Auto-approve guidelines'));
  } else if (options.nonInteractive) {
    logger.keyValue('Mode', chalk.yellow('Non-interactive'));
  } else {
    logger.keyValue('Mode', chalk.green('Interactive'));
  }

  logger.blank();

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

  // Run outer loop - auto-apply guidelines only in --auto mode
  const result = await outerLoop.execute({
    autoApplyGuidelines: options.auto,
  });

  // Update state with review timestamp
  state.lastReview = new Date().toISOString();
  state.tasksSinceReview = 0;
  state.metrics.patternsDetected += result.patternsDetected.length;

  // Display outer loop summary
  logger.blank();
  logger.section('Analysis Complete');

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
    logger.info('Guidelines auto-updated:');
    for (const file of result.guidelinesUpdated) {
      logger.listItem(file);
    }
  }

  // Handle proposals based on mode
  if (result.proposalsGenerated.length > 0) {
    logger.blank();

    if (options.nonInteractive) {
      // Non-interactive: save all proposals to pending
      state.pendingProposals = [
        ...state.pendingProposals,
        ...result.proposalsGenerated,
      ];
      logger.info(
        `${result.proposalsGenerated.length} proposal(s) saved to pending reviews.`
      );
      logger.info('Run `ophan review --pending` to review them interactively.');
    } else {
      // Interactive or auto mode: review proposals
      const reviewer = new InteractiveReviewer({
        projectRoot,
        autoApproveGuidelines: options.auto,
        nonInteractive: false,
      });

      const reviewResult = await reviewer.review(result.proposalsGenerated);

      // Update state based on review results
      // Add skipped proposals to pending
      if (reviewResult.skipped.length > 0) {
        state.pendingProposals = [
          ...state.pendingProposals,
          ...reviewResult.skipped,
        ];
      }

      // Update metrics for approved proposals
      state.metrics.learningsPromoted += reviewResult.summary.approvedCount;
    }
  }

  saveState(projectRoot, state);

  if (result.digestPath) {
    logger.blank();
    logger.success(`Digest saved: ${result.digestPath}`);
  }

  // Show pending proposals count
  if (state.pendingProposals.length > 0) {
    logger.blank();
    logger.info(
      `${state.pendingProposals.length} proposal(s) pending review.`
    );
  }
}

/**
 * Review pending proposals from previous runs
 */
async function reviewPendingProposals(
  projectRoot: string,
  state: ReturnType<typeof loadState>,
  options: ReviewOptions
): Promise<void> {
  const pendingProposals = state.pendingProposals.filter(
    (p) => p.status === 'pending' || p.status === 'skipped'
  );

  if (pendingProposals.length === 0) {
    logger.info('No pending proposals to review.');
    return;
  }

  console.log();
  console.log(gold.bold('Pending Proposals'));
  console.log(gold('═'.repeat(40)));
  console.log();
  logger.info(`${pendingProposals.length} proposal(s) pending review`);

  // Group by source
  const taskAgentProposals = pendingProposals.filter(
    (p) => p.source === 'task-agent'
  );
  const contextAgentProposals = pendingProposals.filter(
    (p) => p.source === 'context-agent'
  );

  if (taskAgentProposals.length > 0) {
    logger.keyValue('Task Agent', taskAgentProposals.length.toString());
  }
  if (contextAgentProposals.length > 0) {
    logger.keyValue('Context Agent', contextAgentProposals.length.toString());
  }

  logger.blank();

  const reviewer = new InteractiveReviewer({
    projectRoot,
    autoApproveGuidelines: options.auto,
    nonInteractive: options.nonInteractive,
  });

  const reviewResult = await reviewer.review(pendingProposals);

  // Update state: remove reviewed proposals, keep only skipped
  const reviewedIds = new Set([
    ...reviewResult.approved.map((p) => p.id),
    ...reviewResult.rejected.map((p) => p.id),
  ]);

  // Keep proposals that weren't touched in this review or were skipped
  state.pendingProposals = state.pendingProposals.filter(
    (p) => !reviewedIds.has(p.id)
  );

  // Update metrics
  state.metrics.learningsPromoted += reviewResult.summary.approvedCount;

  saveState(projectRoot, state);

  if (state.pendingProposals.length > 0) {
    logger.blank();
    logger.info(
      `${state.pendingProposals.length} proposal(s) still pending.`
    );
  }
}
