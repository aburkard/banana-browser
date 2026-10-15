# Image model bake-off — October 15, 2026

Seven OpenAI/Gemini configurations rendered the same frozen ESPN NFL News request eight times each: 56 calls, 55 succeeded, about $3.52 in estimated provider charges. A one-round smoke run beforehand cost about $0.24. Nothing in the app changed; this records evidence for the next model change.

## Summary

- **Nano Banana 2.1 should replace Nano Banana 2 and is the better Gemini default.** At 1K with minimal thinking it took 12.6 s median and cost $0.044, against $0.069 for Nano Banana 2. Its worst page had 8 non-words.
  - The current default, Nano Banana 2 Lite, is 2.6× faster (4.9 s) but produced the most garbled page (45 non-words), plus two more with 14 and 17, with invented or duplicated stories. Nano Banana 2 produced one page of invented headlines (27).
  - Nano Banana 2.1's typical miss is layout, not spelling. The sixth story often falls below the fold, and four times a shown headline was shortened or lost a word ("Kellen respond", without "Moore").
- **GPT Image 2.5 Flare is a faster GPT Image 2 with slightly weaker small text.** It took 18.0 s median against 22.4 s (about 20% faster) at the same price. Headlines were 48/48 verbatim, and all six descriptions appeared every time. Manual review of the flagged words found roughly 2–2.5 real typos per page in the small description text ("Seahwaks", "nightucb", "lirebeacker"), against about 1 per page for GPT Image 2. Worth adding as a faster option; whether it should become the default depends on whether 4 s matters more than occasional body-text typos.
- **GPT Image 2 remains the accuracy reference** at $0.048: every headline and description shown, the fewest typos. Nano Banana Pro matches it on headlines (47/48) and shows 92% of descriptions, but costs 3× as much and is slower (25.6 s). Google lists Nano Banana 2.1 as Pro's replacement, but on this dense page 2.1 is not equivalent.
- **2K helps Nano Banana 2.1 only a little**: 41 vs 38 verbatim headlines, 1 vs 4 altered, for +5 s and +$0.017. 1K is the sensible default; 2K could be an option.
- One GPT Image 2 call failed after 1.6 s. OpenAI returned an HTML error page, and the app's `openAIImageRequest` reported it as `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, losing the HTTP status. Users saw the same message until #62 made the error read `OpenAI API error: 502 Bad Gateway`. The harness made no retry, by design.

## Results

| Model | Settings | OK | Median | Max | Mean cost | Headlines verbatim | Truncated | Altered | Not shown | Descriptions shown | Non-word rate | Worst page | Output |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| GPT Image 2 (current API default) | low, 1920x1280; 5 refs | 7/8 | 22.4 s | 24.5 s | $0.048 | 42/42 (100%) | 0 | 0 | 0 | 100% | 1.8% | 4 | 1920×1280 |
| GPT Image 2.5 Flare | low, 1920x1280; 5 refs | 8/8 | 18.0 s | 21.2 s | $0.048 | 48/48 (100%) | 0 | 0 | 0 | 100% | 3.6% | 8 | 1920×1280 |
| Nano Banana 2 Lite (current Gemini default) | 1K, minimal thinking; 1 ref | 8/8 | 4.9 s | 5.8 s | $0.034 | 38/48 (79%) | 4 | 0 | 6 | 25% | 9.3% | 45 | 1264×848 |
| Nano Banana 2 | 1K, minimal thinking; 5 refs | 8/8 | 10.4 s | 14.5 s | $0.069 | 38/48 (79%) | 1 | 2 | 7 | 21% | 6.3% | 27 | 1264×848 |
| Nano Banana 2.1 | 1K, minimal thinking; 5 refs | 8/8 | 12.6 s | 13.7 s | $0.044 | 38/48 (79%) | 1 | 4 | 5 | 54% | 3.7% | 8 | 1264×848 |
| Nano Banana 2.1 (2K) | 2K, minimal thinking; 5 refs | 8/8 | 17.7 s | 20.4 s | $0.061 | 41/48 (85%) | 1 | 1 | 5 | 44% | 3.1% | 10 | 2528×1696 |
| Nano Banana Pro | 2K, high thinking; 5 refs | 8/8 | 25.6 s | 30.1 s | $0.143 | 47/48 (98%) | 1 | 0 | 0 | 92% | 1.7% | 9 | 2528×1696 |

Each headline is in exactly one category:
- *Verbatim*: rendered with zero edits.
- *Truncated*: cut with an ellipsis, a layout choice.
- *Altered*: shown but with dropped, added or changed characters, usually a missing word.
- *Not shown*: absent, including text cut in half by the bottom edge of the frame.

The other columns:
- *Descriptions shown*: any rendering of the description, including truncated or altered.
- *Non-word rate*: share of OCR words of four or more letters found in neither the prompt nor the system word lists.
- *Worst page*: the most such words on one page.
- *Costs*: the app's own estimates from returned token usage, so they are deterministic for the token-priced models.

Flagged words are not all errors. Every model gets some from the ESPN logo ("espt"), the "SONY" headset and "ORLEANS" helmet in the reference photos, and nav labels such as "NCAAF". Compare models with this in mind, as above.

Per-page non-words, in run order:

| Model | Pages |
|---|---|
| GPT Image 2 | 1, 4, 4, 3, 3, 1, 4 |
| Flare | 7, 4, 6, 5, 5, 5, 8, 7 |
| Nano Banana 2 Lite | 45, 6, 7, 6, 2, 4, 14, 17 |
| Nano Banana 2 | 2, 27, 5, 10, 7, 3, 2, 4 |
| Nano Banana 2.1 | 8, 2, 3, 5, 7, 2, 7, 2 |
| Nano Banana 2.1 (2K) | 2, 10, 2, 4, 9, 0, 2, 2 |
| Nano Banana Pro | 4, 0, 9, 0, 5, 1, 3, 2 |

## Not yet run: OpenRouter candidates

The harness also defines Grok Imagine Image 2.0, MAI-Image-2.6 and 2.6-Flash, Seedream 5.0 Flash and Pro, FLUX 3 Image, Qwen-Image-3 and Muse Image through OpenRouter's Image API. Their reference limits and size controls come from OpenRouter's capability listing; see `models.mjs`. No `OPENROUTER_API_KEY` was available, so they were skipped. With a key:

`node --env-file=.env experiments/image-bakeoff/run.mjs --run --max-spend 6 --reps 8 --run-id openrouter-2026-10-15 --models x-ai/grok-imagine-image-2.0,microsoft/mai-image-2.6-flash,microsoft/mai-image-2.6,bytedance-seed/seedream-5-0-flash,bytedance-seed/seedream-5-0-pro,black-forest-labs/flux-3-image,qwen/qwen-image-3,meta/muse-image`

then `node experiments/image-bakeoff/score.mjs tmp/image-bakeoff/runs/openrouter-2026-10-15`. The worst-case ledger for that plan is $6.48. OpenRouter successes are charged at their reported cost, so a $6 cap stops early only if real costs approach the guards; listed prices suggest well under half that. OpenRouter lists no endpoint for Muse Image's Image API at present, so expect it to fail. Failed generations are not billed.

## Method

Harness: [experiments/image-bakeoff](../experiments/image-bakeoff/README.md).

**Fixture.** The September 6 ESPN capture (hash `988400…`) was never saved, and #42 has since changed the homepage prompt, so a new request was frozen from `main` at `3bf99c7`. `capture.mjs` ran the app's own `navigate()` on the **ESPN NFL News** bookmark with the provider stubbed. Result: the production modern-style prompt (4,719 characters) with six stories, and the five reference photos the app attaches (request SHA-256 `597e6e52b772…`). Every call reused these exact bytes. Each model got the first *N* references its endpoint accepts: Nano Banana 2 Lite gets 1, as in the app; the others get 5.

**Requests.**
- Existing models used the production request methods (`generateWithOpenAI` / `generateWithGemini`) with app defaults. Nano Banana Pro ran at its app default: 2K, high thinking.
- GPT Image 2.5 Flare and Nano Banana 2.1 used the same methods with an injected model spec: Flare like GPT Image 2 (low, 1920×1280, edits endpoint with references), Nano Banana 2.1 like Nano Banana 2 (1K or 2K, 3:2, minimal thinking).
- Calls ran one at a time from this Mac, rotating order each round, with no retries.
- Latency is wall-clock from request to decoded response. It includes upload of the references (about 330 KB) and the streamed OpenAI body.

**Scoring.** Local macOS Vision OCR with language correction off, compared to the six headlines and six descriptions in the prompt. Text is normalized: case, punctuation and spacing are ignored. Wrapped lines are regrouped by column. Lines touching the top or bottom frame edge are ignored as half-rendered. The scoring was refined after the first look at results. Text cut off at the frame edge was initially counted as misspelling: Nano Banana 2.1 once drew "Feb. shooting of 49ers' Keion White" correctly but half below the fold, and OCR read it as "Eeh chontina of 40erc' Keinn White". Ellipsis cuts were also separated from alterations. All runs were rescored from cached OCR.

OCR ceiling: the same strings rendered as clean 13, 16 and 20 px text scored 6/6 headlines and 6/6 descriptions verbatim, with 0 non-words.

**Cost.** OpenAI/Gemini costs are the app's estimate from returned token usage and published rates. Nano Banana 2.1 used $1.50/M input, $7.50/M text/thinking and $30/M image output, which is $0.0336 per 1K image and $0.0504 per 2K image. Flare used GPT Image 2's rates, which OpenAI lists for it. The harness ledger deliberately over-counts, at $5.20 for the main run. The $3.52 above is the sum of the per-call estimates.

## Limitations

- One page (a news homepage) in one style. Article pages with long body text, and dense lists such as Hacker News, may rank differently.
- The prompt asks for a natural homepage density, so *not shown* and *descriptions shown* mix completeness with legitimate layout choices.
- The non-word rate misses real-word substitutions (Nano Banana 2.1 once labelled a nav item "Patchers"), and it includes logo and photo text. The typo-per-page figures above come from manually reviewing the flagged words.
- Eight samples per model from one network location at one time of day. Latency medians are indicative, not a service-level measure.
