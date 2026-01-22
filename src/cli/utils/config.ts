import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  OphanConfigSchema,
  DEFAULT_CONFIG,
  type OphanConfigOutput,
} from '../../types/config.js';
import {
  OphanStateSchema,
  createInitialState,
  type OphanStateOutput,
} from '../../types/state.js';

const CONFIG_FILENAME = '.ophan.yaml';
const STATE_DIR = '.ophan';
const STATE_FILENAME = 'state.json';

/**
 * Find the project root by looking for .ophan.yaml or .git
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir;

  while (currentDir !== dirname(currentDir)) {
    if (
      existsSync(join(currentDir, CONFIG_FILENAME)) ||
      existsSync(join(currentDir, STATE_DIR))
    ) {
      return currentDir;
    }
    // Also check for .git as a fallback
    if (existsSync(join(currentDir, '.git'))) {
      return currentDir;
    }
    currentDir = dirname(currentDir);
  }

  return null;
}

/**
 * Check if Ophan is initialized in the current project
 */
export function isOphanInitialized(projectRoot: string): boolean {
  return (
    existsSync(join(projectRoot, CONFIG_FILENAME)) &&
    existsSync(join(projectRoot, STATE_DIR))
  );
}

/**
 * Load and validate the Ophan configuration
 */
export function loadConfig(projectRoot: string): OphanConfigOutput {
  const configPath = join(projectRoot, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const rawConfig = parseYaml(content);

    // Interpolate environment variables
    const interpolated = interpolateEnvVars(rawConfig);

    return OphanConfigSchema.parse(interpolated);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Save configuration to .ophan.yaml
 */
export function saveConfig(
  projectRoot: string,
  config: OphanConfigOutput
): void {
  const configPath = join(projectRoot, CONFIG_FILENAME);
  const content = stringifyYaml(config, { indent: 2 });
  writeFileSync(configPath, content, 'utf-8');
}

/**
 * Load the Ophan state
 */
export function loadState(projectRoot: string): OphanStateOutput {
  const statePath = join(projectRoot, STATE_DIR, STATE_FILENAME);

  if (!existsSync(statePath)) {
    return createInitialState();
  }

  try {
    const content = readFileSync(statePath, 'utf-8');
    const rawState = JSON.parse(content);
    return OphanStateSchema.parse(rawState);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load state: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Save the Ophan state
 */
export function saveState(projectRoot: string, state: OphanStateOutput): void {
  const stateDir = join(projectRoot, STATE_DIR);
  const statePath = join(stateDir, STATE_FILENAME);

  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Interpolate environment variables in config values
 * Supports ${VAR_NAME} syntax
 */
function interpolateEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const value = process.env[varName];
      if (value === undefined) {
        console.warn(`Warning: Environment variable ${varName} is not set`);
        return '';
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }

  return obj;
}

/**
 * Get paths for Ophan directories
 */
export function getOphanPaths(projectRoot: string) {
  return {
    config: join(projectRoot, CONFIG_FILENAME),
    stateDir: join(projectRoot, STATE_DIR),
    state: join(projectRoot, STATE_DIR, STATE_FILENAME),
    guidelines: join(projectRoot, STATE_DIR, 'guidelines'),
    criteria: join(projectRoot, STATE_DIR, 'criteria'),
    logs: join(projectRoot, STATE_DIR, 'logs'),
    digests: join(projectRoot, STATE_DIR, 'digests'),
    metrics: join(projectRoot, STATE_DIR, 'metrics'),
  };
}
