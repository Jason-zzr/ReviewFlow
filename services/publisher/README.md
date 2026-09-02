# ReviewFlow publisher sidecar

The sidecar binds to `127.0.0.1`, requires a per-session bearer token, and keeps live publishing disabled unless `REVIEWFLOW_LIVE_PUBLISH=1` is set. Install the optional `live` extra to provide the pinned `sau` runtime.

```powershell
py -3.10 -m pip install -e ".[dev]"
$env:REVIEWFLOW_SESSION_TOKEN = "local-development-token"
reviewflow-sidecar
```

No endpoint treats process submission as proof of publication. A successful upstream process is stored as `unknown` until an external URL/ID or a manual confirmation is recorded.

The sidecar also owns a persistent metric collection queue. Due tasks resume whenever the app starts; Bilibili can use its public BV endpoint, while Xiaohongshu and Douyin move to `manual_required` for manual or CSV completion.

`reviewflow retro run` requires the snapshot JSON to include a timezone-aware `capturedAt`. The snapshot must have been captured at least 72 hours after publication and not after the retrospective completion time.
