import { Command } from 'commander';
import { promises as fs } from 'fs';
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
import { DevAgent } from '../../core/agents/dev-agent.js';

// Brand color: Ophan gold (#B9A46D)
const gold = chalk.hex('#B9A46D');

interface DevOptions {
  goal?: string;
  planOnly?: boolean;
  maxTasks?: number;
  project?: string;
}

export const devCommand = new Command('dev')
  .description('Run a goal-driven development cycle')
  .option('-g, --goal <id>', 'Focus on a specific goal')
  .option('--plan-only', 'Plan without executing (dry run)')
  .option('--max-tasks <number>', 'Max tasks per run (default: 5)', parseInt)
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (options: DevOptions) => {
    try {
      await runDev(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runDev(options: DevOptions): Promise<void> {
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

  // Header
  console.log();
  console.log(gold.bold('Dev Agent'));
  console.log(gold('═'.repeat(40)));
  console.log();

  if (options.planOnly) {
    logger.info('Plan-only mode — no tasks will be executed');
    console.log();
  }

  // Initialize DevAgent
  const agent = new DevAgent();
  await agent.initialize({
    projectRoot,
    ophanDir,
    config,
    onProgress: (msg) => logger.info(msg),
  });
  agent.setState(state);

  // Run the cycle
  const result = await agent.run({
    goalId: options.goal,
    planOnly: options.planOnly,
    maxTasks: options.maxTasks,
  });

  // Display results
  console.log();
  console.log(gold('─'.repeat(40)));
  logger.section('Run Summary');

  if (result.idle) {
    logger.info('Nothing to do — all goals are complete or no goals defined.');
    logger.info('Add a goal with: ophan goals add "your goal title"');
  } else {
    // Goals planned
    if (result.goalsPlanned.length > 0) {
      logger.keyValue('Goals planned', result.goalsPlanned.length.toString());
      for (const goalId of result.goalsPlanned) {
        logger.listItem(goalId);
      }
    }

    // Tasks executed
    if (result.tasksExecuted.length > 0) {
      logger.keyValue('Tasks executed', result.tasksExecuted.length.toString());
      let totalCost = 0;
      for (const task of result.tasksExecuted) {
        const status = task.success ? chalk.green('✓') : chalk.red('✗');
        logger.listItem(
          `${status} ${task.taskId} (${task.iterations} iter, $${task.cost.toFixed(4)})`
        );
        totalCost += task.cost;
      }
      logger.keyValue('Total cost', `$${totalCost.toFixed(4)}`);
    }

    // Goals completed
    if (result.goalsCompleted.length > 0) {
      console.log();
      for (const goalId of result.goalsCompleted) {
        logger.success(`Goal completed: ${goalId}`);
      }
    }

    // Decision info
    if (result.decision.action === 'blocked') {
      console.log();
      logger.warn(`Blocked: ${result.decision.reason}`);
    }
  }

  // Update state with goal changes
  state.goals = result.goals.map((g) => ({
    goalId: g.id,
    status: g.status,
    tasks: g.tasks,
    startedAt: g.createdAt,
    completedAt: g.completedAt,
    totalCost: g.tasks.reduce((sum, t) => sum + (t.result?.cost ?? 0), 0),
    totalTokens: 0,
  }));
  state.lastPlanningRun = new Date().toISOString();
  saveState(projectRoot, state);

  console.log();
}
