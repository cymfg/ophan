import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { OphanConfig, FileUsage } from '../types/index.js';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolRunnerOptions {
  projectRoot: string;
  config: OphanConfig;
}

/**
 * Executes tools requested by the agent
 */
export class ToolRunner {
  private projectRoot: string;
  private config: OphanConfig;
  private toolOutputs: string[] = [];

  // File usage tracking for context agent evaluation
  private fileUsage: {
    read: Set<string>;
    written: Set<string>;
    searched: Set<string>;
    commands: string[];
  } = {
    read: new Set(),
    written: new Set(),
    searched: new Set(),
    commands: [],
  };

  // Track when first write happens (for exploration token calculation)
  private firstWriteOccurred: boolean = false;

  constructor(options: ToolRunnerOptions) {
    this.projectRoot = options.projectRoot;
    this.config = options.config;
  }

  /**
   * Execute a tool by name
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    let result: ToolResult;

    switch (toolName) {
      case 'run_command':
        result = await this.runCommand(
          input.command as string,
          input.timeout as number | undefined
        );
        // Track command
        if (result.success) {
          this.fileUsage.commands.push(input.command as string);
        }
        break;
      case 'read_file':
        result = await this.readFile(input.path as string);
        // Track file read
        if (result.success) {
          this.fileUsage.read.add(this.normalizePath(input.path as string));
        }
        break;
      case 'write_file':
        result = await this.writeFile(
          input.path as string,
          input.content as string
        );
        // Track file write and mark first write
        if (result.success) {
          this.fileUsage.written.add(this.normalizePath(input.path as string));
          this.firstWriteOccurred = true;
        }
        break;
      case 'list_files':
        result = await this.listFiles(
          input.path as string | undefined,
          input.pattern as string | undefined
        );
        break;
      case 'search_files':
        result = await this.searchFiles(
          input.pattern as string,
          input.path as string | undefined,
          input.filePattern as string | undefined
        );
        // Track files found in search results
        if (result.success) {
          this.extractSearchedFiles(result.output);
        }
        break;
      case 'task_complete':
        result = {
          success: true,
          output: `Task completed: ${input.summary}`,
        };
        break;
      default:
        result = {
          success: false,
          output: '',
          error: `Unknown tool: ${toolName}`,
        };
    }

    // Record tool output
    this.toolOutputs.push(
      `[${toolName}] ${result.success ? 'SUCCESS' : 'FAILED'}\n${result.output}${result.error ? `\nError: ${result.error}` : ''}`
    );

    return result;
  }

  /**
   * Get all tool outputs for evaluation
   */
  getToolOutputs(): string {
    return this.toolOutputs.join('\n\n---\n\n');
  }

  /**
   * Clear tool outputs (for new iteration)
   */
  clearToolOutputs(): void {
    this.toolOutputs = [];
  }

  /**
   * Get file usage data for context evaluation
   */
  getFileUsage(): FileUsage {
    return {
      filesRead: [...this.fileUsage.read],
      filesWritten: [...this.fileUsage.written],
      filesSearched: [...this.fileUsage.searched],
      commandsRun: [...this.fileUsage.commands],
    };
  }

  /**
   * Check if first write has occurred (for exploration token calculation)
   */
  hasFirstWriteOccurred(): boolean {
    return this.firstWriteOccurred;
  }

  /**
   * Clear file usage data (for new task)
   */
  clearFileUsage(): void {
    this.fileUsage = {
      read: new Set(),
      written: new Set(),
      searched: new Set(),
      commands: [],
    };
    this.firstWriteOccurred = false;
  }

  /**
   * Record a tool output (used when tools are executed externally, e.g., by Claude Code)
   */
  recordToolOutput(toolName: string, result: ToolResult): void {
    this.toolOutputs.push(
      `[${toolName}] ${result.success ? 'SUCCESS' : 'FAILED'}\n${result.output}${result.error ? `\nError: ${result.error}` : ''}`
    );
  }

  /**
   * Run a shell command
   */
  private async runCommand(
    command: string,
    timeout: number = 30000
  ): Promise<ToolResult> {
    // Check against blocked commands
    const blockedCommands = this.config.guardrails.blockedCommands;
    for (const blocked of blockedCommands) {
      if (command.includes(blocked)) {
        return {
          success: false,
          output: '',
          error: `Command blocked by guardrails: ${blocked}`,
        };
      }
    }

    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', command], {
        cwd: this.projectRoot,
        env: process.env,
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const output = stdout + (stderr ? `\nStderr:\n${stderr}` : '');
        if (code === 0) {
          resolve({ success: true, output: output || '(no output)' });
        } else {
          resolve({
            success: false,
            output,
            error: `Command exited with code ${code}`,
          });
        }
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          output: '',
          error: err.message,
        });
      });
    });
  }

  /**
   * Read a file
   */
  private async readFile(filePath: string): Promise<ToolResult> {
    const fullPath = this.resolvePath(filePath);

    // Check if path is protected
    if (this.isProtectedPath(filePath)) {
      return {
        success: false,
        output: '',
        error: `Cannot read protected file: ${filePath}`,
      };
    }

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, output: content };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Failed to read file: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Write to a file
   */
  private async writeFile(
    filePath: string,
    content: string
  ): Promise<ToolResult> {
    const fullPath = this.resolvePath(filePath);

    // Check if path is protected
    if (this.isProtectedPath(filePath)) {
      return {
        success: false,
        output: '',
        error: `Cannot write to protected file: ${filePath}`,
      };
    }

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true, output: `Successfully wrote to ${filePath}` };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Failed to write file: ${(err as Error).message}`,
      };
    }
  }

  /**
   * List files in a directory
   */
  private async listFiles(
    dirPath: string = '.',
    pattern?: string
  ): Promise<ToolResult> {
    const fullPath = this.resolvePath(dirPath);

    try {
      if (pattern) {
        const files = await glob(pattern, { cwd: fullPath });
        return { success: true, output: files.join('\n') || '(no files found)' };
      } else {
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        const output = entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .join('\n');
        return { success: true, output: output || '(empty directory)' };
      }
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Failed to list directory: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Search for pattern in files
   */
  private async searchFiles(
    pattern: string,
    dirPath: string = '.',
    filePattern?: string
  ): Promise<ToolResult> {
    const fullPath = this.resolvePath(dirPath);

    try {
      const regex = new RegExp(pattern, 'g');
      const globPattern = filePattern || '**/*';
      const files = await glob(globPattern, {
        cwd: fullPath,
        nodir: true,
        ignore: ['node_modules/**', '.git/**', 'dist/**'],
      });

      const results: string[] = [];

      for (const file of files.slice(0, 100)) {
        // Limit to 100 files
        try {
          const filePath = path.join(fullPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            if (regex.test(line)) {
              results.push(`${file}:${index + 1}: ${line.trim()}`);
            }
            regex.lastIndex = 0; // Reset regex state
          });
        } catch {
          // Skip files that can't be read
        }
      }

      return {
        success: true,
        output:
          results.slice(0, 50).join('\n') ||
          `No matches found for pattern: ${pattern}`,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Search failed: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Resolve a path relative to project root
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.projectRoot, filePath);
  }

  /**
   * Check if a path is protected by guardrails
   */
  private isProtectedPath(filePath: string): boolean {
    const protectedPaths = this.config.guardrails.protectedPaths;

    for (const protectedPattern of protectedPaths) {
      // Simple glob matching
      if (protectedPattern.includes('**')) {
        const prefix = protectedPattern.replace('/**', '').replace('**/', '');
        if (filePath.startsWith(prefix) || filePath.includes(`/${prefix}`)) {
          return true;
        }
      } else if (filePath === protectedPattern || filePath.endsWith(protectedPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalize a file path to relative form for consistent tracking
   */
  private normalizePath(filePath: string): string {
    // Convert absolute paths to relative
    if (path.isAbsolute(filePath)) {
      return path.relative(this.projectRoot, filePath);
    }
    // Normalize the relative path
    return path.normalize(filePath);
  }

  /**
   * Extract file paths from search results output
   * Format: "file.ts:123: matched line content"
   */
  private extractSearchedFiles(output: string): void {
    const lines = output.split('\n');
    for (const line of lines) {
      // Match "filename:lineNumber:" pattern
      const match = line.match(/^([^:]+):\d+:/);
      if (match) {
        this.fileUsage.searched.add(this.normalizePath(match[1]));
      }
    }
  }
}
