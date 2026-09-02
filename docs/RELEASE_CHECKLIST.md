# Windows MVP release checklist

## Reproducible build

- [ ] Use Node.js 22 and CPython 3.10.
- [ ] Install `services/publisher[dev,live]` with `constraints-live.txt`.
- [ ] Confirm the omnipost source commit equals `012caee407f2ee9cca8857579b23721c8b6e7f63`.
- [ ] Run `npm.cmd run check`.
- [ ] Confirm all three fixture-only real-Electron renderer scenarios pass; they must not read credentials or contact a platform.
- [ ] Run `scripts/smoke-publisher.ps1 -MinimalPath` and confirm `doctor` plus all three unauthenticated platform checks pass.
- [ ] Run `npm.cmd run package:win`.
- [ ] Confirm the installer contains `reviewflow-sidecar.exe` and `reviewflow-sau.exe`.
- [ ] Record SHA-256 hashes for the installer and embedded publisher executables.

The Windows CI `verify` job enforces publisher dependency provenance, `npm.cmd run check`, and the high-severity npm audit. Its dependent `windows-release` job runs the same `npm.cmd run package:win` command used locally, exercises `scripts/smoke-installed-release.ps1` in a guarded temporary directory with a minimal system `PATH`, fails if any required embedded executable is missing, and uploads the installer, blockmap, all three embedded publisher executables, and `release-sha256.txt` for 14 days. A green hosted run is release evidence, but does not replace the manual UI or real-platform checks below.

## Clean Windows verification

- [ ] Install on a Windows user account without system Python.
- [ ] Run `scripts/smoke-publisher.ps1` against the packaged `resources/publisher` executables with `-MinimalPath`.
- [ ] Complete the first-run guide and restart the application.
- [ ] Confirm real publishing is off by default, persists only after an explicit user switch, and restarting the Sidecar applies the change.
- [ ] Confirm scoring, prediction, workspace persistence, portable export/import, and diagnostics.
- [ ] Move an exported workspace bundle to a fresh user-data directory, import `workspace.reviewflow.json`, and confirm every referenced media file is copied into the new managed library with matching content.
- [ ] Select media, confirm a managed copy exists under application user data, restart, and confirm the managed copy remains eligible for preview without exposing unrelated local files.
- [ ] Confirm the diagnostic file excludes credentials, content bodies, media paths, and raw platform payloads.
- [ ] Open each platform login terminal; leave QR/captcha interaction to the operator.
- [ ] Confirm `.dpapi` credential files do not contain plaintext Cookie markers and temporary session directories are removed.
- [ ] Confirm duplicate confirmation clicks and concurrent execute requests reuse one atomically claimed idempotency-bound job.
- [ ] Confirm a video manifest with more than one video file is rejected before execution.
- [ ] Confirm a stopped uploader becomes `unknown`, not `published`.
- [ ] Force-end the desktop process, wait for the parent watchdog, and confirm no packaged Sidecar process remains before uninstalling.
- [ ] Confirm a challenge, risk-control marker, or expired Cookie interrupts the publisher process and stops with `userActionRequired`.
- [ ] Confirm the immutable manifest, all publication job statuses, frozen publication contexts, and T+3 task states recover after an application restart.
- [ ] Confirm concurrent T+3 collectors claim one task once, an abandoned lease becomes recoverable, and failed automatic collection requests manual input.

## Release boundary

- [ ] Do not claim real-platform acceptance from fixture or dry-run evidence.
- [ ] Follow `REAL_PLATFORM_ACCEPTANCE.md` separately for each authorized account and manifest.
- [ ] Do not sign, publish, upload, or create a release unless the maintainer explicitly authorizes that external action.
