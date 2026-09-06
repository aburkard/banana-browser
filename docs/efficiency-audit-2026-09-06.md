# Performance, cost, and content audit

Audited main at `e713a7212c51a8919f3092d9b29b4a851b8dcd0d`. This is an audit and proposed sequence, not an implementation. No paid model calls, production changes, or deployments were made. Tests below used the actual TypeScript methods with fake model responses; public API samples were unauthenticated.

## What to preserve

- Keep the red pointer screenshot in click interpretation and subsequent navigation. Coordinates-only interpretation is not proposed.
- Keep the separate image and click tasks, previous-page visual reference, and 20% scroll overlap until a controlled quality comparison supports a change.
- Keep the existing API-specific transformations as baselines. A live ESPN listing shrank from 49,843 to 3,347 characters (pretty JSON), about 93%. Compact serialization reduced that further to 2,951 characters, another 12%. These are character counts, not measured token savings.
- Preserve explicit API versus plan billing, no silent billing fallback, and no automatic generation retries.

## Reproduced opportunities

| Finding | Evidence | Proposed change and verification |
| --- | --- | --- |
| Returning to a page loses paid scroll views | `goBack`/`goForward` rebuild `scrollStack` with only the top image. A mock sequence generated three views of A, visited B, then returned to A. Depth dropped from three to one; scrolling down made another image request. | Store each history entry's generated views and current position. The same sequence should reuse the original views with zero additional model calls. Preserve the pointer and generation prompts. |
| Render cache ignores output options and context | The module-level key is URL/model/style only. Changing low to high and revisiting the URL reused the old image. A second browser instance reused the first instance's cache. | Specify cache behavior before enlarging it: include effective output settings and source revision; isolate contexts where continuity matters. Preserve deliberate history reuse without pretending cached output was generated under new settings. Add a bounded memory policy and deliberate freshness behavior. |
| Image and click models receive different content | Image data is cut at 10,000 characters; click data at 8,000. An 8,335-character fixture kept a target URL in the image prompt but removed it from the click prompt. Both cuts can split a JSON value. | Build one bounded, structured page context with stable item IDs and complete navigation targets. Give clicks a compact target map for that same context. Check every retained item still resolves to its correct target. |
| Processed article photos are not used | `processESPNArticle` returns `article.imageUrl` and `imageUrls`; `extractImageInfo` handles `articles` and `headlines` only. A processed fixture retained one photo but extracted zero references. | Teach extraction the existing article shape. Test URL, caption, reference ordering, and image-budget handling. This improves fidelity but may increase image-input cost; it is not a token-saving change. |
| Reference fetching repeats work | Two references sharing one URL, across two passes, caused four fetch/encoding operations. Fetches are sequential. | Deduplicate and reuse immutable reference bytes with a bounded cache; use small bounded concurrency while retaining reference order. HTTP caching may already avoid some transfer, so do not equate four fetch calls with four downloads. |
| Usage discards information needed for optimization | Cached tokens and cache writes are absent from app usage. Gemini candidates are all priced as image output; thought tokens are omitted. A synthetic mixed-output fixture produced a $0.036025 estimate versus $0.033775 using the existing modality-specific rates. | Preserve provider cache, modality, and reasoning counts before changing caching. Missing fields remain unknown. Synthetic accounting demonstrates a code path, not a live billing discrepancy. |

Source locations: `src/browser.ts` around lines 397–402 (cache key), 584–617 (reference fetch), 623–678 (extraction), 771–855 (usage), 945–1090 (history/scroll), 1108–1160 (cache use), 1501–1544 (image context), and 1602–1733 (click context and parsing).

## Long content needs actual pagination

The sampled ESPN article, "NFL team previews 2026: Predictions, rankings, depth charts", returned 226,244 bytes. After the current processor, pretty JSON was still 162,535 characters, including a 158,835-character story. Parsing the original HTML and taking its text reduced the story to 80,226 characters, but that simplistic operation also loses headings and link targets, so it is not the proposed production transformation.

Every image generation, including later scrolls, currently receives the same first 10,000 characters. It never advances through the source. The prompt asks for new content anyway, and `canScrollDown()` always allows another attempt. That is a fidelity risk, not proof of a particular observed hallucination.

Recommended experiment: keep the full normalized source locally; preserve paragraph/heading boundaries, links, captions, and item IDs; feed a bounded content window with overlap into each new view. Track which source blocks were assigned to a view. Preserve the previous screenshot and 20% visual overlap. Account for text wrapping and variable content density before deciding how to advance; do not silently assume a fixed number of paragraphs always fits. Later views must demonstrably use later source blocks and stop when no source content remains.

The click prompt also still tells ESPN clicks to use `links.api.self.href`, while the processor exposes `apiUrl`. The model can sometimes infer the right field, but instructions should match the actual input. A common target map would remove this mismatch and the need to teach every provider's URL conventions in every click request. Consider returning a validated item ID instead of having the model invent a URL. Keep the visual marker.

## Provider caching and conversation state

The current click requests put changing screenshot pixels first for Gemini/OpenAI API, and click coordinates near the start of the text. That limits reusable prefixes. A controlled experiment can place stable instructions and page data first, then the marked screenshot and coordinates. Prompt order can change behavior, so evaluate target accuracy as well as cache hits.

For GPT-5.6 and later, the current OpenAI documentation describes cache boundaries, a 1,024-token minimum, 1.25× cache-write input cost, and 0.1× cache-read input cost. A stable prefix alone is insufficient when no eligible matching boundary exists. Measure reads, writes, cost, and correctness; do not pad short prompts just to seek cache hits. These rules do not establish the private subscription endpoint's behavior. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

Gemini `generateContent` supports implicit caching with model-specific minimums; explicit caches add storage charges. The current table does not establish all selected image models' eligibility. Stable content first is an experiment, not a guaranteed saving. [Google generateContent caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)

The existing Gemini adapter retains the returned image bytes but drops other returned parts. A conversation experiment should retain the appropriate model response parts and thought signatures, branch history when the user goes Back, and keep the red-marker edit as a new user input. Also check final-image selection: the current loop takes the first `inlineData`, while Google documents thought images separately from final images. This is a conditional parser risk, not a demonstrated live failure under the current settings. [Google image generation](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)

Conversation continuation is primarily a fidelity experiment. OpenAI states that earlier input in a `previous_response_id` chain is still billed; continuation does not make context free. Moving direct Images calls to Responses also restores an LLM wrapper that we just removed for speed. [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state)

Google documents separate cached, modality, and thought usage fields. Preserve these before comparing costs. Asking for IMAGE-only output is another small experiment where the exact selected image model supports it; it will not eliminate the model's underlying thinking cost. [Google usage schema](https://ai.google.dev/api/generate-content#UsageMetadata), [image output and thinking](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)

## New APIs worth adding

**Art Institute of Chicago first.** Browse artworks → open an artwork → browse another page. It offers field selection, pagination, image metadata, and public-domain filtering; API and image CORS are documented. An actual artwork response was 25,267 bytes in full versus 2,129 bytes with eight useful fields, about 92% smaller. Both returned HTTP 200 with wildcard CORS. Keep artwork/artist/date/description/source link plus one reference image, rather than sending collection-management metadata. [API documentation](https://api.artic.edu/docs/)

**TVmaze second.** Search shows → show detail → season/episode. Search and detail returned HTTP 200 with wildcard CORS. Ten search matches were 19,741 characters as pretty JSON; projecting titles, summaries, genres, premiere date, rating, API link, image, and source link yielded 8,241 characters, about 58% smaller. This projection is an audit sample, not a tested image-generation processor. Page episode collections instead of passing all seasons at once. Its public API documents browser support and at least 20 requests per 10 seconds; credit TVmaze and follow its stated CC BY-SA terms. [API documentation](https://www.tvmaze.com/api)

These are transport and payload checks, not complete integration tests. A browser harness was prepared to check listing → detail → image decoding, but the local preview was stopped and the browser received connection refused. No reference-image decode, generated-page, or click-accuracy results are claimed. Open Library and PokéAPI remain prior shortlist candidates; this pass prioritized two additions with different kinds of content.

## Toward arbitrary APIs

Use a shared page shape with a title, content blocks/items, image references, navigation targets, and pagination. Keep small adapters for known APIs, so their careful transformations remain useful. Add a conservative generic JSON fallback that recognizes common item/link fields and enforces structural budgets without slicing serialized JSON mid-value. CORS, authentication, and unclear ID-to-URL semantics still prevent a static browser from supporting literally every API.

If schema inference is later useful, ask a small model to propose a reusable field mapping from a bounded schema/sample once, validate it, and apply it locally thereafter. Do not add a summarization call before every generated page by default. That adds cost and latency and creates another opportunity to drop a clicked item or alter a fact. Measure mapping reuse and content retention before adopting it.

## Suggested implementation order

1. Preserve generated scroll views in history; correct render-cache identity. Offline checks can prove eliminated requests without changing prompts.
2. Preserve usage details and repair the processed-article reference path. Separate fidelity gains from cost savings.
3. Add a shared navigation context and paragraph-aware source windows, tested against long articles and dense listings. Keep the existing visual-click and scroll strategies as controls.
4. Add Art Institute using that common shape, then TVmaze. Verify browser JSON/image access and a listing/detail/scroll/click path before advertising support.
5. Run narrowly budgeted provider-specific caching and conversation experiments using saved representative fixtures. Change defaults only after both accuracy and total cost improve.

Offline reproduction scripts and outputs for this audit are in `/tmp/banana-efficiency-audit.mjs`, `/tmp/banana-efficiency-audit-results.json`, `/tmp/banana-public-api-audit.mjs`, and `/tmp/banana-public-api-results.json`. Temporary files are not durable test fixtures; implementation should add focused regression tests to the repository.
