# Priority tiers — October 17, 2026

Both API providers sell a faster tier. Only one place got measurably faster.

## What exists

- **OpenAI "Fast mode"** (`service_tier: "fast"`, formerly priority) covers the GPT text models on the Responses and Chat Completions APIs. It costs exactly twice the standard rates, cached input included: GPT-6 Luna is $0.20/$0.02/$1.00 per million input/cached/output tokens instead of $0.10/$0.01/$0.50. The Images API rejects the parameter ("Unknown parameter: 'service_tier'"), so GPT Image has no priority option.
- **Gemini "Priority"** (`service_tier: "priority"`) costs 75–100% more and is in preview for paid Tier 2/3 projects. Google lists the Gemini text models; Nano Banana 2.1 also accepted it and reported serving at priority. When capacity runs out, requests are downgraded to standard and billed at the standard rate.
- **OpenRouter** can sort providers by latency, but each curated model here has a single provider, so it changes nothing.

## Measurements

Clicks used the October 16 click check, alternating tiers per case, 12 cases each:

| Click model | Standard median | Priority/Fast median | Accuracy |
|---|---:|---:|---|
| GPT-6 Luna | 2.71 s | **1.84 s** | 11/11 and 12/12 (one standard request hit a network error) |
| Gemini 3.8 Flash | 2.95 s | 3.50 s | 12/12 both |

Images used the bake-off's frozen ESPN request with its five photos at 256 px. Nano Banana 2.1 ran 4 calls per tier, alternating:

| Tier | Median | Range |
|---|---:|---:|
| Standard | 12.7 s | 11.7–15.6 s |
| Priority | 12.6 s | 12.1–12.8 s |

These cost about $0.60 in total.

## Decision

- GPT-6 Luna clicks now request Fast mode. That is about 0.9 s faster for about $0.0003 more per click, so it is on automatically rather than behind a checkbox.
- OpenAI reports the tier it served, and the usage breakdown bills fast responses at twice the rate. If OpenAI downgrades a request under load, it shows at the standard rate.
- GPT-6.1 Sol and Astra stay standard, since doubling their price is real money. The ChatGPT plan stays standard too, so it does not use up plan limits faster.
- Gemini Priority made neither clicks nor images faster here, so it is not used.
- Image generation is most of each page's wait (about 12–20 s), and no tier sped it up.
