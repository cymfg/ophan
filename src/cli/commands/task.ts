import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
  loadConfig,
  loadState,
  saveState,
} from '../utils/config.js';
import { InnerLoop } from '../../core/inner-loop.js';
import { TaskLogger } from '../../core/task-logger.js';

interface TaskOptions {
  dryRun?: boolean;
  maxIterations?: number;
  project?: string;
}

export const taskCommand = new Command('task')
  .description('Run a task through the inner loop')
  .argument('<description>', 'Task description')
  .option('-n, --dry-run', 'Show what would be done without executing')
  .option(
    '-m, --max-iterations <number>',
    'Override max iterations',
    parseInt
  )
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (description: string, options: TaskOptions) => {
    try {
      await runTask(description, options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runTask(
  description: string,
  options: TaskOptions
): Promise<void> {
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
    logger.info('Or specify a project path with: ophan task "..." --project /path/to/project');
    return;
  }

  if (!isOphanInitialized(projectRoot)) {
    logger.error(`Ophan not initialized in ${projectRoot}. Run \`ophan init\` first.`);
    return;
  }

  const config = loadConfig(projectRoot);
  const state = loadState(projectRoot);

  // Override max iterations if provided
  if (options.maxIterations) {
    config.innerLoop.maxIterations = options.maxIterations;
  }

  logger.section('Task');
  logger.keyValue('Description', description);
  logger.keyValue('Max iterations', config.innerLoop.maxIterations.toString());
  logger.keyValue(
    'Regeneration strategy',
    config.innerLoop.regenerationStrategy
  );

  if (options.dryRun) {
    logger.blank();
    logger.info('Dry run mode - no changes will be made.');
    logger.blank();
    logger.info('Would execute:');
    logger.listItem('Load guidelines from .ophan/guidelines/');
    logger.listItem('Load criteria from .ophan/criteria/');
    logger.listItem('Generate output using Claude API');
    logger.listItem('Evaluate against criteria + dev tools');
    logger.listItem('Learn and regenerate if needed');
    logger.listItem('Log results to .ophan/logs/');
    return;
  }

  // Check for ANTHROPIC_API_KEY
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error('ANTHROPIC_API_KEY environment variable is not set.');
    logger.info('Set it with: export ANTHROPIC_API_KEY=your-api-key');
    return;
  }

  const ophanDir = path.join(projectRoot, '.ophan');

  // Load guidelines and criteria
  const guidelines = await loadGuidelines(ophanDir);
  const criteria = await loadCriteria(ophanDir);
  const learnings = await loadLearnings(ophanDir);

  logger.blank();
  logger.info('Starting inner loop execution...');
  logger.blank();

  // Initialize the task logger
  const taskLogger = new TaskLogger({ ophanDir });
  await taskLogger.init();

  // Get project name from directory
  const projectName = path.basename(projectRoot);

  // Create and run the inner loop
  const innerLoop = new InnerLoop({
    projectRoot,
    projectName,
    config,
    guidelines,
    criteria,
    learnings,
    onProgress: (message) => {
      logger.info(message);
    },
    onIteration: (iteration, evaluation) => {
      logger.blank();
      logger.info(`--- Iteration ${iteration} ${evaluation.passed ? '✓' : '✗'} ---`);
    },
    onEscalation: (_task, reason, context) => {
      logger.blank();
      logger.warn(`Escalation: ${reason}`);
      if (context.lastError) {
        logger.error(`Error: ${context.lastError}`);
      }
      if (context.suggestedAction) {
        logger.info(`Suggested: ${context.suggestedAction}`);
      }
    },
  });

  const result = await innerLoop.execute(description);

  // Save task log
  await taskLogger.saveTaskLog(result.task, result.logs);

  // Save any learnings
  for (const learning of result.learnings) {
    await taskLogger.saveLearning(learning);
    state.learnings.push(learning);
  }

  // Update state
  state.tasksSinceReview += 1;
  state.metrics.totalTasks += 1;

  if (result.task.status === 'converged') {
    state.metrics.successfulTasks += 1;
  } else if (result.task.status === 'failed') {
    state.metrics.failedTasks += 1;
  } else if (result.task.status === 'escalated') {
    state.metrics.escalatedTasks += 1;
  }

  state.metrics.totalTokensUsed += result.task.tokensUsed;
  state.metrics.totalCost += result.task.cost;

  // Recalculate success rate
  state.metrics.successRate =
    state.metrics.totalTasks > 0
      ? (state.metrics.successfulTasks / state.metrics.totalTasks) * 100
      : 0;

  saveState(projectRoot, state);

  // Display summary
  logger.blank();
  logger.section('Task Complete');

  const statusLabel =
    result.task.status === 'converged'
      ? '✓ Converged'
      : result.task.status === 'escalated'
        ? '⚠ Escalated'
        : '✗ Failed';

  logger.keyValue('Status', statusLabel);
  logger.keyValue('Iterations', result.task.iterations.toString());
  logger.keyValue('Tokens used', result.task.tokensUsed.toLocaleString());
  logger.keyValue('Cost', `$${result.task.cost.toFixed(4)}`);

  if (result.learnings.length > 0) {
    logger.blank();
    logger.info(`Extracted ${result.learnings.length} learning(s)`);
  }

  logger.blank();
  logger.info(`Tasks since last review: ${state.tasksSinceReview}`);

  if (state.tasksSinceReview >= config.outerLoop.triggers.afterTasks) {
    logger.blank();
    logger.warn(
      `Reached ${config.outerLoop.triggers.afterTasks} tasks. Consider running \`ophan review\`.`
    );
  }
}

async function loadGuidelines(ophanDir: string): Promise<string> {
  const guidelinesDir = path.join(ophanDir, 'guidelines');
  const files = ['coding.md', 'testing.md', 'learnings.md'];
  const contents: string[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(
        path.join(guidelinesDir, file),
        'utf-8'
      );
      contents.push(`# ${file}\n\n${content}`);
    } catch {
      // File doesn't exist, skip
    }
  }

  return contents.join('\n\n---\n\n');
}

async function loadCriteria(ophanDir: string): Promise<string> {
  const criteriaDir = path.join(ophanDir, 'criteria');
  const files = ['quality.md', 'security.md'];
  const contents: string[] = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(criteriaDir, file), 'utf-8');
      contents.push(`# ${file}\n\n${content}`);
    } catch {
      // File doesn't exist, skip
    }
  }

  return contents.join('\n\n---\n\n');
}

async function loadLearnings(ophanDir: string): Promise<string> {
  const learningsFile = path.join(ophanDir, 'guidelines', 'learnings.md');

  try {
    return await fs.readFile(learningsFile, 'utf-8');
  } catch {
    return '';
  }
}
