# Gemini Image Generation Pricing

## Models Used

### gemini-2.5-flash-image (Nano Banana)
Fast image generation model, good for most use cases.

| Resolution | Tokens/Image | Cost/Image |
|------------|--------------|------------|
| Standard | 1,290 tokens | ~$0.039 |
| 1K-2K (1024-2048px) | 1,120 tokens | ~$0.134 |
| 4K (4096px) | 2,000 tokens | ~$0.24 |

### gemini-3-pro-image-preview (Nano Banana Pro)
Higher quality, supports more input images, better for complex tasks.

| Resolution | Cost/Image |
|------------|------------|
| 1K-2K (1024-2048px) | ~$0.134 |
| 4K (4096px) | ~$0.24 |

Note: Pro is ~3.4x more expensive than Flash for standard images.

### gemini-2.5-flash (Text/Vision)
Used for click interpretation. Much cheaper than image generation.
- Input: $0.075 per 1M tokens
- Output: $0.30 per 1M tokens

## Free Tier (Google AI Studio)

- **1,500 images/day** (45,000/month)
- Same models as paid tier
- Great for development and low-volume production

## Cost Per "Page View" in Banana Browser

Each navigation in Banana Browser:
1. Image generation: ~$0.039 (or free tier)
2. Click interpretation: negligible (text model)

## Sources

- [Gemini Developer API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Introducing Gemini 2.5 Flash Image - Google Developers Blog](https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/)
