# Architecture

## Containers

```text
┌──────────────────────────────────────────────────────────────────┐
│ Electron                                                         │
│  Vue renderer ──typed preload──> main process                    │
│      │                            │                               │
│      │ no secrets                ├─ DPAPI encrypted API key      │
│      │                            ├─ versioned SQLite workspace   │
│      │                            ├─ managed local media library  │
│      │                            └─ localhost bearer proxy       │
└──────┼───────────────────────────────┬────────────────────────────┘
       │                               │ random token
       │                               ▼
       │                      FastAPI publisher sidecar
       │                      ├─ SQLite publish jobs
       │                      ├─ manifest verification
       │                      ├─ resumable T+3 collection queue
       │                      └─ guarded sau adapters
       │                               │
       └───────────────────────────────┴──> XHS / Douyin / Bilibili
```

Both processes can open different tables in the same WAL-mode SQLite database. Electron owns creator workspace state and secrets. Python owns publishing and metric records. Neither process sends credentials to the Vue renderer.

## Main flow

1. Score content against a versioned rubric and preserve evidence.
2. Build an interval prediction from account history, benchmark samples, or explicit cold-start priors.
3. Freeze the prediction and create a canonical SHA-256 manifest.
4. Show the exact digest and target accounts to the user.
5. Sidecar recomputes the digest, checks idempotency, then invokes the adapter only when live mode is explicitly enabled.
6. Store success as `unknown` until a platform identifier/URL or manual confirmation proves publication.
7. Persist a collection task; the sidecar resumes due tasks on startup, collects supported metrics at 72 hours, or marks the task for manual/CSV input.
8. After ten same-context retrospectives, build an experimental rubric, backtest it, and activate it only after an explicit user action.

## Evolution triggers

Rubric suggestions and activation require ten complete same-context calibration samples, Spearman ranking consistency of at least 0.8, no pairwise regression against observed performance, and explicit user confirmation.
