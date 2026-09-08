# Firecrawl browsing

## Current architecture

User decision: visitors supply their own Firecrawl key. It must never be sent to Banana Browser's backend. The rejected server-secret design has been removed completely; experiments/encrypted-relay matches main. No Firecrawl credential was ever copied to Modal.

Settings has an optional password field available for API and ChatGPT-plan users. The key is kept in sessionStorage for this tab, restored on reload, and removed when cleared. Requests go directly to fixed https://api.firecrawl.dev/v2/scrape, /search and /map endpoints with credentials omitted and redirects rejected. No backend or relay fallback. Missing keys fail before a provider call and explain where to add the key.

Unknown URLs retain direct JSON handling, then use Firecrawl for HTML/CORS failures. Known example API errors never trigger paid scrapes. Scrapes preserve Markdown, navigation, image references and final URLs; root homepages retain full sections and articles use existing passages. Search returns up to ten summaries without scraping each result. Explore discovers up to25 links on the current site. Existing red-pointer clicks, scroll views, source/style/model render reuse and history remain intact.

Credit metadata is shown separately from model dollars and billed to the visitor's Firecrawl account. Missing metadata is unknown, never assumed free. Scrape calls request basic proxy, no PDF parsers, one-hour provider maxAge, 30-second provider timeout; all browser provider requests have a 40-second timeout and no automatic retries. A fresh source request can incur credits even when an unchanged generated image is reused.

## Evidence

- Direct browser cross-origin POST to Firecrawl with an invalid test credential returned a readable401 response: browser CORS access works. No real credential or paid scrape was needed for this check.
- Browser replay with a fake key verified Settings, tab storage, the fixed direct search endpoint and separate reported credits. Captured live scrape/search/map data and mocked image responses previously verified page loading, scroll, Back/Forward and Explore.
- Credential tests verify Authorization is sent only to Firecrawl, destination fetches receive no key, missing keys cause no fetch/usage, errors do not expose provider details, and native provider credit metadata is interpreted correctly.
- Backend restored to main:16 existing tests pass. See current CI for the full app/build result.

## Prior live experiments

14 Firecrawl credits consumed through the existing local CLI connection; no paid image/model calls. HN homepage15,035 Markdown characters/199links; article72,130characters/30links. Each scrape reported1credit. HN screenshot+branding also succeeded for1credit; screenshot-assisted image quality has not been compared.

Search and Map returned real public results. Four bounded Interact sessions were explicitly closed, but CLI, SDK and current endpoints returned empty execution output. HTTP200/exit0 is not evidence that controls worked. No further blind retries.

One strict Agent extraction capped at5credits terminated with "Agent reached max credits", reported0credits, and returned no data. Prefer cheaper Search plus selected scrapes for now. Paid change tracking is unnecessary for the existing local unchanged-content render reuse.

## Roadmap and workspace

#45 external webpages, #47 search and #49 site directories are in PR52. #50 uses existing render caching. #46 visual reference quality, #48 reliable remote controls and #51 research mode remain experimental with the limits above.

Worktree /tmp/banana-browser-reddit-rss, branch codex/firecrawl-browsing. Preserve the original checkout's uncommitted extension prototype. No Modal secret or backend deployment is needed for this direct-browser design.

## Optional visual references and freshness (September8)

Settings now offers Site reference (off by default) and Fresh pages (off by default). Both remain in tab storage and apply on the next page load. Site reference requests screenshot+branding alongside the existing scrape, validates the screenshot URL and includes at most500characters of allowlisted colors/fonts/scheme. The screenshot is prioritized within the existing image-input cap; its caption states that it is layout guidance, not factual content/scroll continuation, and that the selected style wins. Section context preserves these hints. Extra image input can increase model usage; no guaranteed quality improvement is claimed. Missing screenshots fall back to ordinary text-based generation.

Fresh pages sets scrape maxAge:0; it does not bypass history or regenerate unchanged content unnecessarily. No backend or credential routing changes.

215tests and build passed; independent review found no blockers. Browser replay used the previously captured live HN screenshot/branding: fetched screenshot bytes entered the mocked image-edit request (261KB request), with correct caption. An unavailable screenshot fell back to image generation and loaded successfully. Settings fit1512×850 and390×844 without outer scrolling. No paid image or additional Firecrawl calls were made; a paid image-quality comparison remains open under#46.

Official format and freshness reference: https://docs.firecrawl.dev/features/scrape
