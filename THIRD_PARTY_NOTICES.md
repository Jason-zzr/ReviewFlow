# Third-party notices

ReviewFlow is independently implemented and selectively derives interfaces, workflow rules, and integration behavior from the following MIT-licensed projects.

## cheat-on-content

- Project: `XBuilderLAB/cheat-on-content`
- Pinned review commit: `86823e197e3d32f0fd999b9b620b89254f2d3198`
- Source: https://github.com/XBuilderLAB/cheat-on-content
- License: MIT

ReviewFlow's starter rubric, blind-prediction lifecycle, T+3 default, and rubric-bump validation were informed by this project. Agent prompts and marketing claims were not copied as product algorithms.

## omnipost / social-auto-upload

- Project: `rehatRobot/omnipost`
- Pinned runtime commit: `012caee407f2ee9cca8857579b23721c8b6e7f63`
- Source: https://github.com/rehatRobot/omnipost
- License: MIT
- Based on: `dreammis/social-auto-upload`

ReviewFlow packages the upstream uploader modules behind its own `reviewflow-sau` entrypoint. The entrypoint supplies a writable per-command runtime directory because the pinned upstream wheel omits its top-level `conf.py`; it also limits the exposed platform surface to Xiaohongshu, Douyin, and Bilibili. ReviewFlow does not expose omnipost's Flask backend or permissive CORS configuration.

## biliup

- Project: `biliup/biliup`
- Pinned Windows runtime: `v1.2.4`
- Asset: `biliupR-v1.2.4-x86_64-windows.zip`
- SHA-256: `cb5af47aeaffd63719c94fa354a4d1404dd8437b6cc215513ec4e6054177c93e`

The verified executable is downloaded only during the release build and bundled as a separate runtime. ReviewFlow does not request GitHub's `latest` endpoint during account login or publishing.

## Direct runtime dependencies

The Windows distribution also bundles the following direct runtime components. Transitive notices remain available in the corresponding package metadata; Electron's own license and Chromium's complete notices are shipped beside `ReviewFlow.exe` as `LICENSE.electron.txt` and `LICENSES.chromium.html`.

| Component | Version | License |
| --- | --- | --- |
| Electron | 44.1.0 | MIT |
| Vue | 3.5.42 | MIT |
| Ajv | 8.20.0 | MIT |
| FastAPI | 0.141.1 | MIT |
| HTTPX | 0.28.1 | BSD-3-Clause |
| Pydantic | 2.13.5 | MIT |
| Typer | 0.27.2 | MIT |
| Uvicorn | 0.52.4 | BSD-3-Clause |
| Loguru | 0.7.3 | MIT |
| Patchright | 1.58.2 | Apache-2.0 |
| OpenCV Python | 4.13.0.92 | Apache-2.0 |
| NumPy | 2.2.6 | BSD-3-Clause; bundled component notices apply |
| Requests | 2.32.3 | Apache-2.0 |
| qrcode | 8.2 | BSD |
| Segno | 1.6.6 | BSD |

All original copyright and permission notices must be retained when distributing copied or bundled portions of these projects.
