# Isolated image comparison — September 6, 2026

User authorized exactly two image calls: one OpenAI API call and one ChatGPT subscription call. No retries or Fast-mode calls were made.

Prompt: `A yellow banana on a plain blue background. Flat illustration, no text.`

Both requested GPT Image 2, size `1536x1024`, quality `medium`, with no reference images. Executed sequentially in Brave (API first), outside Banana Browser's data fetch, page prompts, and click flow. Browser TLS/auth preparation took 0.06 seconds and was excluded. Timing ends after the complete response body is parsed, before image decoding/rendering.

| Route | Seconds | Success | Actual dimensions |
| --- | ---: | --- | --- |
| OpenAI `/v1/images/generations` | 26.84 | Yes | 1536 × 1024 |
| ChatGPT Codex Responses via encrypted relay, Sol → GPT Image 2 tool | 26.82 | Yes | 1254 × 1254 |

Both images visibly match the simple prompt. This pair shows no meaningful timing difference, but does not establish general parity: one sample per route, sequential order, and different returned dimensions. The subscription route did not honor the requested landscape size in this sample. Do not assume quality settings were honored just because accepted.

Reported usage differs in scope:

- API: 21 input text tokens, 1,372 output image tokens.
- Subscription top-level response: 2,322 input tokens, 68 output tokens, zero cached/cache-write/reasoning tokens reported. This is not an equivalent image-token accounting breakdown and does not establish subscription cost or allowance consumption.

Credentials remained in the browser; none were printed or copied into files. The temporary comparison harness lives only in local build output and is removed by the next ordinary build. Production request behavior was unchanged. Results were left visible in the Brave comparison tab.

Follow-up: inspect subscription image-tool size handling before treating API/subscription timings as a matched-resolution benchmark. This test did not evaluate Fast mode.

## Actual app request: Sol vs. Luna with no reasoning

After the isolated test, the user authorized investigating the slower app flow and replacing the image-tool wrapper with a cheaper model and minimum reasoning. Two additional subscription image requests were sent from Brave; no API-key image calls, automatic retries, or Fast-mode requests were made.

Both used `BananaBrowser.navigate(BOOKMARKS['ESPN NFL News'])`, the existing page prompt/reference-image processing, and GPT Image 2. **Correction:** the harness label said medium quality and `1536x1024`, but did not set those options. The actual app constructor defaults were low quality and `1920x1280`; the later matched-input test explicitly captured these fields. Sol used the existing image request without an explicit reasoning setting. Luna used `reasoning.effort: "none"`. The initial replay harness failed locally while reinitializing an already-loaded libcurl module, before sending the Luna request. The corrected Luna harness ran separately and re-fetched ESPN data, so this is the same app flow, not a byte-identical input replay. Both resulting pages showed the same lead story and headline set.

| Stage | Sol baseline | Luna / none |
| --- | ---: | ---: |
| Source data fetch | 0.270 s | 0.260 s |
| Reference image downloads | 0.487 s | 0.405 s |
| Browser TLS + authentication ready (cumulative) | 0.057 s | 0.048 s |
| Fetch response available / stream opened (cumulative) | 4.104 s | 3.661 s |
| Image-generation-start event (cumulative) | 22.319 s | 11.707 s |
| Image-output-received event (cumulative) | 84.574 s | 84.059 s |
| Complete response read (cumulative) | 84.574 s | 84.060 s |
| Actual image dimensions | 1536 × 1024 | 1024 × 1536 |

Cumulative request timings begin before browser TLS/auth preparation and exclude the source/reference fetches. The test initially labeled fetch resolution as “Response headers received”; libcurl.js resolves fetch on its first body-data callback, so the production label is now “Response stream opened.” The interval from image-generation-start to image output was 62.255 s for Sol and 72.352 s for Luna. These are observed stream milestones, not a breakdown of server queue time, model reasoning, pure image computation, or relay transfer time.

Luna accepted the forced image tool with reasoning disabled and produced a coherent ESPN page incorporating references and headlines. It reached the image-generation event 10.612 s earlier, but overall image latency was essentially unchanged in this pair. This does not establish a speed improvement, a general latency distribution, or a measured reduction in subscription allowance use. The returned portrait image also means this is not a matched-orientation benchmark. Neither the requested size nor quality should be assumed honored by this private plan endpoint.

At this stage the app switched to Luna with no reasoning for the image-tool wrapper, as requested. GPT Image 2, click-model settings, page prompts, reference images, red-X handling, and conversation behavior are unchanged. Local console timing records expose only scope, phase, request ID, and elapsed milliseconds; they add no remote telemetry or retries.

[Luna's official model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna) lists the image-generation tool and `none` reasoning. That public API documentation alone does not establish support in the private Codex endpoint; the live call above verified acceptance. No documented direct Images API access using ChatGPT subscription auth was found in the [image generation guide](https://developers.openai.com/api/docs/guides/image-generation) or [Codex image-generation documentation](https://learn.chatgpt.com/docs/image-generation). This integration still uses a language-model Responses call with a forced image tool.

Remaining: investigate plan image size/quality handling before adding silent retries or changing prompts; benchmark multiple matched-output runs only with an explicit spending budget. The local preview was rebuilt with the tested Luna setting and timing instrumentation. Nothing was merged or deployed.

## Matched-input diagnosis and direct image fix

The follow-up investigation found a direct plan image endpoint in [Codex's own Images client](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/images.rs), using the [ChatGPT Codex provider base URL](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs). This supersedes the earlier conclusion that a language-model wrapper was necessary. The JSON request schema is in [images.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/images.rs).

One ESPN request was captured at the app's subscription boundary: 4,315 prompt characters, five inline reference images, and 1,425,717 serialized bytes. Its SHA-256 was `988400778e6b96ef34f5ebaf13cdb6331411013e88065418581893600deb28f8`. API, wrapper, and direct-plan tests reused that captured prompt and reference-image array. The later API quality control and app verification re-captured the same data and confirmed the exact same hash. The API medium control explicitly overrode only size/quality after this capture.

| Request | Actual returned quality / dimensions | Complete response | Output image tokens |
| --- | --- | ---: | ---: |
| API app defaults: low, 1920×1280 | low / 1920×1280 | 28.824 s | 197 |
| Plan wrapper, same requested defaults | medium / 1536×1024 | 79.547 s | Not separately exposed |
| Direct plan Images endpoint, same requested defaults | medium / 1024×1536 | 62.990 s | 1,372 |
| API control requesting medium, 1536×1024 | medium / 1536×1024 | 48.123 s | 1,372 |
| App using the new direct implementation, same defaults | medium / 1024×1536 | 63.731 s | 1,372 |

All calls were sequential. These are individual observations, not a statistical latency guarantee. Portrait and landscape outputs have equal pixel area but differing composition. The wrapper rewrote the 4,315-character prompt to 1,392 characters, used 289 text output tokens, and reached its image-generation event at 12.111 s. The direct endpoint passes the original prompt and images without a text-model request.

### What explains the discrepancy

1. **Different actual quality despite the same UI selection.** Both tested plan paths overrode low quality to medium. The API honored low. The matched-quality API control took 19.299 s longer than API low, with 1,372 versus 197 output image tokens (about 7×). Quality and dimensions changed together in that control to match the plan output; do not attribute every millisecond exclusively to quality.
2. **An unnecessary text-model wrapper on the plan route.** Bypassing it removed a separate request stage. In these observations the direct route was 16.557 s faster than the wrapper, approximately 21%, with the app verification reproducing the direct-route timing.
3. **No substantial additional app delay in this case.** Source/reference fetches took 0.465 s in the controlled comparison and 0.323 s in the app verification. Browser TLS/auth took at most 0.051 s. Direct-plan body transfer/parsing took 0.422 s in the comparison and 0.911 s in app verification. The remaining ~15 s between API medium and direct plan occurred before response-body arrival; available headers exposed no server processing/queue timing. This does not identify a specific scheduler tier, prove lower subscription priority, or fully separate upload/network latency from upstream processing.

The earlier simple-image test used medium quality on the API, so it did not exercise the app's fast low-quality default. That is why it failed to reveal this configuration discrepancy. Real webpage generation also has more text and reference-image input than the simple banana prompt; these observations do not isolate its independent latency contribution.

### Implementation

Subscription images now use `/backend-api/codex/images/generations` without input images and `/backend-api/codex/images/edits` with references or prior-page images. The browser still validates TLS through the same encrypted relay; credentials stay in the browser. Click interpretation still uses Luna/Terra Responses with its existing effort setting. There is no retry or API-billing fallback.

The response reader accepts bounded JSON, verifies an image exists, handles returned image formats, and reports actual image input/output token counts. Page prompts, red-X placement, reference-image order, and turn handling are unchanged. Subscription size/quality controls are hidden because the endpoint ignores the requested values; API controls remain available. No prompt-based quality workaround or costly Fast tier was enabled.

The relay's 120-second socket-idle timeout was removed because direct requests can remain silent until completion. Its existing five-minute absolute connection deadline, byte budget, destination/origin allowlists, and concurrency limits remain in force. This protects long direct calls; it does not reduce generation time.

### Final verification and spending

After the relay update, the actual app generated a Hacker News page without references using the new `/images/generations` path: 59.783 s, medium quality, 941×1672, 1,680 input text tokens and 1,158 image output tokens. This confirms both direct endpoint branches return decodable pages through the deployed encrypted relay. The ESPN and Hacker News outputs were visually inspected. Their contents and reference usage were coherent; the plan's auto-selected portrait layouts remain a limitation.

This investigation made two API image calls and four subscription image calls total, with no retries, paid Fast mode, or click-model calls. Based on the app's existing token-rate table, the two API calls total approximately $0.112; this is an estimate, not a billing-dashboard reading. Credentials remained in the browser, and temporary harnesses were removed from build output by the ordinary build. No credentials or image payloads were committed.

55 main-app tests and three relay tests passed, along with the TypeScript/static build. Independent review covered routing, auth, response bounds, ignored settings, and the relay deadline. The timeout change was deployed to the existing Modal relay and its served source matched the local file. Frontend changes are in the local preview, not merged or published to GitHub Pages. Findings were recorded on issues #4 and #15; unsupported size/quality controls remain an upstream limitation, rather than a solved endpoint capability.
