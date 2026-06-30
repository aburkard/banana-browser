# Image Generation Pricing

## Models Used

### Gemini Models

#### gemini-2.5-flash-image (Gemini Flash)
Fast image generation model, good for most use cases.

| Resolution | Tokens/Image | Cost/Image |
|------------|--------------|------------|
| Standard | 1,290 tokens | ~$0.039 |

#### gemini-3.1-flash-lite-image (Nano Banana 2 Lite)
Fastest and cheapest Gemini image model for interactive generation. Supports 1K output only.

| Resolution | Tokens/Image | Cost/Image |
|------------|--------------|------------|
| 1K | 1,120 tokens | ~$0.034 |

Note: Lite is not optimized for multiple reference inputs or multi-turn sequential editing. Banana Browser limits Lite to one input image per generation.

#### gemini-3.1-flash-image (Nano Banana 2)
General-purpose Gemini image model with 0.5K, 1K, 2K, and 4K output options.

| Resolution | Tokens/Image | Cost/Image |
|------------|--------------|------------|
| 0.5K | 747 tokens | ~$0.045 |
| 1K | 1,120 tokens | ~$0.067 |
| 2K | 1,680 tokens | ~$0.101 |
| 4K | 2,520 tokens | ~$0.151 |

#### gemini-3-pro-image (Gemini Pro)
Higher quality, supports more input images, better for complex tasks.

| Resolution | Cost/Image |
|------------|------------|
| 1K-2K (1024-2048px) | ~$0.134 |
| 4K (4096px) | ~$0.24 |

Note: Pro is ~4x more expensive than Flash Lite for 1K images.

#### gemini-2.5-flash (Text/Vision)
Used for click interpretation. Much cheaper than image generation.
- Input: $0.075 per 1M tokens
- Output: $0.30 per 1M tokens

### OpenAI Models

#### gpt-image-1.5 (GPT Image 1.5)
OpenAI's image generation model with native image editing capabilities.

| Type | Cost |
|------|------|
| Text input | $5.00 per 1M tokens |
| Image input | $8.00 per 1M tokens |
| Image output | $32.00 per 1M tokens |

Output size: **1536x1024** (landscape) for better web page feel.

Supports both generation (`/images/generations`) and editing (`/images/edits`) endpoints.

#### gpt-5-mini (Vision/Click Interpretation)
Used for click interpretation when no Gemini API key is available.

| Type | Cost |
|------|------|
| Input (text + image) | $0.25 per 1M tokens |
| Output | $1.00 per 1M tokens |

For a 1024x1024 image: ~1,229 tokens = **~$0.0003 per click interpretation**

## Free Tier (Google AI Studio)

- **1,500 images/day** (45,000/month)
- Same models as paid tier
- Great for development and low-volume production

Note: OpenAI does not offer a free tier for image generation.

## Cost Per "Page View" in Banana Browser

Each navigation in Banana Browser:
1. Image generation: ~$0.034+ (Gemini) or ~$0.006+ (OpenAI)
2. Click interpretation: negligible (text model, Gemini only)

## Sources

- [Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Introducing Gemini 2.5 Flash Image - Google Developers Blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/)
- [Nano Banana image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [OpenAI API Pricing](https://openai.com/api/pricing/)
