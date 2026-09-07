# Banana Browser encrypted relay

Optional ChatGPT subscription transport for the public Banana Browser side
project. This test page is separate from the main application's provider UI.
The browser runs TLS using [libcurl.js](https://github.com/ading2210/libcurl.js/).
The Node relay forwards encrypted bytes to OpenAI, which terminates the inner
TLS connection. No OpenAI credentials are included in the deployment.

## Run locally

Requires Node 20 or newer:

```sh
npm ci --prefix experiments/encrypted-relay --ignore-scripts
npm start --prefix experiments/encrypted-relay
```

Open http://127.0.0.1:5189/. Opening index.html as a file will not work.

## Deploy to Modal

Use an existing Modal account, or authenticate with `modal setup` first:

```sh
python3 -m venv /tmp/banana-modal
/tmp/banana-modal/bin/pip install -r experiments/encrypted-relay/requirements-modal.txt
/tmp/banana-modal/bin/modal deploy experiments/encrypted-relay/modal_app.py
```

The `banana-browser-relay` app runs one warm container (`min_containers=1`),
with a one-container scaling limit, 0.125 requested CPU cores, and 256 MiB RAM.
The 30-day baseline is approximately $5.68 before Modal credits at rates checked
September 5, 2026. Actual CPU/memory above the request, network egress, and other
workspace usage can raise the bill. This is not a spending cap. Containers can
be preempted or restarted; keeping one warm avoids routine scale-to-zero delays
but does not guarantee uninterrupted uptime.

Only explicitly listed files are uploaded. No local auth, environment files,
browser profiles, or other project directories are included. The deployment
uses its own exact public origin from Modal; edit the origins in modal_app.py
for your website. No custom domain or Modal Team plan is required. To stop
billing, stop this app in Modal's dashboard.

## Separate static frontend

The website can stay on GitHub Pages. Set `url` in relay-config.json to the HTTPS
Modal endpoint (empty means the page's own origin). Publish index.html,
experiment.js, browser-oauth.mjs, relay-config.json, LICENSE, and libcurl.js and
libcurl.wasm from the pinned dependency. Preserve its license and attribution.
Relative asset URLs support a GitHub Pages subdirectory. The relay must allow
the website's exact origin. No local helper is needed. The Modal deployment also
serves its own test page for convenience.

## Sign in

Both methods identify the login as Codex, not a separately registered Banana
Browser OAuth application:

- **Try browser sign-in:** choose **Continue on OpenAI**, sign in, then paste the
  full `http://localhost:1455/auth/callback?...` address from the return tab here.
  That tab may show a connection error because no callback server is running.
  PKCE verifier and state stay in this tab's memory; incorrect and expired return
  URLs are rejected before exchange. Do not reload during sign-in.
- **Use device code instead:** approve the code on OpenAI's page. Device login
  must be enabled in ChatGPT security settings. OpenAI shows its device warning.

The test makes one GPT-5.6 Luna screenshot request and one low-quality GPT Image 2
request through GPT-5.6 Sol, consuming plan usage. Tokens stay in browser memory
and references are cleared when the test ends. Refresh/ID tokens are not retained;
reloading requires another login. Clearing references is not a secure-memory wipe.

## Tests

```sh
npm test --prefix experiments/encrypted-relay
npm test
npm run build
```

With Python Playwright and Chromium installed:

```sh
python3 experiments/encrypted-relay/smoke.py --url https://YOUR-ENDPOINT.modal.run/
python3 experiments/encrypted-relay/smoke.py --url https://YOUR-ENDPOINT.modal.run/ --existing-login
```

The first checks valid HTTPS, expired-certificate rejection, and device-code
initiation without completing login. The optional live test reads
CODEX_HOME/auth.json (default ~/.codex/auth.json) and passes the access token and
account ID directly into an isolated browser's memory via Playwright. It makes
two real model calls. Credentials are not printed or written to artifacts.
Certificate validation must pass before credentials are loaded.

`browser-login-smoke.py` checks the local login UI with simulated responses:
wrong-state rejection, exchange, both model results, input cleanup, no persisted
credentials, and recovery after failed exchange.

Verified locally September 5, 2026: valid HTTPS; expired certificate rejected;
fresh device login; screenshot label `Read story`; image decoded at 1536x1024.
The user also reported normal browser login and screenshot interpretation.
Remote verification is separate from these local results. Other browser engines
and token refresh remain unverified.

## Reddit RSS feed

`GET /reddit?url=<https://www.reddit.com/...json URL>` returns the matching
public subreddit or post-comments feed as Atom XML for the browser to parse
with `DOMParser`. Only canonical `https://www.reddit.com` listing/sort and
comment `.json` URLs are accepted; other hosts, credentials, ports, user and
private paths, traversal, and unknown query keys are rejected with 400.
Upstream requests carry only a descriptive Banana Browser `User-Agent` and an
Atom `Accept` (no cookies or auth), refuse redirects, time out after 15 s,
are capped at 2 MiB, and must return Atom XML (an HTML 200 is an error).

Rate discipline: at most 2 upstream requests in flight and 6 starts per
minute; per-URL 60 s cache (20 entries / 10 MiB); identical concurrent
requests share one fetch. An upstream 429 installs a global cooldown from a
bounded `Retry-After` (default 60 s, max 300 s) with no retries; fresh cache
is still served during cooldown. Only 200s are cached; error bodies are
static JSON and never include upstream content. Caller `Origin` must be on
the same allowlist as the relay. See `reddit-feed.mjs` and its offline tests.

## Boundaries and trust

- Fixed HTTPS destinations: auth.openai.com, chatgpt.com, example.com, and
  expired.badssl.com. The last two are public TLS diagnostics. Port is always 443.
- Separate read-only Reddit endpoint: only `https://www.reddit.com` `/.rss`
  URLs derived from validated `.json` URLs, with the in-flight, rate,
  cache, and cooldown budgets above. The encrypted tunnel and its
  destination list are unchanged.
- Exact browser-origin allowlist; 32 concurrent tunnels; 120 new tunnels/minute;
  1 MiB maximum message; 64 MiB total per tunnel; five-minute lifetime; bounded
  buffering with backpressure. Origin checks protect browsers but are not auth:
  non-browser clients can forge Origin. These limits do not prevent all abuse.
- `/health` and `/stats` expose readiness and aggregate counters. Application logs
  contain no payloads, user IPs, return URLs, or credentials. Hosting-provider
  request logs and network metadata are outside that guarantee.
- TLS-handshake and plaintext-marker counters corroborate the design; they are
  not cryptographic proof. The browser verifies OpenAI certificates.

The relay can see client IPs, destinations, traffic sizes, and timing. Website
JavaScript handles login tokens, so users must trust it and its dependencies.
Public source permits inspection and self-hosting but does not prove that a live
website runs identical code. OpenAI can change this experimental Codex integration;
official support for third-party browser subscription access is not claimed.

## Source and licenses

The page links to the running image's relay source, Modal configuration,
dependency lockfile, and this README. Browser source is available in index.html,
experiment.js, and browser-oauth.mjs. First-party files in this directory are MIT
licensed; the main project now also has an MIT license. libcurl.js 0.7.1 is
LGPL-3.0-or-later; ws 8.21.3 is MIT. Preserve dependency licenses and upstream source
references when redistributing. The implementation can also be published on GitHub.
