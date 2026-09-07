# Source sections

Long processed API data is now divided locally into valid JSON sections of at most 8,000 characters. Image generation and red-pointer click interpretation receive the exact same active section. Short sources remain whole; oversized records retain original paths and compact identity/navigation/photo context. Text stays intact across Unicode-safe fragments; URLs remain indivisible. An oversized indivisible target or metadata fails explicitly instead of silently cutting JSON or dropping data.

Previous section / Next section controls appear only for multi-section sources. A first visit generates one image. Returning to a visited section restores its image and visual scroll position without a model request. History stores those sections and scroll views together. Failed navigation restores the previous source/image; loading guards prevent concurrent section requests. Reference photos are taken from the active section rather than unrelated first-page records.

A section is a source budget, not a claim that every character fits on one screenshot. Existing visual scrolling remains within the active section, using the previous image and approximately 20% overlap. Section advancement is explicit, with no additional text-model planning call. The red pointer and separate click/image calls remain intact.

TVmaze lists retain all valid records instead of their first 12. TVmaze and Art detail story text no longer has a 4,000-character adapter cap. Existing intentional listing summaries and source-fetch limits are unchanged. The Art bookmark remains withheld because the documented image host previously failed browser delivery; no protection was bypassed.

## Verification

- 104 app tests passed, including source retention, intact long URLs, Unicode, shared image/click context, section/history/scroll reuse, failed transitions, duplicate actions, reference selection, and renderer races.
- Production build passed. The original four offline prototype tests remain preserved independently.
- Headless Chromium exercised the actual app UI with all external requests intercepted: 90 TVmaze episode records occupied three sections; the last section retained Episode 90. Section controls, Back, cached scroll views, and pointer-click requests worked. Image and click source matched. Six simulated image requests and one simulated click request covered the sequence; cached revisits added no requests. Zero paid requests.
- The browser check found and reproduced an existing rendering race exposed by fast section/click interactions. Status-only updates now reuse the current screenshot; late image decodes and stale animation timers cannot leave duplicate canvases. A focused DOM regression covers differing images, overlapping animations, and out-of-order decoding.
- The offline prompt measurement now reports 4,601 characters per Gemini click and 4,099 per scroll for the unchanged TVmaze fixture. These are structural character measurements, not token or savings claims.

Generated content fidelity remains model-dependent; the integration guarantees retained input/context and navigation state, not that a model renders every source item accurately. The later small paid acceptance screen is recorded below.

## Live acceptance screen

A subsequent bounded test executed the actual production source-section splitter, image prompt/generation, section transition, red-pointer drawing and Luna interpretation. Eighteen synthetic directory records produced three sections. Two Gemini Nano Banana 2 calls at requested 512px/minimal thinking generated the first and last sections. The first visibly contained Stations 01–06; the last visibly contained Stations 13–18, with no earlier-section cards intruding. Both retained the FIELD GUIDE theme, although borders/geometry changed somewhat and long summaries were condensed.

After visual inspection, Station 17 was selected at image coordinate (311, 319). One Luna/low interpretation returned exactly `https://api.tvmaze.com/shows/117`. It received the same 6,870-character section as the later image. The returned URL was checked, not fetched; no additional navigation image was generated. All three calls were bounded with no retries.

Image calls took 9,083 and 8,154 ms; the click took 2,882 ms. Known estimated cost was $0.0917886, including a complete $0.0005071 Luna estimate with 1,646 cache-write tokens. Gemini's unclassified output tokens leave the image estimate incomplete; assigning all those tokens the higher image rate yields a conservative total estimate of $0.1481286 for this screen. These are estimates, not invoices.

This establishes a small synthetic acceptance case for later-section content and pointer navigation, not real-site accuracy or complete rendering of long prose. [Sanitized results](../experiments/content-pagination/live-results-2026-09-06.json) and [bounded harness instructions](../experiments/content-pagination/live-README.md) are preserved. Both live test tabs retain their rendered images for inspection; automatic browser-download files were not independently verified.
