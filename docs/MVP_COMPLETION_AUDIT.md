# ReviewFlow MVP completion audit

Date: 2026-09-02
Rule: fixture or local evidence never counts as real-platform acceptance.

## Requirement evidence

| Area | Required outcome | Current evidence | Status |
| --- | --- | --- | --- |
| Product scope | Local-first Windows desktop for individual creators; Xiaohongshu, Douyin, and Bilibili only | Electron/Vue workspace, FastAPI Sidecar, three-platform registry and capability endpoint | Locally verified |
| Content workflow | Master content, editable platform variants, scoring evidence, frozen interval predictions and benchmark fallback | `packages/domain`, immutable score cards, domain-filtered account/platform/kind history, prediction-owned content kind, platform variant editor, schema-validated BYOK scoring, and CLI benchmark fallback | Locally verified |
| Publish control | Immutable digest, exact summary, per-task confirmation, idempotency and `submitted/processing` not shown as success | Shared Python `PublishService`, SQLite-backed atomic job claim/listing, persisted desktop manifest and multi-job status recovery, interactive CLI and concurrent fixture tests | Locally verified |
| Adapter behavior | Capabilities, login/check, validation, preview, publish, local status and metric collection semantics | Complete adapter interface contract, `SauAdapter`, account endpoints, publication status endpoint and metric adapter/API composition | Locally verified; live platform response pending |
| Scheduling | Use platform-native scheduling only and preserve local wall-clock semantics | Uploader commands use native `--schedule`; timezone contract test rejects naive timestamps | Locally verified |
| T+3 loop | Persist 72-hour work, resume on restart, retry safely, reject early snapshots, then require manual/CSV fallback | Versioned publisher SQLite queue, atomic claim leases with stale-worker token fencing, Electron-authorized task-list recovery, exact confirmed platform/reference checks for schedule and fetch, immutable task evidence, publication-linked snapshot validation, three-attempt backoff, manual/CSV UI and scheduler tests | Locally verified |
| Formula lifecycle | Ten same-context complete samples, experimental weights, non-regressing backtest and explicit activation | Domain-enforced unique one-to-one retro/sample IDs, account/platform/kind equality, complete samples, finite performance, tie-aware correlations, strict pairwise non-regression, and explicit activation | Locally verified |
| MVP metric | In 30 days, track at least eight confirmed publications and at least 80% completion among T+3-due work | Persisted publication records and the **今日** validation view | Instrumented; real 30-day outcome pending |
| Credentials | Renderer cannot retrieve stored secrets; Cookies/API keys encrypted at rest; temporary Sidecar credential exposure only | Electron `safeStorage`, Windows DPAPI publisher sessions and security tests | Locally verified |
| Local data | Versioned SQLite business state, application-managed media, portable import/export and redacted diagnostics | Desktop `PRAGMA user_version`, transactional publisher v1→v2→v3→v4 migrations with future-version rejection, managed media plus workspace bundle round-trip/integrity tests, and exact diagnostic-allowlist regression test | Locally verified |
| CLI | `account`, `content`, `publish`, and `retro` command groups with interactive execute confirmation | All five CLI help probes exit 0; publish CLI contract tests; account child-process output redaction test | Locally verified |
| Windows distribution | No system Python required; embedded Sidecar/uploader; clean installation path works without orphan runtimes | Guarded `smoke-installed-release.ps1` temporary install/uninstall, minimal-`PATH` startup, real-publishing default check, unfinished-onboarding recovery test, forced-parent-exit lifecycle check, Sidecar/uploader smoke tests; [hosted CI #4](https://github.com/Jason-zzr/ReviewFlow/actions/runs/33641448116) passed on commit `b4b4466`; the current workflow also uploads every runtime named by the hash manifest | Locally verified on current Windows host; current unpushed batch awaits its hosted run |
| Licensing | MIT project license and pinned upstream provenance/licenses | `THIRD_PARTY_NOTICES.md` and `licenses/` | Verified |
| Real publishing | Human-authorized login, exact account/content/time, real post verification and external reference | No authorization record supplied | Pending external gate |
| Real T+3 evidence | Collect or manually import the actual platform result after 72 hours and complete a retrospective | Requires a real confirmed publication and elapsed T+3 | Pending external gate |

## Latest local acceptance

- Domain: 33 tests passed, including immutable score snapshots, prediction-owned content kind, validated freeze timestamps, contextual history filtering, publication-linked retrospectives, unique same-context formula samples, tie-aware correlations, and strict pairwise non-regression.
- Electron: 20 tests passed, including portable workspace media round-trip, unfinished-onboarding recovery, diagnostic allowlisting, exact Sidecar recovery-path policy, multi-job recovery, and content-kind-aware frozen publication-context validation.
- Publisher: 74 tests passed, including the complete adapter contract, forced concurrent publish/metric races, stale-worker-fenced claim-lease recovery, manifest timezone validation, multi-video rejection, confirmed-publication metric linkage, evidence-bound fetch/schedule behavior, terminal-task immutability, and persisted job/task listings; one non-blocking Starlette/httpx deprecation warning.
- Installer: `apps/desktop/release/ReviewFlow-0.1.0-x64-setup.exe`.
- Installer SHA-256: `a8818966bd7579b8e90cfd793c980a8de84bceca0dc10bb4a2d2d0682c3eb43e`.

## Remaining authorization record

Before a real run, record the platform, exact account alias, title, managed media filenames, immediate/native schedule time, manifest digest, idempotency key, operator timestamp, and whether the post may remain public. Any manifest change invalidates that authorization.
