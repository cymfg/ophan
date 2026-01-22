<p align="center">
  <img src="docs/ophan_logo.png" alt="Ophan Logo" width="200">
</p>

# Ophan

A self-improving AI development agent based on the **Two-Loop Paradigm**.

> *"Ophan"* references the biblical Ophanim—"wheels within wheels" from Ezekiel's vision—representing nested loops that autonomously adapt while observing and learning continuously.

## The Two-Loop Paradigm

Most AI coding agents plateau: they fix bugs and generate code but make the same mistakes repeatedly. Ophan solves this by separating **Guidelines** (how to work) from **Criteria** (what good looks like).

### Inner Loop (Per-Task)
1. **Generate** output from Guidelines
2. **Evaluate** against Criteria + dev tools
3. **Learn** from evaluation results
4. **Regenerate** with improved understanding

### Outer Loop (Periodic)
1. **Gather** converged outputs from many tasks
2. **Analyze** for patterns and learnings
3. **Propose** updates to Guidelines and Criteria
4. **Apply** (Guidelines automatically, Criteria with human approval)

## Quick Start

```bash
# Install
npm install -g ophan

# Initialize in your project
ophan init

# Run a task
ophan task "fix the login validation bug"

# Check status
ophan status

# Run outer loop review
ophan review

# View recent task logs
ophan logs

# Open web UI
ophan ui
```

## Project Structure

After running `ophan init`, your project will have:

```
my-project/
├── OPHAN.md                    # Agent entry point
├── .ophan.yaml                 # Configuration
├── .ophan/
│   ├── guidelines/             # Agent CAN edit
│   │   ├── coding.md
│   │   ├── testing.md
│   │   └── learnings.md
│   ├── criteria/               # Agent CANNOT edit (protected)
│   │   ├── quality.md
│   │   └── security.md
│   ├── logs/                   # Task execution logs
│   ├── digests/                # Outer loop reports
│   └── state.json              # Runtime state
└── [your project files]
```

## Key Concepts

### Guidelines (G) — "How to Work"
- Workflows and decision trees
- Data structures and templates
- Constraints and failure detection
- **Agent can freely update** these based on learnings

### Criteria (C) — "What Good Looks Like"
- Evaluation standards
- Analytical methods
- Comparative context
- Failure patterns
- **Only humans can approve changes** (prevents reward hacking)

### Expert in the Loop (EITL)
The outer loop requires human oversight to approve criteria changes. This prevents the agent from lowering its own standards to achieve easier "success."

## Configuration

See `.ophan.yaml` for all options:

```yaml
model:
  name: claude-sonnet-4-20250514
  maxTokens: 4096

innerLoop:
  maxIterations: 5
  regenerationStrategy: informed  # full | informed | incremental
  costLimit: 0.50

outerLoop:
  triggers:
    afterTasks: 10
  minOccurrences: 3
  minConfidence: 0.7
  lookbackDays: 30
  learnings:
    maxCount: 50
    retentionDays: 90
    promotionThreshold: 3
    similarityThreshold: 0.9

escalations:
  webhooks:
    - name: slack-alerts
      url: ${SLACK_WEBHOOK_URL}
      events: [escalation, digest]
```

## Commands

| Command | Description |
|---------|-------------|
| `ophan init` | Initialize Ophan in current project |
| `ophan task "<description>"` | Run a task through inner loop |
| `ophan review` | Run outer loop (pattern detection) |
| `ophan status` | Show metrics and status |
| `ophan logs` | View recent task logs |
| `ophan ui` | Open web UI for configuration and monitoring |
| `ophan approve <id>` | Approve a criteria change proposal |

### Command Options

**`ophan init`**
- `-t, --template <name>` — Template to use (base, typescript, python)
- `-f, --force` — Overwrite existing configuration
- `-y, --yes` — Skip confirmation prompts
- `-p, --project <path>` — Path to the project directory

**`ophan task`**
- `-n, --dry-run` — Show what would be done without executing
- `-m, --max-iterations <number>` — Override max iterations
- `-p, --project <path>` — Path to the project directory

**`ophan review`**
- `-f, --force` — Run even if task threshold not reached
- `-p, --project <path>` — Path to the project directory

**`ophan logs`**
- `-l, --limit <number>` — Number of logs to show (default: 10)
- `-p, --project <path>` — Path to the project directory
- `--json` — Output as JSON

**`ophan ui`**
- `-p, --port <number>` — Port to run the server on (default: 4040)
- `--no-open` — Do not open browser automatically
- `--project <path>` — Path to the project directory

## Web UI

Ophan includes a lightweight web dashboard for viewing status and editing configuration.

```bash
# Start the UI (opens browser automatically)
ophan ui

# Start on a different port
ophan ui --port 8080

# Start without opening browser
ophan ui --no-open
```

The UI provides:
- **Dashboard**: View task metrics, success rates, and costs
- **Task Logs**: Browse and search task execution history
- **Configuration**: Edit settings with form-based interface
- **Guidelines/Criteria**: View current guidelines and criteria files
- **Digests**: Read outer loop review reports

## Escalations & Webhooks

Ophan can send notifications when tasks escalate (hit max iterations, exceed cost limits, etc.) or when outer loop digests are generated.

### Webhook Events
- `escalation` — Task failed to converge
- `task_complete` — Task finished (success or failure)
- `digest` — Outer loop review completed

### Webhook Payload (Escalation)
```json
{
  "type": "escalation",
  "timestamp": "2024-01-15T10:30:00Z",
  "task": {
    "id": "task-20240115-103000-abc1",
    "description": "fix the login bug",
    "iterations": 5,
    "maxIterations": 5
  },
  "reason": "max_iterations",
  "context": {
    "lastError": "Test failed: expected 200, got 401",
    "suggestedAction": "Review task complexity or improve guidelines"
  },
  "project": {
    "name": "my-app",
    "path": "/Users/dev/my-app"
  }
}
```

### Environment Variables in Config

Use `${VAR_NAME}` syntax for secrets:

```yaml
escalations:
  webhooks:
    - name: slack
      url: ${SLACK_WEBHOOK_URL}
      headers:
        Authorization: Bearer ${AUTH_TOKEN}
      events: [escalation]
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| Webhook URLs/tokens | No | As configured in `.ophan.yaml` |

## How It Works

### Inner Loop (Task Execution)

1. **Context Building**: Loads guidelines, criteria, and previous learnings
2. **Agent Execution**: Claude executes the task using available tools
3. **Evaluation**: Output is evaluated against criteria and dev tools (tests, lint, build)
4. **Learning**: If evaluation fails, learnings are extracted
5. **Regeneration**: Agent regenerates with updated understanding
6. **Convergence**: Repeats until evaluation passes or max iterations reached

### Outer Loop (Pattern Analysis)

1. **Log Analysis**: Analyzes task logs from the lookback period
2. **Pattern Detection**: Identifies failure, iteration, and success patterns
3. **Learning Consolidation**: Deduplicates, promotes, and prunes learnings
4. **Guideline Updates**: Auto-applies updates from promoted learnings
5. **Proposal Generation**: Creates proposals for criteria changes (require approval)
6. **Digest Generation**: Writes summary report to `.ophan/digests/`

### Pattern Types

- **Failure Patterns**: Recurring errors (TypeScript, tests, lint)
- **Iteration Patterns**: Tasks consistently needing multiple iterations
- **Success Patterns**: Approaches that work well consistently

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build

# Run CLI locally
npm run dev -- task "your task"
```

## Documentation

For detailed documentation, see:

- **[Architecture Overview](docs/architecture.md)** — System design with Mermaid diagrams
- **[Inner Loop](docs/inner-loop.md)** — Per-task execution engine
- **[Outer Loop](docs/outer-loop.md)** — Pattern detection and learning consolidation
- **[Configuration Reference](docs/configuration.md)** — Complete config options

## Project Status

- **Phase 1A: Core Infrastructure** — CLI, config, types, scaffolding
- **Phase 1B: Inner Loop** — Task execution, Claude API, evaluation, regeneration
- **Phase 1C: Outer Loop** — Pattern detection, learning consolidation, proposals
- **Phase 1D: Escalations** — Webhook notifications
- **Phase 1E: Polish** — Testing, documentation
- **Phase 1F: Web UI** — Dashboard, config editor, log viewer

**Test Coverage:** 87 tests passing

## License

MIT
