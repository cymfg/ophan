/**
 * Ophan UI Server
 *
 * Lightweight local web server for viewing status, logs, and editing configuration.
 */

import express, { type Express, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { loadConfig, saveConfig, loadState, saveState } from '../cli/utils/config.js';
import type { OphanStateOutput } from '../types/state.js';
import type { Task, Evaluation, EscalationPayload, Proposal } from '../types/index.js';
import { InnerLoop } from '../core/inner-loop.js';
import { TaskLogger } from '../core/task-logger.js';
import { ContextLogger } from '../core/context-logger.js';
import { OuterLoop } from '../core/outer-loop.js';
import { loadGoalFiles } from '../core/goal-parser.js';
import { OrchestratorAgent } from '../core/agents/orchestrator-agent.js';
import type { ActionResult } from '../core/orchestrator/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find the public directory for static assets.
 * Works both in development (src/ui/public) and when installed from npm (dist/ui/public).
 */
function findPublicDir(): string {
  // In development: __dirname is src/ui, public is at src/ui/public
  const devPath = path.join(__dirname, 'public');
  if (existsSync(devPath)) {
    return devPath;
  }

  // When bundled: __dirname is dist/cli, public is at dist/ui/public
  const distPath = path.join(__dirname, '..', 'ui', 'public');
  if (existsSync(distPath)) {
    return distPath;
  }

  // Fallback to dev path (will error with clear message if not found)
  return devPath;
}

const publicDir = findPublicDir();

export interface UIServerOptions {
  projectRoot: string;
  port: number;
  open?: boolean;
}

export interface UIServer {
  app: Express;
  server: Server;
  wss: WebSocketServer;
  port: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  broadcast: (event: string, data: unknown) => void;
}

/**
 * Create and configure the UI server
 */
export function createUIServer(options: UIServerOptions): UIServer {
  const { projectRoot, port } = options;
  const ophanDir = path.join(projectRoot, '.ophan');

  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Track connected clients
  const clients = new Set<WebSocket>();

  // Chat state
  let orchestratorAgent: OrchestratorAgent | null = null;
  let chatProcessing = false;

  async function getOrInitOrchestrator(): Promise<OrchestratorAgent> {
    if (orchestratorAgent) {
      // Refresh state on each access so the orchestrator sees latest dev agent activity
      const state = loadState(projectRoot);
      orchestratorAgent.setState(state);
      return orchestratorAgent;
    }

    const config = loadConfig(projectRoot);
    const state = loadState(projectRoot);

    orchestratorAgent = new OrchestratorAgent();
    await orchestratorAgent.initialize({
      projectRoot,
      ophanDir,
      config,
      onProgress: (msg: string) => broadcast('chat:progress', { message: msg }),
    });
    orchestratorAgent.setState(state);

    return orchestratorAgent;
  }

  async function handleChatEvent(
    ws: WebSocket,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const send = (evt: string, d: unknown): void => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ event: evt, data: d }));
      }
    };

    switch (event) {
      case 'chat:start': {
        try {
          const agent = await getOrInitOrchestrator();
          const existingId = agent.getSessionId();

          if (!existingId) {
            await agent.setupSession({ resume: data.resume as boolean });
          }

          // Load session history for the client
          const sid = agent.getSessionId()!;
          const sessionPath = path.join(
            ophanDir, 'agents', 'orchestrator', 'sessions', `${sid}.json`,
          );
          let messages: unknown[] = [];
          try {
            const content = await fs.readFile(sessionPath, 'utf-8');
            const session = JSON.parse(content) as { messages?: unknown[] };
            messages = session.messages ?? [];
          } catch {
            // New session — no history
          }

          send('chat:session', { sessionId: sid, messages, isNew: messages.length === 0 });
        } catch (err) {
          send('chat:error', { error: String(err) });
        }
        break;
      }

      case 'chat:send': {
        if (chatProcessing) {
          send('chat:error', { error: 'A message is already being processed. Please wait.' });
          return;
        }
        chatProcessing = true;
        try {
          const agent = await getOrInitOrchestrator();
          if (!agent.getSessionId()) {
            await agent.setupSession();
          }

          send('chat:thinking', { sessionId: agent.getSessionId() });

          const response = await agent.processMessage(data.message as string);

          send('chat:response', {
            text: response.text,
            actions: response.actions,
            awaitingConfirmation: response.awaitingConfirmation,
            sessionId: agent.getSessionId(),
          });
        } catch (err) {
          send('chat:error', { error: String(err) });
        } finally {
          chatProcessing = false;
        }
        break;
      }

      case 'chat:confirm': {
        try {
          const agent = await getOrInitOrchestrator();
          if (data.confirm) {
            const results = await agent.confirmActions();
            send('chat:actions_result', { results });

            // Auto-execute any newly created goals
            for (const result of results) {
              if (result.success && result.artifactPath?.includes('/goals/')) {
                try {
                  const goalContent = await fs.readFile(result.artifactPath, 'utf-8');
                  const titleMatch = goalContent.match(/title:\s*(.+)/);
                  const descMatch = goalContent.match(/description:\s*(.+)/);
                  const taskDesc = descMatch?.[1]?.trim() ?? titleMatch?.[1]?.trim() ?? 'Execute goal';
                  const taskTitle = titleMatch?.[1]?.trim() ?? 'New goal';

                  send('chat:system_message', {
                    message: `Starting work on "${taskTitle}"...`,
                    type: 'task_starting',
                  });

                  await prepareAndRunTask(taskDesc);
                } catch {
                  // Goal file couldn't be read — not critical
                }
              }
            }
          } else {
            agent.cancelActions();
            send('chat:actions_result', {
              results: [{ success: true, message: 'Actions cancelled.' }] satisfies ActionResult[],
            });
          }
        } catch (err) {
          send('chat:error', { error: String(err) });
        }
        break;
      }

      case 'chat:end': {
        try {
          if (orchestratorAgent) {
            await orchestratorAgent.endSession();
          }
          send('chat:session', { sessionId: null, messages: [], isNew: true });
        } catch (err) {
          send('chat:error', { error: String(err) });
        }
        break;
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', async (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as { event: string; data: Record<string, unknown> };
        if (parsed.event?.startsWith('chat:')) {
          await handleChatEvent(ws, parsed.event, parsed.data ?? {});
        }
      } catch (err) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ event: 'chat:error', data: { error: String(err) } }));
        }
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  // Middleware
  app.use(express.json());
  app.use(express.static(publicDir));

  // API Routes

  /**
   * GET /api/status - Get current metrics and status
   */
  app.get('/api/status', async (_req: Request, res: Response) => {
    try {
      const config = loadConfig(projectRoot);
      const state = loadState(projectRoot);
      const projectName = path.basename(projectRoot);

      // Calculate metrics from state
      const metrics = await calculateMetrics(ophanDir, state);

      // Goals summary
      const activeGoals = state.goals.filter(
        (g) => !['completed', 'abandoned'].includes(g.status)
      ).length;
      const completedGoals = state.goals.filter((g) => g.status === 'completed').length;
      const goalsTotalCost = state.goals.reduce((sum, g) => sum + (g.totalCost ?? 0), 0);

      res.json({
        projectName,
        projectPath: projectRoot,
        config: {
          claudeCode: config.claudeCode,
          innerLoop: config.innerLoop,
          outerLoop: {
            triggers: config.outerLoop.triggers,
            minOccurrences: config.outerLoop.minOccurrences,
            minConfidence: config.outerLoop.minConfidence,
          },
        },
        state: {
          lastReview: state.lastReview,
          tasksSinceReview: state.tasksSinceReview,
          pendingProposals: state.pendingProposals?.length ?? 0,
        },
        goals: {
          active: activeGoals,
          completed: completedGoals,
          total: state.goals.length,
          totalCost: goalsTotalCost,
        },
        metrics,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/config - Get full configuration
   */
  app.get('/api/config', async (_req: Request, res: Response) => {
    try {
      const config = loadConfig(projectRoot);
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * PUT /api/config - Update configuration
   */
  app.put('/api/config', async (req: Request, res: Response) => {
    try {
      const newConfig = req.body;
      saveConfig(projectRoot, newConfig);

      // Broadcast config update to all connected clients
      broadcast('config:updated', newConfig);

      res.json({ success: true, config: newConfig });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  /**
   * GET /api/logs - Get task logs with pagination
   */
  app.get('/api/logs', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const logsDir = path.join(ophanDir, 'agents', 'dev', 'logs');
      const logs = await loadTaskLogs(logsDir, limit, offset);

      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/logs/:id - Get a specific task log
   */
  app.get('/api/logs/:id', async (req: Request, res: Response) => {
    try {
      const logFile = path.join(ophanDir, 'agents', 'dev', 'logs', `${req.params.id}.json`);
      const content = await fs.readFile(logFile, 'utf-8');
      res.json(JSON.parse(content));
    } catch (error) {
      res.status(404).json({ error: 'Log not found' });
    }
  });

  /**
   * GET /api/digests - Get list of digests
   */
  app.get('/api/digests', async (_req: Request, res: Response) => {
    try {
      const digestsDir = path.join(ophanDir, 'agents', 'dev', 'digests');
      const digests = await loadDigests(digestsDir);
      res.json(digests);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/digests/:filename - Get a specific digest
   */
  app.get('/api/digests/:filename', async (req: Request, res: Response) => {
    try {
      const filename = req.params.filename as string;
      const digestFile = path.join(ophanDir, 'agents', 'dev', 'digests', filename);
      const content = await fs.readFile(digestFile, 'utf-8');
      res.json({ filename, content });
    } catch (error) {
      res.status(404).json({ error: 'Digest not found' });
    }
  });

  /**
   * GET /api/guidelines - Get guidelines content
   */
  app.get('/api/guidelines', async (_req: Request, res: Response) => {
    try {
      const guidelinesDir = path.join(ophanDir, 'guidelines');
      const files = await fs.readdir(guidelinesDir);
      const guidelines: Record<string, string> = {};

      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = await fs.readFile(
            path.join(guidelinesDir, file),
            'utf-8'
          );
          guidelines[file] = content;
        }
      }

      res.json(guidelines);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/criteria - Get criteria content
   */
  app.get('/api/criteria', async (_req: Request, res: Response) => {
    try {
      const criteriaDir = path.join(ophanDir, 'criteria');
      const files = await fs.readdir(criteriaDir);
      const criteria: Record<string, string> = {};

      for (const file of files) {
        if (file.endsWith('.md')) {
          const content = await fs.readFile(
            path.join(criteriaDir, file),
            'utf-8'
          );
          criteria[file] = content;
        }
      }

      res.json(criteria);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/learnings - Get learnings
   */
  app.get('/api/learnings', async (_req: Request, res: Response) => {
    try {
      const state = loadState(projectRoot);
      res.json(state.learnings ?? []);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/goals - Get goals with runtime state
   */
  app.get('/api/goals', async (_req: Request, res: Response) => {
    try {
      const goalsDir = path.join(ophanDir, 'goals');
      const goalFiles = await loadGoalFiles(goalsDir);
      const state = loadState(projectRoot);

      const goals = goalFiles.map((gf) => {
        const gs = state.goals.find((g) => g.goalId === gf.id);
        const completedTasks = gs?.tasks.filter((t) => t.status === 'converged').length ?? 0;
        return {
          id: gf.id,
          title: gf.title,
          description: gf.description,
          priority: gf.priority,
          tags: gf.tags,
          dependsOn: gf.dependsOn,
          acceptanceCriteria: gf.acceptanceCriteria,
          status: gs?.status ?? 'pending',
          tasks: gs?.tasks ?? [],
          taskProgress: gs ? `${completedTasks}/${gs.tasks.length}` : 'no tasks',
          totalCost: gs?.totalCost ?? 0,
          startedAt: gs?.startedAt,
          completedAt: gs?.completedAt,
        };
      });

      // Include goals in state but not in files (deleted/orphaned)
      for (const gs of state.goals) {
        if (!goalFiles.find((gf) => gf.id === gs.goalId)) {
          const completedTasks = gs.tasks.filter((t) => t.status === 'converged').length;
          goals.push({
            id: gs.goalId,
            title: gs.goalId,
            description: '',
            priority: 5,
            tags: [],
            dependsOn: [],
            acceptanceCriteria: [],
            status: gs.status,
            tasks: gs.tasks,
            taskProgress: `${completedTasks}/${gs.tasks.length}`,
            totalCost: gs.totalCost,
            startedAt: gs.startedAt,
            completedAt: gs.completedAt,
          });
        }
      }

      res.json(goals);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/orchestrator/status - Get orchestrator agent status
   */
  app.get('/api/orchestrator/status', async (_req: Request, res: Response) => {
    try {
      const statePath = path.join(ophanDir, 'agents', 'orchestrator', 'state.json');
      const content = await fs.readFile(statePath, 'utf-8');
      res.json(JSON.parse(content));
    } catch {
      res.json({
        version: '0.1.0',
        goalsCreated: 0,
        guidelinesUpdated: 0,
        conversationsHandled: 0,
        proactiveAlertsSent: 0,
        supervisedGoalCompletionRate: 0,
        supervisedGoalIds: [],
        recentAlerts: [],
      });
    }
  });

  /**
   * GET /api/orchestrator/sessions - List orchestrator conversation sessions
   */
  app.get('/api/orchestrator/sessions', async (_req: Request, res: Response) => {
    try {
      const sessionsDir = path.join(ophanDir, 'agents', 'orchestrator', 'sessions');
      const files = await fs.readdir(sessionsDir);
      const sessionFiles = files
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 50);

      const sessions = [];
      for (const file of sessionFiles) {
        try {
          const content = await fs.readFile(path.join(sessionsDir, file), 'utf-8');
          const session = JSON.parse(content);
          const firstUserMsg = session.messages?.find((m: { role: string }) => m.role === 'user');
          sessions.push({
            id: session.id,
            startedAt: session.startedAt,
            lastActiveAt: session.lastActiveAt,
            messageCount: session.messages?.length ?? 0,
            preview: firstUserMsg?.content?.slice(0, 100) ?? '',
          });
        } catch {
          // Skip invalid session files
        }
      }

      res.json(sessions);
    } catch {
      res.json([]);
    }
  });

  /**
   * GET /api/orchestrator/sessions/:id - Get full session by ID
   */
  app.get('/api/orchestrator/sessions/:id', async (req: Request, res: Response) => {
    try {
      const sessionFile = path.join(
        ophanDir, 'agents', 'orchestrator', 'sessions', `${req.params.id}.json`
      );
      const content = await fs.readFile(sessionFile, 'utf-8');
      res.json(JSON.parse(content));
    } catch {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  /**
   * GET /api/orchestrator/memory - Get orchestrator memory
   */
  app.get('/api/orchestrator/memory', async (_req: Request, res: Response) => {
    try {
      const memoryPath = path.join(ophanDir, 'agents', 'orchestrator', 'memory.json');
      const content = await fs.readFile(memoryPath, 'utf-8');
      res.json(JSON.parse(content));
    } catch {
      res.json({ preferences: [], episodes: [], patterns: [] });
    }
  });

  // =========================================================================
  // Chat API (REST fallback for when WebSocket is unavailable)
  // =========================================================================

  /**
   * POST /api/chat/session - Start or resume a chat session
   */
  app.post('/api/chat/session', async (req: Request, res: Response) => {
    try {
      const { resume } = req.body as { resume?: boolean };
      const agent = await getOrInitOrchestrator();
      const sessionId = await agent.setupSession({ resume });
      res.json({ sessionId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/chat/message - Send a chat message
   */
  app.post('/api/chat/message', async (req: Request, res: Response) => {
    try {
      const { message } = req.body as { message?: string };
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      if (chatProcessing) {
        res.status(429).json({ error: 'A message is already being processed. Please wait.' });
        return;
      }
      chatProcessing = true;

      try {
        const agent = await getOrInitOrchestrator();
        if (!agent.getSessionId()) {
          await agent.setupSession();
        }

        broadcast('chat:thinking', { sessionId: agent.getSessionId() });
        const response = await agent.processMessage(message);

        broadcast('chat:response', {
          text: response.text,
          actions: response.actions,
          awaitingConfirmation: response.awaitingConfirmation,
          sessionId: agent.getSessionId(),
        });

        res.json(response);
      } finally {
        chatProcessing = false;
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/chat/confirm - Confirm or cancel pending actions
   */
  app.post('/api/chat/confirm', async (req: Request, res: Response) => {
    try {
      const { confirm } = req.body as { confirm?: boolean };
      const agent = await getOrInitOrchestrator();

      if (confirm) {
        const results = await agent.confirmActions();
        res.json({ results });

        // Auto-execute any newly created goals
        for (const result of results) {
          if (result.success && result.artifactPath?.includes('/goals/')) {
            try {
              const goalContent = await fs.readFile(result.artifactPath, 'utf-8');
              const titleMatch = goalContent.match(/title:\s*(.+)/);
              const descMatch = goalContent.match(/description:\s*(.+)/);
              const taskDesc = descMatch?.[1]?.trim() ?? titleMatch?.[1]?.trim() ?? 'Execute goal';
              const taskTitle = titleMatch?.[1]?.trim() ?? 'New goal';

              broadcast('chat:system_message', {
                message: `Starting work on "${taskTitle}"...`,
                type: 'task_starting',
              });

              await prepareAndRunTask(taskDesc);
            } catch {
              // Goal file couldn't be read — not critical
            }
          }
        }
      } else {
        agent.cancelActions();
        res.json({ results: [{ success: true, message: 'Actions cancelled.' }] });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * DELETE /api/chat/session - End the current chat session
   */
  app.delete('/api/chat/session', async (_req: Request, res: Response) => {
    try {
      if (orchestratorAgent) {
        await orchestratorAgent.endSession();
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/context-stats - Get context usage statistics
   */
  app.get('/api/context-stats', async (req: Request, res: Response) => {
    try {
      const lookbackDays = parseInt(req.query.days as string) || 30;
      const contextLogger = new ContextLogger({ ophanDir });
      const metrics = await contextLogger.getAggregateMetrics(lookbackDays);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * GET /api/proposals - Get pending proposals
   */
  app.get('/api/proposals', async (_req: Request, res: Response) => {
    try {
      const state = loadState(projectRoot);
      res.json(state.pendingProposals ?? []);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/proposals/:id/approve - Approve a proposal
   */
  app.post('/api/proposals/:id/approve', async (req: Request, res: Response) => {
    try {
      const proposalId = req.params.id;
      const { feedback } = req.body || {};
      const state = loadState(projectRoot);

      const proposal = state.pendingProposals?.find((p: Proposal) => p.id === proposalId);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }

      // Apply the proposal change
      const targetPath = path.join(ophanDir, proposal.targetFile);
      try {
        let existingContent = '';
        try {
          existingContent = await fs.readFile(targetPath, 'utf-8');
        } catch {
          // File doesn't exist yet
        }

        // Handle APPEND directive
        let newContent = proposal.change;
        if (proposal.change.startsWith('APPEND:')) {
          newContent = existingContent + '\n' + proposal.change.replace('APPEND:', '').trim();
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, newContent, 'utf-8');
      } catch (error) {
        res.status(500).json({ error: `Failed to apply change: ${String(error)}` });
        return;
      }

      // Update proposal status
      proposal.status = 'approved';
      proposal.reviewedAt = new Date().toISOString();
      if (feedback) {
        proposal.humanFeedback = feedback;
      }

      // Remove from pending
      state.pendingProposals = state.pendingProposals?.filter((p: Proposal) => p.id !== proposalId) ?? [];
      saveState(projectRoot, state);

      broadcast('proposal:approved', { proposal });
      res.json({ success: true, proposal });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/proposals/:id/reject - Reject a proposal
   */
  app.post('/api/proposals/:id/reject', async (req: Request, res: Response) => {
    try {
      const proposalId = req.params.id;
      const { feedback } = req.body || {};
      const state = loadState(projectRoot);

      const proposal = state.pendingProposals?.find((p: Proposal) => p.id === proposalId);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }

      // Update proposal status
      proposal.status = 'rejected';
      proposal.reviewedAt = new Date().toISOString();
      if (feedback) {
        proposal.humanFeedback = feedback;
      }

      // Remove from pending
      state.pendingProposals = state.pendingProposals?.filter((p: Proposal) => p.id !== proposalId) ?? [];
      saveState(projectRoot, state);

      broadcast('proposal:rejected', { proposal });
      res.json({ success: true, proposal });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Track running review
  let runningReview: {
    startedAt: string;
    status: 'running' | 'completed' | 'failed';
  } | null = null;

  /**
   * GET /api/review/status - Get current review status
   */
  app.get('/api/review/status', (_req: Request, res: Response) => {
    if (runningReview) {
      res.json({ running: runningReview.status === 'running', ...runningReview });
    } else {
      res.json({ running: false });
    }
  });

  /**
   * POST /api/review - Trigger outer loop review
   */
  app.post('/api/review', async (_req: Request, res: Response) => {
    try {
      if (runningReview?.status === 'running') {
        res.status(409).json({ error: 'A review is already running' });
        return;
      }

      const config = loadConfig(projectRoot);
      const state = loadState(projectRoot);
      const projectName = path.basename(projectRoot);

      runningReview = {
        startedAt: new Date().toISOString(),
        status: 'running',
      };

      broadcast('review:started', { startedAt: runningReview.startedAt });

      // Return immediately, review runs in background
      res.json({ success: true, message: 'Review started' });

      // Run review in background
      try {
        const outerLoop = new OuterLoop({
          projectRoot,
          projectName,
          ophanDir,
          config,
          state,
          onProgress: (message: string) => {
            broadcast('review:progress', { message });
          },
        });

        const result = await outerLoop.execute({ autoApplyGuidelines: false });

        // Update state with new proposals
        const updatedState = loadState(projectRoot);
        updatedState.pendingProposals = [
          ...(updatedState.pendingProposals ?? []),
          ...result.proposalsGenerated,
        ];
        updatedState.lastReview = new Date().toISOString();
        updatedState.tasksSinceReview = 0;
        saveState(projectRoot, updatedState);

        runningReview.status = 'completed';
        broadcast('review:completed', {
          patternsDetected: result.patternsDetected.length,
          proposalsGenerated: result.proposalsGenerated.length,
          guidelinesUpdated: result.guidelinesUpdated,
          digestPath: result.digestPath,
        });
      } catch (error) {
        runningReview.status = 'failed';
        broadcast('review:error', { error: String(error) });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Track running task
  let runningTask: {
    task: Task;
    abortController?: AbortController;
  } | null = null;

  /**
   * GET /api/task/current - Get currently running task status
   */
  app.get('/api/task/current', (_req: Request, res: Response) => {
    if (runningTask) {
      res.json({
        running: true,
        task: runningTask.task,
      });
    } else {
      res.json({ running: false });
    }
  });

  /**
   * Prepare and launch a task in the background.
   * Shared by POST /api/task and chat goal auto-execution.
   * Returns the initial task, or null if a task is already running.
   */
  async function prepareAndRunTask(description: string): Promise<Task | null> {
    if (runningTask) {
      broadcast('chat:system_message', {
        message: 'A task is already running. The goal has been saved and will be picked up next.',
        type: 'task_queued',
      });
      return null;
    }

    const config = loadConfig(projectRoot);
    const projectName = path.basename(projectRoot);
    const guidelines = await loadGuidelinesContent(ophanDir);
    const criteria = await loadCriteriaContent(ophanDir);
    const learnings = await loadLearningsContent(ophanDir);

    const taskLogger = new TaskLogger({ ophanDir });
    await taskLogger.init();

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const initialTask: Task = {
      id: taskId,
      description,
      status: 'running',
      iterations: 0,
      maxIterations: config.innerLoop.maxIterations,
      startedAt: new Date().toISOString(),
      cost: 0,
      tokensUsed: 0,
    };

    runningTask = { task: initialTask };
    broadcast('task:started', { task: initialTask });

    runTaskInBackground(
      description,
      config,
      projectName,
      ophanDir,
      guidelines,
      criteria,
      learnings,
      taskLogger,
      broadcast,
      (task: Task) => {
        if (runningTask) {
          runningTask.task = task;
        }
      },
      () => {
        runningTask = null;
      },
    );

    return initialTask;
  }

  /**
   * POST /api/task - Start a new task
   */
  app.post('/api/task', async (req: Request, res: Response) => {
    try {
      const { description } = req.body;

      if (!description || typeof description !== 'string') {
        res.status(400).json({ error: 'Task description is required' });
        return;
      }

      if (runningTask) {
        res.status(409).json({
          error: 'A task is already running',
          task: runningTask.task,
        });
        return;
      }

      const task = await prepareAndRunTask(description);
      res.json({ success: true, message: 'Task started', task });
    } catch (error) {
      runningTask = null;
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/task/cancel - Cancel the running task
   */
  app.post('/api/task/cancel', (_req: Request, res: Response) => {
    if (!runningTask) {
      res.status(404).json({ error: 'No task is running' });
      return;
    }

    // Mark task as cancelled (note: actual cancellation would need AbortController support in InnerLoop)
    runningTask.task.status = 'failed';
    broadcast('task:cancelled', { task: runningTask.task });
    runningTask = null;

    res.json({ success: true, message: 'Task cancellation requested' });
  });

  /**
   * Run task in background and broadcast progress
   */
  async function runTaskInBackground(
    description: string,
    config: ReturnType<typeof loadConfig>,
    projectName: string,
    ophanDir: string,
    guidelines: string,
    criteria: string,
    learnings: string,
    taskLogger: TaskLogger,
    broadcastFn: (event: string, data: unknown) => void,
    updateTask: (task: Task) => void,
    onComplete: () => void
  ): Promise<void> {
    try {
      const innerLoop = new InnerLoop({
        projectRoot,
        projectName,
        ophanDir,
        config,
        guidelines,
        criteria,
        learnings,
        onProgress: (message: string) => {
          broadcastFn('task:progress', { message });
        },
        onIteration: (iteration: number, evaluation: Evaluation) => {
          broadcastFn('task:iteration', {
            iteration,
            maxIterations: config.innerLoop.maxIterations,
            passed: evaluation.passed,
            score: evaluation.score,
            failures: evaluation.failures,
          });
        },
        onEscalation: (
          task: Task,
          reason: EscalationPayload['reason'],
          context: EscalationPayload['context']
        ) => {
          broadcastFn('task:escalation', {
            task,
            reason,
            context,
          });
        },
      });

      const result = await innerLoop.execute(description);

      // Update task reference
      updateTask(result.task);

      // Save task log
      await taskLogger.saveTaskLog(result.task, result.logs);

      // Save learnings and update state
      const state = loadState(projectRoot);
      for (const learning of result.learnings) {
        await taskLogger.saveLearning(learning);
        state.learnings.push(learning);
      }

      // Update metrics
      state.tasksSinceReview += 1;
      state.metrics.totalTasks += 1;

      if (result.task.status === 'converged') {
        state.metrics.successfulTasks += 1;
      } else if (result.task.status === 'failed') {
        state.metrics.failedTasks += 1;
      } else if (result.task.status === 'escalated') {
        state.metrics.escalatedTasks += 1;
      }

      state.metrics.totalCost += result.task.cost ?? 0;
      state.metrics.totalTokensUsed += result.task.tokensUsed ?? 0;

      saveState(projectRoot, state);

      // Broadcast completion
      broadcastFn('task:completed', {
        task: result.task,
        learnings: result.learnings.length,
        finalEvaluation: result.finalEvaluation,
      });
    } catch (error) {
      broadcastFn('task:error', {
        error: String(error),
      });
    } finally {
      onComplete();
    }
  }

  // Serve index.html for all non-API routes (SPA fallback)
  // Express 5 uses path-to-regexp v8 which requires named parameters
  app.get('/{*path}', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Broadcast function
  function broadcast(event: string, data: unknown): void {
    const message = JSON.stringify({ event, data });
    for (const client of clients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(message);
      }
    }
  }

  return {
    app,
    server,
    wss,
    port,
    start: async () => {
      return new Promise((resolve) => {
        server.listen(port, () => {
          resolve();
        });
      });
    },
    stop: async () => {
      // End orchestrator session if active
      if (orchestratorAgent) {
        try { await orchestratorAgent.endSession(); } catch { /* ignore */ }
      }

      return new Promise((resolve, reject) => {
        // Close all WebSocket connections
        for (const client of clients) {
          client.close();
        }
        wss.close();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    broadcast,
  };
}

/**
 * Calculate metrics from task logs
 */
async function calculateMetrics(
  ophanDir: string,
  state: OphanStateOutput
): Promise<Record<string, unknown>> {
  const logsDir = path.join(ophanDir, 'agents', 'dev', 'logs');

  try {
    const files = await fs.readdir(logsDir);
    const logFiles = files.filter((f) => f.endsWith('.json'));

    let totalTasks = 0;
    let successfulTasks = 0;
    let failedTasks = 0;
    let escalatedTasks = 0;
    let totalIterations = 0;
    let totalCost = 0;

    for (const file of logFiles) {
      try {
        const content = await fs.readFile(path.join(logsDir, file), 'utf-8');
        const log = JSON.parse(content);

        totalTasks++;
        totalIterations += log.task?.iterations ?? 1;
        totalCost += log.task?.cost ?? 0;

        switch (log.task?.status) {
          case 'converged':
            successfulTasks++;
            break;
          case 'escalated':
            escalatedTasks++;
            break;
          case 'failed':
            failedTasks++;
            break;
        }
      } catch {
        // Skip invalid log files
      }
    }

    return {
      totalTasks,
      successfulTasks,
      failedTasks,
      escalatedTasks,
      successRate:
        totalTasks > 0
          ? ((successfulTasks / totalTasks) * 100).toFixed(1)
          : '0.0',
      averageIterations:
        totalTasks > 0 ? (totalIterations / totalTasks).toFixed(1) : '0.0',
      totalCost: totalCost.toFixed(2),
      averageCostPerTask:
        totalTasks > 0 ? (totalCost / totalTasks).toFixed(2) : '0.00',
      activeLearnings: state.learnings?.length ?? 0,
    };
  } catch {
    return {
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      escalatedTasks: 0,
      successRate: '0.0',
      averageIterations: '0.0',
      totalCost: '0.00',
      averageCostPerTask: '0.00',
      activeLearnings: 0,
    };
  }
}

/**
 * Load task logs with pagination
 */
async function loadTaskLogs(
  logsDir: string,
  limit: number,
  offset: number
): Promise<{ logs: unknown[]; total: number }> {
  try {
    const files = await fs.readdir(logsDir);
    const logFiles = files
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    const total = logFiles.length;
    const paginatedFiles = logFiles.slice(offset, offset + limit);

    const logs = await Promise.all(
      paginatedFiles.map(async (file) => {
        const content = await fs.readFile(path.join(logsDir, file), 'utf-8');
        const log = JSON.parse(content);
        return {
          id: file.replace('.json', ''),
          ...log.task,
          iterationCount: log.iterations?.length ?? 0,
        };
      })
    );

    return { logs, total };
  } catch {
    return { logs: [], total: 0 };
  }
}

/**
 * Load digests
 */
async function loadDigests(
  digestsDir: string
): Promise<{ digests: unknown[]; total: number }> {
  try {
    const files = await fs.readdir(digestsDir);
    const digestFiles = files
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse();

    const digests = digestFiles.map((file) => ({
      filename: file,
      date: file.replace('.md', ''),
    }));

    return { digests, total: digests.length };
  } catch {
    return { digests: [], total: 0 };
  }
}

/**
 * Load guidelines content as a single string
 */
async function loadGuidelinesContent(ophanDir: string): Promise<string> {
  const guidelinesDir = path.join(ophanDir, 'guidelines');
  const parts: string[] = [];

  try {
    const files = await fs.readdir(guidelinesDir);
    for (const file of files.filter((f) => f.endsWith('.md'))) {
      const content = await fs.readFile(path.join(guidelinesDir, file), 'utf-8');
      parts.push(`# ${file}\n\n${content}`);
    }
  } catch {
    // Directory may not exist
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Load criteria content as a single string
 */
async function loadCriteriaContent(ophanDir: string): Promise<string> {
  const criteriaDir = path.join(ophanDir, 'criteria');
  const parts: string[] = [];

  try {
    const files = await fs.readdir(criteriaDir);
    for (const file of files.filter((f) => f.endsWith('.md'))) {
      const content = await fs.readFile(path.join(criteriaDir, file), 'utf-8');
      parts.push(`# ${file}\n\n${content}`);
    }
  } catch {
    // Directory may not exist
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Load learnings content
 */
async function loadLearningsContent(ophanDir: string): Promise<string> {
  const learningsFile = path.join(ophanDir, 'guidelines', 'learnings.md');

  try {
    return await fs.readFile(learningsFile, 'utf-8');
  } catch {
    return '';
  }
}
