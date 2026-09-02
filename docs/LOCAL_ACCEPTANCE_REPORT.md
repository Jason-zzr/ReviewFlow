# ReviewFlow MVP local acceptance report

Date: 2026-09-01  
Scope: Windows local build and fixture-based acceptance only

## Result

The local MVP implementation is buildable and its Windows x64 installer is available at `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.

- TypeScript domain tests: 15 passed, including the 30-day publication and due-only T+3 completion-rate contract.
- Electron main-process tests: 5 passed for managed media boundaries plus workspace persistence and migration-version enforcement.
- Python publisher tests: 43 passed, including publisher schema-version persistence.
- npm audit: 0 vulnerabilities at the configured high threshold.
- Python dependency check: no broken requirements; pinned publisher dependencies verified.
- Packaged Sidecar: healthy; unauthenticated API request returned 401.
- Packaged publisher runtime: offline doctor passed for Patchright, the system browser, and Biliup 1.2.4.
- Xiaohongshu, Douyin, and Bilibili packaged account checks all returned `account_auth_required` with exit code 20 when no credentials were present.
- Packaged desktop startup: Electron and its embedded Sidecar remained running during the startup probe; managed media remained present across startup and clean user data contained no real-publishing opt-in setting.
- The NSIS installer completed into a fresh temporary directory, the installed desktop and Sidecar stayed healthy with a minimal system `PATH`, and the silent uninstaller removed the test installation successfully.
- The desktop **今日** view was rendered and visually checked at 1440 × 920 with the persisted MVP validation tracker and rubric progress visible.

## Release artifact

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `ReviewFlow-0.1.0-x64-setup.exe` | 234,892,363 | `96fc26a34312c7c05c3adaccdea245764c4428f94d779eeb62756694972f03ff` |
| `reviewflow-sidecar.exe` | 14,586,062 | `76b628fe5a4caa22176a3ffff7b14f2c92f405e5a03ba4c9e42aba05e5d0f32a` |
| `reviewflow-sau.exe` | 99,782,755 | `98ce33cfb2f7462b58ac67707ec8565a7b6108b5ad6c0bda64f918710fbb194b` |
| `biliup.exe` | 33,895,936 | `5500912978355e7a64dbbe86ebd7ade2cd4ec8bbc91e16998e4aea7359d0fcdd` |

## Outstanding acceptance gate

No real platform login, public post, native scheduled post, or live metric collection was performed. Those checks require a fresh authorization record for the exact account, content, schedule, manifest digest, and idempotency key described in `REAL_PLATFORM_ACCEPTANCE.md`. Fixture and local package evidence must not be presented as real-platform acceptance.
