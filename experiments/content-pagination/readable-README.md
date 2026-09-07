# Readable-source comparison

Experiment only; no production import. Uses the same frozen section and two-image flow as article-fix, converting only story HTML to readable text with heading/paragraph boundaries and Markdown links. Retains semantic href values, including relative targets; decodes HTML entities and removes non-display markup. This is a display-oriented transformation, not byte-preserving HTML serialization or a general rich-document converter.

Build: `node experiments/content-pagination/article-fix-build.mjs tmp/real-content-fixtures/manifest.json --readable`

Open `http://127.0.0.1:5178/banana-browser/tmp/readable-article-check/index.html` on the existing saved-key origin. Generate once and scroll once. Independent permanent lock: `banana-readable-article-v1`; do not clear it to retry. Maximum two Gemini image attempts, 1K/minimal, one candidate, requested 2,048 output tokens, 90-second timeout. No click calls or automatic retries. Estimated two-call allowance approximately $0.25; this is not a provider billing cap.

Offline: `node --test experiments/content-pagination/readable-source.test.mjs experiments/content-pagination/article-fix.test.mjs`

Actual bundled production-method check, with fake key and mocked requests only: `BANANA_READABLE_TEST=1 node --test experiments/content-pagination/article-fix-bundle.test.mjs`. Requires the built ignored fixture bundle; otherwise the bundle test skips. These experiments are not included in the default CI app suite.

Clean before production build: `node experiments/content-pagination/article-fix-build.mjs --readable --clean`. Raw fixtures and generated bundle stay ignored. Previous HTML harness mode and its lock remain unchanged.

Result: [September 7 report](../../docs/readable-source-2026-09-07.md). The attempted representation did not pass visual acceptance and was not promoted to production.
