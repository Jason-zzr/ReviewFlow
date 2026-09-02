# Contributing

Keep changes inside the local-first, single-creator MVP boundary. New platform adapters must:

1. implement capability, validation, preview, execution status, and metric fallback;
2. use argument arrays rather than shell interpolation;
3. stop on login challenges or risk controls;
4. never map process exit success directly to `published`;
5. include fixture-based contract tests and update third-party notices.

Run TypeScript type checks, domain tests, Python tests, the production build, and `npm audit` before submitting a change. Real platform tests require explicit account/content/time approval and never run in CI.

