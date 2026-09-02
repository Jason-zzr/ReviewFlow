# Data contracts

The TypeScript package is the public contract for content, variants, rubrics, predictions, publish manifests, publication attempts, metric snapshots, and retrospectives.

Important invariants:

- Scores are integer `0..5`; every dimension requires evidence.
- Starter dimensions are equally weighted.
- Predictions record model/prompt versions, baseline source, sample size, confidence, ranges and a full bucket distribution.
- A frozen prediction is append-only; retrospectives never rewrite it.
- Every selected platform receives its own prediction for the active account and content type.
- Manifest timestamps use UTC ISO-8601 with milliseconds (`.000Z`) before digesting.
- An idempotency key is permanently bound to one manifest digest.
- `submitted` and `processing` are not `published`.
- Unsupported platform metrics are `null`, not zero.
- Raw metric payloads are evidence, not the canonical cross-platform schema.
- Selected media is copied to the application `userData/media` library with collision-safe names; manifests use those managed absolute paths and never mutate the creator's source files.
- T+3 collection tasks persist their due time, retry time, attempt count and manual-fallback state in SQLite.
- Both SQLite stores carry explicit migration versions: the publisher uses `schema_meta`, while the desktop workspace uses `PRAGMA user_version` and refuses silent downgrade from a newer schema.
- MVP validation deduplicates confirmed `publicationId` values, counts only publications from the latest 30 days, and calculates retrospective completion only from records whose T+3 deadline has passed.
