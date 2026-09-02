# ReviewFlow MVP local acceptance report

Date: 2026-09-03
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 39 passed, including immutable score-card snapshots, prediction-owned content kind, validated freeze timestamps, domain-filtered contextual prediction history, empirical P10/P50/P90 ranges, observed bucket distributions, versioned prediction rationale, retrospective publication linkage and detached actual-metric snapshots, complete and uniquely linked formula calibration samples, immutable experiment records, auditable rubric activation/version history, tie-aware correlations, strict pairwise non-regression, the 30-day publication target, and T+3 capture-time contracts.
- Electron tests: 30 passed for BYOK key isolation, transactional configuration/credential persistence, damaged-credential recovery, managed media boundaries, portable workspace bundles, workspace persistence, migration-version enforcement, unfinished onboarding recovery, exact diagnostic-export allowlisting, Sidecar recovery-path policy, multi-job recovery, content-kind-aware frozen publication-context selection, bridge-payload detachment from Vue reactive proxies, and quote-aware metrics CSV parsing with structural validation.
- Real-Electron renderer E2E: 3 fixture-only scenarios passed for a video flow, an image/text flow, and a platform-challenge flow. The video scenario imports a BOM-prefixed CSV containing a quoted newline, comma, and escaped quotes; the image/text scenario retains manual metric entry. Both complete scenarios verify visible per-dimension score evidence and suggestions, rubric/model/prompt metadata, prediction P10/P50/P90 ranges and baseline rationale, immutable preview, per-task confirmation, idempotent execution, explicit publication confirmation, six-metric actual-versus-predicted T+3 comparison, and retrospective generation; the challenge scenario stops at `userActionRequired` and never displays synthetic success. The isolated preload performs no platform request and reads no user credentials.
- Python publisher tests: 92 passed, including detached retrospective actual-metric snapshots, sequential/partial/future-version migration behavior, the complete platform-adapter contract, immediate challenge/risk-control process termination, UTF-8 child-process handling, non-synthetic uploader success, condition-aware account checks, desktop-parity empirical prediction ranges/buckets/protocol metadata, CLI retrospective publication linkage, manifest timezone enforcement, multi-video rejection, confirmed-publication metric and evidence linkage, immutable terminal metric tasks, atomic publish and token-fenced metric-task claims, persisted job/task listing, account-command output redaction, and Windows parent-process lifecycle handling.
- npm audit: 0 vulnerabilities at the configured high threshold.
- Python dependency check: no broken requirements; pinned publisher dependencies verified.
- Packaged Sidecar: healthy; unauthenticated API request returned 401.
- Packaged publisher runtime: offline doctor passed for Patchright, the system browser, and Biliup 1.2.4.
- Xiaohongshu, Douyin, and Bilibili packaged account checks all returned `account_auth_required` with exit code 20 when no credentials were present.
- Packaged desktop startup: Electron and its embedded Sidecar remained running during the startup probe; managed media remained present across startup and clean user data contained no real-publishing opt-in setting.
- The reusable `scripts/smoke-installed-release.ps1` check installed the NSIS package into a validated temporary directory with a minimal system `PATH`; the installed desktop and both PyInstaller Sidecar process levels stayed alive, real publishing remained disabled, force-ending Electron released the Sidecar, and the silent uninstaller plus guarded temporary cleanup completed successfully.
- The desktop **今日** view was rendered and visually checked at 1440 × 920 with the persisted MVP validation tracker, account-scoped rubric progress, and formula version history visible.
- [GitHub-hosted CI 33658717922](https://github.com/Jason-zzr/ReviewFlow/actions/runs/33658717922) completed successfully for commit `6a96eb3`. Its `verify` and `windows-release` jobs passed and produced the 359,384,634-byte `reviewflow-windows-6a96eb39380041b4fe1ea78b87c8b18c7fad858f` artifact with GitHub digest `sha256:c4a1dd8aeb74575c8831d9ee4eb9134523e2ad41856c7553c441baa454adcf43`; every pushed release candidate still requires a matching hosted run.

## Release artifact

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,911,956 | `1ebe618b90617175ea0dcb25f2100e3b9f763175cfa0129b1649cd23766e2564` |
| `reviewflow-sidecar.exe` | 14,592,051 | `31d2f0b68f1fcaacb6d94db76eac54474f5f01ff6d0a57c8e638f40f477f4db9` |
| `reviewflow-sau.exe` | 99,782,083 | `a0a4f00a2ce7dc0af8b3766820328598c76bb25c213af45ee4ef3080d41b7fdd` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gates

The fixture suites cover the domain, real Electron renderer, Electron main process, Sidecar API, adapters, CLI, persistence, and installed package. Renderer coverage remains fixture-only and therefore does not establish real-platform behavior.

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
