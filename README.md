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
- **Gemini**: gemini-2.5-flash-image, gemini-3-pro-image-preview
- **OpenAI**: gpt-image-1.5, gpt-image-1-mini

## Style Presets

- Modern (clean, professional)
- Geocities (90s web aesthetic)
- Brutalist (raw HTML look)
- Vaporwave (retro 80s)
- Newspaper (NYT style)
- Hacker (terminal aesthetic)

Or enter any custom style description.
