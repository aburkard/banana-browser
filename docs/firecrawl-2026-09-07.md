# Firecrawl implementation and experiments

Roadmap: #45 external webpages, #46 screenshot/branding references, #47 address-bar search, #48 real controls/Interact, #49 site directories/Map, #50 unchanged-content render reuse, #51 topic pages/Agent.

## First implementation (not deployed)

Unknown URLs retain direct JSON handling when available; failed/non-JSON responses fall back to a separate `/web` endpoint alongside the existing Modal relay. Known example API failures are not sent to Firecrawl. The endpoint uses a server key, no user credentials/cookies, fixed basic scrape options, 30s provider/35s total timeout, 2MiB body cap, 2 concurrent jobs, 10 starts/minute and 100 starts/process. The lifetime cap resets on restart and is not a durable billing quota. Cache: 10 minutes, 20 entries, 10MiB, duplicate requests shared. PDF parsing and enhanced proxies are disabled in this first version.

Scrapes retain navigation (`onlyMainContent:false`). The frontend preserves Markdown, resolves links against the final page URL and retains up to five image references. Root homepages use full source sections; articles use existing passages. History, red-pointer interpretation and cached scroll images continue unchanged. Stable extracted data reuses the existing render cache, without buying change-tracking calls.

UI reports actual Firecrawl credit metadata separately from model dollar totals. Cache hits are zero credits. Missing or malformed responses mark usage unknown; locally rejected requests are zero. Dollar conversion is deliberately not invented: this is server-funded credit usage and plan pricing varies.

## Live evidence

Used the existing authenticated CLI; initial balance 1,045, last balance check 1,035, followed by two explicitly billed two-credit Interact probes (14 credits consumed in total). No paid model/image calls.

- HN homepage: 15,035 Markdown characters, 199 links, one reported credit.
- Public article: “How to Do Great Work”, 72,130 characters, 30 links, one reported credit.
- HN screenshot + branding: both returned, including fonts/colors/typography; one reported credit. No image-model comparison yet.
- Search: three web results with real URLs/titles/descriptions; results were not scraped.
- Map: ten discovered URLs/titles from a public essay site; no bulk crawl.
- Browser/Interact experiment: four bounded 60-second sessions were created and explicitly closed. CLI, SDK, and current `/v2/interact` endpoints all returned empty execution output. The current endpoint returned HTTP 200 and success with empty stdout/result; this is not evidence of successful pagination. No further blind retries. Pagination is NOT verified.
- Agent and change-tracking endpoints have not been run. The existing local render cache already avoids regeneration for unchanged extracted content (regression tested).

Browser replay used the actual captured scrape data and mocked image generation: HN loaded, scroll added an image without a scrape, article navigation loaded the expected title, Back/Forward left counts at two scrapes/three images. These are UI integration checks, not live image-fidelity measurements.

## Search and site exploration (not deployed)

Address-bar text becomes a web search; URLs continue to navigate normally. Search returns up to ten results without scraping every result. Explore discovers up to 25 links on the current site's origin, without claiming their contents have been read. Both use existing image generation, click navigation, scrolling and history. Internal search addresses restore the readable query in the address bar.

The separate `/search` and `/map` backend routes share a bounded ten-minute cache, two concurrent requests, ten starts/minute and 50 starts/process. They use fixed provider options and report actual credits or unknown usage. These process limits reset on restart; they are not durable account-wide quotas.

Verified: 205 app tests, 37 backend tests and production build passed. Independent review found no blockers. Browser replay with captured live Search/Map data and mocked image generation verified search query restoration, cached Back navigation and the Explore button opening the site's directory. No paid image calls were used.

## Deployment gate

Automatic approval review rejected copying the existing Firecrawl credential into Modal because the user had not explicitly authorized this credential transfer. No key was copied and no backend/frontend deployment occurred. Code expects the Modal secret `banana-browser-firecrawl` with `FIRECRAWL_API_KEY`. Obtain explicit approval for that transfer, then create the secret without exposing it, deploy the backend, verify live `/web` from the app origin, and merge/deploy the frontend. Existing production remains unchanged.

Muse Spark 1.3 Contributor Free / OpenCode Zen xhigh implemented the pure normalization module and tests from public code only; parent review corrected final-URL precedence and filtering. Native review caught malformed-response usage and non-special HN fallback issues; both have regression tests.

Next order: finish #45/#47/#49 deployment after explicit credential-transfer approval; evaluate #46 visual references with a bounded image trial; resolve #48's empty execution output before building stateful controls; evaluate #51 explicit research pages with a small hard credit limit. #50 already benefits from verified local content equality without purchasing remote diffs. Current work is on `codex/firecrawl-browsing` in `/tmp/banana-browser-reddit-rss`, draft PR #52. Preserve the original checkout's uncommitted extension prototype.
