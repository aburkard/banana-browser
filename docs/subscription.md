# ChatGPT subscription research history

The working integration is documented in [ChatGPT connection](chatgpt-connection.md).
It includes the main UI, static build, saved sessions, refresh, and subscription
usage labels. This document records the earlier prototypes and research.

The
[encrypted browser relay experiment](../experiments/encrypted-relay/README.md)
successfully runs screenshot interpretation and image generation inside a real
browser while a relay forwards TLS-encrypted bytes. This addresses the requirement
that the hosted relay must not receive readable subscription credentials.
The original local Vite adapter remains for reference and is disabled by default.

Verified on September 5, 2026 with an existing ChatGPT-authenticated Codex login:

- GPT-5.6 Luna read an inline screenshot and returned a JSON click decision.
- GPT Image 2 generated a PNG through the image-generation tool on a
  GPT-5.6 Sol Responses request.
- The endpoint rejected the hosted site's cross-origin preflight (HTTP 400,
  no Access-Control-Allow-Origin), so a static GitHub Pages app cannot call it
  directly with native fetch. The newer experiment instead runs TLS in
  WebAssembly and uses a WebSocket-to-TCP relay. End users would not need a local
  helper when that relay is hosted.

The encrypted browser experiment also verified valid HTTPS responses, rejection
of an expired certificate with libcurl error 60, and OpenAI device-code issuance.
Its relay observed TLS handshakes and did not observe the plaintext test marker.
Live model calls used an existing login injected into isolated browser memory by
the test runner, never through a relay HTTP endpoint. **A fresh device login and
token exchange subsequently succeeded after the user completed sign-in.** The
real experiment tab then completed screenshot interpretation and decoded a
1536×1024 generated image. These checks are a feasibility demonstration, not a
security audit. The relay was subsequently deployed on Modal.

**Current scope:** The user accepts experimental subscription support for this
public side project, including the working device flow. The CLI warning is a UX concern to
improve, not a reason to exclude the feature or require a separately branded
OAuth application.

OpenClaw's normal browser OAuth flow uses PKCE and a localhost callback, with a
manual return-URL/code fallback. OpenCode also documents ChatGPT subscription
browser login. Our browser check reached a normal OpenAI login page with the
localhost callback and no device-code warning on that initial screen. Replacing
the callback with the hosted Banana Browser URL produced an authentication error.
The user subsequently reported normal browser sign-in and screenshot interpretation
succeeding with the manual return-URL flow. The return URL may land on an unreachable
localhost page. Do not promise a seamless hosted callback or warning-free consent.

The direct request format was researched from OpenClaw's
[OpenAI provider documentation](https://docs.openclaw.ai/providers/openai),
[image-generation documentation](https://docs.openclaw.ai/tools/image-generation),
and [implementation](https://github.com/openclaw/openclaw/blob/main/extensions/openai/image-generation-provider.ts).
This uses the Codex subscription backend, not the public OpenAI API and not a
full Codex agent runtime. Its protocol and account availability may change.

## Historical local adapter

`npm run dev:subscription` enables localhost-only endpoints beneath
`/banana-browser/api/subscription/`. Regular development and static builds do
not enable those endpoints. The adapter reads `CODEX_HOME/auth.json` (default
`~/.codex/auth.json`) on each request. It never returns, logs, copies, refreshes,
or modifies those credentials. Keychain-only credentials aren't supported.
If the token expires, renew the login in Codex and retry. See official
[Codex authentication documentation](https://learn.chatgpt.com/docs/auth).

Only the fixed image-generation tool and two click models are allowed. Requests
are size limited, time limited, restricted by localhost Host and same-origin
checks, and never automatically retried. Subscription calls consume plan
allowances; token counts must not be presented as API dollar costs or as a
remaining plan balance.

Run `npm test` for mocked protocol, authentication, validation, and origin
checks. Live smoke tests were run separately and aren't part of the test suite.
Main-app integration and refresh/session behavior are now implemented. The
encrypted relay is deployed on Modal with one warm container; hosted TLS, screenshot interpretation,
image generation, and a separate frontend origin passed. See
[deployment and verification details](modal-relay.md).
