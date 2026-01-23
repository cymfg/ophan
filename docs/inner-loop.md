# Inner Loop Documentation

The inner loop is Ophan's per-task execution engine. It implements the learn-regenerate paradigm where the agent generates output, evaluates it, learns from failures, and regenerates with improved understanding.

## Overview

```mermaid
flowchart TB
    Start([Task Received]) --> Load[Load Context]
    Load --> Gen[Generate Output]
    Gen --> Eval{Evaluate}
    Eval --> |"Pass"| Done([Converged])
    Eval --> |"Fail"| Learn[Extract Learning]
    Learn --> Check{Max Iterations?}
    Check --> |"No"| Gen
    Check --> |"Yes"| Escalate([Escalated])

    subgraph Context
        Guidelines[Guidelines]
        Criteria[Criteria]
        Learnings[Learnings]
    end

    Load --> Context
    Context --> Gen
```

## Execution Flow

### 1. Task Initialization

When a task is submitted, the inner loop:

1. Generates a unique task ID
2. Loads guidelines, criteria, and learnings
3. Initializes the Claude client with tools
4. Sets up the evaluation engine

```mermaid
sequenceDiagram
    participant CLI
    participant InnerLoop
    participant Storage

    CLI->>InnerLoop: execute("fix the bug")
    InnerLoop->>InnerLoop: generateTaskId()
    InnerLoop->>Storage: Load guidelines/*.md
    InnerLoop->>Storage: Load criteria/*.md
    InnerLoop->>Storage: Load learnings.md
    InnerLoop->>InnerLoop: Initialize Claude, Tools, Evaluator
```

### 2. Agent Loop

The agent loop executes Claude Code with tools until completion:

```mermaid
flowchart TB
    Start([Start Loop]) --> CC[Claude Code CLI]

    CC --> Stream[Stream Messages]
    Stream --> Track[Track File Usage]
    Track --> Check{Task Complete?}

    Check --> |"No"| CC
    Check --> |"Yes"| Done([Loop Complete])

    subgraph "Available Tools"
        Read[Read]
        Write[Write]
        Edit[Edit]
        Bash[Bash]
        Glob[Glob]
        Grep[Grep]
    end

    CC --> Read
    CC --> Write
    CC --> Edit
    CC --> Bash
    CC --> Glob
    CC --> Grep
```

Ophan uses Claude Code (subscription-based) for task execution:
- No API key required (uses Claude Code subscription)
- Full tool access via Claude Code's built-in tools
- File usage is tracked for context agent evaluation
- Cost limits enforced via Claude Code's budget system

### 3. Tool Execution

Tools are executed in a sandboxed environment:

```mermaid
flowchart LR
    subgraph "Tool Runner"
        Validate[Validate Input]
        Execute[Execute Command]
        Capture[Capture Output]
        Store[Store for Evaluation]
    end

    ToolCall[Tool Call] --> Validate
    Validate --> |"Blocked"| Error[Return Error]
    Validate --> |"Allowed"| Execute
    Execute --> Capture
    Capture --> Store
    Store --> Result[Return Result]
```

**Tool Types:**

| Tool | Purpose | Sandboxed |
|------|---------|-----------|
| `read_file` | Read file contents | Yes (path validation) |
| `write_file` | Create/modify files | Yes (protected paths) |
| `run_shell` | Execute commands | Yes (blocklist) |
| `search_code` | Search codebase | Yes (project scope) |
| `task_complete` | Signal completion | N/A |

### 4. Evaluation

After each iteration, the output is evaluated:

```mermaid
flowchart TB
    Start([Evaluate]) --> Criteria[Parse Criteria]
    Criteria --> DevTools[Run Dev Tools]

    DevTools --> Test[npm test]
    DevTools --> Lint[npm run lint]
    DevTools --> Build[npm run build]
    DevTools --> Type[npm run typecheck]

    Test --> Collect[Collect Results]
    Lint --> Collect
    Build --> Collect
    Type --> Collect

    Collect --> Score[Calculate Score]
    Score --> Check{Score >= Threshold?}
    Check --> |"Yes"| Pass([Passed])
    Check --> |"No"| Fail([Failed])
```

**Evaluation Criteria:**

```mermaid
pie title Evaluation Weight Distribution
    "Functional Correctness" : 40
    "Test Results" : 25
    "Code Quality" : 20
    "Build Success" : 15
```

### 5. Learning Extraction

When evaluation fails, learnings are extracted:

```mermaid
flowchart TB
    Fail([Evaluation Failed]) --> Analyze[Analyze Failures]
    Analyze --> Extract[Extract Patterns]
    Extract --> Format[Format Learning]

    Format --> Learning[/"Learning Object"/]

    Learning --> |"Content"| What[What went wrong]
    Learning --> |"Context"| Where[Where it happened]
    Learning --> |"Resolution"| How[How to fix it]
    Learning --> |"Impact"| Which[Which guideline]
```

**Learning Structure:**

```typescript
interface Learning {
  id: string;              // Unique identifier
  content: string;         // The learning itself
  context: string;         // Task context
  issue: string;           // What went wrong
  resolution: string;      // How it was fixed
  guidelineImpact: string; // Which guideline to update
  timestamp: string;       // When extracted
  references: number;      // Times referenced
  promoted: boolean;       // Promoted to guideline?
}
```

### 6. Regeneration Strategies

Ophan supports three regeneration strategies:

```mermaid
flowchart TB
    Fail([Evaluation Failed]) --> Strategy{Strategy?}

    Strategy --> |"full"| Full[Discard All]
    Strategy --> |"informed"| Informed[Keep Structure]
    Strategy --> |"incremental"| Incremental[Minimal Changes]

    Full --> Regen1[Regenerate from Scratch]
    Informed --> Regen2[Regenerate Problematic Parts]
    Incremental --> Regen3[Targeted Edits Only]

    Regen1 --> Next([Next Iteration])
    Regen2 --> Next
    Regen3 --> Next
```

| Strategy | Description | Best For |
|----------|-------------|----------|
| `full` | Discard output, regenerate from scratch | Small tasks, creative work |
| `informed` | Keep structurally sound parts, regenerate problems | Most coding tasks (default) |
| `incremental` | Minimal targeted edits | Quick fixes, minor adjustments |

### 7. Convergence & Escalation

```mermaid
stateDiagram-v2
    [*] --> Running: Task starts

    Running --> Converged: Evaluation passes
    Running --> Running: Evaluation fails (iterate)
    Running --> Escalated: Max iterations reached
    Running --> Escalated: Cost limit exceeded
    Running --> Failed: Unrecoverable error

    Converged --> [*]: Success
    Escalated --> [*]: Needs human help
    Failed --> [*]: Error

    note right of Escalated
        Triggers webhook notification
        if configured
    end note
```

## Cost Management

```mermaid
flowchart TB
    Start([Each Iteration]) --> Track[Track Tokens]
    Track --> Calculate[Calculate Cost]
    Calculate --> Check{Cost > Limit?}
    Check --> |"No"| Continue([Continue])
    Check --> |"Yes"| Escalate([Escalate])

    subgraph "Cost Estimation"
        Input[Input Tokens]
        Output[Output Tokens]
        Model[Model Pricing]
    end

    Track --> Input
    Track --> Output
    Input --> Calculate
    Output --> Calculate
    Model --> Calculate
```

**Cost Formula:**

```
cost = (inputTokens * inputPrice) + (outputTokens * outputPrice)

For Claude Sonnet:
- inputPrice = $3.00 / 1M tokens
- outputPrice = $15.00 / 1M tokens
```

## Task Logging

Every task execution is logged for the outer loop:

```mermaid
flowchart LR
    Task[Task Execution] --> Log[Task Log]

    Log --> Task_[Task Metadata]
    Log --> Iterations[Iteration Logs]
    Log --> Evaluation[Final Evaluation]

    subgraph "Log Entry"
        TaskID[Task ID]
        Timestamp[Timestamp]
        Iteration[Iteration #]
        Action[Action Taken]
        Output[Output]
        EvalResult[Evaluation]
    end

    Iterations --> TaskID
    Iterations --> Timestamp
    Iterations --> Iteration
    Iterations --> Action
    Iterations --> Output
    Iterations --> EvalResult
```

## Context Usage Logging

After each task, the inner loop logs context usage for the Context Agent:

```mermaid
flowchart TB
    Task[Task Complete] --> Collect[Collect File Usage]

    Collect --> Provided[Files Provided]
    Collect --> Used[Files Actually Used]

    Provided --> Metrics[Compute Metrics]
    Used --> Metrics

    Metrics --> HitRate[Hit Rate]
    Metrics --> MissRate[Miss Rate]

    HitRate --> Save[Save to context-logs/]
    MissRate --> Save
```

**Context Usage Metrics:**

| Metric | Description | Target |
|--------|-------------|--------|
| Hit Rate | % of provided files that were used | >70% |
| Miss Rate | % of used files that weren't provided | <20% |
| Exploration Tokens | Tokens spent on discovery before first write | Minimize |

This data enables the Context Agent to learn which files are relevant for different task types.

## System Prompt Structure

The system prompt is dynamically built for each iteration:

```mermaid
flowchart TB
    subgraph "System Prompt"
        Role[Role Definition]
        Guidelines[Guidelines Content]
        Criteria[Criteria Content]
        Learnings[Recent Learnings]
        Context[Task Context]
        Previous[Previous Evaluation]
    end

    Role --> Prompt[Final System Prompt]
    Guidelines --> Prompt
    Criteria --> Prompt
    Learnings --> Prompt
    Context --> Prompt
    Previous --> Prompt

    Prompt --> Claude[Claude API]
```

## Error Handling

```mermaid
flowchart TB
    Error([Error Occurs]) --> Type{Error Type}

    Type --> |"API Error"| Retry[Retry with Backoff]
    Type --> |"Tool Error"| Report[Report to Agent]
    Type --> |"Timeout"| Timeout[Mark as Failed]
    Type --> |"Rate Limit"| Wait[Wait and Retry]

    Retry --> |"Max Retries"| Escalate[Escalate]
    Report --> Continue[Continue Execution]
    Timeout --> Escalate
    Wait --> Retry
```

## Configuration Options

```yaml
innerLoop:
  maxIterations: 5           # Maximum iterations before escalation
  regenerationStrategy: informed  # full | informed | incremental
  costLimit: 0.50            # Maximum cost per task in USD

# Claude Code configuration
claudeCode:
  allowedTools:              # Tools to allow (omit for all)
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
  maxTurns: 50               # Max conversation turns
```

## Metrics Tracked

| Metric | Description |
|--------|-------------|
| `iterations` | Number of iterations used |
| `tokensUsed` | Total tokens consumed |
| `cost` | Estimated cost in USD |
| `duration` | Time to completion |
| `status` | converged / escalated / failed |

## Next Steps

- [Outer Loop Documentation](./outer-loop.md) - Pattern detection and learning consolidation
- [Configuration Reference](./configuration.md) - Full configuration options
- [Architecture Overview](./architecture.md) - System architecture
