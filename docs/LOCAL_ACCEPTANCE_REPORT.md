# ReviewFlow MVP local acceptance report

Date: 2026-09-02
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 19 passed, including strict scoring dimensions, valid-sample prediction fallback, finite score adjustment, the 30-day publication target, due-only T+3 completion rate, and snapshot capture-time contracts.
- Electron tests: 9 passed for managed media boundaries, portable workspace bundles, workspace persistence, migration-version enforcement, and unfinished onboarding recovery.
- Python publisher tests: 57 passed, including sequential/partial/future-version migration behavior, account-command output redaction, benchmark prediction input, strict scoring/prediction validation, T+3 snapshot capture-time parity, and Windows parent-process lifecycle handling.
- npm audit: 0 vulnerabilities at the configured high threshold.
- Python dependency check: no broken requirements; pinned publisher dependencies verified.
- Packaged Sidecar: healthy; unauthenticated API request returned 401.
- Packaged publisher runtime: offline doctor passed for Patchright, the system browser, and Biliup 1.2.4.
- Xiaohongshu, Douyin, and Bilibili packaged account checks all returned `account_auth_required` with exit code 20 when no credentials were present.
- Packaged desktop startup: Electron and its embedded Sidecar remained running during the startup probe; managed media remained present across startup and clean user data contained no real-publishing opt-in setting.
- The NSIS installer completed into a fresh temporary directory with a minimal system `PATH`; the installed desktop and both PyInstaller Sidecar process levels stayed alive, force-ending Electron caused all packaged processes to exit within four seconds, and the silent uninstaller removed the test installation successfully.
- The desktop **今日** view was rendered and visually checked at 1440 × 920 with the persisted MVP validation tracker and rubric progress visible.

## Release artifact

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,898,903 | `999fb01ad883a0ae60572adff3248003a9f2d4ec55c45ed2e9f5ca44c6bcbe19` |
| `reviewflow-sidecar.exe` | 14,589,139 | `77f8bfe1e386b1a6241b3c38641116003599b3ee735229c7d8ea4cbb9e656564` |
| `reviewflow-sau.exe` | 99,782,310 | `49b24494e379b8dc2ec1db13a69b46a8ad15328b3e032de52dc11bf410bf9252` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gate

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
