# Cache and conversation comparison, September 6

The investigation found no caching toggle that should be enabled across all routes. A later live comparison below supports a narrow Luna API click change; other routes and turn boundaries remain unchanged. The [offline measurement](../experiments/cache-comparison/README.md) now makes prefix changes inspectable without spending credits.

## Measured current requests

The script runs the actual `BananaBrowser` image and click prompt builders with the checked-in TVmaze search fixture and a fake Gemini SDK. There are no provider requests. The fixture's SHA-256 is `e595648ab0139f205fd582aaf876e2ca4c5e3b5031ef3ac86b4ca577d22f94db`.

| Scenario | Text characters | Current leading identical parts | Common text if text moved first |
| --- | ---: | ---: | ---: |
| Two different clicks on the same page | 5,153 each | 0 | 90 characters |
| Same scroll prompt, different previous images | 4,463 each | 0 | 4,463 characters |

These are the measurements before the content-window integration. Rerun the script for current numbers. The source processor produced 3,094 compact JSON characters. Synthetic images deliberately differ; their sizes say nothing about real image token counts.

The click screenshot changes at the beginning of each request. Moving its text first would still leave coordinates near the beginning, so only 90 characters match. An effective prefix experiment must also move stable rules and page data ahead of coordinates. That changes prompt layout and requires a click-accuracy comparison.

Gemini image requests currently put reference images first, then the previous page, then text. Repeated reference images can already provide an identical leading part; the measured case isolates a changing previous image without references. Moving the entire text first offers a longer reusable prefix for that case, but the result depends on the selected model's cache support and minimum. A character count cannot establish eligibility.

## What official documentation establishes

OpenAI's GPT-5.6+ Responses caching requires at least 1,024 visible input tokens; older models normally require 2,048. GPT-5.6+ cache writes cost 1.25 times ordinary input and reads cost 0.1 times. Explicit breakpoints can keep changing content out of the reusable prefix. One-off writes can cost more; record actual cache reads and writes. This concerns Responses requests, not an assumed universal Images or subscription parameter. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

A Responses `previous_response_id` chain still bills previous input tokens. Conversation continuation is therefore a fidelity experiment, not an automatic input-cost reduction. [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state)

Google recommends common content first for implicit caching. Its current generateContent guide lists 4,096 tokens for Gemini 3.8 Flash; it does not list the app's image models in that minimum table. Explicit caching also charges for storage duration. Creating caches for every page without demonstrated reuse would add cost and lifecycle work. [Google generateContent caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)

Gemini image conversation history should preserve returned thought signatures exactly, or use SDK chat history that handles them. Keeping only generated image bytes does not preserve that state. Also, suppressing returned thoughts does not eliminate thinking charges. [Google image generation](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)

## Decisions and next paid comparison

Already-shipped history/render/reference caches avoid requests or reference work directly. Keep those. Keep reporting cached, written, and reasoning tokens where returned. Do not pad prompts, add blanket cache parameters, grow conversation history, or change model defaults on the strength of this structural measurement.

The next useful experiment is click interpretation, not another expensive image-quality experiment:

1. Prepare three fixed page screenshots with different marked targets and known exact API URLs. Keep screenshot bytes, model, reasoning setting and task wording fixed across variants.
2. Compare current order with stable rules + page data first, then marked screenshot + coordinates. For a model that supports it, place the cache breakpoint after the stable text. Do not modify the pointer image or combine image generation with interpretation.
3. Run each variant once per target, alternating order. No automatic retries. Count the first cache write in the total. Use a separate cache key per variant where supported; observe returned diagnostics rather than assume cold or warm state.
4. Record correctness, elapsed time, input/output/reasoning counts, cache reads/writes, and complete cost across all calls. Unknown fields remain unknown. Abort on the experiment's preflight spend cap; the overall app-testing budget remains $10.
5. Promote only if all targets still navigate correctly and measured total cost or latency improves. Three targets are an initial screen, not a reliable general benchmark. A regression requires revising the candidate rather than compensating with more model calls.

Image conversations are a separate test: preserve full Gemini response parts/signatures in a bounded experimental history and compare against the current previous-image-only route. Judge content fidelity, scrolling continuity and total multi-turn usage together. No live call or savings claim is included in this report.

## Live Luna API result

The [browser comparison](../experiments/cache-comparison/index.html) subsequently ran six public OpenAI API click calls with the checked-in TVmaze fixture, a deterministic 1024×768 canvas screenshot, and the production red pointer. Model: GPT-5.6 Luna, low reasoning, 512 maximum output tokens. The control puts the image first; the candidate puts unchanged stable task/source text first with an explicit cache boundary, followed by the image and unchanged coordinate instruction. Calls alternated as A1, B1, B2, A2, A3, B3. Neither variant generated images or used subscription authentication.

| Result | Image-first control | Stable-prefix candidate |
| --- | ---: | ---: |
| Correct targets | 3 / 3 | 3 / 3 |
| Cached input per call | 0, 0, 0 | 0, 1,443, 1,443 |
| Cache writes per call | 2,395, 2,395, 2,395 | 1,443, 0, 0 |
| Total cost, including writes | $0.00194325 | $0.00107187 |
| Median elapsed time | 1,952 ms | 1,924 ms |

The candidate cost 44.8% less in this small trial. Most savings came from input caching rather than reduced output: input cost alone fell from $0.00179805 to $0.00099147. The control's first call generated 52 reasoning tokens, which also increased its total. Latency was mixed: one candidate call was slower than its control; the medians were close. Do not advertise a general speed improvement.

A separate short-prefix compatibility call returned HTTP 200/completed with 10 input tokens, 5 output tokens, and zero cache reads/writes. An undersized explicit prefix therefore worked uncached for this tested model. Total measured usage cost across all seven calls was $0.00302312. No automatic retries were performed. [Sanitized measured results](../experiments/cache-comparison/results-2026-09-06.json)

The narrow production change is limited to **OpenAI API Luna click interpretation**: stable source/rules first, explicit cache boundary, changing pointer and coordinates last. Its cache-read and cache-write rates are now included in accounting. Gemini, other OpenAI models, image generation, and subscription transport retain their prior behavior. Source data stays in a user message; the change does not elevate API content to trusted instructions. Rapid duplicate clicks are also ignored while a request is pending.

Three obvious card targets establish acceptance and an initial accuracy screen. Dense pages, unusual styles, and model-version changes still warrant broader evaluation. Conversation-history integration remains untested and unchanged.
