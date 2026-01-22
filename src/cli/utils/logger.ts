import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLogLevel: LogLevel = 'info';

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Set the current log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function shouldLog(level: LogLevel): boolean {
  return levelPriority[level] >= levelPriority[currentLogLevel];
}

/**
 * Logger utility for Ophan CLI
 */
export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.log(chalk.gray(`[debug] ${message}`), ...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(message, ...args);
    }
  },

  success(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(chalk.green(`✓ ${message}`), ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(chalk.yellow(`⚠ ${message}`), ...args);
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(chalk.red(`✗ ${message}`), ...args);
    }
  },

  /**
   * Log a section header
   */
  section(title: string): void {
    if (shouldLog('info')) {
      console.log();
      console.log(chalk.bold.blue(title));
      console.log(chalk.blue('─'.repeat(title.length)));
    }
  },

  /**
   * Log a key-value pair
   */
  keyValue(key: string, value: string | number): void {
    if (shouldLog('info')) {
      console.log(`  ${chalk.dim(key + ':')} ${value}`);
    }
  },

  /**
   * Log a list item
   */
  listItem(item: string, indent: number = 0): void {
    if (shouldLog('info')) {
      const padding = '  '.repeat(indent);
      console.log(`${padding}• ${item}`);
    }
  },

  /**
   * Log a blank line
   */
  blank(): void {
    if (shouldLog('info')) {
      console.log();
    }
  },

  /**
   * Log a divider line
   */
  divider(): void {
    if (shouldLog('info')) {
      console.log(chalk.dim('─'.repeat(50)));
    }
  },
};
