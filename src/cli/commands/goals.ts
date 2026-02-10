import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import {
  findProjectRoot,
  isOphanInitialized,
  loadState,
} from '../utils/config.js';
import {
  loadGoalFiles,
  serializeGoalFile,
  generateGoalId,
  type ParsedGoalFile,
} from '../../core/goal-parser.js';
import type { GoalStatus } from '../../types/index.js';

// Brand color: Ophan gold (#B9A46D)
const gold = chalk.hex('#B9A46D');

export const goalsCommand = new Command('goals')
  .description('Manage development goals')
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (options: { project?: string }) => {
    try {
      await listGoals(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

// Subcommand: goals add "title"
goalsCommand
  .command('add')
  .description('Create a new goal file')
  .argument('<title>', 'Goal title')
  .option('-d, --description <text>', 'Goal description')
  .option('-c, --criteria <items>', 'Comma-separated acceptance criteria')
  .option('--priority <number>', 'Priority (lower = higher priority, default: 10)', parseInt)
  .option('--tags <tags>', 'Comma-separated tags')
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (title: string, options: { description?: string; criteria?: string; priority?: number; tags?: string; project?: string }, command: Command) => {
    // Commander may parse --project as the parent's option when both define it
    options.project ??= command.parent?.opts().project;
    try {
      await addGoal(title, options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

// Subcommand: goals show <id>
goalsCommand
  .command('show')
  .description('Show goal details and progress')
  .argument('<id>', 'Goal ID')
  .option(
    '-p, --project <path>',
    'Path to the project directory (defaults to current directory)'
  )
  .action(async (id: string, options: { project?: string }, command: Command) => {
    options.project ??= command.parent?.opts().project;
    try {
      await showGoal(id, options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function resolveProject(projectPath?: string): Promise<string> {
  let projectRoot: string | null;

  if (projectPath) {
    projectRoot = path.resolve(projectPath);
    try {
      await fs.access(projectRoot);
    } catch {
      throw new Error(`Project path does not exist: ${projectRoot}`);
    }
  } else {
    projectRoot = findProjectRoot();
  }

  if (!projectRoot) {
    throw new Error('Not in an Ophan project. Run `ophan init` first.');
  }

  if (!isOphanInitialized(projectRoot)) {
    throw new Error('Ophan not initialized. Run `ophan init` first.');
  }

  return projectRoot;
}

function statusIcon(status: GoalStatus): string {
  switch (status) {
    case 'pending':
      return chalk.gray('○');
    case 'planning':
      return chalk.blue('◐');
    case 'in_progress':
      return chalk.yellow('●');
    case 'blocked':
      return chalk.red('✗');
    case 'completed':
      return chalk.green('✓');
    case 'abandoned':
      return chalk.gray('—');
    default:
      return '?';
  }
}

async function listGoals(options: { project?: string }): Promise<void> {
  const projectRoot = await resolveProject(options.project);
  const ophanDir = path.join(projectRoot, '.ophan');
  const goalsDir = path.join(ophanDir, 'goals');

  const goalFiles = await loadGoalFiles(goalsDir);
  const state = loadState(projectRoot);
  const goalStates = new Map(state.goals.map((g) => [g.goalId, g]));

  console.log();
  console.log(gold.bold('Goals'));
  console.log(gold('═'.repeat(50)));
  console.log();

  if (goalFiles.length === 0) {
    logger.info('No goals defined yet.');
    logger.info('Create one with: ophan goals add "your goal title"');
    console.log();
    return;
  }

  // Sort by priority
  const sorted = [...goalFiles].sort((a, b) => a.priority - b.priority);

  for (const goal of sorted) {
    const goalState = goalStates.get(goal.id);
    const status: GoalStatus = goalState?.status ?? 'pending';
    const tasks = goalState?.tasks ?? [];
    const completedTasks = tasks.filter((t) => t.status === 'converged').length;
    const totalTasks = tasks.length;

    const taskProgress =
      totalTasks > 0 ? `[${completedTasks}/${totalTasks}]` : '';

    const icon = statusIcon(status);
    const priorityLabel = chalk.gray(`P${goal.priority}`);

    console.log(
      `  ${icon} ${priorityLabel} ${goal.title} ${chalk.gray(taskProgress)}`
    );
    console.log(`    ${chalk.gray(goal.id)}`);

    if (goal.tags.length > 0) {
      console.log(`    ${goal.tags.map((t) => chalk.cyan(`#${t}`)).join(' ')}`);
    }
  }

  console.log();

  // Summary
  const completed = sorted.filter(
    (g) => goalStates.get(g.id)?.status === 'completed'
  ).length;
  const active = sorted.filter((g) => {
    const s = goalStates.get(g.id)?.status ?? 'pending';
    return !['completed', 'abandoned'].includes(s);
  }).length;

  logger.keyValue('Total', sorted.length.toString());
  logger.keyValue('Active', active.toString());
  logger.keyValue('Completed', completed.toString());
  console.log();
}

async function addGoal(
  title: string,
  options: { description?: string; criteria?: string; priority?: number; tags?: string; project?: string }
): Promise<void> {
  const projectRoot = await resolveProject(options.project);
  const ophanDir = path.join(projectRoot, '.ophan');
  const goalsDir = path.join(ophanDir, 'goals');

  await fs.mkdir(goalsDir, { recursive: true });

  const id = generateGoalId(title);
  const priority = options.priority ?? 10;
  const tags = options.tags ? options.tags.split(',').map((t) => t.trim()) : [];
  const description = options.description ?? 'TODO: Add description';
  const acceptanceCriteria = options.criteria
    ? options.criteria.split(',').map((c) => c.trim())
    : ['TODO: Define acceptance criteria'];

  const goalFile: ParsedGoalFile = {
    id,
    title,
    priority,
    tags,
    dependsOn: [],
    description,
    acceptanceCriteria,
    filePath: path.join(goalsDir, `${id}.md`),
  };

  const content = serializeGoalFile(goalFile);
  await fs.writeFile(goalFile.filePath, content, 'utf-8');

  console.log();
  logger.success(`Created goal: ${goalFile.filePath}`);
  if (!options.description || !options.criteria) {
    logger.info('Edit the file to fill in missing description or criteria.');
  }
  logger.info('Run `ophan dev` to start working on this goal.');
  console.log();
}

async function showGoal(id: string, options: { project?: string } = {}): Promise<void> {
  const projectRoot = await resolveProject(options.project);
  const ophanDir = path.join(projectRoot, '.ophan');
  const goalsDir = path.join(ophanDir, 'goals');

  const goalFiles = await loadGoalFiles(goalsDir);
  const goalFile = goalFiles.find((g) => g.id === id);

  if (!goalFile) {
    logger.error(`Goal not found: ${id}`);
    logger.info('Available goals:');
    for (const g of goalFiles) {
      logger.listItem(`${g.id} — ${g.title}`);
    }
    return;
  }

  const state = loadState(projectRoot);
  const goalState = state.goals.find((g) => g.goalId === id);
  const status: GoalStatus = goalState?.status ?? 'pending';
  const tasks = goalState?.tasks ?? [];

  console.log();
  console.log(gold.bold(goalFile.title));
  console.log(gold('═'.repeat(50)));
  console.log();

  logger.keyValue('ID', goalFile.id);
  logger.keyValue('Status', `${statusIcon(status)} ${status}`);
  logger.keyValue('Priority', goalFile.priority.toString());

  if (goalFile.tags.length > 0) {
    logger.keyValue('Tags', goalFile.tags.map((t) => `#${t}`).join(', '));
  }
  if (goalFile.dependsOn.length > 0) {
    logger.keyValue('Depends on', goalFile.dependsOn.join(', '));
  }
  console.log();

  // Description
  logger.section('Description');
  console.log(goalFile.description);
  console.log();

  // Acceptance Criteria
  logger.section('Acceptance Criteria');
  for (const criterion of goalFile.acceptanceCriteria) {
    const met = status === 'completed';
    const icon = met ? chalk.green('✓') : chalk.gray('○');
    console.log(`  ${icon} ${criterion}`);
  }
  console.log();

  // Tasks
  if (tasks.length > 0) {
    logger.section(`Tasks (${tasks.length})`);
    for (const task of tasks) {
      const taskIcon =
        task.status === 'converged'
          ? chalk.green('✓')
          : task.status === 'failed'
            ? chalk.red('✗')
            : task.status === 'running'
              ? chalk.yellow('●')
              : chalk.gray('○');

      const costStr = task.result
        ? chalk.gray(` ($${task.result.cost.toFixed(4)})`)
        : '';

      console.log(`  ${taskIcon} ${task.description}${costStr}`);
    }

    // Task summary
    const completedTasks = tasks.filter((t) => t.status === 'converged').length;
    const failedTasks = tasks.filter((t) => t.status === 'failed').length;
    const totalCost = tasks.reduce((sum, t) => sum + (t.result?.cost ?? 0), 0);

    console.log();
    logger.keyValue('Completed', `${completedTasks}/${tasks.length}`);
    if (failedTasks > 0) {
      logger.keyValue('Failed', failedTasks.toString());
    }
    if (totalCost > 0) {
      logger.keyValue('Total cost', `$${totalCost.toFixed(4)}`);
    }
  } else {
    logger.info('No tasks yet. Run `ophan dev` to plan this goal.');
  }

  console.log();
}
