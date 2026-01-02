# Image Generation Pricing

## Models Used

### Gemini Models

#### gemini-2.5-flash-image (Gemini Flash)
Fast image generation model, good for most use cases.

| Resolution | Tokens/Image | Cost/Image |
|------------|--------------|------------|
| Standard | 1,290 tokens | ~$0.039 |
| 1K-2K (1024-2048px) | 1,120 tokens | ~$0.134 |
| 4K (4096px) | 2,000 tokens | ~$0.24 |

#### gemini-3-pro-image-preview (Gemini Pro)
Higher quality, supports more input images, better for complex tasks.

| Resolution | Cost/Image |
|------------|------------|
| 1K-2K (1024-2048px) | ~$0.134 |
| 4K (4096px) | ~$0.24 |

Note: Pro is ~3.4x more expensive than Flash for standard images.

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
1. Image generation: ~$0.039 (Gemini) or ~$0.10+ (OpenAI)
2. Click interpretation: negligible (text model, Gemini only)

## Sources

- [Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Introducing Gemini 2.5 Flash Image - Google Developers Blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/)
- [OpenAI API Pricing](https://openai.com/api/pricing/)
