/**
 * Shared Utilities for Agents
 *
 * Common utilities extracted from various agent implementations
 * to reduce duplication and ensure consistency.
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * Generate unique IDs for various entities
 */
export const IdGenerator = {
  /**
   * Generate a task ID
   * Format: task-YYYYMMDD-HHMMSS-XXXX
   */
  task(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const random = Math.random().toString(36).slice(2, 6);
    return `task-${date}-${time}-${random}`;
  },

  /**
   * Generate a learning ID
   * Format: YYYYMMDDHHMMSS
   */
  learning(): string {
    const now = new Date();
    return now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  },

  /**
   * Generate a proposal ID with optional prefix
   * Format: [prefix-]YYYYMMDDHHMMSS[-XXXX]
   */
  proposal(prefix?: string): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const random = Math.random().toString(36).slice(2, 6);

    if (prefix) {
      return `${prefix}-${timestamp}-${random}`;
    }
    return `proposal-${timestamp}`;
  },

  /**
   * Generate a context proposal ID
   * Format: ctx-YYYYMMDDHHMMSS-XXXX
   */
  contextProposal(): string {
    return this.proposal('ctx');
  },
};

/**
 * Result of loading content files
 */
export interface LoadedContent {
  /** Concatenated content from all files */
  content: string;
  /** List of file paths that were loaded */
  files: string[];
}

/**
 * Load and concatenate content from multiple files
 */
export const ContentLoader = {
  /**
   * Load multiple files and concatenate their contents
   *
   * @param baseDir - Base directory to load from
   * @param fileNames - List of file names to load
   * @param separator - Separator between file contents
   * @returns Combined content and list of loaded files
   */
  async loadMultiple(
    baseDir: string,
    fileNames: string[],
    separator: string = '\n\n---\n\n'
  ): Promise<LoadedContent> {
    const contents: string[] = [];
    const loadedFiles: string[] = [];

    for (const fileName of fileNames) {
      const filePath = path.join(baseDir, fileName);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        contents.push(`# ${fileName}\n\n${content}`);
        loadedFiles.push(filePath);
      } catch {
        // File doesn't exist, skip it
      }
    }

    return {
      content: contents.join(separator),
      files: loadedFiles,
    };
  },

  /**
   * Load guidelines from the .ophan/guidelines directory
   */
  async loadGuidelines(
    ophanDir: string,
    fileNames: string[]
  ): Promise<LoadedContent> {
    return this.loadMultiple(path.join(ophanDir, 'guidelines'), fileNames);
  },

  /**
   * Load criteria from the .ophan/criteria directory
   */
  async loadCriteria(
    ophanDir: string,
    fileNames: string[]
  ): Promise<LoadedContent> {
    return this.loadMultiple(path.join(ophanDir, 'criteria'), fileNames);
  },

  /**
   * Load JSON files from a directory with optional date filtering
   *
   * @param dir - Directory to load from
   * @param since - Only load files with dates after this
   * @returns Array of parsed JSON objects
   */
  async loadJsonFiles<T>(
    dir: string,
    since?: Date
  ): Promise<Array<{ data: T; filePath: string }>> {
    const results: Array<{ data: T; filePath: string }> = [];

    try {
      const files = await fs.readdir(dir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const filePath = path.join(dir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content) as T;

          // If filtering by date, check the data
          if (since && 'timestamp' in (data as object)) {
            const timestamp = new Date((data as { timestamp: string }).timestamp);
            if (timestamp < since) {
              continue;
            }
          }

          results.push({ data, filePath });
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory might not exist
    }

    return results;
  },
};

/**
 * Abstract base class providing common agent functionality
 */
export abstract class AbstractAgent {
  protected options: {
    projectRoot: string;
    ophanDir: string;
    onProgress?: (message: string) => void;
  } | null = null;

  /**
   * Log a message using the configured progress callback
   */
  log(message: string): void {
    this.options?.onProgress?.(message);
  }

  /**
   * Ensure the agent has been initialized
   */
  protected ensureInitialized(): void {
    if (!this.options) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }
  }

  /**
   * Get the ophan directory path
   */
  protected get ophanDir(): string {
    this.ensureInitialized();
    return this.options!.ophanDir;
  }

  /**
   * Get the project root path
   */
  protected get projectRoot(): string {
    this.ensureInitialized();
    return this.options!.projectRoot;
  }
}
