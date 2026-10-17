# Banana Browser

A fully generative AI-powered web browser. Instead of rendering HTML, it generates images of webpages from API data.

**[Open Banana Browser](https://andrewburkard.com/banana-browser/)**

Connect your ChatGPT plan, or use a Gemini, OpenAI or OpenRouter API key. ChatGPT sign-in is experimental. [How the connection works, what gets saved, and the source](docs/chatgpt-connection.md).

Ordinary webpages open without extra keys through Banana Browser's built-in reader. An optional Firecrawl key, entered with the other keys, adds web search, Explore, and JavaScript-heavy or protected sites. [How webpage reading works](docs/keyless-webpages-2026-10-16.md).

## How it works

1. Navigate to an API endpoint (ESPN, Hacker News, Reddit, etc.)
2. AI generates an image of what a webpage displaying that data would look like
3. Click on elements in the image to navigate (AI interprets clicks)
4. Scroll down to generate more content

## Setup

```bash
npm install
```

Choose a connection in the app. No `.env` file is needed.

## Run

```bash
npm run dev
```

For ChatGPT relay testing, use `npm run dev -- --host 127.0.0.1 --port 5178` so the origin matches the relay allowlist.

First-party source is [MIT licensed](LICENSE). Browser TLS uses [libcurl.js](https://github.com/ading2210/libcurl.js), licensed LGPL-3.0-or-later; its license is included with the built assets.

## Models

Supports current image generation models:
- **Gemini**: gemini-nano-banana-2.1, gemini-3.1-flash-lite-image (fastest), gemini-3-pro-image
- **OpenAI**: gpt-image-2.5-flare, gpt-image-2.5-sunburst, gpt-image-2

Click interpretation uses a separate text/vision model:

- **Gemini**: gemini-3.8-flash, gemini-3.5-flash-lite, gemini-4-argon
- **OpenAI**: gpt-6-luna, gpt-6.1-sol, gpt-6-astra (API keys); gpt-5.6-luna and gpt-5.6-terra (ChatGPT plan, whose endpoint accepts only these)

An **OpenRouter** key adds a curated set rather than OpenRouter's whole catalog. OpenRouter copies of Gemini or OpenAI models are hidden when you also have that provider's own key.
- Images: GPT Image 2.5 Flare, Nano Banana 2.1, Seedream 5.0 Flash, MAI-Image-2.6-Flash, Qwen-Image-3, Grok Imagine Image 2.0 and FLUX 3 Image
- Clicks: GPT-6 Luna, Claude Haiku 5.5, Gemini 3.8 Flash, Claude Sonnet 5.5, Gemini 4 Argon and Grok 4.7

Defaults follow the keys you add:

| Connection | Image | Clicks |
|---|---|---|
| OpenAI key | GPT Image 2.5 Flare | GPT-6 Luna, or Gemini 3.8 Flash if a Gemini or OpenRouter key is also set |
| OpenRouter key without an OpenAI key | GPT Image 2.5 Flare via OpenRouter | Gemini 3.8 Flash (direct if you have a Gemini key) |
| Gemini key only | Nano Banana 2.1 | Gemini 3.8 Flash |
| ChatGPT plan | GPT Image 2 | GPT-5.6 Luna |

Choose models and thinking/reasoning levels in Settings.

See [model pricing](docs/pricing.md) for costs, the Gemini 4 Argon and 3.8 Flash price changes, and estimate limitations. Gemini API image generation requires the paid tier.

## Style Presets

- Modern (clean, professional)
- Geocities (90s web aesthetic)
- Brutalist (raw HTML look)
- Vaporwave (retro 80s)
- Newspaper (NYT style)
- Hacker (terminal aesthetic)

Or enter any custom style description.
