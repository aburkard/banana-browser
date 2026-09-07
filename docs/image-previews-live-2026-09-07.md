# Live preview verification and configurable count

Two bounded public GPT Image 2 generation calls, same fictional botanical browser-page prompt, `stream: true`, `partial_images: 3`, `moderation: low`. Saved credentials stayed inside the browser origin. No retries.

| Quality / requested size | Partial arrivals | Final arrival | Reported input / image output tokens | Estimated cost |
| --- | --- | --- | --- | --- |
| Medium / 1536×1024 | 18.770s, 25.533s, 32.272s | 38.911s | 99 / 1640 | $0.049695 |
| Low / 1920×1280 | None | 23.539s | 99 / 197 | $0.006405 |

Total additional experimental spend: $0.056100 at the app's GPT Image 2 rates. Approximate running experimental ledger: $3.51 of $10, including the previous conservative allowance for unknown output usage.

The user's open production app used API credits, GPT Image 2, low quality, 1920×1280. The low-quality check reproduced no partials at those settings; the API emitted only its final event. This is consistent with OpenAI's documented early-final behavior, and does not prove low quality will always omit previews. The real medium run exercised the production SSE reader and emitted all three partials correctly. Its first image was readable but had an unfinished subtitle and illustration; later stages refined layout and details.

Advanced Settings now includes Previews 0 (off), 1, 2, 3 for public OpenAI image models only. Default 0 avoids automatically opting users into paid previews. Gemini and ChatGPT-plan paths hide this unsupported control. Changing the count does not generate an image or invalidate a completed image cache entry. Per-image estimates allow up to 100 extra image output tokens per requested preview; actual session spend uses returned aggregate usage without manually adding a surcharge. The API can return fewer previews than requested.

The two allowlisted result records and manual one-shot harnesses are in `experiments/image-previews/`. Full-resolution medium captures and `gallery.html` are available locally; PNGs are excluded from git. The gallery directly displays the actual returned images without image editing.

References: https://developers.openai.com/api/docs/guides/image-generation and https://developers.openai.com/api/reference/resources/images/generation-streaming-events

Validation: all 164 tests and production build pass. Independent review found no remaining issues. Browser check confirmed default 0, count-dependent price badge ($0.015 to $0.024 in the selected configuration), and hiding the selector after switching to Gemini. UI tests also cover hiding it for ChatGPT-plan access.


Follow-up tattoo-style prompt: GPT Image 2 medium 1536×1024, three requested previews. Arrivals 12.068s, 21.655s, 30.216s; final 38.167s. Reported 141 input text tokens and 1640 output image tokens: estimated $0.049905. One call, no retry. Approximate running experimental ledger now $3.56 of $10. Prompt, usage and timings: `experiments/image-previews/tattoo-result.json`; local full-size comparison: `tattoo-gallery.html`.

## Smooth in-app transitions

Previews now decode before fading in over 400ms. The previous decoded image stays beneath the incoming image; arrivals during a fade queue only the latest frame, keeping at most two layers. The final preview stays visible through final canvas loading, then the overlay fades away. New requests, errors, disposal and stale image callbacks clear or invalidate layers; a failed final decode releases the overlay and removes the old clickable canvas. Reduced-motion preferences disable fades. Ordinary history/scroll animations remain when no preview has been shown.

Validation: 165 tests and build pass. Replayed the captured tattoo images through the app's actual OpenAI streaming reader, without a paid request. Mid-transition incoming opacity was 0.409 with the previous layer fully visible; final handoff opacity was 0.591 with the final canvas already present and banana hidden. Cleanup left one canvas and no overlay. Reduced-motion computed transition durations were 0s. Independent review's final-decode failure finding was fixed and covered by regression; no remaining findings.
