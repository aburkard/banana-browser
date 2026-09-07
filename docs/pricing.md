# Model Pricing

Last verified: **September 7, 2026**. Prices are USD for the direct Gemini and OpenAI APIs using standard processing. Token rates below are per **1 million tokens**, with uncached input and short-context rates where applicable. Batch, Flex, priority processing, taxes, and account-specific terms are excluded.

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

For Luna, cache reads cost **$0.02** and cache writes cost **$0.25** per million input tokens. The app applies explicit caching to Luna and Terra API click interpretation and includes read/write rates in its usage estimate. Cache writes replace the ordinary input charge for those tokens; they are not added on top. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [measured comparison](cache-comparison-2026-09-06.md).

**Scheduled change:** Gemini 3.8 Flash rises to **$1.50 input / $7.50 output** on January 1, 2027. The app's estimates switch at midnight UTC, including in an already-open session; earlier recorded costs stay unchanged.

The existing click defaults remain Gemini 3 Flash when a Gemini key is available, otherwise GPT-5.4 Mini. The newer choices need a comparison of click accuracy and latency before changing defaults. GPT-5.6 exposes `none`, `low`, `medium`, `high`, `xhigh`, and `max`; Gemini 3.8 supports only `low`, `medium`, and `high`.

[Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini thinking levels](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [GPT-5.4 Nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano).

## Availability and retired models

- The supported Gemini image models have **no Gemini API free tier**. The old claim of 1,500 free images per day was incorrect. AI Studio access does not establish a free API image quota. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
- The app now uses stable `gemini-3.1-flash-lite`; its preview endpoint shut down May 25, 2026.
- Original Nano Banana (`gemini-2.5-flash-image`) was removed from the picker ahead of its October 2, 2026 shutdown. Use Nano Banana 2 Lite, Nano Banana 2, or Pro instead. [Google deprecations](https://ai.google.dev/gemini-api/docs/deprecations).

## How to read the app's estimates

Each navigation or scroll generates an image. Clicking also sends the screenshot and page data to the selected text/vision model. The image price badge excludes click interpretation, assumes 1,500 prompt tokens, and does not include reference-image input or additional thinking costs.

The running spend counter uses returned usage metadata with the selected model's rates. It separates cache reads/writes and text/image tokens where reported and prices them where model-specific rates are configured. It includes Gemini's separately reported thinking tokens; OpenAI reasoning is already included in output tokens and is not counted twice. Missing or inconsistent counts or required rates mark the estimate incomplete, so the displayed amount can omit unpriced usage. Long-context surcharges are covered in the September 7 audit below. Subscription requests display zero API spend, which does not measure subscription allowance use. Compare actual charges with the provider's dashboard. [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Gemini usage and thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking).

## September 7 spend audit

Rechecked standard rates against the official sources above. Added published cached-input prices for supported text models and separate cached text/image prices for OpenAI Images. GPT Image 1.5 text output is $10/M and is now separated from $32/M image output whenever the response supplies modality counts. Unknown text-output prices remain incomplete. [Images response schema](https://developers.openai.com/api/reference/resources/images/methods/generate), [Image 1.5 pricing](https://developers.openai.com/api/docs/models/gpt-image-1.5).

| Model | Cached input / M | Cache writes / M |
|---|---:|---:|
| Gemini 3.1 Flash Lite | $0.025 | — |
| Gemini 3.5 Flash Lite | $0.03 | — |
| Gemini 3.8 Flash | $0.075; $0.15 from Jan 2027 | — |
| Gemini 3 Flash | $0.05 | — |
| Gemini 3.1 Pro | $0.20 | — |
| GPT-5.6 Luna | $0.02 | $0.25 |
| GPT-5.6 Terra | $0.20 | $2.50 |
| GPT-5.4 Nano | $0.02 | — |
| GPT-5.4 Mini | $0.075 | — |
| GPT-5.4 | $0.25 | — |
| GPT Image 2 / 1.5 | Text $1.25; image $2 | — |
| GPT Image Mini | Text $0.20; image $0.25 | — |

Long-context accounting now applies Gemini 3.1 Pro's $4 input/$0.40 cached/$18 output above 200,000 input tokens. Above 272,000 input tokens, GPT-5.4, Luna and Terra use twice the input/cache/write rates and 1.5 times output rates for the full request. Normal app source sections are far smaller. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

Every dispatched model request is now counted once, including a failed/lost response or one without usage. Those cases retain missing values and flag uncertainty; they are not assumed free or assumed billed. Costs remain session estimates, resetting on reload or connection changes. Unknown totals display “Cost unavailable.” Successful responses with unusable content still contribute returned usage. ChatGPT plan usage preserves missing counts and remains separate from API dollars.

OpenAI click requests put stable source/instructions before changing pointer pixels and coordinates. Luna and Terra use explicit breakpoints; GPT-5.4 models retain automatic caching. Minimum cacheable prefixes differ by model, so shorter prompts need not produce cache hits. No padding, cache-storage resource, extra history, or automatic retry is added. [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
