# Image model bake-off

Compares image models on one frozen production page request: text accuracy (local OCR against the source headlines and descriptions), latency and cost. Results: [docs/image-bakeoff-2026-10-15.md](../../docs/image-bakeoff-2026-10-15.md).

## 1. Capture the fixture (free)

`node experiments/image-bakeoff/capture.mjs`

Runs the app's own `navigate()` on the **ESPN NFL News** bookmark with the image provider stubbed, using GPT Image 2's reference budget. It fetches only the public ESPN feed and photo CDN hosts (any other host fails the capture) and makes no model calls. Writes Git-ignored `tmp/image-bakeoff/fixture/`: the exact prompt, the five reference photos, the source section, the raw feed and a request SHA-256. Re-capturing replaces the fixture and invalidates comparisons with earlier runs; `score.mjs` refuses a run whose fixture hash differs.

Each model receives the first *N* references its endpoint allows (Nano Banana 2 Lite: 1, as in the app), with the prompt rebuilt by `composePrompt`. Loading the fixture checks that this reproduces the captured prompt byte for byte.

## 2. Generate (paid)

Dry run (no requests; shows keys present, plan and worst-case ledger):

`node --env-file=.env experiments/image-bakeoff/run.mjs --reps 5`

Paid run:

`node --env-file=.env experiments/image-bakeoff/run.mjs --run --max-spend 5 --reps 5 [--models id,id] [--run-id name]`

Keys come from `OPENAI_API_KEY`, `GEMINI_API_KEY` and `OPENROUTER_API_KEY` (the older `VITE_` names also work). Models without a key are skipped.

- Existing app models and injected new specs (GPT Image 2.5 Flare, Nano Banana 2.1) call `BananaBrowser.generateWithOpenAI` / `generateWithGemini`: the production request with app defaults.
- Other providers go through OpenRouter's [Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) with references, `resolution` and `aspect_ratio` where the endpoint supports them. See `models.mjs`.
- Calls are sequential and rotate order each round. No retries.
- Before each call the ledger must have room for that model's `guardUSD`. Failures and app-route estimates reserve at least the guard amount, so the ledger over-counts real spend. OpenRouter results use its reported `usage.cost`.
- Errors are stored with key material redacted. Images and `results.json` go to `tmp/image-bakeoff/runs/<run-id>/`.

## 3. Score (free)

`node experiments/image-bakeoff/score.mjs [tmp/image-bakeoff/runs/<run-id>]`

Compiles `ocr.swift` once (macOS Vision, language correction off so misspellings are not repaired) and caches OCR per image. Writes `scored.json`, `report.md` and `gallery.html` next to the images.

Each headline and description is in exactly one category. Text is normalized first: case, punctuation and spacing are ignored. OCR lines are regrouped into column blocks so wrapped text matches, and lines touching the top or bottom frame edge are ignored as half-rendered.
- **Verbatim**: zero edits.
- **Truncated**: at least 40% of the words, then an ellipsis.
- **Altered**: best match ≥ 0.75 similarity but not verbatim, usually a dropped or misspelled word.
- **Not shown**: anything else.

The prompt asks for a natural homepage density, so *not shown* mixes completeness with legitimate layout choices.

Two more measures:
- **Non-word rate / worst page**: OCR words of four or more letters found in neither the prompt nor the system word lists, with simple inflection handling. This catches garbled or invented text anywhere on the page, including chrome. Logo, photo and nav-acronym text also lands here, so compare models rather than reading it as an absolute.
- **OCR ceiling**: the expected strings rendered as clean 13, 16 and 20 px text and scored the same way.

Offline tests (all requests mocked): `node --test experiments/image-bakeoff/bakeoff.test.mjs`
