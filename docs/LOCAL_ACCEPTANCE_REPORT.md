# ReviewFlow MVP local acceptance report

Date: 2026-09-03
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 35 passed, including immutable score-card snapshots, prediction-owned content kind, validated freeze timestamps, domain-filtered contextual prediction history, retrospective publication linkage, complete and uniquely linked formula calibration samples, immutable experiment records, auditable rubric activation/version history, tie-aware correlations, strict pairwise non-regression, the 30-day publication target, and T+3 capture-time contracts.
- Electron tests: 23 passed for BYOK key isolation, transactional configuration/credential persistence, damaged-credential recovery, managed media boundaries, portable workspace bundles, workspace persistence, migration-version enforcement, unfinished onboarding recovery, exact diagnostic-export allowlisting, Sidecar recovery-path policy, multi-job recovery, and content-kind-aware frozen publication-context selection.
- Python publisher tests: 88 passed, including sequential/partial/future-version migration behavior, the complete platform-adapter contract, immediate challenge/risk-control process termination, UTF-8 child-process handling, non-synthetic uploader success, condition-aware account checks, desktop-parity structured CLI prediction, CLI retrospective publication linkage, manifest timezone enforcement, multi-video rejection, confirmed-publication metric and evidence linkage, immutable terminal metric tasks, atomic publish and token-fenced metric-task claims, persisted job/task listing, account-command output redaction, and Windows parent-process lifecycle handling.
- npm audit: 0 vulnerabilities at the configured high threshold.
- Python dependency check: no broken requirements; pinned publisher dependencies verified.
- Packaged Sidecar: healthy; unauthenticated API request returned 401.
- Packaged publisher runtime: offline doctor passed for Patchright, the system browser, and Biliup 1.2.4.
- Xiaohongshu, Douyin, and Bilibili packaged account checks all returned `account_auth_required` with exit code 20 when no credentials were present.
- Packaged desktop startup: Electron and its embedded Sidecar remained running during the startup probe; managed media remained present across startup and clean user data contained no real-publishing opt-in setting.
- The reusable `scripts/smoke-installed-release.ps1` check installed the NSIS package into a validated temporary directory with a minimal system `PATH`; the installed desktop and both PyInstaller Sidecar process levels stayed alive, real publishing remained disabled, force-ending Electron released the Sidecar, and the silent uninstaller plus guarded temporary cleanup completed successfully.
- The desktop **今日** view was rendered and visually checked at 1440 × 920 with the persisted MVP validation tracker, account-scoped rubric progress, and formula version history visible.
- [GitHub-hosted CI #5](https://github.com/Jason-zzr/ReviewFlow/actions/runs/33646258618) completed successfully for commit `7ab6e83` in 8m50s. It produced the 343 MB `reviewflow-windows-7ab6e835440b46b834ce9e688527f46b2ad4efa4` artifact with GitHub digest `sha256:2984b68215f67b0f455a1c4b2c640228fdd5dc58bc4a3f57e74d582865f84d93`; the current source batch requires its own hosted run.

## Release artifact

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,912,337 | `cf45171ffcfee11f5627b48c311da615c72de39716fe4009c323850cd2e6c3b3` |
| `reviewflow-sidecar.exe` | 14,593,924 | `b1d369c3c3fa476fe836a734e2f9148ec5f7f016bb0aa55c8fe65ab3b14704bd` |
| `reviewflow-sau.exe` | 99,781,530 | `e7678a5d40d22d08a20eb3c8c516679d5d69f3a57e384f13151e7a515f678a57` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gates

The fixture suites cover the domain, Electron main process, Sidecar API, adapters, CLI, persistence, and installed package, but an automated renderer-level flow for one video and one image/text item has not yet been added.

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
