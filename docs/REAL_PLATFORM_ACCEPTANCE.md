# Real-platform acceptance gate

Real Xiaohongshu, Douyin, and Bilibili publishing is deliberately excluded from automated CI. A test may create a public post, trigger account controls, or consume a platform scheduling slot, so every run requires fresh human authorization for one immutable manifest.

## Required authorization record

Record all fields before selecting **confirm publish**:

- platform and exact account alias;
- content title and local media filenames;
- immediate or native platform schedule time;
- ReviewFlow manifest digest;
- ReviewFlow idempotency key;
- operator and authorization timestamp;
- whether the post may remain public or must be manually removed afterwards.

Authorization is valid for that exact digest only. Editing title, body, media, platform, account, tags, schedule, or Bilibili `tid` requires a new preview and a new authorization record.

## Execution procedure

1. Start from the packaged Windows build, not a source-only Python process.
2. Open the platform login terminal from **平台账号** and complete QR, captcha, or risk-control steps yourself.
3. Run **检查登录** and confirm the intended account alias.
4. Score the content and freeze a separate prediction for every selected platform.
5. Review the publish summary and compare its digest with the authorization record.
6. Execute once. Do not retry a `submitted`, `processing`, or `unknown` job with a different idempotency key.
7. Verify the post in the platform creator backend. Only then may the local job be marked `published`.
8. Save the external content reference and schedule the T+3 collection task.

## Evidence to retain

- application version and installer SHA-256;
- manifest JSON and digest, excluding local absolute paths from shared reports;
- publication job status transitions and redacted output condition;
- platform backend screenshot or post URL captured by the operator;
- T+3 snapshot source (`adapter`, `manual`, or `csv`) and retrospective ID.

Never retain API keys, Cookie JSON, QR payloads, authorization headers, or DPAPI blobs in screenshots, logs, diagnostics, issues, or public test fixtures.
