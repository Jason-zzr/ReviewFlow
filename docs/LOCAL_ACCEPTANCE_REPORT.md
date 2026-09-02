# ReviewFlow MVP local acceptance report

Date: 2026-09-03
Scope: Windows local build, fixture-based platform acceptance, and isolated real-workspace lifecycle acceptance

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 39 passed, including immutable score-card snapshots, prediction-owned content kind, validated freeze timestamps, domain-filtered contextual prediction history, empirical P10/P50/P90 ranges, observed bucket distributions, versioned prediction rationale, retrospective publication linkage and detached actual-metric snapshots, complete and uniquely linked formula calibration samples, immutable experiment records, auditable rubric activation/version history, tie-aware correlations, strict pairwise non-regression, the 30-day publication target, and T+3 capture-time contracts.
- Electron tests: 33 passed for BYOK key isolation, transactional configuration/credential persistence, damaged-credential recovery, managed media boundaries, portable workspace bundles, workspace persistence, explicit version-zero migration with legacy-payload preservation, strict legacy column-shape validation, rollback on incompatible legacy schemas, future-version rejection, unfinished onboarding recovery, exact diagnostic-export allowlisting, Sidecar recovery-path policy, multi-job recovery, content-kind-aware frozen publication-context selection, bridge-payload detachment from Vue reactive proxies, and quote-aware metrics CSV parsing with structural validation.
- Real-Electron E2E: 5 local scenarios passed. Three fixture-driven publishing scenarios cover video, image/text, and platform-challenge handling. The video scenario imports a BOM-prefixed CSV containing a quoted newline, comma, and escaped quotes; the image/text scenario retains manual metric entry. Both complete publishing scenarios verify visible per-dimension score evidence and suggestions, rubric/model/prompt metadata, prediction P10/P50/P90 ranges and baseline rationale, immutable preview, per-task confirmation, idempotent execution, explicit publication confirmation, six-metric actual-versus-predicted T+3 comparison, and retrospective generation; the challenge scenario stops at `userActionRequired` and never displays synthetic success. Two additional phases launch the production main process in separate Electron processes against the same isolated `userData`, complete first-run onboarding and edit content through the renderer, then prove the production preload/IPC/SQLite path restores that state after a full restart. No scenario performs a platform request or reads user credentials.
- Python publisher tests: 93 passed, including explicit authenticated adapter-factory injection, detached retrospective actual-metric snapshots, sequential/partial/future-version migration behavior, the complete platform-adapter contract, immediate challenge/risk-control process termination, UTF-8 child-process handling, non-synthetic uploader success, condition-aware account checks, desktop-parity empirical prediction ranges/buckets/protocol metadata, CLI retrospective publication linkage, manifest timezone enforcement, multi-video rejection, confirmed-publication metric and evidence linkage, immutable terminal metric tasks, atomic publish and token-fenced metric-task claims, persisted job/task listing, account-command output redaction, and Windows parent-process lifecycle handling.
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
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,915,569 | `da224ca2b44a6426d4a2d3e972192684fdf1f19d771849a96479b82bd1a5e568` |
| `reviewflow-sidecar.exe` | 14,593,581 | `0e7260dc01540f54ec305776b9b3fb0fbdb8959b750851e8bc268ab88e89b324` |
| `reviewflow-sau.exe` | 99,781,991 | `de4b140d53472824e700ae6d8041875114884d91025513edb598680fea6c6036` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gates

The fixture suites cover the domain, real Electron renderer, Electron main process, Sidecar API, adapters, CLI, persistence, and installed package. Renderer coverage remains fixture-only and therefore does not establish real-platform behavior.

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
