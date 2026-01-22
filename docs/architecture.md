# Ophan Architecture

This document provides a comprehensive overview of Ophan's architecture, based on the Two-Loop Paradigm for self-improving AI agents.

## High-Level Architecture

```mermaid
flowchart TB
    subgraph "User Interface"
        CLI[CLI Commands]
    end

    subgraph "Inner Loop"
        IL[Inner Loop Engine]
        Claude[Claude API]
        Tools[Tool Runner]
        Eval[Evaluation Engine]
    end

    subgraph "Outer Loop"
        OL[Outer Loop Engine]
        PD[Pattern Detector]
        LM[Learning Manager]
        DG[Digest Generator]
    end

    subgraph "Storage"
        Config[.ophan.yaml]
        State[state.json]
        Guidelines[Guidelines]
        Criteria[Criteria]
        Logs[Task Logs]
        Digests[Digests]
    end

    subgraph "Integrations"
        Webhooks[Webhook Client]
    end

    CLI --> IL
    CLI --> OL

    IL --> Claude
    IL --> Tools
    IL --> Eval
    IL --> Logs
    IL --> Webhooks

    OL --> PD
    OL --> LM
    OL --> DG
    OL --> Logs
    OL --> Digests
    OL --> Webhooks

    IL --> Guidelines
    IL --> Criteria
    IL --> State

    OL --> Guidelines
    OL --> State

    Config --> IL
    Config --> OL
```

## The Two-Loop Paradigm

The core innovation of Ophan is the separation of concerns between two feedback loops:

```mermaid
flowchart LR
    subgraph "Inner Loop (Per Task)"
        G1[Guidelines G] --> Gen[Generate Output O]
        Gen --> Eval1[Evaluate E]
        Eval1 --> |"Failed"| Learn[Extract Learning ΔG]
        Learn --> |"Update"| G1
        Eval1 --> |"Passed"| Done[Converged]
    end

    subgraph "Outer Loop (Periodic)"
        Logs2[Task Logs] --> Analyze[Pattern Analysis]
        Analyze --> Propose[Generate Proposals]
        Propose --> |"Guidelines"| AutoApply[Auto-Apply]
        Propose --> |"Criteria"| HumanReview[Human Review]
    end

    Done --> Logs2
```

### ML Training Analogy

| ML Training | Ophan Implementation |
|-------------|---------------------|
| **Forward Pass** | Guidelines (G) → Generate output (O) |
| **Loss Function** | Criteria (C) + Dev Tools → Evaluation (E) |
| **Backpropagation** | E → Update to Guidelines (ΔG) |
| **Weight Update** | G' = G + ΔG (persistent improvement) |

## Component Architecture

### Inner Loop Components

```mermaid
classDiagram
    class InnerLoop {
        -claude: ClaudeClient
        -toolRunner: ToolRunner
        -evaluator: EvaluationEngine
        -webhookClient: WebhookClient
        +execute(taskDescription): InnerLoopResult
        -executeAgentLoop(): AgentResult
        -extractLearnings(): Learning[]
        -triggerEscalation(): void
    }

    class ClaudeClient {
        -client: Anthropic
        -config: OphanConfig
        +chat(system, messages): Response
        +chatWithTools(system, messages, tools): Response
        +estimateCost(input, output): number
    }

    class ToolRunner {
        -projectRoot: string
        -config: OphanConfig
        -toolOutputs: Map
        +execute(tool, input): ToolResult
        +getToolOutputs(): ToolOutput[]
    }

    class EvaluationEngine {
        -config: OphanConfig
        +fullEvaluation(context): Evaluation
        +runDevTools(criteria): ToolResult[]
        +formatEvaluation(eval): string
    }

    InnerLoop --> ClaudeClient
    InnerLoop --> ToolRunner
    InnerLoop --> EvaluationEngine
```

### Outer Loop Components

```mermaid
classDiagram
    class OuterLoop {
        -patternDetector: PatternDetector
        -learningManager: LearningManager
        -webhookClient: WebhookClient
        +execute(): OuterLoopResult
        -loadTaskLogs(): TaskLogEntry[]
        -generateProposals(): Proposal[]
        -generateDigest(): string
    }

    class PatternDetector {
        -options: PatternDetectorOptions
        +detectPatterns(logs): Pattern[]
        -detectFailurePatterns(): Pattern[]
        -detectIterationPatterns(): Pattern[]
        -detectSuccessPatterns(): Pattern[]
        +formatPatterns(patterns): string
    }

    class LearningManager {
        -ophanDir: string
        -config: OphanConfig
        +addLearning(learning, existing): Result
        +consolidate(learnings): ConsolidationResult
        +generateGuidelineProposals(): Proposal[]
        +applyGuidelineUpdate(file, content): void
    }

    OuterLoop --> PatternDetector
    OuterLoop --> LearningManager
```

## Data Flow

### Task Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant InnerLoop
    participant Claude
    participant Tools
    participant Evaluator
    participant Storage

    User->>CLI: ophan task "description"
    CLI->>Storage: Load config, guidelines, criteria
    CLI->>InnerLoop: execute(description)

    loop Until converged or max iterations
        InnerLoop->>Claude: Generate with tools
        Claude-->>InnerLoop: Response + tool calls

        loop For each tool call
            InnerLoop->>Tools: Execute tool
            Tools-->>InnerLoop: Tool result
        end

        InnerLoop->>Evaluator: Evaluate output
        Evaluator->>Tools: Run dev tools (test, lint, build)
        Tools-->>Evaluator: Results
        Evaluator-->>InnerLoop: Evaluation

        alt Evaluation passed
            InnerLoop-->>CLI: Converged
        else Evaluation failed
            InnerLoop->>InnerLoop: Extract learnings
            InnerLoop->>InnerLoop: Regenerate with learnings
        end
    end

    InnerLoop->>Storage: Save task log
    CLI-->>User: Result summary
```

### Outer Loop Review Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant OuterLoop
    participant PatternDetector
    participant LearningManager
    participant Storage
    participant Webhooks

    User->>CLI: ophan review
    CLI->>Storage: Load logs, state, config
    CLI->>OuterLoop: execute()

    OuterLoop->>Storage: Load task logs
    OuterLoop->>PatternDetector: detectPatterns(logs)
    PatternDetector-->>OuterLoop: Patterns[]

    OuterLoop->>LearningManager: consolidate(learnings)
    LearningManager-->>OuterLoop: kept, promoted, removed

    OuterLoop->>LearningManager: generateGuidelineProposals()
    LearningManager-->>OuterLoop: Proposals[]

    loop For each guideline update
        OuterLoop->>LearningManager: applyGuidelineUpdate()
        LearningManager->>Storage: Update guideline file
    end

    OuterLoop->>Storage: Generate digest
    OuterLoop->>Webhooks: Send digest notification
    OuterLoop-->>CLI: Result
    CLI-->>User: Summary
```

## File Structure

```
project/
├── OPHAN.md                      # Agent entry point
├── .ophan.yaml                   # Configuration
└── .ophan/
    ├── guidelines/               # Agent CAN edit
    │   ├── coding.md            # Coding workflows
    │   ├── testing.md           # Testing practices
    │   └── learnings.md         # Extracted learnings
    ├── criteria/                 # Agent CANNOT edit
    │   ├── quality.md           # Quality standards
    │   └── security.md          # Security requirements
    ├── logs/                     # Task execution logs
    │   └── task-YYYYMMDD-*.json
    ├── digests/                  # Outer loop reports
    │   └── YYYY-MM-DD.md
    └── state.json                # Runtime state
```

## State Management

```mermaid
stateDiagram-v2
    [*] --> Pending: Task created
    Pending --> Running: Execute starts
    Running --> Running: Iteration (eval failed)
    Running --> Converged: Evaluation passed
    Running --> Escalated: Max iterations
    Running --> Escalated: Cost limit
    Running --> Failed: Error
    Converged --> [*]
    Escalated --> [*]
    Failed --> [*]
```

## Key Design Principles

### 1. Learn-Regenerate, Not Edit-Revise

The inner loop does NOT accumulate patches on flawed output:

```mermaid
flowchart LR
    subgraph "Wrong Approach"
        O1[Output v1] --> P1[Patch 1]
        P1 --> P2[Patch 2]
        P2 --> P3[Patch 3...]
    end

    subgraph "Correct Approach"
        G[Guidelines] --> O2[Output v1]
        O2 --> |"Learn"| G
        G --> |"Regenerate"| O3[Output v2]
        O3 --> |"Learn"| G
        G --> |"Regenerate"| O4[Output v3]
    end
```

### 2. Criteria Protection (Reward Hacking Prevention)

```mermaid
flowchart TB
    Agent[Agent] --> |"Can freely update"| Guidelines
    Agent --> |"Can only propose"| Criteria
    Human[Human EITL] --> |"Approves/rejects"| Criteria

    style Criteria fill:#f96,stroke:#333
    style Guidelines fill:#9f9,stroke:#333
```

### 3. Expert in the Loop (EITL)

The outer loop requires external authority for criteria changes:

- **Phase 1 (Current):** Human developer reviews via Git PRs
- **Phase 2+ (Future):** Meta-cognitive agent with fixed evaluation criteria

## Integration Points

### Webhook Events

```mermaid
flowchart LR
    subgraph Events
        E1[escalation]
        E2[task_complete]
        E3[digest]
    end

    subgraph Webhooks
        W1[Slack]
        W2[PagerDuty]
        W3[Custom API]
    end

    E1 --> W1
    E1 --> W2
    E2 --> W3
    E3 --> W1
```

## Performance Considerations

| Component | Complexity | Notes |
|-----------|------------|-------|
| Pattern Detection | O(n²) | Signature clustering across task logs |
| Learning Similarity | O(n²) | Pairwise comparison with word overlap |
| Guideline Updates | O(1) | Append-only file operations |
| Digest Generation | O(n) | Linear scan of task logs |

## Security Model

```mermaid
flowchart TB
    subgraph "Protected"
        Criteria[Criteria Files]
        Blocklist[Blocked Commands]
    end

    subgraph "Sandboxed"
        Tools[Tool Execution]
        Shell[Shell Commands]
    end

    subgraph "Open"
        Guidelines[Guidelines]
        Learnings[Learnings]
    end

    Agent --> |"Read only"| Protected
    Agent --> |"Restricted"| Sandboxed
    Agent --> |"Full access"| Open
```

## Next Steps

- [Inner Loop Documentation](./inner-loop.md)
- [Outer Loop Documentation](./outer-loop.md)
- [Configuration Reference](./configuration.md)
- [CLI Reference](./cli.md)
