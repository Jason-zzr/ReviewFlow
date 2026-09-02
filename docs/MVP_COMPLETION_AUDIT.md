# ReviewFlow MVP completion audit

Date: 2026-09-02
Rule: fixture or local evidence never counts as real-platform acceptance.

## Requirement evidence

| Area | Required outcome | Current evidence | Status |
| --- | --- | --- | --- |
| Product scope | Local-first Windows desktop for individual creators; Xiaohongshu, Douyin, and Bilibili only | Electron/Vue workspace, FastAPI Sidecar, three-platform registry and capability endpoint | Locally verified |
| Content workflow | Master content, editable platform variants, scoring evidence, frozen interval predictions and benchmark fallback | `packages/domain`, immutable score cards, domain-filtered account/platform/kind history, platform variant editor, schema-validated BYOK scoring, and CLI benchmark fallback | Locally verified |
| Publish control | Immutable digest, exact summary, per-task confirmation, idempotency and `submitted/processing` not shown as success | Shared Python `PublishService`, SQLite-backed atomic job claim/listing, persisted desktop manifest and multi-job status recovery, interactive CLI and concurrent fixture tests | Locally verified |
| Adapter behavior | Capabilities, login/check, validation, preview, publish, local status and metric collection semantics | `SauAdapter`, account endpoints, publication status endpoint and metric adapter/API composition | Locally verified; live platform response pending |
| Scheduling | Use platform-native scheduling only and preserve local wall-clock semantics | Uploader commands use native `--schedule`; timezone contract test rejects naive timestamps | Locally verified |
| T+3 loop | Persist 72-hour work, resume on restart, retry safely, reject early snapshots, then require manual/CSV fallback | Versioned publisher SQLite queue, atomic claim leases, persisted task-list recovery, confirmed-publication import checks, publication-linked snapshot validation, three-attempt backoff, manual/CSV UI and scheduler tests | Locally verified |
| Formula lifecycle | Ten same-context complete samples, experimental weights, non-regressing backtest and explicit activation | Domain-enforced unique one-to-one retro/sample IDs, account/platform/kind equality, complete samples, finite performance, tie-aware correlations, strict pairwise non-regression, and explicit activation | Locally verified |
| MVP metric | In 30 days, track at least eight confirmed publications and at least 80% completion among T+3-due work | Persisted publication records and the **今日** validation view | Instrumented; real 30-day outcome pending |
| Credentials | Renderer cannot retrieve stored secrets; Cookies/API keys encrypted at rest; temporary Sidecar credential exposure only | Electron `safeStorage`, Windows DPAPI publisher sessions and security tests | Locally verified |
| Local data | Versioned SQLite business state, application-managed media, portable import/export and redacted diagnostics | Desktop `PRAGMA user_version`, transactional publisher v1→v2→v3 migrations with future-version rejection, managed media plus workspace bundle round-trip/integrity tests, and exact diagnostic-allowlist regression test | Locally verified |
| CLI | `account`, `content`, `publish`, and `retro` command groups with interactive execute confirmation | All five CLI help probes exit 0; publish CLI contract tests; account child-process output redaction test | Locally verified |
| Windows distribution | No system Python required; embedded Sidecar/uploader; clean installation path works without orphan runtimes | Guarded `smoke-installed-release.ps1` temporary install/uninstall, minimal-`PATH` startup, real-publishing default check, unfinished-onboarding recovery test, forced-parent-exit lifecycle check, Sidecar/uploader smoke tests; Windows CI now runs the same installation gate before installer/hash artifact upload | Locally verified on current Windows host; first hosted CI run pending push |
| Licensing | MIT project license and pinned upstream provenance/licenses | `THIRD_PARTY_NOTICES.md` and `licenses/` | Verified |
| Real publishing | Human-authorized login, exact account/content/time, real post verification and external reference | No authorization record supplied | Pending external gate |
| Real T+3 evidence | Collect or manually import the actual platform result after 72 hours and complete a retrospective | Requires a real confirmed publication and elapsed T+3 | Pending external gate |

## Latest local acceptance

- Domain: 31 tests passed, including immutable score snapshots, contextual history filtering, publication-linked retrospectives, unique same-context formula samples, tie-aware correlations, and strict pairwise non-regression.
- Electron: 17 tests passed, including portable workspace media round-trip, unfinished-onboarding recovery, diagnostic allowlisting, multi-job recovery, and frozen publication-context validation.
- Publisher: 67 tests passed, including forced concurrent publish/metric races, claim-lease recovery, manifest timezone validation, multi-video rejection, confirmed-publication metric linkage, and persisted job/task listings; one non-blocking Starlette/httpx deprecation warning.
- Installer: `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.
- Installer SHA-256: `ce9ebf676b50259f7404114e9123694614dcf609e5330169183326c8834a2afa`.

## Remaining authorization record

Before a real run, record the platform, exact account alias, title, managed media filenames, immediate/native schedule time, manifest digest, idempotency key, operator timestamp, and whether the post may remain public. Any manifest change invalidates that authorization.
