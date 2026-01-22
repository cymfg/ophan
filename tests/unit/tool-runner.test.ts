import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRunner } from '../../src/core/tool-runner.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';
import type { OphanConfigOutput } from '../../src/types/config.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

describe('ToolRunner', () => {
  let toolRunner: ToolRunner;
  let testDir: string;
  let config: OphanConfigOutput;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = path.join(os.tmpdir(), `ophan-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    config = {
      ...DEFAULT_CONFIG,
      guardrails: {
        ...DEFAULT_CONFIG.guardrails,
        protectedPaths: ['.ophan/criteria/**'],
        blockedCommands: ['rm -rf /', 'sudo rm'],
      },
    };

    toolRunner = new ToolRunner({
      projectRoot: testDir,
      config,
    });
  });

  describe('run_command', () => {
    it('should execute a simple command', async () => {
      const result = await toolRunner.execute('run_command', {
        command: 'echo "hello world"',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('hello world');
    });

    it('should block dangerous commands', async () => {
      const result = await toolRunner.execute('run_command', {
        command: 'rm -rf /',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked by guardrails');
    });

    it('should return error for failed commands', async () => {
      const result = await toolRunner.execute('run_command', {
        command: 'exit 1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('exited with code 1');
    });
  });

  describe('read_file', () => {
    it('should read file contents', async () => {
      const testFile = path.join(testDir, 'test.txt');
      await fs.writeFile(testFile, 'test content', 'utf-8');

      const result = await toolRunner.execute('read_file', {
        path: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('test content');
    });

    it('should return error for non-existent file', async () => {
      const result = await toolRunner.execute('read_file', {
        path: 'nonexistent.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read file');
    });
  });

  describe('write_file', () => {
    it('should write content to file', async () => {
      const result = await toolRunner.execute('write_file', {
        path: 'output.txt',
        content: 'new content',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(
        path.join(testDir, 'output.txt'),
        'utf-8'
      );
      expect(content).toBe('new content');
    });

    it('should create nested directories', async () => {
      const result = await toolRunner.execute('write_file', {
        path: 'nested/dir/file.txt',
        content: 'nested content',
      });

      expect(result.success).toBe(true);

      const content = await fs.readFile(
        path.join(testDir, 'nested/dir/file.txt'),
        'utf-8'
      );
      expect(content).toBe('nested content');
    });

    it('should block writing to protected paths', async () => {
      const result = await toolRunner.execute('write_file', {
        path: '.ophan/criteria/quality.md',
        content: 'malicious content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('protected file');
    });
  });

  describe('list_files', () => {
    it('should list files in directory', async () => {
      await fs.writeFile(path.join(testDir, 'file1.txt'), '', 'utf-8');
      await fs.writeFile(path.join(testDir, 'file2.txt'), '', 'utf-8');
      await fs.mkdir(path.join(testDir, 'subdir'));

      const result = await toolRunner.execute('list_files', {});

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.txt');
      expect(result.output).toContain('subdir/');
    });
  });

  describe('search_files', () => {
    it('should find pattern in files', async () => {
      await fs.writeFile(
        path.join(testDir, 'search.txt'),
        'line 1\nfind me here\nline 3',
        'utf-8'
      );

      const result = await toolRunner.execute('search_files', {
        pattern: 'find me',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('search.txt');
      expect(result.output).toContain('find me here');
    });
  });

  describe('task_complete', () => {
    it('should return success with summary', async () => {
      const result = await toolRunner.execute('task_complete', {
        summary: 'Task completed successfully',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Task completed successfully');
    });
  });

  describe('getToolOutputs', () => {
    it('should accumulate tool outputs', async () => {
      await toolRunner.execute('run_command', { command: 'echo "first"' });
      await toolRunner.execute('run_command', { command: 'echo "second"' });

      const outputs = toolRunner.getToolOutputs();

      expect(outputs).toContain('first');
      expect(outputs).toContain('second');
    });

    it('should clear outputs when requested', async () => {
      await toolRunner.execute('run_command', { command: 'echo "test"' });
      toolRunner.clearToolOutputs();

      const outputs = toolRunner.getToolOutputs();
      expect(outputs).toBe('');
    });
  });
});
