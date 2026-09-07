# Bounded list advancement

## Production behavior

Recognized whole `articles`, `stories`, and `posts` records advance in groups of at most three, with a soft 1,400-character record budget. Oversized records remain whole. Original source sections and identities remain intact, and the existing passage/history mechanism restores the source and image together. Final passage exhaustion stops locally. Unsupported partial records, multiple competing lists, and mixed article/discussion payloads retain their prior behavior.

The image prompt receives only the current records and source metadata. Internal cursor/end bookkeeping is omitted and expressed as a short instruction for the current view. The previous screenshot still supplies approximately 20% visual overlap; the full previous source remains in click interpretation so targets in the overlap stay reachable. No extra text-model request or automatic retry is introduced. Removing an unused duplicate previous-record field further reduces click context; it does not change the tested image prompt.

This extends the previously shipped 1,400-character narrative passages. Source-fetch pagination and explicit section navigation remain separate. A three-record target is practical here, not a proof every arbitrary record fits every image model/style.

## Real-source acceptance

Used the final nine records from the captured Doctor Who season-one episode response, https://api.tvmaze.com/seasons/3116/episodes. Original capture September7 01:14:49 UTC, SHA256 `0ffc741c781814e65e4754d9d78057f6b41c09e1b8b216b59d3849a6788f7ff6`. The subset is deliberate and unmodified; it fits three production passages. It is a follow-up to the earlier long-list failure, not an identical full-list baseline. Source and image reference requests were restricted to the fixture and its exact photo URLs.

Two bounded three-image trials used production BananaBrowser, Nano Banana2 (`gemini-3.1-flash-image`), 1K/minimal. No click model or new baseline was run. All six image calls completed at1264×848. The original red-pointer TVmaze click result remains documented in the earlier real-content report; offline regression verifies current/previous list targets still reach its prompt.

- First trial: all nine titles/dates/ratings/episode numbers were correct, but the images exposed `hasMore` prose, emitted an early end label, and made a multi-column continuation awkward. This is **not** a clean visual pass. Its raw results are `experiments/list-passages/results-2026-09-07.json`.
- Revised trial: list bookkeeping was removed from the image data, a vertical list was requested, and continuation/end instructions became explicit per view. All nine records appear in order with correct titles, dates, ratings and supplied episode numbers. Earlier records occupy only the overlap; pages1/2 have no end marker, page3 ends with “End of section.” Raw results are `results-v2-2026-09-07.json`.
- Both trials: moving up twice/down twice restored exact cached images and sources. Another scroll at the end left the final view unchanged. **Zero additional calls** during those checks.

Human review inspected all three revised images at native resolution. Remaining cosmetic/model limitations: the first image repeats a shortened title/date inside the same Desperate Venture card, an overlap acquires an unsupported decorative photo, and the model draws decorative browser chrome. These are recorded rather than counted as perfect rendering. The scoped factual advancement/exhaustion target is met; this does not establish general model fidelity or pixel-exact overlap.

## Usage and validation

First trial:3592 input/5551 output tokens; known modeled cost$0.203396, partial. Revised:3367 input/5082 output; known modeled cost$0.2032835, partial. Each reports3360 image-output tokens; the remaining output modality is unspecified, so the UI correctly marks these estimates partial. The combined unclassified3913 tokens would add$0.011739 if text-priced, or$0.23478 if conservatively all image-priced. No assumption is substituted for provider billing.

Together with the three public API latency images($0.124845), this turn adds$0.5315245 known API cost plus unclassified output, and three plan calls with unknown allowance consumption. Using the expensive image rate for all unclassified new output puts the running modeled test ledger at approximately$3.45 versus the$10 budget; the previous ledger itself is approximate. Plan dollars cannot be inferred from API rates.

Offline tests cover full ordered record retention, Unicode/URLs/numbers, whole and sectioned arrays, oversized/partial records, unrelated metadata, mixed discussions, image-prompt metadata exclusion, no-call cached/end behavior, and red-pointer previous-view targets. Independent review caught the mixed-content early-end case; it was fixed and the review passed. Manual harnesses remain outside CI; no paid jobs or browser downloads were added.

Final validation:144 app tests passed in about2.1seconds; TypeScript and Vite production build passed. Temporary live harness bundles were removed before building.
