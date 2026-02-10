/**
 * Prompt templates for the Ophan agent
 */

export interface TaskContext {
  taskDescription: string;
  projectRoot: string;
  guidelines: string;
  criteria: string;
  learnings: string;
  iteration: number;
  maxIterations: number;
  previousEvaluation?: string;
  regenerationStrategy: 'full' | 'informed' | 'incremental';
}

/**
 * System prompt for the inner loop agent
 */
export function buildSystemPrompt(context: TaskContext): string {
  const iterationInfo =
    context.iteration > 1
      ? `
## Current Iteration: ${context.iteration}/${context.maxIterations}

You are in iteration ${context.iteration}. Previous attempts have not fully satisfied the criteria.
${
  context.previousEvaluation
    ? `
### Previous Evaluation Feedback
${context.previousEvaluation}
`
    : ''
}

### Regeneration Strategy: ${context.regenerationStrategy}
${getRegenerationGuidance(context.regenerationStrategy)}
`
      : '';

  return `You are Ophan, a self-improving AI development agent. Your task is to complete the given work while following the guidelines and meeting the criteria.

## Your Guidelines (How to Work)
${context.guidelines}

## Quality Criteria (What Good Looks Like)
${context.criteria}

${
  context.learnings
    ? `## Learnings from Previous Tasks
${context.learnings}
`
    : ''
}

${iterationInfo}

## Project Context
Working directory: ${context.projectRoot}

## Tools Available
You have access to tools for:
- Running shell commands (tests, linting, builds)
- Reading and writing files
- Searching the codebase

## Important Instructions

1. **Understand First**: Read relevant files before making changes
2. **Follow Guidelines**: Your guidelines exist because of past learnings - follow them
3. **Meet Criteria**: Your work must satisfy all quality criteria
4. **Verify Once**: After making all changes, run verification ONE time (tests, type check, lint)
5. **Fix & Re-verify**: If verification found issues, fix them, then verify ONE more time
6. **Signal Completion**: Once verification passes, immediately say "TASK COMPLETE" with a 1-2 sentence summary

## Completion Protocol (CRITICAL — follow exactly)

Your workflow MUST follow this sequence:
  Understand → Plan → Implement → Verify → (Fix if needed → Verify again →) TASK COMPLETE

Rules:
- Do NOT run the same verification command more than twice
- Do NOT add features, refactoring, or improvements beyond what the task requires
- Do NOT explore the codebase after your changes are working
- Do NOT add extra validation, type annotations, documentation, PropTypes, or "nice to have" enhancements unless the task specifically asks for them
- Once you say "TASK COMPLETE", make ZERO additional tool calls
- Be surgical: change only what the task requires, nothing more

When you encounter an error:
1. Analyze what went wrong
2. Fix the specific issue
3. Verify the fix (one time)
4. If it passes → "TASK COMPLETE"

If you cannot complete the task after trying your best, explain what's blocking you.
`;
}

function getRegenerationGuidance(
  strategy: 'full' | 'informed' | 'incremental'
): string {
  switch (strategy) {
    case 'full':
      return `In "full" regeneration mode, you should approach this iteration fresh.
Discard your previous approach if it wasn't working and try a fundamentally different solution.
The goal is to improve your understanding and generate better output from scratch.`;

    case 'informed':
      return `In "informed" regeneration mode, keep structurally sound parts of previous work
but regenerate problematic sections. Focus on the specific areas that failed evaluation
while preserving what was working correctly.`;

    case 'incremental':
      return `In "incremental" mode, make targeted minimal edits to fix specific issues.
Only change what's necessary to pass the failing criteria. This is appropriate for
small fixes and adjustments, not fundamental problems.`;
  }
}

/**
 * Build the initial user message for a task
 */
export function buildTaskMessage(taskDescription: string): string {
  return `Please complete the following task:

${taskDescription}

Follow the Completion Protocol: Understand → Implement → Verify once → TASK COMPLETE.
Only change what the task requires. Do not add extras.`;
}

/**
 * Build a message with evaluation feedback for regeneration
 */
export function buildRegenerationMessage(
  taskDescription: string,
  evaluationFeedback: string,
  iteration: number
): string {
  return `## Iteration ${iteration} - Regeneration Required

The previous attempt did not fully satisfy the criteria. Here's the evaluation feedback:

${evaluationFeedback}

## Original Task
${taskDescription}

Please address the specific issues identified in the evaluation. Do not change anything else.

Follow the Completion Protocol: Fix the failures → Verify once → TASK COMPLETE.
Only fix what failed. Do not add extras or refactor working code.`;
}

/**
 * Build prompt for extracting learnings from a completed task
 */
export function buildLearningExtractionPrompt(
  taskDescription: string,
  iterations: number,
  evaluationHistory: string[],
  outcome: 'success' | 'failure' | 'escalated'
): string {
  return `Analyze this completed task and extract learnings that could improve future performance.

## Task
${taskDescription}

## Outcome
${outcome} after ${iterations} iteration(s)

## Evaluation History
${evaluationHistory.map((e, i) => `### Iteration ${i + 1}\n${e}`).join('\n\n')}

## Instructions
Extract 0-3 learnings from this task. Only extract learnings that are:
1. Generalizable to future tasks (not specific to this one task)
2. Actionable (can be applied in future work)
3. Not already covered in existing guidelines

For each learning, provide:
- A brief description of the learning
- The context that led to this learning
- How it should impact future guidelines

If there are no meaningful learnings to extract, return an empty list.

Respond in JSON format:
{
  "learnings": [
    {
      "content": "Brief description of the learning",
      "context": "What happened that led to this",
      "issue": "The problem encountered",
      "resolution": "How it was resolved",
      "guidelineImpact": "Which guideline this relates to and how to update it"
    }
  ]
}`;
}

/**
 * Build prompt for evaluating task output against criteria
 */
export function buildEvaluationPrompt(
  taskDescription: string,
  criteria: string,
  toolOutputs: string
): string {
  return `Evaluate whether the task output meets the quality criteria.

## Task
${taskDescription}

## Quality Criteria
${criteria}

## Tool Outputs from Task Execution
${toolOutputs}

## Instructions
Evaluate the work against each criterion. For each criterion:
1. Determine if it passed or failed
2. If failed, explain why with severity (error or warning)

Respond in JSON format:
{
  "passed": boolean,
  "score": number (0-100),
  "criteria": [
    {
      "name": "criterion name",
      "passed": boolean,
      "message": "explanation if failed",
      "severity": "error" | "warning"
    }
  ],
  "summary": "Brief overall assessment"
}`;
}
