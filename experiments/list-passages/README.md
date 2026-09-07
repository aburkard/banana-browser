# Three-passage live acceptance

Run `node experiments/list-passages/build.mjs`, then open `/banana-browser/tmp/list-passages/index.html` on the existing local app origin with its Gemini key. The build validates the original captured TVmaze fixture hash, selects its final nine episodes, and verifies those intact records make exactly three production passages. No synthetic records or changed production prompts are used. Source subset metadata is generated alongside the page.

One manual button permits at most three Nano Banana 2 image calls at 1K/minimal. A durable localStorage marker plus browser lock prevents duplicate runs. Each stage permits one network dispatch; SDK retries and other model endpoints are blocked. A failed stage ends the run. Each Gemini request has a two-minute timeout; an interrupted response may have unknown usage. No click model is called.

Source fetching is intercepted only for the captured exact season URL. Reference photos are limited to exact image URLs found in the selected fixture. Existing production navigation, reference selection, prompts, usage accounting, source passages, and scroll methods run from the static app bundle without HMR. Credentials remain on the current browser origin and are never displayed or persisted by the harness.

All three generated images appear simultaneously beside their visible source JSON. Automated checks compare restored image/source identity while moving up twice/down twice and verify that scrolling past the last passage leaves the last image unchanged with zero additional calls. Human inspection must verify episode order, text completeness, unwanted repetition, readability, and whether the final page invents continuation.

Copy only the visible sanitized result JSON after inspection. Image payloads are intentionally not exported. Remove generated public files before a production build with `node experiments/list-passages/build.mjs --clean`; this does not clear the attempt marker. Preparing/building this harness sends no provider calls.

September7 results and limitations: see `docs/list-passages-2026-09-07.md`. The first run source is retained as `index-v1.html`; the second uses a separate v2 attempt marker. The source/prompt implementation changed between these trials as documented. Both original markers remain locked. Do not treat a rebuilt harness as authorization to clear a marker or repeat the run.
