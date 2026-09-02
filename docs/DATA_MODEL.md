# Data contracts

The TypeScript package is the public contract for content, variants, rubrics, predictions, publish manifests, publication attempts, metric snapshots, and retrospectives.

Important invariants:

- Scores are integer `0..5`; every dimension requires evidence, and rubric/assessment dimension codes must be complete and unique.
- Starter dimensions are equally weighted.
- Predictions record model/prompt versions, baseline source, valid sample size, confidence, ranges and a full bucket distribution. `PredictionHistorySample` carries snapshot ID, platform, account, kind and metrics; the domain deduplicates IDs and admits only the requested context. Calibration ignores rows without any finite, non-negative canonical metric; content-score adjustment accepts only finite values from `0..10`.
- A frozen prediction is append-only; retrospectives never rewrite it.
- Every selected platform receives its own prediction for the active account and content type.
- Manifest timestamps use UTC ISO-8601 with milliseconds (`.000Z`) before digesting.
- An idempotency key is permanently bound to one manifest digest.
- `submitted` and `processing` are not `published`.
- Unsupported platform metrics are `null`, not zero.
- Raw metric payloads are evidence, not the canonical cross-platform schema.
- Selected media is copied to the application `userData/media` library with collision-safe names; manifests use those managed absolute paths and never mutate the creator's source files.
- Workspace export version 2 replaces managed absolute paths with bundle-scoped media references, copies each unique asset once, and records its size and SHA-256. Import verifies containment and integrity before copying assets into the destination media library and rewriting the workspace paths; version 1 JSON exports remain importable without embedded media.
- T+3 collection tasks persist their due time, retry time, attempt count and manual-fallback state in SQLite. A transactionally claimed five-minute lease prevents concurrent schedulers from fetching the same task while allowing recovery after a crashed collector.
- A retrospective accepts a snapshot only when its `publicationId` matches and `capturedAt` is a valid timezone-aware instant at or after the 72-hour deadline and no later than the report `completedAt`; a later review cannot legitimize an early or unrelated snapshot.
- Both SQLite stores carry explicit migration versions: the publisher applies transactional `schema_meta` migrations in order and resumes known partial steps, while the desktop workspace uses `PRAGMA user_version`; both refuse silent downgrade from a newer schema.
- MVP validation deduplicates confirmed `publicationId` values, counts only publications from the latest 30 days, and calculates retrospective completion only from records whose T+3 deadline has passed.
- Formula calibration requires at least ten unique same-context samples whose IDs correspond one-to-one with unique retrospective records. Every sample must satisfy the active scoring contract, observed performance must be finite and non-negative, tied ranks use average-rank Spearman correlation, and any candidate that regresses a previously correct pairwise ordering is ineligible.
- The desktop persists immutable manifests, multiple publication jobs, T+3 tasks, and `PublicationContextRecord` snapshots. A retrospective resolves its frozen prediction and score assessments from that exact publication context instead of the currently edited content.
