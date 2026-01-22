import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createUIServer, type UIServer } from '../../src/ui/server.js';

describe('UI Server', () => {
  let testDir: string;
  let server: UIServer | null = null;
  let portCounter = 5000 + Math.floor(Math.random() * 1000);

  function getNextPort(): number {
    return portCounter++;
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `ophan-ui-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Create .ophan directory structure
    mkdirSync(join(testDir, '.ophan', 'guidelines'), { recursive: true });
    mkdirSync(join(testDir, '.ophan', 'criteria'), { recursive: true });
    mkdirSync(join(testDir, '.ophan', 'logs'), { recursive: true });
    mkdirSync(join(testDir, '.ophan', 'digests'), { recursive: true });

    // Create config file
    writeFileSync(
      join(testDir, '.ophan.yaml'),
      `model:
  name: claude-sonnet-4-20250514
  maxTokens: 4096
innerLoop:
  maxIterations: 5
  regenerationStrategy: informed
outerLoop:
  triggers:
    afterTasks: 10
  minOccurrences: 3
  minConfidence: 0.7
  lookbackDays: 30
`
    );

    // Create state file
    writeFileSync(
      join(testDir, '.ophan', 'state.json'),
      JSON.stringify({
        version: '0.1.0',
        lastReview: null,
        tasksSinceReview: 0,
        pendingProposals: [],
        learnings: [],
        metrics: {
          totalTasks: 0,
          successfulTasks: 0,
          failedTasks: 0,
          escalatedTasks: 0,
          successRate: 0,
          averageIterations: 0,
          maxIterationsHit: 0,
          totalTokensUsed: 0,
          totalCost: 0,
          averageCostPerTask: 0,
          averageTaskDuration: 0,
          totalTimeSpent: 0,
          totalLearnings: 0,
          learningsPromoted: 0,
          patternsDetected: 0,
          periodStart: new Date().toISOString(),
          periodEnd: new Date().toISOString(),
        },
      })
    );

    // Create sample guidelines
    writeFileSync(
      join(testDir, '.ophan', 'guidelines', 'coding.md'),
      '# Coding Guidelines\n\nBest practices for coding.'
    );

    // Create sample criteria
    writeFileSync(
      join(testDir, '.ophan', 'criteria', 'quality.md'),
      '# Quality Criteria\n\nStandards for quality.'
    );
  });

  afterEach(async () => {
    if (server && server.server.listening) {
      await server.stop();
    }
    server = null;
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('createUIServer', () => {
    it('should create a server with correct properties', () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      expect(server).toBeDefined();
      expect(server.app).toBeDefined();
      expect(server.server).toBeDefined();
      expect(server.wss).toBeDefined();
      expect(server.port).toBe(port);
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.broadcast).toBe('function');
    });

    it('should start and stop correctly', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      // Server should be listening
      expect(server.server.listening).toBe(true);

      await server.stop();

      // Server should not be listening
      expect(server.server.listening).toBe(false);
    });
  });

  describe('API endpoints', () => {
    it('should respond to /api/status', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/status`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.projectName).toBeDefined();
      expect(data.config).toBeDefined();
      expect(data.state).toBeDefined();
      expect(data.metrics).toBeDefined();
    });

    it('should respond to /api/config', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/config`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.model).toBeDefined();
      expect(data.model.name).toBe('claude-sonnet-4-20250514');
      expect(data.innerLoop).toBeDefined();
      expect(data.outerLoop).toBeDefined();
    });

    it('should respond to /api/guidelines', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/guidelines`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data['coding.md']).toBeDefined();
      expect(data['coding.md']).toContain('Coding Guidelines');
    });

    it('should respond to /api/criteria', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/criteria`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data['quality.md']).toBeDefined();
      expect(data['quality.md']).toContain('Quality Criteria');
    });

    it('should respond to /api/logs', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/logs`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.logs).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('should respond to /api/digests', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/digests`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.digests).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('should respond to /api/learnings', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/learnings`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toEqual([]);
    });

    it('should update config via PUT /api/config', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      // Get current config
      const getResponse = await fetch(`http://localhost:${port}/api/config`);
      const originalConfig = await getResponse.json();

      // Update config
      const updatedConfig = {
        ...originalConfig,
        innerLoop: {
          ...originalConfig.innerLoop,
          maxIterations: 10,
        },
      };

      const putResponse = await fetch(`http://localhost:${port}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });

      expect(putResponse.ok).toBe(true);

      // Verify config was updated
      const verifyResponse = await fetch(`http://localhost:${port}/api/config`);
      const verifyConfig = await verifyResponse.json();
      expect(verifyConfig.innerLoop.maxIterations).toBe(10);
    });

    it('should respond to GET /api/task/current when no task running', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/task/current`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.running).toBe(false);
    });

    it('should reject POST /api/task without description', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe('Task description is required');
    });

    it('should reject POST /api/task without API key', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      // Make sure ANTHROPIC_API_KEY is not set for this test
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      try {
        const response = await fetch(`http://localhost:${port}/api/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: 'test task' }),
        });

        expect(response.ok).toBe(false);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.error).toBe('ANTHROPIC_API_KEY environment variable is not set');
      } finally {
        if (originalKey) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        }
      }
    });

    it('should respond to POST /api/task/cancel when no task running', async () => {
      const port = getNextPort();
      server = createUIServer({
        projectRoot: testDir,
        port,
      });

      await server.start();

      const response = await fetch(`http://localhost:${port}/api/task/cancel`, {
        method: 'POST',
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe('No task is running');
    });
  });
});
