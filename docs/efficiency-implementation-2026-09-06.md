# Efficiency changes, September 6

This implements the first changes from [the audit](efficiency-audit-2026-09-06.md). The red-pointer click image, separate click/image requests, previous-page reference, and 20% scroll overlap remain intact.

## Implemented

- History retains each page's generated scroll images and selected position. Back/Forward and already-generated scroll positions make no model calls.
- Independent renders use a per-browser LRU cache capped at 32 MiB/16 entries. Keys hash the fetched source, URL, model, style, and image options. Each Go fetches source data before checking the cache. Click navigations retain visual context and bypass this cache. Settings are locked while a request is running.
- Reference images are deduplicated, fetched with concurrency three, and cached for five minutes within 16 MiB/24 entries. Responses have a 15-second timeout and 8 MiB limit. Processed article photos now reach generation; this can improve fidelity and increase image-input charges.
- Gemini ignores thought-preview images when selecting the final output.
- Usage preserves reported cache reads, cache writes, reasoning, and modality details. Gemini text/image/thought output uses the respective existing rates. Missing counts/rates produce an explicitly partial estimate; no cache discounts are invented. Subscription tokens remain separate from API dollars.
- TVmaze provides a new TV shows bookmark with show → seasons → episodes navigation and accessible attribution. Lists expose the first 12 items and report omitted results; complete long-season browsing remains a follow-up. Art Institute's field-selected public-domain adapter is implemented, but has no bookmark yet because its image endpoint failed a browser CORS request.

## Verification and limits

Automated tests cover history reuse, source/options cache invalidation, concurrent navigation/settings, failed navigation recovery, bounded references, final-image selection, usage normalization/accounting, API fixtures and attribution. They replace paid model calls with deterministic responses.

A real Chromium browser fetched Art and TVmaze listings and details. TVmaze poster bytes decoded successfully. Art JSON succeeded, but the documented IIIF image host failed browser fetch; the same image succeeded via curl and failed via Node. No workaround for that host's edge filtering is included.

The TVmaze search → show → seasons → episodes → episode path also completed in Chromium. Its processed payloads were respectively 3,646, 1,404, 1,446, 4,379 and 1,539 characters. These are character counts, not measured token counts.

No paid generation calls were made for this batch. These checks establish request construction, data navigation and browser transport, not generated-page visual quality or real click accuracy on the new example.

## Follow-ups

- Existing issues #3 and #4 cover provider caching/conversation comparisons and timing experiments. New usage details make those measurable; prompt ordering and conversation defaults are unchanged until a controlled comparison establishes both fidelity and total cost.
- Issue #6 covers long-article/source-window work. The delegated broad content/pagination task was blocked by an automatic safety check with the reason “Potentially unintended activity.” Its incomplete files were excluded. Current generic JSON and long-article prompt truncation remain; the new known-API adapters use their own bounded summaries/navigation.
- Issue #7 remains open for more APIs, generated-page/click evaluation, and Art Institute browser image delivery.
