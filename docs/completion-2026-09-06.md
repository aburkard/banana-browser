# September 6 continuation results

- Luna stable-prefix caching shipped separately in PR #17. All six original comparison clicks were correct; the measured small-trial cost reduction was 44.8%, including cache writes. No general latency improvement is claimed.
- PR #18 adds retained source sections, matching image/click context, cached section/history/scroll navigation, complete TVmaze lists, and a fix for overlapping canvas renders. The original isolated prototype and handoff are preserved in history and the repository.
- Gemini conversation comparison completed: both edits were visually correct; extra history offered no observed fidelity advantage, increased input and had slightly higher latency in one pair. Production conversation behavior remains unchanged.
- Live section acceptance completed: Stations 01–06 appeared in the first section, Stations 13–18 in the last. Red-pointer selection of Station 17 returned its exact API URL. No navigation fetch followed the assertion.
- Validation: 104 app tests, seven offline live-harness tests, production build, independent review, actual Chromium controls with simulated images, and the bounded live acceptance screens. Temporary test bundles are excluded from the production output.

## Testing budget

The known cost portions for newly completed calls are $0.1348355 (conversation) and $0.0917886 (section acceptance), totaling $0.2266241. Gemini output-modality details were incomplete, and one initial conversation seed request was interrupted by a development reload before a result was recorded. It may still be billed; its original run lock is preserved. A replacement ran only after removing development reloads from the harness.

Conservatively valuing unclassified output at the higher image rate, allowing the interrupted request's configured output limit, and including earlier documented API tests gives a modeled cumulative subtotal of approximately $0.61 against the $10 budget. This is not an account-wide billing ledger or enforced provider cap. No automatic provider retries or subscription tests ran during this continuation.

## Limits retained deliberately

Explicit sections keep the existing scrolling strategy. A source section is not proof that all its prose fits one generated image. Model fidelity remains imperfect; the paid checks are small synthetic acceptance screens.

Art Institute image delivery remains the previously documented external limitation in issue #7. Its bookmark stays withheld; no image-host protection was bypassed. Further API examples and broader model comparisons remain optional backlog work rather than reasons to alter working production behavior.

Details: [source sections](source-sections-2026-09-06.md), [conversation comparison](conversation-comparison-2026-09-06.md), [Luna caching](cache-comparison-2026-09-06.md).
