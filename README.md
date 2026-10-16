# Banana Browser

A fully generative AI-powered web browser. Instead of rendering HTML, it generates images of webpages from API data.

**[Open Banana Browser](https://andrewburkard.com/banana-browser/)**

Connect your ChatGPT plan, or use a Gemini/OpenAI API key. ChatGPT sign-in is experimental. [How the connection works, what gets saved, and the source](docs/chatgpt-connection.md).

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

Supports multiple image generation models:
- **Gemini**: gemini-3.1-flash-lite-image, gemini-nano-banana-2.1, gemini-3.1-flash-image, gemini-3-pro-image
- **OpenAI**: gpt-image-2.5-flare, gpt-image-2.5-sunburst, gpt-image-2, gpt-image-1.5 and gpt-image-1-mini (both shut down Dec 1, 2026)

Click interpretation uses a separate text/vision model:

- **Gemini**: gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemini-3.8-flash, gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-4-argon
- **OpenAI**: gpt-6-luna, gpt-6.1-sol, gpt-6-astra, gpt-5.6-luna, gpt-5.6-terra, gpt-5.4-mini, gpt-5.4

Image generation defaults to GPT Image 2.5 Flare when an OpenAI key is available (GPT Image 2 on a ChatGPT plan), otherwise Nano Banana 2.1. Click interpretation defaults to Gemini 3 Flash when a Gemini key is available, otherwise GPT-5.4 Mini. Choose the click model and thinking/reasoning levels in the advanced controls.

See [model pricing](docs/pricing.md) for costs, the Gemini 4 Argon and 3.8 Flash price changes, and estimate limitations. Gemini API image generation requires the paid tier.

## Style Presets

- Modern (clean, professional)
- Geocities (90s web aesthetic)
- Brutalist (raw HTML look)
- Vaporwave (retro 80s)
- Newspaper (NYT style)
- Hacker (terminal aesthetic)

Or enter any custom style description.
