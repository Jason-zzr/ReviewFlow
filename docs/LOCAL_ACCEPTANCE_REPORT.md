# ReviewFlow MVP local acceptance report

Date: 2026-09-02
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 16 passed, including the 30-day publication, due-only T+3 completion-rate, and snapshot capture-time contracts.
- Electron main-process tests: 8 passed for managed media boundaries, portable workspace bundles, workspace persistence and migration-version enforcement.
- Python publisher tests: 49 passed, including publisher schema-version persistence, T+3 snapshot capture-time parity, and Windows parent-process lifecycle handling.
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
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,891,969 | `b191f7269473f0498a7235d40b505b457ed5fdd58a81afa22b3f92fc6d692f60` |
| `reviewflow-sidecar.exe` | 14,585,272 | `64ea559dae98df4fc490062f4d9f3462e8a5d4905ea20853378ef77f6b344f78` |
| `reviewflow-sau.exe` | 99,782,361 | `f05e7ffead54fb052a74db15a85f7f0ed9d2a782e3ef062a5f5596ea6a101198` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gate

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
