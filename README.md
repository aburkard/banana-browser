# Banana Browser

A fully generative AI-powered web browser. Instead of rendering HTML, it generates images of webpages from API data.

**[Live Demo](http://andrewburkard.com/banana-browser/)**

## How it works

1. Navigate to an API endpoint (ESPN, Hacker News, Reddit, etc.)
2. AI generates an image of what a webpage displaying that data would look like
3. Click on elements in the image to navigate (AI interprets clicks)
4. Scroll down to generate more content

## Setup

```bash
npm install
```

Create a `.env` file:
```
GEMINI_API_KEY=your_key_here
# and/or
OPENAI_API_KEY=your_key_here
```

## Run

```bash
npm run dev
```

## Models

Supports multiple image generation models:
- **Gemini**: gemini-3.1-flash-lite-image, gemini-3.1-flash-image, gemini-3-pro-image
- **OpenAI**: gpt-image-2, gpt-image-1.5, gpt-image-1-mini

Click interpretation uses a separate text/vision model:

- **Gemini**: gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3-flash-preview, gemini-3.1-pro-preview
- **OpenAI**: gpt-5.6-luna, gpt-5.6-terra, gpt-5.4-nano, gpt-5.4-mini, gpt-5.4

Image generation defaults to GPT Image 2 when an OpenAI key is available, otherwise Nano Banana 2 Lite. Click interpretation defaults to Gemini 3 Flash when a Gemini key is available, otherwise GPT-5.4 Mini. Choose the click model and thinking/reasoning levels in the advanced controls.

See [model pricing](docs/pricing.md) for costs, the Gemini 3.8 promotion cutoff, and estimate limitations. Gemini API image generation requires the paid tier.

## Style Presets

- Modern (clean, professional)
- Geocities (90s web aesthetic)
- Brutalist (raw HTML look)
- Vaporwave (retro 80s)
- Newspaper (NYT style)
- Hacker (terminal aesthetic)

Or enter any custom style description.
