import ora, { type Ora } from 'ora';

/**
 * Create a spinner for long-running operations
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: 'dots',
  });
}

/**
 * Run an async operation with a spinner
 */
export async function withSpinner<T>(
  text: string,
  operation: () => Promise<T>,
  options: {
    successText?: string;
    failText?: string;
  } = {}
): Promise<T> {
  const spinner = createSpinner(text);
  spinner.start();

  try {
    const result = await operation();
    spinner.succeed(options.successText ?? text);
    return result;
  } catch (error) {
    spinner.fail(options.failText ?? `Failed: ${text}`);
    throw error;
  }
}
