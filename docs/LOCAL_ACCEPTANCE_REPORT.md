# ReviewFlow MVP local acceptance report

Date: 2026-09-02
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 31 passed, including immutable score-card snapshots, domain-filtered contextual prediction history, retrospective publication linkage, complete and uniquely linked formula calibration samples, tie-aware correlations, strict pairwise non-regression, the 30-day publication target, and T+3 capture-time contracts.
- Electron tests: 17 passed for managed media boundaries, portable workspace bundles, workspace persistence, migration-version enforcement, unfinished onboarding recovery, exact diagnostic-export allowlisting, multi-job recovery, and frozen publication-context selection.
- Python publisher tests: 67 passed, including sequential/partial/future-version migration behavior, manifest timezone enforcement, multi-video rejection, confirmed-publication metric linkage, atomic publish and metric-task claims, persisted job/task listing, account-command output redaction, and Windows parent-process lifecycle handling.
- npm audit: 0 vulnerabilities at the configured high threshold.
- Python dependency check: no broken requirements; pinned publisher dependencies verified.
- Packaged Sidecar: healthy; unauthenticated API request returned 401.
- Packaged publisher runtime: offline doctor passed for Patchright, the system browser, and Biliup 1.2.4.
- Xiaohongshu, Douyin, and Bilibili packaged account checks all returned `account_auth_required` with exit code 20 when no credentials were present.
- Packaged desktop startup: Electron and its embedded Sidecar remained running during the startup probe; managed media remained present across startup and clean user data contained no real-publishing opt-in setting.
- The reusable `scripts/smoke-installed-release.ps1` check installed the NSIS package into a validated temporary directory with a minimal system `PATH`; the installed desktop and both PyInstaller Sidecar process levels stayed alive, real publishing remained disabled, force-ending Electron released the Sidecar, and the silent uninstaller plus guarded temporary cleanup completed successfully.
- The desktop **今日** view was rendered and visually checked at 1440 × 920 with the persisted MVP validation tracker and rubric progress visible.
- The updated Windows CI workflow was parsed locally, its pinned publisher provenance check passed, its installed-release smoke script completed locally, and its release-manifest command reproduced the hashes below from the packaged `win-unpacked` executables. The first GitHub-hosted run remains pending until these changes are committed and pushed.

## Release artifact

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,902,582 | `ce9ebf676b50259f7404114e9123694614dcf609e5330169183326c8834a2afa` |
| `reviewflow-sidecar.exe` | 14,589,534 | `544483e06d2d84cd61aee44ae0e22b1fceb0096094cac21dc95cd26c67c0113b` |
| `reviewflow-sau.exe` | 99,782,029 | `9ac9a93656506ef9e44f1b996067844456567e23d5486e1c8c5c37133b8ead84` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gate

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
