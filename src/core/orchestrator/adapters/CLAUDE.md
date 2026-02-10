# src/core/orchestrator/adapters/

Messaging adapter abstraction for the Orchestrator Agent.

## Files

| File | Export | Purpose |
|------|--------|---------|
| `types.ts` | `MessagingAdapter` interface, `IncomingMessage`, `UserPrompt`, `OrchestratorNotification` | Abstract adapter contract |
| `cli-adapter.ts` | `CLIAdapter` class | Readline-based CLI implementation |

## MessagingAdapter Interface

- `start()` / `stop()` — Lifecycle management
- `onMessage(callback)` — Register handler for incoming user messages
- `sendResponse(response)` — Send orchestrator response to user
- `promptUser(prompt)` — Ask user for confirmation/selection
- `sendNotification(notification)` — Priority-based notifications

## Adding a New Adapter

1. Create `<name>-adapter.ts` implementing `MessagingAdapter`
2. Handle message formatting for the target platform
3. Map notification priorities to platform-appropriate display
4. Register in `OrchestratorAgent` initialization

## CLIAdapter Details

- Gold color styling for brand consistency
- Handles `/quit` command for session exit
- Numbered option selection for prompts
- Priority icons for notifications (info, warning, critical)
