# Bounded image latency audit — September 7, 2026

## Scope and status

The reusable manual harness is in `experiments/latency-audit`. Preparing and compiling it makes no provider calls. The live six-attempt run completed; results and an observer limitation are recorded below. The fixed maximum is six image attempts: three public OpenAI Images API and three direct ChatGPT plan Images calls, with no automatic retry or replacement sample. It stops on the first failure. Existing click-spend measurements need no further model calls for this image comparison.

Preparation validation: the harness bundle compiled, and `node experiments/latency-audit/check.mjs` passed offline checks for the six-call ceiling, stopping on the first failure, the persistent repeat lock, and credential-free results. Those checks stub transport and decode; they do not establish live endpoint behavior.

The identical compact synthetic factual-card prompt, GPT Image 2 model request, medium quality request, 1536×1024 size request, and absence of references isolate generation from news fetching, reference downloading, click interpretation, and the page prompt. The fixed order is API, plan, plan, API, API, plan; this reduces simple order confounding but is neither randomized nor enough to estimate tail latency.

Plan requests use the existing `subscriptionGenerate` implementation, including its direct Images endpoint, in-browser auth refresh, encrypted relay, and five-minute request deadline. Public API requests have a two-minute deadline. No production setting, timeout, quality workaround, service tier, or API fallback is changed. A deadline or closed tab does not prove that upstream generation stopped or that no usage was charged.

## Running and collecting

1. Run `node experiments/latency-audit/build.mjs` to create a temporary page under `public/tmp/latency-audit`. Use the existing local app server and exact browser origin where the API key and ChatGPT session already exist. Do not copy credentials to a different origin or export them.
2. Open `/banana-browser/tmp/latency-audit/index.html` on that origin. Review the fixed six-call scope and press **Run six image calls once** only within the authorized budget. Opening the page does not generate images.
3. A browser lock prevents concurrent tabs starting the run. A durable localStorage attempt marker is written before the first request. It survives refreshes and interruptions; there is deliberately no reset/resume button. Each attempt is recorded before it is sent. Do not clear the marker to obtain replacement samples.
4. After completion, copy only the visible sanitized JSON result into an experiment result file, and inspect the displayed images for correct title, all three facts, footer, and readable layout. Do not copy auth storage or image payloads. The image previews remain in page memory; the result record contains no credentials or images.
5. Remove the temporary generated page with `node experiments/latency-audit/build.mjs --clean` before a normal production build. Keep the static experiment source and findings in the repository.

## Measurement interpretation

`totalResponseMs` runs from the harness invocation to the production response reader completing, before image decode. Plan preparation includes TLS/auth; `responseReadMs` starts immediately before the actual provider fetch and excludes preparation. Both include upload, transit, server queuing/computation, response transfer, and parsing. They do not identify pure server computation. `decodeMs` measures the subsequent browser image decode independently.

`firstBodyMs` records when fetch resolves: for native API fetch this can be response headers; for libcurl plan fetch it is the first body-data callback. These are different milestones and must not be treated as matched time-to-first-byte measurements. The corrected plan observer reads a bounded response clone to recover returned quality/size omitted by the production result type. That local diagnostic parsing can slightly affect timing; the production request/body/auth are unchanged. The live version-1 run did not capture those plan fields, as explained below.

Every row retains numeric returned usage, reported quality/size/format, and dimensions verified by browser image decode. `matchesRequestedOutput` requires actual decoded dimensions of 1536×1024 **and reported quality medium**. Missing quality is unknown, never inferred from token count. Only a subset with matching actual quality and dimensions can support a matched-output latency comparison; all other rows remain request-matched observations. Equal pixel counts with different orientations do not qualify. Inspect semantic/text correctness separately: matching resolution and quality is not a quality score.

API cost is an estimate from returned usage and documented standard rates. With no reference images, text input is $5/million tokens ($1.25 cached) and image output is $30/million. The harness marks the total incomplete if unexpected image inputs, cache writes, text outputs, or missing counts prevent this calculation, and retains a known image-output cost component when available. This is not a billing-dashboard reading. Plan dollar cost and allowance consumption remain unknown; public API token rates are not assigned to included ChatGPT plan usage. Failed/interrupted requests can add unknown spend. [Official pricing](https://developers.openai.com/api/docs/pricing)

## Fast / Priority research

The current official guide says Priority Processing was renamed Fast mode on July 30, 2026. It documents `service_tier: fast` and `priority` for supported **Responses and Chat Completions** requests, at a per-token premium. Its headline speed claim is not an image-generation benchmark. Image *input* support on those text routes does not establish a faster direct Images route. [Official Fast mode guide](https://developers.openai.com/api/docs/guides/fast-mode)

The inspected public Images generation schema exposes no `service_tier`. The official GPT Image 2 price table lists standard image input/cached/output rates of $8/$2/$30 per million, and text input/cached rates of $5/$1.25. No GPT Image 2 Fast price or documented direct Images Fast control was found in these sources. Fast support or premium pricing for the private ChatGPT plan Images endpoint remains unverified. No paid probe or undocumented parameter is justified by this evidence. [Images request reference](https://developers.openai.com/api/reference/resources/images/methods/generate), [pricing](https://developers.openai.com/api/docs/pricing)

Keep the current direct route and avoid a Fast toggle without verified endpoint support and a measured benefit. A text-model Fast tier cannot be assumed to accelerate a separate image model; restoring the removed wrapper to test it would change the request path and confound the comparison.

## Earlier evidence and closure criteria

The September 6 matched-input investigation already measured API low at 28.824 s, API medium at 48.123 s, the plan wrapper at 79.547 s, and direct plan at 62.990 s; another app direct-plan run was 63.731 s. These are individual observations with differing requested/returned dimensions and sometimes quality. The wrapper-to-direct observation was 16.557 s faster (about 21%), without a proof of a general latency distribution. [Previous comparison](image-comparison-2026-09-06.md)

The subsequent quality investigation established server normalization to auto, simple prompts sometimes yielding low, and a real page remaining medium despite a low-quality prompt instruction. Therefore medium is not a fixed plan setting and no low toggle is justified. [Quality investigation](plan-quality-investigation-2026-09-06.md)

After the bounded run, report all attempts, per-route median/range among successful outputs, actual settings, correctness observations, known API cost plus unknown partials, and the number eligible for matched-output comparison. If plan outputs still differ, close the implementation investigation with that explicit limitation rather than claiming plan/API parity or spending more to seek a favorable sample. Size/quality control remains an upstream limitation; a full statistical or Fast benchmark remains unperformed.

## Live result and observer limitation

All six image attempts completed successfully. In execution order:

| Attempt | Route | Complete response, seconds | Decoded dimensions | Reported quality | Input / output tokens | Estimated API cost |
| --- | --- | ---: | --- | --- | --- | ---: |
| 1 | API | 35.3471 | 1536×1024 | medium | 91 / 1,372 | $0.041615 |
| 2 | Plan | 28.3401 | 1536×1024 | unknown | unavailable | unknown |
| 3 | Plan | 26.1510 | 1536×1024 | unknown | unavailable | unknown |
| 4 | API | 41.6684 | 1536×1024 | medium | 91 / 1,372 | $0.041615 |
| 5 | API | 34.4845 | 1536×1024 | medium | 91 / 1,372 | $0.041615 |
| 6 | Plan | 25.9748 | 1536×1024 | unknown | unavailable | unknown |

API median complete-response time was **35.3471 s**, range **34.4845–41.6684 s**. Plan median was **26.1510 s**, range **25.9748–28.3401 s**. These are `totalResponseMs` measurements including route preparation and complete response read, before image decode. All six screenshots showed the requested title, three facts, and footer correctly. Known API image cost totals **$0.124845**; plan allowance consumption is unknown.

This is **not a matched-quality benchmark**. While the decoded dimensions match on all six, plan quality and token usage were not captured. There are three API outputs verified at the requested dimensions/quality and **zero plan outputs eligible for a verified matched-output comparison**. The timing observations alone do not establish plan/API parity, a general advantage for the plan route, or the relative image quality setting.

Offline inspection found the version-1 harness wrapped libcurl's placeholder `fetch` before initialization. In the pinned libcurl.js 0.7.1 source, `setup_main_session()` assigns `api.fetch = main_session.fetch.bind(main_session)`; initial `set_websocket()` calls that setup after WASM becomes ready. That replacement discarded the observer. Production image requests and independent end-to-end/decode measurements continued to work, but plan `providerRequests`, quality, usage, and provider-request timing were absent; `responseReadMs` serialized as null. Those missing values must remain missing in the raw record. They cannot be reconstructed from requested quality, pixel dimensions, or the API outputs.

The reusable source is now version 2 and installs its observer immediately **after** production websocket initialization. The original attempt-lock key is preserved, so the fix cannot unlock the completed run. Offline checks now simulate initialization replacing `fetch` and assert capture of plan request count, quality, usage, and finite provider-request timing; they pass. The live page/bundle was not rebuilt, no original results were rewritten, and no replacement image calls were made to repair the diagnostic gap. Corrected observer behavior remains unverified against a new live response.
