# Spend and prompt audit — September 7, 2026

## Accounting changes

Verified standard base prices against official Google/OpenAI documentation; the configured base rates matched. Added missing published cache read/write rates, separate OpenAI image text output pricing, and full-request long-context surcharges. Details and source links are in [pricing.md](pricing.md).

All model-request attempts now enter the session counter once, including lost responses, invalid JSON and returned responses without usage. Unknown usage is not treated as a confirmed free request. Returned usage is retained even if the content is unusable. Missing ChatGPT plan token counts remain missing instead of becoming reported zero. Plan usage remains separate from API spend.

The UI identifies the connection-session scope (reload/connection changes reset it), shows unavailable totals as unknown, and marks partial estimates. This is still a returned-usage estimate, not an account invoice: interrupted requests, missing modality/rate fields, provider-specific billing adjustments and other clients cannot be reconciled from this app alone.

## Token reduction and caching

OpenAI click requests place stable instructions/source before pointer pixels and coordinates. Luna and Terra use explicit cache breakpoints, avoiding writes for the changing suffix. Older OpenAI click models use their automatic cache behavior. Gemini/subscription request ordering, previous-image continuity, red-pointer strategy and separate image/click calls remain intact.

Click instructions include the relevant provider's navigation rule instead of all providers' examples. For paths without explicit Luna/Terra caching, processed reference-image URLs are omitted from click-only source copies. Navigation URLs, IDs, captions, full prior-passage prose and rendering source remain intact. Measured source character reductions were 40% for TV search, 16% TV detail, 37% Art gallery and 9% Art detail; these are not token or price percentages.

A live test showed why stronger compaction is not applied to Luna/Terra. All nine clicks were correct, using three marked targets on the same captured TV listing and GPT-5.6 Luna, low reasoning, maximum 512 output tokens. No image generation. Baseline and compact calls were interleaved; the revised retained-source run followed. Independent cache keys prevented sharing between variants.

| Variant | Input tokens/call | Stable cache tokens | Total for 3 clicks |
|---|---:|---:|---:|
| Baseline 9867d72 | 2,199 | 1,244 | $0.00101416 |
| Aggressive compaction | 1,711 | 0 | $0.00110700 |
| Shipped: shorter rules, retained source | 2,040 | 1,085 | $0.00096805 |

Aggressive compaction cut input tokens 22% but cost 9% more over three clicks after losing caching. The shipped version cut tokens 7% and cost approximately 4.5% less while retaining cache hits. This is a small, unreplicated example, not a universal optimum; cache thresholds and reuse frequency matter. No artificial padding or extra conversation history is added.

Total new API cost: **$0.00308921**. Modeled cumulative budget remains approximately **$2.68 of $10**, with prior incomplete billing caveats. Sanitized per-call evidence is in `experiments/spend-audit/results-2026-09-07.json`.

## Validation

139 app tests pass, including missing/failed-response accounting, actual rates, long-context boundaries, output modality splits, raw-source preservation, cache-prefix placement and UI unknown/session labeling. Independent review caught the JSON-null accounting edge case; it was fixed and covered. Production build passes. Live clicks were 9/9 correct. New caching behavior on Terra follows verified official support but was not separately live-tested. No paid tests are added to CI.

To inspect the bounded live harness, run `node experiments/spend-audit/build.mjs` (old versus forced compact, six requests) or add `--retained` (current production, three requests). It builds a static page under `public/tmp` without HMR, uses an existing key only inside its browser origin, locks on first attempt, and never retries. A rebuild can reflect newer production prompts; the saved JSON is the historical measurement. Do not rerun completed checks merely to duplicate evidence. Clean both outputs with `--clean` (and `--retained --clean`) before production builds.
