# ReviewFlow publisher sidecar

The sidecar binds to `127.0.0.1`, requires a per-session bearer token, and keeps live publishing disabled unless `REVIEWFLOW_LIVE_PUBLISH=1` is set. Install the optional `live` extra to provide the pinned `sau` runtime.

```powershell
py -3.10 -m pip install -e ".[dev]"
$env:REVIEWFLOW_SESSION_TOKEN = "local-development-token"
reviewflow-sidecar
```

No endpoint treats process submission as proof of publication. A successful upstream process is stored as `unknown` until an external URL/ID or a manual confirmation is recorded.

The `account login` and `account check` commands capture uploader output, redact credential values and Cookie paths, and then preserve the uploader's original exit code.

The sidecar also owns a persistent metric collection queue. Due tasks resume whenever the app starts; Bilibili can use its public BV endpoint, while Xiaohongshu and Douyin move to `manual_required` for manual or CSV completion.

Publisher SQLite upgrades are applied sequentially (`v1` base records, `v2` manifest-digest binding, `v3` T+3 queue) in a transaction. A partially applied known migration is safe to resume, while a database from a newer schema version is rejected without downgrade.

`reviewflow content predict` accepts either the legacy history array or a structured prediction object. A structured object carries `id`, `contentId`, `platform`, `accountId`, `kind`, `history`, and `benchmarks`; it returns the complete desktop `Prediction` contract. History is filtered to the exact account/platform/content-kind context and deduplicated by non-blank `snapshotId`; benchmarks are filtered by platform/content kind. Six canonical metric ranges, bucket probabilities, rationale, model/prompt metadata, and confidence use the same deterministic rules as the TypeScript domain module. Legacy metric-row arrays and `{ history, benchmarks }` objects remain available for compact views-only scripts. `--score`, when supplied, must be finite and between `0` and `10`.

`reviewflow retro run` requires the snapshot JSON to include a timezone-aware `capturedAt`. The snapshot must have been captured at least 72 hours after publication and not after the retrospective completion time.
