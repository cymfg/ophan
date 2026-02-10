# src/integrations/

External service integrations.

## Files

| File | Class | Purpose |
|------|-------|---------|
| `webhook.ts` | `WebhookClient` | Sends notifications to configured webhooks |

## WebhookClient

Sends HTTP notifications for three event types:
- `escalation` — Task hit max iterations or cost limit
- `task_complete` — Task converged, failed, or escalated
- `digest` — Outer loop review summary

### Patterns

- Filters webhooks by subscribed event type before sending
- Interpolates `${VAR_NAME}` in URLs and headers from environment variables
- Throws on missing required environment variables
- Includes project name and path in all payloads
- Sends to multiple webhooks in parallel via `Promise.all()`
- Supports POST and PUT methods
