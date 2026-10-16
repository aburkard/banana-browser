# Model Pricing

Last verified: **October 16, 2026**. Prices are USD for the direct Gemini and OpenAI APIs using standard processing. Token rates below are per **1 million tokens**, with uncached input and short-context rates where applicable. Batch, Flex, priority processing, taxes, and account-specific terms are excluded.

## Image generation

### Gemini

| Model ID | Text/image input | Text/thinking output | Image output |
|----------|------------------|----------------------|--------------|
| `gemini-3.1-flash-lite-image` | $0.25 | $1.50 | $30 |
| `gemini-nano-banana-2.1` | $1.50 | $7.50 | $30 |
| `gemini-3.1-flash-image` | $0.50 | $3 | $60 |
| `gemini-3-pro-image` | $2 | $12 | $120 |

Approximate image-output costs, excluding input and text/thinking:

| Model | 0.5K | 1K | 2K | 4K |
|-------|------|----|----|----|
| Nano Banana 2 Lite | — | $0.0336 | — | — |
| Nano Banana 2.1 | — | $0.0336 | $0.0504 | $0.113 |
| Nano Banana 2 | $0.045 | $0.067 | $0.101 | $0.151 |
| Nano Banana Pro | — | $0.134 | $0.134 | $0.240 |

Banana Browser defaults to Nano Banana 2 Lite at 1K when only a Gemini key is available. Lite accepts at most one reference image in this app because it is not optimized for multiple references or sequential editing. Nano Banana 2 defaults to 1K; Pro defaults to 2K.

Nano Banana 2.1 rates were checked October 16, 2026. It uses 1,120, 1,680 and 3,780 output tokens at 1K, 2K and 4K; it has no 0.5K size. The app defaults it to 1K with **minimal** thinking. The API's own default is medium, which adds thinking output at $7.50/M. The API accepts up to 14 input images; the app keeps its usual budget of six (reference photos plus the previous page). Google lists 2.1 as the recommended replacement for `gemini-3.1-flash-image`, with no shutdown date announced for either. In the October 15, 2026 bake-off (one dense ESPN page, 1K, minimal thinking, five references), 2.1 took 12.6 s median at about $0.044 per page including input, against 4.9 s for Lite. Its worst page had 8 non-words, against 45 for Lite. Its price badge shows about $0.036 at 1K: the 1,500 assumed prompt tokens plus image output, excluding reference images and thinking.

The other Gemini rates match the previous configuration. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [image generation guide](https://ai.google.dev/gemini-api/docs/image-generation).

### OpenAI

| Model ID | Text input | Image input | Image output |
|----------|------------|-------------|--------------|
| `gpt-image-2.5-sunburst` | $5 | $8 | $30 |
| `gpt-image-2.5-flare` | $5 | $8 | $30 |
| `gpt-image-2` | $5 | $8 | $30 |
| `gpt-image-1.5` (shuts down Dec 1, 2026) | $5 | $8 | $32 |
| `gpt-image-1-mini` (shuts down Dec 1, 2026) | $2 | $2.50 | $8 |

With an OpenAI key the app defaults to **GPT Image 2.5 Flare, 1920×1280, low quality**; the ChatGPT plan uses GPT Image 2. Image 1.5 and Image Mini default to 1536×1024, medium quality. Generation and editing use the Images API. OpenAI deprecated Image 1.5 and Image Mini on June 2, 2026 and recommends GPT Image 2.5 instead; the picker labels them as retiring.

At the default 1920×1280 low, the displayed estimate for Flare and GPT Image 2 is the same, about **$0.0134 per generation**: $0.0075 for an assumed 1,500 text-input tokens plus $0.0059 image output (197 tokens). GPT Image 2 and 2.5 output estimates use the official guide's token calculator: grids are 16/48/96 for GPT Image 2 low/medium/high and 16/24/48/64/96 for 2.5 low through max. This replaced pixel-scaling from a 1536×1024 price, which overstated the default at $0.0078. The calculator matches recorded usage: 197 tokens at 1920×1280 low and 1,372 at 1536×1024 medium. Reference images increase input cost.

[OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT Image 1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5), [GPT Image Mini](https://developers.openai.com/api/docs/models/gpt-image-1-mini), [image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

## Click interpretation (text/vision)

| Model ID | Input | Output | App's initial thinking/reasoning setting |
|----------|-------|--------|-----------------------------------------|
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | minimal |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | minimal |
| `gemini-3.8-flash` | $0.75 | $3.75 | low |
| `gemini-3-flash-preview` | $0.50 | $3 | low |
| `gemini-3.1-pro-preview` | $2 | $12 | low |
| `gemini-4-argon` | $2; $4 from Dec 1, 2026 | $10; $20 from Dec 1, 2026 | low |
| `gpt-6-luna` | $0.10 | $0.50 | low |
| `gpt-6.1-sol` | $2 | $10 | low |
| `gpt-6-astra` | $10 | $50 | low |
| `gpt-5.6-luna` | $0.20 | $1.20 | low |
| `gpt-5.6-terra` | $2 | $12 | low |
| `gpt-5.4-mini` | $0.75 | $4.50 | low |
| `gpt-5.4` | $2.50 | $15 | low |

GPT-6 Luna, GPT-6.1 Sol and GPT-6 Astra are OpenAI's current models; Gemini 4 Argon is Google's flagship. GPT-5.4 Nano was removed from the picker: OpenAI deprecated it on October 1, 2026 (shutdown April 1, 2027) in favor of GPT-6 Luna, which costs half as much.

For OpenAI models from GPT-5.6 on, cache writes cost 1.25× the input rate. Cache reads, per million input tokens:

| Model | Cache read | Cache write |
|---|---:|---:|
| GPT-6 Luna | $0.01 | $0.125 |
| GPT-6.1 Sol | $0.10 | $2.50 |
| GPT-6 Astra | $1.00 | $12.50 |
| GPT-5.6 Luna | $0.02 | $0.25 |
| GPT-5.6 Terra | $0.20 | $2.50 |

The app applies explicit caching to these five API click models and includes read/write rates in its usage estimate. Cache writes replace the ordinary input charge for those tokens; they are not added on top. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [measured comparison](cache-comparison-2026-09-06.md).

**Scheduled changes:**
- Gemini 4 Argon's introductory prices double on **December 1, 2026**: $4 input, $0.20 cached, $20 output.
- Gemini 3.8 Flash rises to **$1.50 input / $7.50 output** on **January 1, 2027**.

The app's estimates switch at midnight UTC, including in an already-open session; earlier recorded costs stay unchanged.

The existing click defaults remain Gemini 3 Flash when a Gemini key is available, otherwise GPT-5.4 Mini. The newer choices need a comparison of click accuracy and latency before changing defaults.

Reasoning settings by model:
- GPT-6 Luna and GPT-5.6 accept `none`, `low`, `medium`, `high`, `xhigh` and `max`.
- GPT-6.1 Sol and GPT-6 Astra accept `low` through `max`, with no `none`.
- Gemini 3.8 Flash and Gemini 4 Argon accept only `low`, `medium` and `high`. Argon's thinking cannot be disabled.

[Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini thinking levels](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon), [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6), [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), [GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations).

## Availability and retired models

- The supported Gemini image models have **no Gemini API free tier**. The old claim of 1,500 free images per day was incorrect. AI Studio access does not establish a free API image quota. [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).
- The app now uses stable `gemini-3.1-flash-lite`; its preview endpoint shut down May 25, 2026.
- Original Nano Banana (`gemini-2.5-flash-image`) was removed from the picker. Google now lists it as legacy, limited to past users, with an earliest shutdown of March 15, 2027. The October 2, 2026 date recorded earlier no longer applies. Use Nano Banana 2 Lite, Nano Banana 2, or Pro instead. [Google deprecations](https://ai.google.dev/gemini-api/docs/deprecations).
- OpenAI shuts down `gpt-image-1.5` and `gpt-image-1-mini` on December 1, 2026, and `gpt-5.4-nano` on April 1, 2027. [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations).
- `gemini-3-flash-preview`, the default Gemini click model, is labelled legacy. Google lists no shutdown date for it.

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

## October 16 pricing audit

Rechecked every configured rate against Google's pricing page (updated October 15) and OpenAI's pricing, model and deprecation pages. All existing text and image token rates were still correct.

Changes:
- **Click models.** Added GPT-6 Luna, GPT-6.1 Sol, GPT-6 Astra and Gemini 4 Argon with the rates above, and removed the deprecated GPT-5.4 Nano.
- **Long-context accounting.** Above 272,000 input tokens, all three GPT-6 models use the same 2× input/cache/write and 1.5× output rule as GPT-5.6 and GPT-5.4. No long-context tier is published for Gemini 4 Argon.
- **Image estimates.** GPT Image 2 output estimates use the official calculator (see above). The default estimate dropped from $0.0153 to $0.0134.

Live check: Gemini 4 Argon interpreted two real clicks on a captured ESPN page correctly (5–6 s, $0.0045 each). The GPT-6 requests could not be checked live: the OpenAI API account returned "no credits remaining". Their request shape is covered by unit tests and follows OpenAI's GPT-5.6-and-later caching guidance.
