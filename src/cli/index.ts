#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { taskCommand } from './commands/task.js';
import { reviewCommand } from './commands/review.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { setLogLevel } from './utils/logger.js';

const program = new Command();

program
  .name('ophan')
  .description(
    'A self-improving AI development agent based on the Two-Loop Paradigm'
  )
  .version('0.1.0')
  .option('-v, --verbose', 'Enable verbose logging')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setLogLevel('debug');
    }
  });

// Register commands
program.addCommand(initCommand);
program.addCommand(taskCommand);
program.addCommand(reviewCommand);
program.addCommand(statusCommand);
program.addCommand(logsCommand);

// Parse and execute
program.parse();
