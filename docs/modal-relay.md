# Modal relay deployment

Deployed September 5, 2026 to the existing `aburkard` Modal workspace:

- Test page: https://aburkard--banana-browser-relay-web.modal.run/
- Dashboard: https://modal.com/apps/aburkard/main/deployed/banana-browser-relay
- App ID: `ap-ywe5CVheGPwT11nxWOBRh3`
- One warm container; one-container scaling limit; 0.125 requested CPU cores;
  256 MiB RAM. Estimated 30-day baseline $5.68 before credits, excluding usage
  above requested resources and chargeable bandwidth. Other workspace usage
  shares the same credit. This configuration is not a billing cap.

## Verified through Modal

- Real Chromium browser TLS: valid HTTPS works; expired certificate rejected
  with libcurl error 60 before any existing credentials are loaded.
- OpenAI issued a device code from the hosted relay.
- Existing Codex login passed directly into browser memory: screenshot
  interpretation returned `{"label":"Read story"}`; image generation returned
  and decoded a 1536x1024 image.
- Four TLS connections in the complete model test; no plaintext authorization
  marker or test canary detected by the relay. This corroborates the design;
  it is not independent cryptographic proof.
- Separate frontend origin: local static assets used only the remote Modal
  WebSocket tunnel; valid/invalid TLS and OpenAI device initiation passed.
- Hosted browser login UI with simulated responses: wrong-state rejection,
  token exchange, model outputs, input cleanup, no persisted credentials, and
  recovery after rejected exchange passed.
- 17 main tests and 3 relay tests passed; production build passed. Patched ws to
  8.21.3; npm audit reported zero known vulnerabilities for relay dependencies.
- Public source downloads matched local relay/configuration/dependency files.
  Three warm health checks, including new HTTPS connections, took 496, 526, and
  524 ms from this machine. These are spot checks, not an uptime/latency guarantee.
- Fresh normal browser OAuth also passed through the deployed page using computer
  use: existing Brave account session, normal Codex consent, manual localhost
  callback paste, encrypted token exchange, screenshot label `Read story`, and
  a decoded 1536x1024 image. No device-code warning appeared. Screenshot usage was
  186 input / 10 output tokens; image wrapper usage was 2297 input / 106 output.
  The UI reported both model tests passed and no stored login. The used callback
  tab was closed. This verifies the full fresh-login flow, beyond token injection.

## Main-app integration

The relay and its test page are deployed. The main Banana Browser UI and static
build now include subscription access; publishing the frontend is a separate
step from deploying the relay. The main client uses the endpoint above and bundles
its pinned browser TLS assets. The standalone experiment can instead use
relay-config.json to select an endpoint.

Normal OAuth still requires the manual callback paste. Fresh login, two real
refresh rotations, returning in a new tab, image generation, and click navigation
passed in the integrated frontend on September 6, 2026. Brave generation also
completed successfully after a long wait. These are spot checks, not a complete
cross-browser test matrix. See [current connection details](chatgpt-connection.md).

First-party relay/browser files are MIT licensed, and the hosted page exposes
the deployed relay source and configuration. No other Modal apps or workspace
billing settings were changed.
