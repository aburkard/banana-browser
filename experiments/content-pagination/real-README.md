# Real content acceptance

To intentionally refresh the real public fixtures, run `node experiments/content-pagination/real-capture.mjs`. It requests only the canonical ESPN article and TVmaze season episode list, once each, with 20-second timeouts and a 2 MiB response bound. It uses production processors/source sections to create the manifest, hashes and exact episode detail allowlist. Raw responses go into Git-ignored `tmp/real-content-fixtures`; no episode details are prefetched. Do not refresh fixtures during an active comparison. Capture unit tests mock requests and never fetch live content.

Build from the captured, ignored fixture manifest:

`node experiments/content-pagination/real-build.mjs tmp/real-content-fixtures/manifest.json`

Open `http://127.0.0.1:5178/banana-browser/tmp/real-content-check/index.html` on the existing saved-key browser origin. The raw public bundle has no Vite reload client. Keys never leave the browser except in the providers' ordinary authentication headers; reports and files contain no keys.

1. Start ESPN. Inspect/save the first rendered view. Choose **Later section** (section 12, zero-based index 11) and inspect the displayed source excerpt against the image. Choose **Scroll within section**, compare continuity and new content, then **Finish scenario**.
2. Start TVmaze. Inspect/save the first view, choose **Later section**, and inspect the final list section. Select a visible episode card on the image. Production `handleClick` draws its red pointer, calls Luna, and navigates to the model-selected real episode URL only if it is in the captured list's exact allowlist. Verify that the destination matches the card chosen. Choose **Check Back / Forward / Back** to verify exact source/image/section/scroll restoration without paid calls. Finish the scenario.
3. Save results JSON and current PNG after each desired view. Clean temporary public assets **before production builds**:

`node experiments/content-pagination/real-build.mjs --clean`

Each scenario has its own permanent `banana-real-content-v1-espn` / `banana-real-content-v1-tvmaze` origin lock and allows at most four image network attempts and one click. Failed steps stop their scenario without retry. Reloads cannot resume or rerun a locked scenario. Combined maximum: eight images, two clicks. Expected described path: three images for ESPN, three for TVmaze, one click. Additional TVmaze scrolling is available once if deliberately selected; it consumes the fourth TVmaze image allowance.

Gemini: `gemini-3.1-flash-image`, 1K, minimal thinking, one candidate, 2,048 output cap, 90-second timeout. Click: GPT-5.6 Luna low reasoning, 512 output cap, 90-second timeout. At locally documented rates, eight 1K image outputs are approximately $0.5376 plus input/text/thinking/click. Charging all eight output allowances at the image rate gives $0.98304 plus input/click, within the $2 preflight estimate. This is not a provider-enforced dollar cap; missing modalities retain incomplete accounting. Failed requests may be billed.

The harness uses production navigation, processing, source sections, image prompts, references, scrolling, pointer interpretation, click navigation, and history methods. Raw ESPN/TVmaze list responses come from captured real fixtures under their original exact URLs; episode detail is one allowlisted live public API fetch. References retain production concurrency, caching and byte limits, with exact approved hosts and at most 24 retrievals per scenario. Unknown requests and redirects are blocked. No subscription calls occur. Image logging is disabled; no production source files are modified.

Offline verification: `node --test experiments/content-pagination/real.test.mjs experiments/content-pagination/real-bundle.test.mjs`. Guard tests always run without network. The full production flow test uses the generated ignored bundle and real captured fixtures with all requests mocked; it skips when the bundle is absent. It verifies later article scrolling, TVmaze detail navigation/history restoration, and credential-free reports. Visual model fidelity still requires inspecting the paid outputs. A small sample cannot establish complete real-world rendering coverage.
