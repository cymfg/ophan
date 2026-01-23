/**
 * Interactive Reviewer for Ophan Proposals
 *
 * Provides an interactive CLI flow for reviewing proposals from both
 * the Task Execution Agent and the Context Agent.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import type { Proposal, ReviewResult } from '../../types/index.js';
import { logger } from './logger.js';

// Brand color: Ophan gold (#B9A46D)
const gold = chalk.hex('#B9A46D');

export interface InteractiveReviewerOptions {
  projectRoot: string;
  /** Auto-approve guideline changes (still require approval for criteria) */
  autoApproveGuidelines?: boolean;
  /** Non-interactive mode - skip all, save to pending */
  nonInteractive?: boolean;
}

export type ReviewAction = 'approve' | 'reject' | 'edit' | 'skip' | 'quit';

/**
 * Interactive reviewer for human-in-the-loop proposal review
 */
export class InteractiveReviewer {
  private options: InteractiveReviewerOptions;

  constructor(options: InteractiveReviewerOptions) {
    this.options = options;
  }

  /**
   * Review a list of proposals interactively
   */
  async review(proposals: Proposal[]): Promise<ReviewResult> {
    const result: ReviewResult = {
      approved: [],
      rejected: [],
      skipped: [],
      summary: {
        totalReviewed: 0,
        approvedCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
        guidelinesUpdated: [],
        criteriaUpdated: [],
      },
    };

    if (proposals.length === 0) {
      logger.info('No proposals to review.');
      return result;
    }

    // Non-interactive mode: skip all proposals
    if (this.options.nonInteractive) {
      for (const proposal of proposals) {
        proposal.status = 'skipped';
        result.skipped.push(proposal);
        result.summary.skippedCount++;
      }
      result.summary.totalReviewed = proposals.length;
      return result;
    }

    // Display header
    console.log();
    console.log(gold.bold('Proposal Review'));
    console.log(gold('═'.repeat(50)));
    console.log();
    logger.info(`${proposals.length} proposal(s) to review`);
    console.log();

    // Group proposals by source
    const taskAgentProposals = proposals.filter(p => p.source === 'task-agent');
    const contextAgentProposals = proposals.filter(p => p.source === 'context-agent');

    if (taskAgentProposals.length > 0) {
      logger.info(`  Task Agent: ${taskAgentProposals.length} proposal(s)`);
    }
    if (contextAgentProposals.length > 0) {
      logger.info(`  Context Agent: ${contextAgentProposals.length} proposal(s)`);
    }
    console.log();

    // Review each proposal
    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i];
      const shouldAutoApprove =
        this.options.autoApproveGuidelines &&
        proposal.type === 'guideline';

      if (shouldAutoApprove) {
        // Auto-approve guidelines
        proposal.status = 'approved';
        proposal.reviewedAt = new Date().toISOString();
        await this.applyProposal(proposal);
        result.approved.push(proposal);
        result.summary.approvedCount++;
        result.summary.guidelinesUpdated.push(proposal.targetFile);
        logger.success(`Auto-approved: ${proposal.targetFile} (guideline)`);
      } else {
        // Interactive review
        this.displayProposal(proposal, i + 1, proposals.length);
        const action = await this.promptForAction(proposal);

        switch (action) {
          case 'approve':
            proposal.status = 'approved';
            proposal.reviewedAt = new Date().toISOString();
            await this.applyProposal(proposal);
            result.approved.push(proposal);
            result.summary.approvedCount++;
            if (proposal.type === 'guideline') {
              result.summary.guidelinesUpdated.push(proposal.targetFile);
            } else {
              result.summary.criteriaUpdated.push(proposal.targetFile);
            }
            logger.success(`Approved: ${proposal.targetFile}`);
            break;

          case 'reject':
            const feedback = await this.promptForFeedback('Why are you rejecting this proposal?');
            proposal.status = 'rejected';
            proposal.humanFeedback = feedback;
            proposal.reviewedAt = new Date().toISOString();
            result.rejected.push(proposal);
            result.summary.rejectedCount++;
            logger.warn(`Rejected: ${proposal.targetFile}`);
            break;

          case 'edit':
            const editedProposal = await this.editProposal(proposal);
            editedProposal.status = 'approved';
            editedProposal.reviewedAt = new Date().toISOString();
            await this.applyProposal(editedProposal);
            result.approved.push(editedProposal);
            result.summary.approvedCount++;
            if (editedProposal.type === 'guideline') {
              result.summary.guidelinesUpdated.push(editedProposal.targetFile);
            } else {
              result.summary.criteriaUpdated.push(editedProposal.targetFile);
            }
            logger.success(`Applied with edits: ${editedProposal.targetFile}`);
            break;

          case 'skip':
            proposal.status = 'skipped';
            result.skipped.push(proposal);
            result.summary.skippedCount++;
            logger.info(`Skipped: ${proposal.targetFile}`);
            break;

          case 'quit':
            // Skip remaining proposals
            for (let j = i; j < proposals.length; j++) {
              proposals[j].status = 'skipped';
              result.skipped.push(proposals[j]);
              result.summary.skippedCount++;
            }
            logger.info('Review session ended early.');
            result.summary.totalReviewed = proposals.length;
            return result;
        }
      }
      result.summary.totalReviewed++;
      console.log();
    }

    // Display summary
    this.displaySummary(result);

    return result;
  }

  /**
   * Display a proposal for review
   */
  private displayProposal(proposal: Proposal, current: number, total: number): void {
    console.log();
    console.log(gold('─'.repeat(50)));
    console.log(gold(`Proposal ${current}/${total}`));
    console.log(gold('─'.repeat(50)));
    console.log();

    const sourceLabel = proposal.source === 'task-agent'
      ? chalk.cyan('Task Agent')
      : chalk.magenta('Context Agent');

    const typeLabel = proposal.type === 'guideline'
      ? chalk.green('Guideline')
      : chalk.yellow('Criteria');

    logger.keyValue('Source', sourceLabel);
    logger.keyValue('Type', typeLabel);
    logger.keyValue('Target', proposal.targetFile);
    logger.keyValue('Confidence', `${(proposal.confidence * 100).toFixed(0)}%`);
    console.log();

    logger.section('Reason');
    console.log(chalk.dim(proposal.reason));
    console.log();

    logger.section('Proposed Change');
    // Display the change with syntax highlighting for markdown
    const changeLines = proposal.change.split('\n');
    for (const line of changeLines) {
      if (line.startsWith('#')) {
        console.log(chalk.bold(line));
      } else if (line.startsWith('```')) {
        console.log(chalk.gray(line));
      } else if (line.startsWith('- ')) {
        console.log(chalk.cyan(line));
      } else if (line.startsWith('+ ')) {
        console.log(chalk.green(line));
      } else {
        console.log(line);
      }
    }
    console.log();

    if (proposal.type === 'criteria') {
      console.log(chalk.yellow('⚠ This is a criteria change and requires human approval.'));
      console.log();
    }
  }

  /**
   * Prompt for review action
   */
  private async promptForAction(proposal: Proposal): Promise<ReviewAction> {
    const choices = [
      { name: '[A]pprove - Apply this change', value: 'approve', key: 'a' },
      { name: '[R]eject  - Decline with feedback', value: 'reject', key: 'r' },
      { name: '[E]dit    - Modify before applying', value: 'edit', key: 'e' },
      { name: '[S]kip    - Review later', value: 'skip', key: 's' },
      { name: '[Q]uit    - End review session', value: 'quit', key: 'q' },
    ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices,
        default: proposal.type === 'guideline' ? 'approve' : undefined,
      },
    ]);

    return action as ReviewAction;
  }

  /**
   * Prompt for feedback text
   */
  private async promptForFeedback(message: string): Promise<string> {
    const { feedback } = await inquirer.prompt([
      {
        type: 'input',
        name: 'feedback',
        message,
        validate: (input: string) => input.length > 0 || 'Please provide feedback',
      },
    ]);

    return feedback;
  }

  /**
   * Allow user to edit a proposal before applying
   */
  private async editProposal(proposal: Proposal): Promise<Proposal> {
    console.log();
    logger.info('Edit the proposed change below:');
    console.log(chalk.dim('(Enter your modified change, then press Enter twice to finish)'));
    console.log();

    const { editedChange } = await inquirer.prompt([
      {
        type: 'editor',
        name: 'editedChange',
        message: 'Edit the proposed change:',
        default: proposal.change,
      },
    ]);

    const { editNote } = await inquirer.prompt([
      {
        type: 'input',
        name: 'editNote',
        message: 'Add a note about your edits (optional):',
      },
    ]);

    return {
      ...proposal,
      change: editedChange,
      humanFeedback: editNote || 'Edited before applying',
    };
  }

  /**
   * Apply a proposal to the target file
   */
  private async applyProposal(proposal: Proposal): Promise<void> {
    const targetPath = path.join(this.options.projectRoot, '.ophan', proposal.targetFile);

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      // Read existing content if file exists
      let existingContent = '';
      try {
        existingContent = await fs.readFile(targetPath, 'utf-8');
      } catch {
        // File doesn't exist, that's fine
      }

      // Determine how to apply the change
      let newContent: string;

      if (proposal.change.includes('REPLACE:')) {
        // Full replacement
        const replaceMatch = proposal.change.match(/REPLACE:\s*([\s\S]*)/);
        newContent = replaceMatch ? replaceMatch[1].trim() : proposal.change;
      } else if (proposal.change.includes('APPEND:')) {
        // Append to existing
        const appendMatch = proposal.change.match(/APPEND:\s*([\s\S]*)/);
        const appendContent = appendMatch ? appendMatch[1].trim() : proposal.change;
        newContent = existingContent.trim() + '\n\n' + appendContent;
      } else if (proposal.change.includes('PREPEND:')) {
        // Prepend to existing
        const prependMatch = proposal.change.match(/PREPEND:\s*([\s\S]*)/);
        const prependContent = prependMatch ? prependMatch[1].trim() : proposal.change;
        newContent = prependContent + '\n\n' + existingContent.trim();
      } else {
        // Default: append the change as a new section
        if (existingContent) {
          newContent = existingContent.trim() + '\n\n' + proposal.change;
        } else {
          newContent = proposal.change;
        }
      }

      await fs.writeFile(targetPath, newContent, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to apply proposal to ${proposal.targetFile}: ${(error as Error).message}`);
    }
  }

  /**
   * Display review session summary
   */
  private displaySummary(result: ReviewResult): void {
    console.log();
    console.log(gold.bold('Review Summary'));
    console.log(gold('═'.repeat(30)));
    console.log();

    logger.keyValue('Total reviewed', result.summary.totalReviewed.toString());
    logger.keyValue('Approved', chalk.green(result.summary.approvedCount.toString()));
    logger.keyValue('Rejected', chalk.red(result.summary.rejectedCount.toString()));
    logger.keyValue('Skipped', chalk.yellow(result.summary.skippedCount.toString()));

    if (result.summary.guidelinesUpdated.length > 0) {
      console.log();
      logger.section('Guidelines Updated');
      for (const file of result.summary.guidelinesUpdated) {
        logger.listItem(file);
      }
    }

    if (result.summary.criteriaUpdated.length > 0) {
      console.log();
      logger.section('Criteria Updated');
      for (const file of result.summary.criteriaUpdated) {
        logger.listItem(file);
      }
    }

    if (result.summary.skippedCount > 0) {
      console.log();
      logger.warn(`${result.summary.skippedCount} proposal(s) saved to pending reviews.`);
      logger.info('Run `ophan review` again to review them.');
    }

    console.log();
  }
}
