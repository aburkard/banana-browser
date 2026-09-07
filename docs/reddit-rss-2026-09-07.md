# Reddit browsing through public feeds

Anonymous JSON requests returned403 locally and fromModal with default, descriptive, and Chrome-style user agents. The historical June30 app fails too. Public RSS is a working alternative: listing and discussion feeds returned200 application/atom+xml from local Node and temporary Modal functions. A discussion response contained one post and25comments. A rapid follow-up previously returned429, so the implementation includes bounded caching and cooldowns instead of retries.

The existing Modal service now has a separate GET /reddit?url=<Reddit .json URL> endpoint. It permits only known app origins and public subreddit/post paths on www.reddit.com, translates them to RSS, and returns Atom XML. The encrypted WebSocket tunnel and destination allowlist are unchanged. No credentials, cookies, or browser extension are used.

Upstream requests have a descriptive user agent, redirects disabled, a15second timeout, and a2MiB body limit. HTML200 is rejected. There are at most2 requests in flight and6 starts/minute. A60second cache holds up to20feeds/10MiB, with identical request deduplication. Reddit429 responses establish a global cooldown (Retry-After or60seconds, bounded to300seconds). No automatic retries.

The browser parses inert feed content into the existing Reddit source structure, preserves paragraphs and reference links, and verifies discussion post identity. The address bar keeps the original Reddit URL, and existing click interpretation, history, source passages, scrolling and render caches continue to apply. RSS omits scores and total comment counts; these are absent rather than fabricated as zero. The feed contains a limited set of comments.

Independent checks:186 app tests,16 relay tests (including real local sockets), and production build pass. Browser parsing of a real captured Atom response produced the correct post and25comments without executing feed HTML. Review fixes cover requested-post identity, relative links, and percent-encoded slugs. The endpoint intentionally requires cross-origin app requests; the relay diagnostic page is not a supported Banana Browser frontend.

Muse Spark1.3 Contributor Free on Zen/xhigh investigated and implemented the endpoint in an isolated public worktree. Its initial live probes failed DNS, including a neutral control; successful RSS evidence and complete socket tests were obtained independently by the parent. No paid model calls were made for app verification.
