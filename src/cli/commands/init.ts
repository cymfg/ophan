import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import inquirer from 'inquirer';
import { logger } from '../utils/logger.js';
import { createSpinner } from '../utils/spinner.js';
import {
  findProjectRoot,
  isOphanInitialized,
  saveConfig,
  saveState,
  getOphanPaths,
} from '../utils/config.js';
import { isGitRepository, getGit, getProjectName } from '../utils/git.js';
import { DEFAULT_CONFIG } from '../../types/config.js';
import { createInitialState } from '../../types/state.js';

interface InitOptions {
  template?: string;
  force?: boolean;
  yes?: boolean;
  project?: string;
}

export const initCommand = new Command('init')
  .description('Initialize Ophan in the current project')
  .option('-t, --template <name>', 'Template to use (base, typescript, python)')
  .option('-f, --force', 'Overwrite existing configuration')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('-p, --project <path>', 'Path to the project directory (defaults to current directory)')
  .action(async (options: InitOptions) => {
    try {
      await runInit(options);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(error.message);
      }
      process.exit(1);
    }
  });

async function runInit(options: InitOptions): Promise<void> {
  // Use --project path if provided, otherwise use cwd
  // path.resolve handles both absolute and relative paths correctly
  const cwd = options.project ? resolve(options.project) : process.cwd();

  // Create the directory if it doesn't exist (for sandbox testing)
  if (options.project && !existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
    logger.info(`Created project directory: ${cwd}`);
  }

  // Check if we're in a git repository
  if (!isGitRepository(cwd)) {
    logger.warn('Not a git repository. Ophan works best with git.');
    if (!options.yes) {
      const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue anyway?',
          default: false,
        },
      ]);
      if (!proceed) {
        logger.info('Aborted.');
        return;
      }
    }
  }

  // Check if already initialized
  // When --project is specified, use that directory directly (don't search parent dirs)
  const projectRoot = options.project ? cwd : (findProjectRoot(cwd) ?? cwd);
  if (isOphanInitialized(projectRoot) && !options.force) {
    logger.error(
      'Ophan is already initialized in this project. Use --force to reinitialize.'
    );
    return;
  }

  // Detect project type
  const detection = await detectProjectType(projectRoot);
  logger.section('Project Detection');
  for (const item of detection.detected) {
    logger.listItem(item);
  }

  // Select template
  let template = options.template ?? detection.suggestedTemplate;
  if (!options.yes && !options.template) {
    const { selectedTemplate } = await inquirer.prompt<{
      selectedTemplate: string;
    }>([
      {
        type: 'list',
        name: 'selectedTemplate',
        message: 'Select a template:',
        choices: [
          {
            name: `${detection.suggestedTemplate} (recommended)`,
            value: detection.suggestedTemplate,
          },
          { name: 'base (minimal)', value: 'base' },
          { name: 'typescript', value: 'typescript' },
          { name: 'python', value: 'python' },
        ],
        default: detection.suggestedTemplate,
      },
    ]);
    template = selectedTemplate;
  }

  logger.blank();
  logger.info(`Using template: ${template}`);
  logger.blank();

  // Create directory structure
  const spinner = createSpinner('Creating Ophan structure...');
  spinner.start();

  try {
    const paths = getOphanPaths(projectRoot);

    // Create directories
    for (const dir of [
      paths.stateDir,
      paths.guidelines,
      paths.criteria,
      paths.logs,
      paths.digests,
      paths.metrics,
    ]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    // Create config file
    saveConfig(projectRoot, DEFAULT_CONFIG);
    spinner.text = 'Created .ophan.yaml';

    // Create state file
    saveState(projectRoot, createInitialState());
    spinner.text = 'Created state file';

    // Create guideline files
    const guidelineFiles = getTemplateGuidelines(template);
    for (const [filename, content] of Object.entries(guidelineFiles)) {
      writeFileSync(join(paths.guidelines, filename), content, 'utf-8');
    }
    spinner.text = 'Created guideline files';

    // Create criteria files
    const criteriaFiles = getTemplateCriteria(template);
    for (const [filename, content] of Object.entries(criteriaFiles)) {
      writeFileSync(join(paths.criteria, filename), content, 'utf-8');
    }
    spinner.text = 'Created criteria files';

    // Create OPHAN.md entry point
    const projectName = isGitRepository(projectRoot)
      ? await getProjectName(getGit(projectRoot), projectRoot)
      : projectRoot.split('/').pop() ?? 'project';

    const ophanMd = createOphanMd(projectName);
    writeFileSync(join(projectRoot, 'OPHAN.md'), ophanMd, 'utf-8');

    spinner.succeed('Ophan initialized successfully!');

    logger.blank();
    logger.section('Created Files');
    logger.success('OPHAN.md');
    logger.success('.ophan.yaml');
    logger.success('.ophan/state.json');
    for (const filename of Object.keys(guidelineFiles)) {
      logger.success(`.ophan/guidelines/${filename}`);
    }
    for (const filename of Object.keys(criteriaFiles)) {
      logger.success(`.ophan/criteria/${filename}`);
    }

    logger.blank();
    logger.info('Run `ophan task "your first task"` to begin.');
  } catch (error) {
    spinner.fail('Failed to initialize Ophan');
    throw error;
  }
}

interface ProjectDetection {
  detected: string[];
  suggestedTemplate: string;
}

async function detectProjectType(projectRoot: string): Promise<ProjectDetection> {
  const detected: string[] = [];
  let suggestedTemplate = 'base';

  // Check for package.json (Node.js)
  if (existsSync(join(projectRoot, 'package.json'))) {
    detected.push('package.json (Node.js)');
    suggestedTemplate = 'typescript';
  }

  // Check for TypeScript
  if (existsSync(join(projectRoot, 'tsconfig.json'))) {
    detected.push('tsconfig.json (TypeScript)');
    suggestedTemplate = 'typescript';
  }

  // Check for Python
  if (
    existsSync(join(projectRoot, 'pyproject.toml')) ||
    existsSync(join(projectRoot, 'setup.py')) ||
    existsSync(join(projectRoot, 'requirements.txt'))
  ) {
    detected.push('Python project detected');
    suggestedTemplate = 'python';
  }

  // Check for Go
  if (existsSync(join(projectRoot, 'go.mod'))) {
    detected.push('go.mod (Go)');
    suggestedTemplate = 'base'; // No Go-specific template yet
  }

  // Check for common config files
  if (existsSync(join(projectRoot, '.eslintrc.json')) ||
      existsSync(join(projectRoot, '.eslintrc.js')) ||
      existsSync(join(projectRoot, 'eslint.config.js'))) {
    detected.push('ESLint configuration');
  }

  if (existsSync(join(projectRoot, '.prettierrc')) ||
      existsSync(join(projectRoot, '.prettierrc.json'))) {
    detected.push('Prettier configuration');
  }

  if (existsSync(join(projectRoot, 'jest.config.js')) ||
      existsSync(join(projectRoot, 'jest.config.ts'))) {
    detected.push('Jest configuration');
  }

  if (existsSync(join(projectRoot, 'vitest.config.ts'))) {
    detected.push('Vitest configuration');
  }

  if (detected.length === 0) {
    detected.push('No specific framework detected');
  }

  return { detected, suggestedTemplate };
}

function getTemplateGuidelines(template: string): Record<string, string> {
  const baseGuidelines: Record<string, string> = {
    'context.md': `# Context Compilation Guidelines

This file defines how Ophan identifies relevant files for tasks.
The context agent learns which files matter for which task types.

## General Patterns

- Configuration files (config/, .env patterns) are often relevant
- Type definition files help understand data structures
- Test files can reveal expected behavior
- Entry points (index files, main files) provide architecture overview

## File Relationships

- When modifying a file, its direct importers may need updates
- Test files are relevant when modifying their source files
- Shared utilities are often relevant across tasks

## Learned Patterns

<!-- This section is populated by the outer loop as patterns emerge -->
<!-- Example pattern:
- Tasks matching "auth" or "login" commonly need:
  - src/auth/**
  - src/middleware/auth.ts
  - src/types/user.ts
-->
`,

    'coding.md': `# Coding Guidelines

## Workflows

### General Development Flow
1. Understand the task requirements
2. Review relevant existing code
3. Plan the implementation approach
4. Write code following project conventions
5. Run linters and formatters
6. Run tests
7. Review changes before committing

### Error Recovery
- When a test fails, analyze the failure message first
- Check for related tests that might provide context
- Fix the root cause, not just the symptoms

## Data Structures

- Follow existing patterns in the codebase
- Use consistent naming conventions
- Document complex data structures

## Constraints

- Never modify files in \`.ophan/criteria/\` directly
- Respect .gitignore patterns
- Keep changes focused and minimal

## Failure Detection

- Run type checking before tests
- Check for lint errors before committing
- Verify imports are valid
`,

    'testing.md': `# Testing Guidelines

## Workflows

### Writing Tests
1. Write tests for new functionality
2. Update tests when modifying existing code
3. Ensure tests are deterministic
4. Use meaningful test names that describe behavior

### Running Tests
1. Run the full test suite before committing
2. Run relevant subset during development
3. Check coverage for new code

## Constraints

- Tests should not depend on external services
- Tests should be isolated and repeatable
- Avoid testing implementation details

## Failure Detection

- Test failures indicate either:
  - A bug in the implementation
  - A test that needs updating
- Flaky tests should be fixed immediately
`,

    'learnings.md': `# Learnings

This file accumulates learnings from task executions.
Learnings are automatically added by Ophan's inner loop.

---
`,
  };

  if (template === 'typescript') {
    baseGuidelines['coding.md'] = `# TypeScript Coding Guidelines

## Workflows

### General Development Flow
1. Understand the task requirements
2. Review relevant existing code
3. Plan the implementation approach
4. Write TypeScript code with proper types
5. Run \`npm run typecheck\` for type errors
6. Run \`npm run lint\` for style issues
7. Run \`npm test\` for tests
8. Review changes before committing

### Error Recovery
- Type errors: Check type definitions and imports
- Lint errors: Run auto-fix or manually correct
- Test failures: Debug with test output

## Data Structures

- Define interfaces for all data shapes
- Use type aliases for complex unions
- Export types that are part of public API

## Constraints

- Never use \`any\` type in production code
- Prefer \`const\` over \`let\`
- Use explicit return types for public functions
- Never modify files in \`.ophan/criteria/\` directly

## Failure Detection

- Run \`npm run typecheck\` before tests
- Check for ESLint errors
- Verify all imports resolve correctly
`;

    baseGuidelines['testing.md'] = `# TypeScript Testing Guidelines

## Workflows

### Writing Tests
1. Create test files alongside source files or in tests/
2. Use descriptive test names with \`describe\` and \`it\`
3. Cover edge cases and error conditions
4. Mock external dependencies

### Running Tests
\`\`\`bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
npm run test:coverage # With coverage
\`\`\`

## Constraints

- Tests should compile without errors
- Avoid testing private implementation details
- Mock external APIs and file system

## Failure Detection

- Compilation errors in test files
- Type mismatches in test assertions
- Missing mock implementations
`;
  }

  return baseGuidelines;
}

function getTemplateCriteria(template: string): Record<string, string> {
  const baseCriteria: Record<string, string> = {
    'context-quality.md': `# Context Quality Criteria

This file defines evaluation criteria for the context agent.
These metrics measure how well Ophan predicts relevant files.

## Hit Rate

- **Target**: >70% of provided files should be used
- Files provided but never touched indicate waste
- Measures efficiency of context prediction

## Miss Rate

- **Target**: <20% of files used should have been unprovided
- High miss rate means poor prediction
- Measures completeness of context prediction

## Exploration Efficiency

- **Target**: <10% of tokens spent on file discovery
- Exploration tokens = reads/searches before first write
- Lower is better - means context was complete

## Evaluation Method

After each task:
1. Compare files provided in context vs files actually accessed
2. Calculate hit rate: (provided ∩ accessed) / provided
3. Calculate miss rate: (accessed - provided) / accessed
4. Track exploration tokens: tokens before first file write

## Improvement Triggers

When metrics consistently fail targets:
- Hit rate <70%: Context prediction includes irrelevant files
- Miss rate >20%: Context prediction misses important files
- Exploration >10%: Agent spending too much time exploring
`,

    'quality.md': `# Quality Criteria

## Evaluation Criteria

- Code compiles/runs without errors
- All tests pass
- No lint errors or warnings
- Changes are minimal and focused
- No regressions in existing functionality

## Analytical Methods

1. Run the test suite
2. Run linters
3. Review changed lines for obvious issues
4. Check that changes match the task description

## Comparative Context

Good code changes:
- Are easy to understand
- Follow existing patterns
- Include appropriate tests
- Have clear commit messages

## Failure Patterns

Common issues to avoid:
- Leaving debug code in commits
- Breaking existing tests
- Introducing security vulnerabilities
- Over-engineering simple solutions
`,

    'security.md': `# Security Criteria

## Evaluation Criteria

- No hardcoded secrets or credentials
- Input validation on user data
- Safe handling of file paths
- No command injection vulnerabilities

## Analytical Methods

1. Check for hardcoded strings that look like secrets
2. Review any shell command construction
3. Verify file path handling
4. Check for SQL/NoSQL injection risks

## Failure Patterns

Never allow:
- Credentials in source code
- User input in shell commands without sanitization
- Path traversal vulnerabilities
- Unvalidated redirects
`,
  };

  if (template === 'typescript') {
    baseCriteria['quality.md'] = `# TypeScript Quality Criteria

## Evaluation Criteria

- TypeScript compiles with no errors
- All tests pass
- No ESLint errors
- No \`any\` types in production code
- All exports have JSDoc comments
- Changes are minimal and focused

## Analytical Methods

1. \`npm run typecheck\` - Must pass
2. \`npm test\` - Must pass
3. \`npm run lint\` - Must pass
4. Review type coverage

## Comparative Context

Good TypeScript code:
- Has explicit types for function parameters
- Uses interfaces over type aliases for objects
- Leverages type inference where obvious
- Uses strict null checks

## Failure Patterns

Common TypeScript issues:
- Using \`any\` to silence errors
- Ignoring nullable types
- Type assertions without validation
- Circular dependencies
`;
  }

  return baseCriteria;
}

function createOphanMd(projectName: string): string {
  return `# Ophan Agent Entry Point

This file is the entry point for the Ophan AI development agent.
Ophan uses the Two-Loop Paradigm for self-improvement.

## Project: ${projectName}

## Guidelines (How to Work)

Guidelines define the agent's workflows, data structures, and constraints.
The agent can freely update these based on learnings.

### Task Execution Agent
- [Coding Guidelines](.ophan/guidelines/coding.md)
- [Testing Guidelines](.ophan/guidelines/testing.md)
- [Learnings](.ophan/guidelines/learnings.md)

### Context Agent
- [Context Guidelines](.ophan/guidelines/context.md)

## Criteria (What Good Looks Like)

Criteria define quality standards and evaluation methods.
Only humans (EITL) can approve changes to criteria.

### Task Execution Agent
- [Quality Criteria](.ophan/criteria/quality.md)
- [Security Criteria](.ophan/criteria/security.md)

### Context Agent
- [Context Quality Criteria](.ophan/criteria/context-quality.md)

## Commands

\`\`\`bash
ophan task "description"  # Run a task through the inner loop
ophan review              # Run the outer loop (pattern detection)
ophan status              # View metrics and status
ophan logs                # View recent task logs
\`\`\`

## Configuration

See [.ophan.yaml](.ophan.yaml) for configuration options.
`;
}
