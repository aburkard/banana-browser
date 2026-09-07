# OpenAI image previews

Public OpenAI image creation and editing now request `stream: true` and `partial_images: 1`, retaining `moderation: low`. The first partial replaces the loading animation with a fitted image and compact progress label. The committed canvas, history, cache and click context only receive the final image. Gemini and ChatGPT-plan transport are unchanged.

The SSE reader supports fragmented events, CRLF, early final completion, and generation/edit event types. Requests have a 180-second timeout, a 64 MiB stream limit, and no automatic retry. Truncated/error streams clear the preview and count one request with unknown usage. Final usage is recorded once from the provider's aggregate report; no synthetic tokens are added to reported usage. The per-image estimate includes one preview's additional 100 image output tokens (GPT Image 2: $0.003). As with other requests, the UI is an estimate rather than billing reconciliation.

Validation: 155 offline tests and production build passed. Tests cover fragmented generation/edit streams, early final with an open connection, malformed/truncated/error events, preview cleanup, final-only committed state, once-only usage accounting, and both outgoing request formats. Browser check with a delayed synthetic SSE response confirmed fitted noninteractive preview and final canvas replacement at a mobile viewport without document overflow. Independent code review found no substantive issues. No paid calls; real preview arrival time and provider billing have not been measured in this change.

References:
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/reference/resources/images/generation-streaming-events
- https://developers.openai.com/api/reference/resources/images/edit-streaming-events
