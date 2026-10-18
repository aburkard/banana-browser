# Whole-page scrolling test (October 17, 2026)

Checks whether an image model keeps its place when it gets a large window of the page plus the previous screenshot, instead of app-chosen passages. Results and the decision are in [docs/whole-page-scrolling-2026-10-17.md](../../docs/whole-page-scrolling-2026-10-17.md).

- `sources.mjs` reads the test pages through the production keyless reader (relay, `htmlToScrape`, `normalizeWebpage`) into `tmp/whole-page-scroll/sources`. No model calls.
- `run.mjs` makes paid Nano Banana 2.1 calls (1K, minimal thinking) with production-style prompts and a 30,000-character page window: a first view plus three scrolls per page and variant, under a spend cap checked before every call. Variants: `pure` (the model decides where to continue), `anchor` (the image model's own report of its last line, which Nano Banana 2.1 never returned) and `read` (the last line read off the previous screenshot by Gemini 3.5 Flash-Lite).
- `score.mjs` OCRs each screenshot with `experiments/image-bakeoff/ocr.swift` (macOS Vision) and matches page paragraphs in order, reporting new, repeated and skipped paragraphs per scroll.
- `production-check.mjs` runs one real `navigate` and `scrollDown` through `BananaBrowser` with the page window. It skips reference photos and console thumbnails, which need a browser `Image`, and reuses a saved first view on reruns so only the scroll is paid.

```sh
node experiments/whole-page-scroll/sources.mjs
node --env-file=<file> experiments/whole-page-scroll/run.mjs --run --max-spend 1.5
node experiments/whole-page-scroll/score.mjs
```

`results-2026-10-17.json` keeps per-call latency, cost, tokens and the OCR progression scores; images stay in the ignored `tmp/` directory.

## Image-view windows and reference photo size (October 17, later)

- `lean-ab.mjs` compares the previous image prompt (raw window with every URL) against the image view (no link targets, window sized by that view) on Nano Banana 2.1 and GPT Image 2.5 Flare, through `BananaBrowser`'s own prompt and provider code. `lean-score.mjs` OCRs the results: the share of words not found in the page source, and the Wikipedia lead sentences.
- `ref-size.mjs` and `photo-tokens.mjs` send the bake-off's frozen ESPN request with reference photos in different forms (256 or 512 px, a single collage, Gemini's low media resolution) and record image-input tokens and cost. Resized photos come from `sips -Z`, the collage from ImageMagick.

`lean-results-2026-10-17.json` keeps the scores and token counts; see [docs/lean-image-inputs-2026-10-17.md](../../docs/lean-image-inputs-2026-10-17.md).
