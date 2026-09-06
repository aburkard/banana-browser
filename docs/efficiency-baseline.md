# Efficiency and latency baseline

Initial research checked September 6, 2026. This baseline preceded the [live latency comparison](image-comparison-2026-09-06.md) and [broader efficiency audit](efficiency-audit-2026-09-06.md). Caching and conversation experiments below remain candidates, not production prompt changes.

## What the app does today

| Route | Image generation | Click interpretation | Conversation state |
| --- | --- | --- | --- |
| Gemini API | `generateContent`, reference images + previous page + prompt | Separate `generateContent`, screenshot with pointer + prompt | Previous image bytes; no retained model response/thought signature |
| OpenAI API | Images generations, or edits when an input image exists | Separate Responses request, pointer screenshot + prompt | Previous image bytes; no response ID chain |
| ChatGPT plan | Direct Codex Images generations/edits; no text-model wrapper | Separate Codex Responses request with Luna/Terra | Previous image bytes; click requests use `store:false`, no response ID chain |

Source: `src/browser.ts` and `src/subscription.ts`. API and subscription image paths can return different effective quality and dimensions, so a timing difference cannot be attributed to subscription priority alone. Existing in-memory page and scroll caches can avoid model requests entirely; exclude those hits from generation timing.

## Caching and continuation

OpenAI's current guide distinguishes GPT-5.6+ caching from older models: cache writes have a premium, reads are discounted, and reusable prefixes need eligible boundaries. Merely putting static text first is not enough to guarantee a hit. Measure reported cache reads/writes before changing costs or promising savings. These API rules do not establish billing behavior for the private Codex endpoint. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

OpenAI supports conversational image editing through Responses, including prior response IDs or image-generation outputs in context. Moving the API image route from Images to Responses would be an architectural experiment, not a free caching switch. Keep the existing route as the baseline and measure both main-model and image-tool usage. [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation)

Gemini `generateContent` has automatic implicit caching on newer models, with model-specific minimum input sizes. Explicit caches also incur storage-duration costs. The current guide lists a 4,096-token minimum for Gemini 3.8 Flash; it does not establish each image model's eligibility. Check the exact image model before creating a cache. [Google generateContent caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)

Google's newer Interactions guide uses different state and usage fields from this app's `generateContent` calls. Do not copy its `usage.total_cached_tokens` field directly into the existing adapter. [Google Interactions caching](https://ai.google.dev/gemini-api/docs/caching/)

Gemini conversational image editing relies on thought signatures for visual context. The app currently retains image bytes only, so a conversation experiment must retain the appropriate returned parts/signatures rather than just append text history. [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3)

## Fast modes

OpenAI documents `service_tier: "fast"` (also `"priority"`) for supported Responses/Chat Completions models. It charges a premium and reports the actual served tier, which may differ from the requested tier. Image **input** support does not demonstrate that the Images endpoint or the image-generation tool receives the same speedup. Do not add one universal Fast toggle. [OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)

Unresolved before exposing a setting: exact Luna/Terra eligibility and prices; image-tool acceleration; Codex endpoint acceptance and subscription allowance multiplier; Google priority support for each selected model and the existing SDK route. No paid option was enabled.

## First controlled experiments

1. Record unchanged baseline requests with secrets excluded: route, model/options, input fixture hash, start/end time, success, usage and cache fields actually returned. Separate data fetch, transport/auth setup, and model completion where observable. Unknown queue time stays unknown.
2. Compare API versus plan with identical inputs/settings where possible. Label Images versus Responses-tool differences. Start with one image and one click scenario; define a separate spend cap before enabling any loop. Never automatically retry billable failures.
3. Test static-prefix ordering/cache boundaries separately from conversation reuse. Preserve pointer pixels, click instructions, reference images, and turn boundaries. Require correct navigation and comparable page quality as well as improved cost/latency.
4. Test a provider's fast setting only after verifying that route accepts it and pricing is known. Record the returned tier. Report samples and variability rather than claiming all subscription requests are slower.

Tracking: [#2](https://github.com/aburkard/banana-browser/issues/2), [#3](https://github.com/aburkard/banana-browser/issues/3), [#4](https://github.com/aburkard/banana-browser/issues/4).
