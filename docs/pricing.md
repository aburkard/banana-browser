# Model Pricing

Last verified: **September 5, 2026**. Prices are USD for the direct Gemini and OpenAI APIs using standard processing. Token rates below are per **1 million tokens**, with uncached input and short-context rates where applicable. Batch, Flex, priority processing, taxes, and account-specific terms are excluded.

## Image generation

### Gemini

| Model ID | Text/image input | Text/thinking output | Image output |
|----------|------------------|----------------------|--------------|
| `gemini-3.1-flash-lite-image` | $0.25 | $1.50 | $30 |
| `gemini-3.1-flash-image` | $0.50 | $3 | $60 |
| `gemini-3-pro-image` | $2 | $12 | $120 |

Approximate image-output costs, excluding input and text/thinking:

| Model | 0.5K | 1K | 2K | 4K |
|-------|------|----|----|----|
| Nano Banana 2 Lite | — | $0.0336 | — | — |
| Nano Banana 2 | $0.045 | $0.067 | $0.101 | $0.151 |
| Nano Banana Pro | — | $0.134 | $0.134 | $0.240 |

Banana Browser defaults to Nano Banana 2 Lite at 1K when only a Gemini key is available. Lite accepts at most one reference image in this app because it is not optimized for multiple references or sequential editing. Nano Banana 2 defaults to 1K; Pro defaults to 2K.

These rates match the previous configuration. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [image generation guide](https://ai.google.dev/gemini-api/docs/image-generation).

### OpenAI

| Model ID | Text input | Image input | Image output |
|----------|------------|-------------|--------------|
| `gpt-image-2` | $5 | $8 | $30 |
| `gpt-image-1.5` | $5 | $8 | $32 |
| `gpt-image-1-mini` | $2 | $2.50 | $8 |

These rates also match the previous configuration. The app defaults to **GPT Image 2, 1920×1280, low quality** whenever an OpenAI key is available. Image 1.5 and Image Mini default to 1536×1024, medium quality. Generation and editing use the Images API.

The displayed GPT Image 2 default estimate is about **$0.0153 per generation**: $0.0075 for an assumed 1,500 text-input tokens plus $0.0078 estimated image output. The output estimate scales the app's 1536×1024 low-quality reference price by pixel count; it is not an official fixed price for 1920×1280. Reference images increase input cost.

[OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT Image 1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5), [GPT Image Mini](https://developers.openai.com/api/docs/models/gpt-image-1-mini), [image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

## Click interpretation (text/vision)

| Model ID | Input | Output | App's initial thinking/reasoning setting |
|----------|-------|--------|-----------------------------------------|
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | minimal |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | minimal |
| `gemini-3.8-flash` | $0.75 | $3.75 | low |
| `gemini-3-flash-preview` | $0.50 | $3 | low |
| `gemini-3.1-pro-preview` | $2 | $12 | low |
| `gpt-5.6-luna` | $0.20 | $1.20 | low |
| `gpt-5.6-terra` | $2 | $12 | low |
| `gpt-5.4-nano` | $0.20 | $1.25 | low |
| `gpt-5.4-mini` | $0.75 | $4.50 | low |
| `gpt-5.4` | $2.50 | $15 | low |

**Scheduled change:** Gemini 3.8 Flash rises to **$1.50 input / $7.50 output** on January 1, 2027. The app's estimates switch at midnight UTC, including in an already-open session; earlier recorded costs stay unchanged.

The existing click defaults remain Gemini 3 Flash when a Gemini key is available, otherwise GPT-5.4 Mini. The newer choices need a comparison of click accuracy and latency before changing defaults. GPT-5.6 exposes `none`, `low`, `medium`, `high`, `xhigh`, and `max`; Gemini 3.8 supports only `low`, `medium`, and `high`.

[Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini thinking levels](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [GPT-5.4 Nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano).

## Availability and retired models

- The supported Gemini image models have **no Gemini API free tier**. The old claim of 1,500 free images per day was incorrect. AI Studio access does not establish a free API image quota. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
- The app now uses stable `gemini-3.1-flash-lite`; its preview endpoint shut down May 25, 2026.
- Original Nano Banana (`gemini-2.5-flash-image`) was removed from the picker ahead of its October 2, 2026 shutdown. Use Nano Banana 2 Lite, Nano Banana 2, or Pro instead. [Google deprecations](https://ai.google.dev/gemini-api/docs/deprecations).

## How to read the app's estimates

Each navigation or scroll generates an image. Clicking also sends the screenshot and page data to the selected text/vision model. The image price badge excludes click interpretation, assumes 1,500 prompt tokens, and does not include reference-image input or additional thinking costs.

The running spend counter uses returned usage metadata with the selected model's rates. It is an estimate, not an invoice: it currently does not distinguish cache reads/writes, long-context surcharges, or Gemini text versus image-output tokens, and does not include Gemini's separately reported thinking tokens. In particular, GPT-5.6 has separate cache-write billing and higher rates above 272K input tokens. Compare actual charges with the provider's dashboard. [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Gemini usage and thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking).
