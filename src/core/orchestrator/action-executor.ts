/**
 * Action Executor
 *
 * Writes to the shared filesystem on behalf of the Orchestrator.
 * Creates goals, updates guidelines, and proposes criteria changes.
 */

import { promises as fs } from 'fs';
import path from 'path';
import {
  serializeGoalFile,
  generateGoalId,
  type ParsedGoalFile,
} from '../goal-parser.js';
import { IdGenerator } from '../agents/utils.js';
import type { Proposal } from '../../types/index.js';
import type {
  ProposedAction,
  ActionResult,
  GoalCreationPayload,
  GuidelineUpdatePayload,
  CriteriaProposalPayload,
} from './types.js';

export interface ActionExecutorOptions {
  ophanDir: string;
  projectRoot: string;
}

export class ActionExecutor {
  constructor(private options: ActionExecutorOptions) {}

  /**
   * Execute a confirmed action.
   * All actions write to the shared filesystem so DevAgent picks them up.
   */
  async execute(action: ProposedAction): Promise<ActionResult> {
    switch (action.payload.type) {
      case 'create_goal':
        return this.createGoal(action.payload as GoalCreationPayload);
      case 'update_guideline':
        return this.updateGuideline(action.payload as GuidelineUpdatePayload);
      case 'propose_criteria_change':
        return this.proposeCriteriaChange(
          action.payload as CriteriaProposalPayload
        );
      case 'show_analysis':
        return { success: true, message: 'Analysis displayed' };
      default:
        return { success: false, message: 'Unknown action type' };
    }
  }

  /**
   * Create a goal file in .ophan/goals/.
   * DevAgent will pick it up on next `ophan dev` run.
   */
  private async createGoal(
    payload: GoalCreationPayload
  ): Promise<ActionResult> {
    const goalsDir = path.join(this.options.ophanDir, 'goals');
    await fs.mkdir(goalsDir, { recursive: true });

    const id = generateGoalId(payload.title);
    const goalFile: ParsedGoalFile = {
      id,
      title: payload.title,
      priority: payload.priority,
      tags: payload.tags,
      dependsOn: payload.dependsOn,
      description: payload.description,
      acceptanceCriteria: payload.acceptanceCriteria,
      filePath: path.join(goalsDir, `${id}.md`),
    };

    const content = serializeGoalFile(goalFile);
    await fs.writeFile(goalFile.filePath, content, 'utf-8');

    return {
      success: true,
      message: `Created goal "${payload.title}" at ${goalFile.filePath}`,
      artifactPath: goalFile.filePath,
    };
  }

  /**
   * Update a guideline file (G is freely updateable).
   */
  private async updateGuideline(
    payload: GuidelineUpdatePayload
  ): Promise<ActionResult> {
    const filePath = path.join(
      this.options.ophanDir,
      'guidelines',
      payload.file
    );

    try {
      let existing = '';
      try {
        existing = await fs.readFile(filePath, 'utf-8');
      } catch {
        // File doesn't exist yet — that's fine for append/replace_all
      }

      let newContent: string;

      switch (payload.operation) {
        case 'append':
          newContent = existing
            ? `${existing}\n\n${payload.content}`
            : payload.content;
          break;
        case 'replace_all':
          newContent = payload.content;
          break;
        case 'replace_section': {
          // Try to find and replace a section by heading
          const sectionMatch = payload.content.match(/^##?\s+(.+)/m);
          if (sectionMatch && existing) {
            const heading = sectionMatch[1].trim();
            const sectionRegex = new RegExp(
              `(##?\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?)(?=\\n##?\\s|$)`,
              'i'
            );
            if (sectionRegex.test(existing)) {
              newContent = existing.replace(sectionRegex, payload.content);
            } else {
              newContent = `${existing}\n\n${payload.content}`;
            }
          } else {
            newContent = existing
              ? `${existing}\n\n${payload.content}`
              : payload.content;
          }
          break;
        }
        default:
          newContent = existing
            ? `${existing}\n\n${payload.content}`
            : payload.content;
      }

      await fs.writeFile(filePath, newContent, 'utf-8');

      return {
        success: true,
        message: `Updated guideline: ${payload.file} (${payload.operation})`,
        artifactPath: filePath,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update guideline: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Create an EITL proposal for criteria changes.
   * Returns the proposal object to be saved to state.json by the caller.
   */
  createCriteriaProposal(payload: CriteriaProposalPayload): Proposal {
    return {
      id: IdGenerator.proposal('orch'),
      type: 'criteria',
      source: 'orchestrator',
      targetFile: payload.targetFile,
      change: payload.change,
      reason: payload.reason,
      confidence: payload.confidence,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
  }

  private async proposeCriteriaChange(
    payload: CriteriaProposalPayload
  ): Promise<ActionResult> {
    // The proposal will be added to state.json by the OrchestratorAgent
    // This method just returns success to signal the action was processed
    return {
      success: true,
      message: `Proposed criteria change for ${payload.targetFile} (will appear in pending proposals)`,
    };
  }
}
