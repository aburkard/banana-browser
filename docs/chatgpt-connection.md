# ChatGPT connection

Banana Browser can use a ChatGPT plan for GPT Image 2 generation and GPT 5.6 Luna/Terra click interpretation. This is an experimental use of Codex sign-in, not an official OpenAI integration. OpenAI may change these endpoints or eligibility.

## Sign in

Choose **Connect ChatGPT**, sign in on OpenAI, then paste the final localhost address back into Banana Browser. No process needs to listen on localhost:1455. The browser’s “can’t connect” page is expected. A device code is available under **Try another way**; OpenAI’s warning remains visible on that route.

**Keep me signed in** is opt-in. Checked: credentials go in localStorage and survive closing the browser. Unchecked: credentials go in sessionStorage for that tab. Browser storage clearing, private browsing, revoked sessions, and provider expiry can require another sign-in. Disconnect removes both local stores; it does not revoke the provider session or sign out of ChatGPT elsewhere.

Expired access tokens refresh through the encrypted relay. A Web Lock serializes refreshes across tabs, and each successful rotation replaces the saved refresh token. An in-flight refresh cannot restore a disconnected session. Requests are not automatically replayed after a model request fails.

Duplicating a tab also copies sessionStorage. Shared, one-way fingerprints record consumed refresh tokens so a stale duplicate cannot replay a token that another tab already rotated. These markers contain no usable credentials. A stale duplicate or an uncertain refresh result requires a new sign-in; remembered sessions normally read the updated credentials from shared localStorage. Markers remain on the device until site data is cleared, including when a tab-only login ends.

## Trust boundary

The static site runs TLS in the browser using pinned libcurl.js 0.7.1. The Modal relay forwards the inner encrypted connection to allowed OpenAI hosts. It can see destinations, timing, and traffic sizes, but cannot decrypt tokens, prompts, or images. The browser validates the upstream certificate.

This protects against a relay reading traffic. It does not protect against malicious JavaScript served by the frontend: code running on the site’s origin can read its stored credentials. GitHub Pages project paths share an origin. The frontend and its dependencies remain part of the trust boundary. Do not add third-party analytics or scripts to the sign-in page.

The callback is checked against the exact redirect, random state, and 15-minute pending login. PKCE binds the code exchange to that tab. The address is cleared on submission/cancellation, and credentials are never included in model logs or usage displays.

## Source and deployment

- [Frontend](../src/subscription.ts), [session store](../src/chatgpt-session.ts), [sign-in UI](../src/chatgpt-ui.ts)
- [Relay and deployment](../experiments/encrypted-relay/README.md), [Modal configuration](modal-relay.md)
- [Running relay source](https://aburkard--banana-browser-relay-web.modal.run/source/relay.mjs)

`npm run build` includes the pinned JS/WASM assets and license in `dist/chatgpt`. GitHub Pages serves the frontend; Modal hosts the WebSocket relay. The relay allows the published site origins and local test origins on ports 5178/5189.

The GitHub link points to the public project. This branch’s changes must be pushed before releasing the new frontend so visitors can inspect the matching source. Serving source from the relay is useful for inspection but is not cryptographic proof of the deployed process.

## Verification

`npm test` covers session persistence, refresh rotation across tabs, cancellation/disconnect races, invalid callbacks, streamed responses, and model routing without API keys or API cost estimates. `npm run build` checks the static bundle. See the relay README for certificate and transport smoke checks.

On September 6, 2026, a fresh browser sign-in from the built static frontend completed against the live Modal relay. A local test page renewed that saved login twice and successfully made a model request with the result. Closing and reopening the frontend in a new tab restored the connection without sign-in. This used a separate login created for Banana Browser, not the developer's Codex credential file. The local test page is not part of the production build.

The integrated app also generated a Hacker News front page through GPT Image 2. Clicking a story used the screenshot to resolve its correct Hacker News item URL. The UI displayed session token counts with the ChatGPT plan label, without API dollar estimates.
