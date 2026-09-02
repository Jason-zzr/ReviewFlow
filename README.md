# ReviewFlow

ReviewFlow is a local-first Windows desktop tool for individual creators. It turns content operations into an auditable loop:

`score → blind prediction → exact publish approval → T+3 metrics → retrospective → rubric experiment`

The first release supports Xiaohongshu, Douyin, and Bilibili through a guarded adapter layer. Live publishing is off by default; an uploader process exiting successfully is recorded as `unknown`, never as proof that a post is live.

## What works

- Equal-weight seven-dimension starter rubric with evidence and exact, unique dimension coverage for every score.
- The desktop score ledger exposes every dimension's evidence and suggestion together with the exact rubric, model, and prompt version used.
- Independent account × platform × content-type interval predictions that persist their content kind, domain-filter and deduplicate contextual history, ignore unusable metric rows, fall back to benchmarks, and report valid sample-size confidence.
- Prediction protocol `prediction-v2` derives P10/P50/P90 from empirical sample quantiles and bucket probabilities from the most complete metric's observed distribution; results expose the baseline source, sample size, confidence, generation metadata, and recorded rationale.
- Deep-frozen predictions and SHA-256 publish manifests whose idempotency keys are digest-bound and atomically claimed before any uploader starts.
- Resumable SQLite T+3 collection queue with atomic leases, manual/CSV metric snapshots, strict quote-aware CSV validation, and Bilibili public metric collection.
- Retrospective reports retain a detached canonical metrics snapshot and show six-metric actual-versus-predicted comparisons, interval hits, relative errors, and the T+3 deadline.
- A local 30-day validation tracker for the eight-publication target and due-only T+3 retrospective completion rate.
- Ten-sample, same-context rubric experiments with unique one-to-one retrospective linkage, complete-sample validation, visible weight/correlation comparisons, strict pairwise non-regression, explicit activation, and persisted version/audit history.
- Restart recovery for the immutable publish manifest, all Sidecar publication jobs, T+3 task states, and each publication's frozen prediction/score context through an exact Electron request allowlist.
- Electron `safeStorage` for BYOK credentials; the renderer never receives stored API keys.
- Portable workspace bundles include managed media, verify SHA-256 integrity on import, and retain legacy JSON import compatibility.
- Credential-free diagnostic export built from an exact, regression-tested field allowlist.
- First-run onboarding resumes until its completion state is explicitly persisted.
- User-selected media is copied into the application-managed local media library; original files are never modified.
- Authenticated localhost FastAPI sidecar and `reviewflow` CLI.
- Electron process-tree shutdown plus a Sidecar parent watchdog prevent orphaned publisher runtimes after restart, exit, or crash.
- Pinned `omnipost` runtime behind ReviewFlow's guarded `reviewflow-sau` entrypoint.
- Per-command temporary Cookie material with Windows DPAPI-protected credential files at rest.

## Development

Requirements: Node.js 22+, npm 11+, and CPython 3.10–3.12. The upstream publishing runtime does not support Python 3.13.

```powershell
npm.cmd install
py -3.10 -m venv services\publisher\.venv
services\publisher\.venv\Scripts\python.exe -m pip install -e "services\publisher[dev,live]" -c services\publisher\constraints-live.txt
npm.cmd run dev
```

Run checks:

```powershell
npm.cmd run check
```

`npm.cmd run check` covers TypeScript type checking, domain/desktop/publisher tests, production builds, and three real-Electron renderer flows for video, image/text, and platform-challenge handling. The video flow imports a quote-aware CSV fixture while the image/text flow verifies manual metric entry. The renderer flows use an isolated fixture preload: they do not read user credentials, contact a platform, or claim live publishing success.

Core CLI examples:

```powershell
reviewflow account check bilibili creator-bili
reviewflow account login bilibili creator-bili
reviewflow content score .\assessment.json
reviewflow content predict .\history.json --score 8
reviewflow publish preview .\manifest.json
reviewflow publish execute .\manifest.json --confirm <digest> --idempotency-key <stable-key>
reviewflow retro run --prediction .\prediction.json --snapshot .\snapshot.json --published-at 2026-09-01T00:00:00Z --publication-id <confirmed-publication-id>
```

For desktop-parity prediction, the input object includes `id`, `contentId`, `platform`, `accountId`, `kind`, `history`, and `benchmarks`. The CLI then applies the same context filtering, snapshot deduplication, six-metric ranges, bucket probabilities, and baseline rules as the desktop domain module. Legacy metric-row arrays remain supported for scripts that only need a compact views interval.

The desktop starts the Python sidecar with a random session token. Real publishing is disabled by default. Enable it explicitly from **模型设置 → 发布安全开关**; changing the switch restarts the authenticated local Sidecar so the new policy takes effect.

For development and controlled automation, an environment override is also available:

```powershell
$env:REVIEWFLOW_LIVE_PUBLISH = "1"
npm.cmd run dev
```

The environment override governs the whole process and makes the desktop switch read-only. Neither method bypasses exact manifest confirmation. QR codes, captchas, risk controls, and other platform challenges interrupt the publisher process and always require the user; a runtime completion message without platform publish evidence is never synthesized as success.

Build a Windows installer and both embedded Python executables with:

```powershell
npm.cmd run package:win
```

The build creates and uses a project-local Python 3.10 environment; an installed ReviewFlow application does not require system Python.
The Windows CI uses the same release command after the complete quality gate, verifies the pinned publisher provenance, smoke-tests a temporary installation without system Python, and uploads the installer, all three embedded publisher executables, and their SHA-256 manifest as one independently verifiable artifact.

Workspace export creates a portable folder containing `workspace.reviewflow.json` and a `media` directory. Move the whole folder together; import the manifest file on the destination machine. API keys, Cookies, publisher credentials, and local database files are never included.

## Repository layout

- `apps/desktop` — Electron/Vue creator workspace and secure OS integrations.
- `packages/domain` — deterministic scoring, prediction, manifest, state and retrospective rules.
- `services/publisher` — FastAPI sidecar, SQLite jobs, platform adapters, metrics and CLI.
- `docs` — architecture, data contract and security boundaries.

Before distributing a build, review [the current MVP completion audit](docs/MVP_COMPLETION_AUDIT.md) and follow [the Windows release checklist](docs/RELEASE_CHECKLIST.md). Real-account runs use a separate [human authorization gate](docs/REAL_PLATFORM_ACCEPTANCE.md) and are never inferred from fixture evidence.

## Scope boundaries

ReviewFlow does not provide SaaS tenancy, autonomous posting, bulk account scraping, captcha bypass, follower guarantees, or statistically validated virality claims. Xiaohongshu and Douyin performance data currently use manual/CSV fallback; Bilibili supports automatic public metrics by BV ID.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for pinned upstream provenance and required acknowledgements.
