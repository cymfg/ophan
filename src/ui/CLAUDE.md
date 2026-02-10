# src/ui/

Express web dashboard with WebSocket real-time updates.

## Structure

- `server.ts` — Factory function `createUIServer()` returning Express app, HTTP server, WebSocket server
- `routes/` — Route handlers (currently inlined in server.ts)
- `public/` — Frontend assets (HTML, CSS, JS)
  - `public/assets/app.js` — Client-side SPA with multi-page navigation

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Project status, metrics, goals overview |
| GET/PUT | `/api/config` | Load/save configuration |
| GET | `/api/logs` | Paginated task logs |
| GET | `/api/logs/:id` | Detailed task log |
| GET | `/api/guidelines`, `/api/criteria` | Load guideline/criteria content |
| GET | `/api/goals` | Goal definitions with runtime state |
| GET | `/api/learnings` | Extracted learnings |
| GET | `/api/proposals` | Pending proposals |
| POST | `/api/proposals/:id/approve\|reject` | Accept/reject proposals |
| POST | `/api/review` | Trigger outer loop review |
| GET | `/api/task/current` | Current running task |
| POST | `/api/task` | Submit a new task |
| GET | `/api/context-stats` | Context usage metrics |
| GET | `/api/orchestrator/*` | Orchestrator agent endpoints |

## Patterns

- Task and review operations run in background, return immediately
- WebSocket broadcasts events to all connected clients for real-time updates
- Prevents concurrent task execution via running task state check
- Proposal application supports APPEND directive
- HTML escaping to prevent XSS in client-side rendering
- Client-side WebSocket auto-reconnects after 3 seconds on disconnect
