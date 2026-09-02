# ReviewFlow

ReviewFlow is a local-first Windows desktop tool for individual creators. It turns content operations into an auditable loop:

`score → blind prediction → exact publish approval → T+3 metrics → retrospective → rubric experiment`

The first release supports Xiaohongshu, Douyin, and Bilibili through a guarded adapter layer. Live publishing is off by default; an uploader process exiting successfully is recorded as `unknown`, never as proof that a post is live.

## What works

- Equal-weight seven-dimension starter rubric with evidence for every score.
- Independent account × platform × content-type interval predictions with sample-size confidence.
- Deep-frozen predictions and SHA-256 publish manifests whose idempotency keys are digest-bound.
- Resumable SQLite T+3 collection queue, manual/CSV metric snapshots, and Bilibili public metric collection.
- A local 30-day validation tracker for the eight-publication target and due-only T+3 retrospective completion rate.
- Ten-sample rubric experiments with backtest gates and explicit activation.
- Electron `safeStorage` for BYOK credentials; the renderer never receives stored API keys.
- Portable workspace bundles include managed media, verify SHA-256 integrity on import, and retain legacy JSON import compatibility.
- Credential-free diagnostic export.
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
npm.cmd run typecheck
npm.cmd run test --workspace @reviewflow/domain
services\publisher\.venv\Scripts\python.exe -m pytest services\publisher\tests
npm.cmd run build
```

Core CLI examples:

```powershell
reviewflow account check bilibili creator-bili
reviewflow account login bilibili creator-bili
reviewflow content score .\assessment.json
reviewflow content predict .\history.json --score 8
reviewflow publish preview .\manifest.json
reviewflow publish execute .\manifest.json --confirm <digest> --idempotency-key <stable-key>
reviewflow retro run --prediction .\prediction.json --snapshot .\snapshot.json --published-at 2026-09-01T00:00:00Z
```

The desktop starts the Python sidecar with a random session token. Real publishing is disabled by default. Enable it explicitly from **模型设置 → 发布安全开关**; changing the switch restarts the authenticated local Sidecar so the new policy takes effect.

For development and controlled automation, an environment override is also available:

```powershell
$env:REVIEWFLOW_LIVE_PUBLISH = "1"
npm.cmd run dev
```

The environment override governs the whole process and makes the desktop switch read-only. Neither method bypasses exact manifest confirmation. QR codes, captchas, risk controls, and other platform challenges always require the user.

Build a Windows installer and both embedded Python executables with:

```powershell
npm.cmd run package:win
```

The build creates and uses a project-local Python 3.10 environment; an installed ReviewFlow application does not require system Python.

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
