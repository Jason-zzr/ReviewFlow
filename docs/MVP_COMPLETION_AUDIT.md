# ReviewFlow MVP completion audit

Date: 2026-09-01  
Rule: fixture or local evidence never counts as real-platform acceptance.

## Requirement evidence

| Area | Required outcome | Current evidence | Status |
| --- | --- | --- | --- |
| Product scope | Local-first Windows desktop for individual creators; Xiaohongshu, Douyin, and Bilibili only | Electron/Vue workspace, FastAPI Sidecar, three-platform registry and capability endpoint | Locally verified |
| Content workflow | Master content, editable platform variants, scoring evidence, frozen interval predictions and benchmark fallback | `packages/domain`, platform variant editor, schema-validated BYOK scoring, domain tests | Locally verified |
| Publish control | Immutable digest, exact summary, per-task confirmation, idempotency and `submitted/processing` not shown as success | Shared Python `PublishService`, desktop dialog, interactive CLI and fixture tests | Locally verified |
| Adapter behavior | Capabilities, login/check, validation, preview, publish, local status and metric collection semantics | `SauAdapter`, account endpoints, publication status endpoint and metric adapter/API composition | Locally verified; live platform response pending |
| Scheduling | Use platform-native scheduling only and preserve local wall-clock semantics | Uploader commands use native `--schedule`; timezone contract test rejects naive timestamps | Locally verified |
| T+3 loop | Persist 72-hour work, resume on restart, retry safely, then require manual/CSV fallback | Versioned publisher SQLite queue, three-attempt backoff, manual/CSV UI, scheduler tests | Locally verified |
| Formula lifecycle | Ten same-context complete samples, experimental weights, non-regressing backtest and explicit activation | Domain experiment rules and 15 passing domain tests | Locally verified |
| MVP metric | In 30 days, track at least eight confirmed publications and at least 80% completion among T+3-due work | Persisted publication records and the **今日** validation view | Instrumented; real 30-day outcome pending |
| Credentials | Renderer cannot retrieve stored secrets; Cookies/API keys encrypted at rest; temporary Sidecar credential exposure only | Electron `safeStorage`, Windows DPAPI publisher sessions and security tests | Locally verified |
| Local data | Versioned SQLite business state, application-managed media, import/export and redacted diagnostics | Desktop `PRAGMA user_version`, publisher `schema_meta`, managed media tests and diagnostic allowlist | Locally verified |
| CLI | `account`, `content`, `publish`, and `retro` command groups with interactive execute confirmation | All five CLI help probes exit 0; publish CLI contract tests | Locally verified |
| Windows distribution | No system Python required; embedded Sidecar/uploader; clean installation path works | NSIS temporary clean install, minimal-`PATH` startup, Sidecar and uploader smoke tests | Locally verified on current Windows host |
| Licensing | MIT project license and pinned upstream provenance/licenses | `THIRD_PARTY_NOTICES.md` and `licenses/` | Verified |
| Real publishing | Human-authorized login, exact account/content/time, real post verification and external reference | No authorization record supplied | Pending external gate |
| Real T+3 evidence | Collect or manually import the actual platform result after 72 hours and complete a retrospective | Requires a real confirmed publication and elapsed T+3 | Pending external gate |

## Latest local acceptance

- Domain: 15 tests passed.
- Electron main process: 5 tests passed.
- Publisher: 43 tests passed; one non-blocking Starlette/httpx deprecation warning.
- Installer: `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.
- Installer SHA-256: `96fc26a34312c7c05c3adaccdea245764c4428f94d779eeb62756694972f03ff`.

## Remaining authorization record

Before a real run, record the platform, exact account alias, title, managed media filenames, immediate/native schedule time, manifest digest, idempotency key, operator timestamp, and whether the post may remain public. Any manifest change invalidates that authorization.
