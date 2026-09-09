# Popular-page regression checks — 2026-09-08

Six live Firecrawl basic scrapes, one attempt per URL, same options as the app (Markdown/links/images, full page, 30-second provider timeout, one-hour cache, no PDF parsers). Each reported one credit. ESPN reused the earlier capture. No OpenAI/Gemini calls, paid image generations, or user browser credential exports.

| Page | Markdown characters | Source sections after fix | First prompt characters | Replay |
| --- | ---: | ---: | ---: | --- |
| https://www.bbc.com/ | 46,414 | 5 | 25,253 | Pass |
| https://www.cnn.com/ | 132,021 | 8 | 25,213 | Pass |
| https://en.wikipedia.org/wiki/World_Wide_Web | 231,156 | 11 | 25,274 | Pass |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript | 77,737 | 5 | 25,075 | Pass |
| https://github.com/facebook/react (redirected to /react/react) | 22,834 | 2 | 25,270 | Pass |
| https://www.amazon.com/ | 93,936 | 9 | 24,883 | Pass |
| https://www.espn.com/ | 61,572 | 5 | 25,272 | Pass |

Each replay passes the captured provider payload through `fetchWebpage`, source sections, and the actual Flare request builder. Image responses and reference downloads are mocked. Assertions cover source prose in the first section, exact text reconstruction across all sections, initial-view and scroll instructions, cached scroll restoration without another generation, and Back/Forward restoring the correct image and transition. Replays completed in 0.34–2.38 seconds each during the parallel run; source normalization took 4–9 ms. This is not an image-generation latency or visual-quality benchmark.

## Bug found and fixed

Non-root URLs were assumed to be API-style article narratives. Wikipedia, MDN, and GitHub therefore applied the approximately 1,400-character story window to full-page Markdown, sending mostly navigation in their first prompts (around 4,000 total prompt characters including instructions). A non-root URL does not establish that its content is a standalone article.

All Firecrawl full-page scrapes now use `content`, preserving their original field order and the existing 24,000-character source-section limit. Menus, footers, and body text stay available. Native API article passage behavior is unchanged. First requests for non-root web pages can be larger; the bound matches homepages and avoids truncating page context to a menu fragment.

Five synthetic offline regression layouts cover news, encyclopedia, documentation/code, repositories/relative links, and shopping/tables. These run in normal CI with no credentials, network requests, or paid calls. All 232 app tests passed in 6.5 seconds; build passed. Existing CI timeouts remain unchanged.

## Extraction limitations observed

BBC's successful full-page scrape includes an embedded survey-frame `ERR_BLOCKED_BY_CLIENT` prelude before its valid navigation and headlines. CNN includes an ad-feedback form; Amazon includes tracking-image Markdown. These are provider-source artifacts, not transport failures. No blanket menu/footer/iframe removal was introduced: that could discard wanted content. Final model interpretation of these artifacts remains visually unverified.

Local captured payloads/replay reports: `/tmp/banana-firecrawl-probes/popular-*.json`, `replay-*.json`; replay harness: `/tmp/banana-browser-reddit-rss/tmp/popular-replay.mjs`. These temporary captures are not checked in or fetched during CI.
