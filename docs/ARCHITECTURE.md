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
       │                      ├─ Electron parent watchdog
       │                      ├─ SQLite publish jobs
       │                      ├─ manifest verification
       │                      ├─ resumable T+3 collection queue
       │                      └─ guarded sau adapters
       │                               │
       └───────────────────────────────┴──> XHS / Douyin / Bilibili
```

Each process owns a separate WAL-mode SQLite database and migration domain. Electron stores creator workspace state in `userData/data/reviewflow.sqlite3`; Python stores publishing, confirmation, metric, and T+3 records in `userData/publisher-data/reviewflow.sqlite3`. Electron alone owns BYOK secrets, while Python owns DPAPI-protected platform credentials. Neither process sends credentials to the Vue renderer.

Electron supplies its process ID to the packaged Sidecar. Intentional restart/exit terminates the complete Windows process tree; if Electron crashes, the Sidecar watchdog observes the terminated parent and exits independently so it cannot retain ports or installed files.

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
