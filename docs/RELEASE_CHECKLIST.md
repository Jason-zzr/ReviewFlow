# Windows MVP release checklist

## Reproducible build

- [ ] Use Node.js 22 and CPython 3.10.
- [ ] Install `services/publisher[dev,live]` with `constraints-live.txt`.
- [ ] Confirm the omnipost source commit equals `012caee407f2ee9cca8857579b23721c8b6e7f63`.
- [ ] Run `npm.cmd run check`.
- [ ] Run `scripts/smoke-publisher.ps1 -MinimalPath` and confirm `doctor` plus all three unauthenticated platform checks pass.
- [ ] Run `npm.cmd run package:win`.
- [ ] Confirm the installer contains `reviewflow-sidecar.exe` and `reviewflow-sau.exe`.
- [ ] Record SHA-256 hashes for the installer and embedded publisher executables.

## Clean Windows verification

- [ ] Install on a Windows user account without system Python.
- [ ] Run `scripts/smoke-publisher.ps1` against the packaged `resources/publisher` executables with `-MinimalPath`.
- [ ] Complete the first-run guide and restart the application.
- [ ] Confirm real publishing is off by default, persists only after an explicit user switch, and restarting the Sidecar applies the change.
- [ ] Confirm scoring, prediction, workspace persistence, export/import, and diagnostics.
- [ ] Select media, confirm a managed copy exists under application user data, restart, and confirm the managed copy remains eligible for preview without exposing unrelated local files.
- [ ] Confirm the diagnostic file excludes credentials, content bodies, media paths, and raw platform payloads.
- [ ] Open each platform login terminal; leave QR/captcha interaction to the operator.
- [ ] Confirm `.dpapi` credential files do not contain plaintext Cookie markers and temporary session directories are removed.
- [ ] Confirm duplicate confirmation clicks reuse one idempotency-bound job.
- [ ] Confirm a stopped uploader becomes `unknown`, not `published`.
- [ ] Confirm a challenge or expired Cookie stops with `userActionRequired`.
- [ ] Confirm T+3 work resumes after an application restart and failed automatic collection requests manual input.

## Release boundary

- [ ] Do not claim real-platform acceptance from fixture or dry-run evidence.
- [ ] Follow `REAL_PLATFORM_ACCEPTANCE.md` separately for each authorized account and manifest.
- [ ] Do not sign, publish, upload, or create a release unless the maintainer explicitly authorizes that external action.
