# Keyless webpage reading — October 16, 2026

Arbitrary webpages used to require a visitor's Firecrawl key. Ordinary pages now open without one: the relay fetches public HTML, and the browser extracts the same text, links and image URLs a Firecrawl scrape provides.

## How it works

1. **Unknown URLs.** A direct JSON fetch is tried first, unchanged. On an HTML or CORS failure, `fetchWebpage` uses Firecrawl if a key is saved; otherwise it uses the built-in reader.
2. **Fetching.** The reader calls the relay's `GET /page?url=…` ([experiments/encrypted-relay/page-reader.mjs](../experiments/encrypted-relay/page-reader.mjs)). The relay fetches one public HTML page server-side and returns `{url, html, truncated}`.
3. **Extraction.** `htmlToScrape` ([src/webpage-reader.ts](../src/webpage-reader.ts)) parses that HTML with `DOMParser` into an inert document and builds full-page Markdown (headings, paragraphs, lists, tables, quotes, code, links, images). It also records links, images and metadata: title, description, final URL and `og:image`.
   - Scripts, styles, forms, frames, hidden elements, tracking pixels and `data:` images are dropped.
   - Linked story cards become a linked heading followed by their summary.
4. **Downstream.** The result goes through the existing `normalizeWebpage`, source sections, passages, references and click navigation exactly like a Firecrawl scrape.
5. **Credentials.** The reader sends no credentials, and a saved Firecrawl key never goes to the relay.

Firecrawl is still needed for:
- web search (`banana:search`)
- Explore (site maps)
- site references (screenshot and branding)
- sites that block non-browser clients or render their text with JavaScript

## Relay safety

The reader is the relay's only general-destination route. The full list of limits is in the [relay README](../experiments/encrypted-relay/README.md#webpage-reader). In short:
- **Addresses.** Every resolved address must be public, and the connection is pinned to the checked address. Redirects are revalidated, up to 5.
- **Requests.** Only http/https on default ports.
- **Responses.** HTML only, capped at 3 MiB after decompression, with a 15 s budget.
- **Load.** 4 upstream requests in flight, 30 starts per minute globally, and a 5-minute cache.
- **Errors.** Static error messages.

The caller Origin must be allowlisted. That doesn't authenticate non-browser clients, so the global budgets are what bound misuse.

**Local development.** Run the relay with `node experiments/encrypted-relay/relay.mjs`, then start the app with `VITE_BANANA_RELAY=http://127.0.0.1:5189 npm run dev -- --host 127.0.0.1 --port 5178`. The relay allows that origin by default.

**Deployment.** The relay runs on Modal and is deployed by hand (`modal deploy experiments/encrypted-relay/modal_app.py`, Modal client 1.5.5). It was deployed from this branch (commit `10eed64`) on October 16, 2026, at the same URL. Checks on the live relay:
- The served `page-reader.mjs` and `relay.mjs` are byte-identical to the commit.
- `/health` returns 200.
- `/page` returned example.com and Wikipedia (200). It refused the cloud metadata IP, localhost and port 8080 (400), a missing or foreign Origin (403), POST (405), and a JSON URL (415).
- `/reddit` still returns 200, and the encrypted tunnel still opens for an allowed origin.
- In a real browser page loaded from https://andrewburkard.com/banana-browser/, `fetch` to `/page` returned Wikipedia (941 ms) and Hacker News (408 ms) with CORS allowed, and refused `10.0.0.1`.

The site's frontend uses the reader only once this branch is merged and GitHub Pages redeploys. Redeploy the relay if `page-reader.mjs` or `relay.mjs` change during review.

## Live check (local relay, real sites)

Same pages as the [September 8 Firecrawl sweep](popular-page-regressions-2026-09-08.md), read through a local relay with the app's extraction code. No model calls. Times are single reads from this Mac.

| Page | Result | Markdown chars (Firecrawl) | Links | Images | Sections |
| --- | --- | ---: | ---: | ---: | ---: |
| bbc.com | OK, 0.25 s | 27,132 (46,414) | 145 | 5 | 10 |
| cnn.com | HTTP 403 | — (132,021) | | | |
| en.wikipedia.org/wiki/World_Wide_Web | OK, 0.19 s | 173,199 (231,156) | 200 | 5 | 33 |
| developer.mozilla.org/…/JavaScript | OK, 0.65 s | 72,967 (77,737) | 200 | 0 | 16 |
| github.com/facebook/react → react/react | OK, 1.26 s | 18,838 (22,834) | 143 | 5 | 8 |
| amazon.com | OK, 0.62 s | 15,834 (93,936) | 113 | 5 | 6 |
| espn.com | OK, 0.23 s | 22,209 (61,572) | 128 | 5 | 7 |
| news.ycombinator.com | OK, 0.15 s | 15,368 | 163 | 0 | 7 |
| nytimes.com | HTTP 403 | — | | | |

Eight of ten pages read successfully. The extracted Markdown contains the real story headlines, article text and navigation. Pages built mostly by JavaScript (Amazon, part of ESPN) yield less text than Firecrawl's rendered scrape. CNN and the New York Times refuse non-browser clients; the reader does not disguise itself as a browser to get around that.

In the built-in browser pane, the app was run against a local relay with a placeholder Gemini key:
- Entering `https://en.wikipedia.org/wiki/Banana` read the page through `/page` (200).
- The article text reached the image prompt.
- No request went to Firecrawl.
- The run then stopped at image generation, as expected with a placeholder key.

## Firecrawl key in connection settings

The Firecrawl key moved from the in-browser Settings panel to the connection screen, as a "Web pages" section below the API keys. It applies to both API-credit and ChatGPT-plan connections.
- It is now saved in `localStorage` with the other keys, instead of tab-only `sessionStorage`. A tab-only key is carried over once.
- Settings shows the Firecrawl options (Site reference, Fresh pages) only when a key is saved.
- Error messages point to connection settings (▾ beside the address bar).
