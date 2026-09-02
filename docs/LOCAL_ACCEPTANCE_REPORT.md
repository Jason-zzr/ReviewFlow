# ReviewFlow MVP local acceptance report

Date: 2026-09-02
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 33 passed, including immutable score-card snapshots, prediction-owned content kind, validated freeze timestamps, domain-filtered contextual prediction history, retrospective publication linkage, complete and uniquely linked formula calibration samples, tie-aware correlations, strict pairwise non-regression, the 30-day publication target, and T+3 capture-time contracts.
- Electron tests: 20 passed for managed media boundaries, portable workspace bundles, workspace persistence, migration-version enforcement, unfinished onboarding recovery, exact diagnostic-export allowlisting, Sidecar recovery-path policy, multi-job recovery, and content-kind-aware frozen publication-context selection.
- Python publisher tests: 74 passed, including sequential/partial/future-version migration behavior, the complete platform-adapter contract, manifest timezone enforcement, multi-video rejection, confirmed-publication metric and evidence linkage, immutable terminal metric tasks, atomic publish and token-fenced metric-task claims, persisted job/task listing, account-command output redaction, and Windows parent-process lifecycle handling.
- npm audit: 0 vulnerabilities at the configured high threshold.
- Python dependency check: no broken requirements; pinned publisher dependencies verified.
- Packaged Sidecar: healthy; unauthenticated API request returned 401.
- Packaged publisher runtime: offline doctor passed for Patchright, the system browser, and Biliup 1.2.4.
- Xiaohongshu, Douyin, and Bilibili packaged account checks all returned `account_auth_required` with exit code 20 when no credentials were present.
- Packaged desktop startup: Electron and its embedded Sidecar remained running during the startup probe; managed media remained present across startup and clean user data contained no real-publishing opt-in setting.
- The reusable `scripts/smoke-installed-release.ps1` check installed the NSIS package into a validated temporary directory with a minimal system `PATH`; the installed desktop and both PyInstaller Sidecar process levels stayed alive, real publishing remained disabled, force-ending Electron released the Sidecar, and the silent uninstaller plus guarded temporary cleanup completed successfully.
- The desktop **今日** view was rendered and visually checked at 1440 × 920 with the persisted MVP validation tracker and rubric progress visible.
- [GitHub-hosted CI #4](https://github.com/Jason-zzr/ReviewFlow/actions/runs/33641448116) completed successfully for commit `b4b4466` in 8m03s. The current local workflow additionally uploads the three embedded runtime files named by the integrity manifest; that artifact-layout change awaits its next hosted run after an authorized push.

## Release artifact

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,906,850 | `a8818966bd7579b8e90cfd793c980a8de84bceca0dc10bb4a2d2d0682c3eb43e` |
| `reviewflow-sidecar.exe` | 14,592,287 | `08d72c3d73046c49472510b32192c4bbf3d0acc7a09c0c4110a69143a609e8e3` |
| `reviewflow-sau.exe` | 99,782,187 | `d67dbc7247f20dd3551ba075f30f4f69694f5da9f0de011d704f103bc19752c0` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gate

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
