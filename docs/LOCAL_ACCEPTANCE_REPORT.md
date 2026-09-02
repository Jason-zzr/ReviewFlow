# ReviewFlow MVP local acceptance report

Date: 2026-09-03
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 35 passed, including immutable score-card snapshots, prediction-owned content kind, validated freeze timestamps, domain-filtered contextual prediction history, retrospective publication linkage, complete and uniquely linked formula calibration samples, immutable experiment records, auditable rubric activation/version history, tie-aware correlations, strict pairwise non-regression, the 30-day publication target, and T+3 capture-time contracts.
- Electron tests: 24 passed for BYOK key isolation, transactional configuration/credential persistence, damaged-credential recovery, managed media boundaries, portable workspace bundles, workspace persistence, migration-version enforcement, unfinished onboarding recovery, exact diagnostic-export allowlisting, Sidecar recovery-path policy, multi-job recovery, content-kind-aware frozen publication-context selection, and bridge-payload detachment from Vue reactive proxies.
- Real-Electron renderer E2E: 3 fixture-only scenarios passed for a video flow, an image/text flow, and a platform-challenge flow. The video and image/text scenarios traverse scoring, prediction, immutable preview, per-task confirmation, idempotent execution, explicit publication confirmation, T+3 metric input, and retrospective generation; the challenge scenario stops at `userActionRequired` and never displays synthetic success. The isolated preload performs no platform request and reads no user credentials.
- Python publisher tests: 88 passed, including sequential/partial/future-version migration behavior, the complete platform-adapter contract, immediate challenge/risk-control process termination, UTF-8 child-process handling, non-synthetic uploader success, condition-aware account checks, desktop-parity structured CLI prediction, CLI retrospective publication linkage, manifest timezone enforcement, multi-video rejection, confirmed-publication metric and evidence linkage, immutable terminal metric tasks, atomic publish and token-fenced metric-task claims, persisted job/task listing, account-command output redaction, and Windows parent-process lifecycle handling.
- npm audit: 0 vulnerabilities at the configured high threshold.
- Python dependency check: no broken requirements; pinned publisher dependencies verified.
- Packaged Sidecar: healthy; unauthenticated API request returned 401.
- Packaged publisher runtime: offline doctor passed for Patchright, the system browser, and Biliup 1.2.4.
- Xiaohongshu, Douyin, and Bilibili packaged account checks all returned `account_auth_required` with exit code 20 when no credentials were present.
- Packaged desktop startup: Electron and its embedded Sidecar remained running during the startup probe; managed media remained present across startup and clean user data contained no real-publishing opt-in setting.
- The reusable `scripts/smoke-installed-release.ps1` check installed the NSIS package into a validated temporary directory with a minimal system `PATH`; the installed desktop and both PyInstaller Sidecar process levels stayed alive, real publishing remained disabled, force-ending Electron released the Sidecar, and the silent uninstaller plus guarded temporary cleanup completed successfully.
- The desktop **今日** view was rendered and visually checked at 1440 × 920 with the persisted MVP validation tracker, account-scoped rubric progress, and formula version history visible.
- [GitHub-hosted CI #5](https://github.com/Jason-zzr/ReviewFlow/actions/runs/33646258618) completed successfully for commit `7ab6e83` in 8m50s. It produced the 343 MB `reviewflow-windows-7ab6e835440b46b834ce9e688527f46b2ad4efa4` artifact with GitHub digest `sha256:2984b68215f67b0f455a1c4b2c640228fdd5dc58bc4a3f57e74d582865f84d93`; every pushed release candidate still requires a matching hosted run.

## Release artifact

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,911,349 | `11c3d67e84fd4963c6f911a86d2bc1845657efca65a4c70f6007f2acbc05b298` |
| `reviewflow-sidecar.exe` | 14,592,632 | `f9c186ec587bb77fa46d4cb842d30c131f66fef30fbd60790bbf60e6af568e00` |
| `reviewflow-sau.exe` | 99,782,284 | `87c7f3d73b05a2aaa74725c661eeb4ea8a66e06ff73ec96310383fb5bfcfd803` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gates

The fixture suites cover the domain, real Electron renderer, Electron main process, Sidecar API, adapters, CLI, persistence, and installed package. Renderer coverage remains fixture-only and therefore does not establish real-platform behavior.

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
