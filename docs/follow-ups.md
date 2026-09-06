# Follow-ups

Finish the sign-in clarity pass, then review the subscription integration in a PR before merging. Keep the items below separate from that PR. The GitHub issues below track each independent follow-up.

## Choose ChatGPT plan or API billing

[GitHub #1](https://github.com/aburkard/banana-browser/issues/1)

Next small change. A connected ChatGPT account should not prevent choosing Gemini or OpenAI with a saved API key.

- Make the active connection and billing source explicit.
- Remember the user's choice across visits; do not always prefer ChatGPT at startup.
- Confirm a switch to paid API usage with short, clear copy.
- Keep existing logins and keys when switching. No silent fallback between plan limits and API credits.

## Make subscription usage easier to see

[GitHub #2](https://github.com/aburkard/banana-browser/issues/2)

The app already records session input/output tokens, calls per model, and image/click counts. It does not display remaining ChatGPT allowance.

- Improve visibility of the existing session breakdown.
- Investigate provider-reported cached tokens and remaining/reset limits; distinguish available measurements from estimates.
- Keep subscription usage separate from API dollar estimates. Decide whether history across visits is useful.

## Investigate model efficiency without changing what works

[GitHub #3](https://github.com/aburkard/banana-browser/issues/3)

Research first, then propose one measurable experiment at a time. Compare Google and OpenAI separately, including subscription and API paths.

- Check prompt caching, reusable context, conversation continuation, and image generation/edit behavior against current provider documentation.
- Preserve screenshot click markers, the existing turn boundaries, and reference-image handling as the baseline. Coordinates alone previously performed worse.
- Save representative image/click scenarios before changing prompts or call structure.
- Compare navigation correctness, visual consistency, latency, token counts, cache hits, and cost. Keep changes only when the comparison supports them.

## Benchmark latency and evaluate fast modes

[GitHub #4](https://github.com/aburkard/banana-browser/issues/4)

Compare image generation and click interpretation across models, settings, and authentication methods. Subscription generation felt slower during testing, but there is no controlled API comparison yet.

- Use the same prompts, source data, reference images, and output settings wherever supported. Record differences between direct image API calls and subscription calls that use a text model's image tool.
- Measure first visible progress and total completion time. Separate source-data fetching, browser TLS/relay setup, login refresh, and model requests where observable; do not label unexplained delays as provider queue time.
- Repeat runs and report median/tail latency, failures, output quality, and actual usage/cost. Separate fresh connections from warm connections and cache hits from misses. Never log credentials.
- Check current provider documentation for fast/priority modes supported by each model and API/subscription route. Verify that requests accept the option and whether responses report the tier actually used.
- If a mode is useful, expose an opt-in control only where supported. Show the applicable API price change or subscription-allowance impact before enabling it; do not assume they have the same billing rules. Keep the default unchanged.

Deliver a small comparison table and a recommendation backed by the measurements before changing generation behavior.

## Make long-running generation look active

[GitHub #5](https://github.com/aburkard/banana-browser/issues/5)

A Brave request appeared stuck but eventually completed. Add elapsed time and genuine progress signals where available, plus a clear timeout/error state. Do not invent progress percentages or promise a completion time without evidence.

## Review existing API transformations

[GitHub #6](https://github.com/aburkard/banana-browser/issues/6)

Audit the three example APIs and their custom processors before rewriting anything. Preserve useful fields and intentional truncation rules.

- Capture representative raw responses and current transformed output.
- Identify redundant text, missing useful context, and payload size.
- Compare smaller payloads against page quality and click accuracy; do not drop fields just to reduce tokens.

## Add more example APIs

[GitHub #7](https://github.com/aburkard/banana-browser/issues/7)

Choose a few visually interesting public APIs with reliable browser access. Check CORS, authentication, rate limits, and useful navigation paths before adding bookmarks. Keep new processors independent of changes to the existing examples.
