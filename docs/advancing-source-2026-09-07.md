# Explicit passage progression experiment

The user's hypothesis was that repeating a full article/source section on every scroll leaves the model to infer which prose comes next. Production does resend the current section within visual scrolling. The experiment instead advances an explicit source cursor and supplies the next passage plus a short preceding context field.

## Result

The three real images progressed through the assigned passages and the last displayed “End of section.” Further generation was disabled by source exhaustion in the harness. This is a better progression result than the previous full-section readable-source experiment, which restarted earlier content and did not end. It is a single small sequential comparison, not proof of generally correct coverage or an isolated causal test of chunking alone.

- Passage 1: opening statistics and receiver-strength paragraph appeared, but the statistics block was duplicated and Markdown heading markers leaked.
- Passage 2: running-game concern, quarterback statistics, best/worst-case records and success criterion appeared. The preceding overlap contained garbled/repeated words.
- Passage 3: fantasy passage, prediction, navigation labels and end label appeared. One prediction line was duplicated.

This supports advancing source text as a useful direction, while showing that within-image repetition remains a separate model-rendering problem. The experiment is not promoted to production and #20 stays open.

## Shared logic and tradeoffs

The helper operates after normal API processing, on common article story fields and source blocks. It needs no new ESPN-specific scroll processor. Known article shapes can share it; arbitrary JSON and dense lists would need an appropriate content mapping rather than pretending all APIs are article prose.

The frozen Jacksonville section contains 3,286 readable story characters and 15 link targets, all retained exactly across passages of 940/1,307/1,039 characters. Paragraphs remain atomic; 1,400 characters is a soft target. Each window retains metadata and adds cursor/count/hasMore plus preceding context capped at 300 characters. The harness adds explicit window instructions while retaining the previous screenshot and the existing approximate 20% visual overlap instruction. Actual overlap fidelity is imperfect.

Smaller passages can require more image calls. This used three images versus two in the preceding readable-source comparison; reduced per-request text does not establish lower total cost. Source assignment also does not prove that every word was rendered or readable.

Production adoption would require storing each view's source cursor with its image, restoring it through history and failures, and validating red-pointer links in both current content and visible overlap. This experiment made no click calls. Its cached Up/Down check restored source explicitly in the harness and made no further model requests; it is not a general production-history test.

## Measurements and safety

Gemini 3.1 Flash Image, 1K/minimal: input tokens 1,047/1,656/1,581; reported output tokens 1,775/1,738/1,671. Elapsed times were 37.736/17.064/13.227 seconds, without a claim about the cause of the first request's latency. Three explicit requests, no retries, no subscription calls. Keys stayed inside the existing saved-key browser origin.

Known cost portions total $0.203742. Valuing unclassified output at the higher image rate gives $0.313182; modeled cumulative testing is approximately $2.03 of $10. Billing remains incomplete as previously documented; these are estimates, not account-wide provider caps.

Five chunk-helper tests cover retention, links, multiple story fields and boundary cases; the bundled production-method test checks advancement, exhaustion and cached navigation. Guard tests cap requests at three and preserve the previous two-call default. Raw article fixtures and generated bundles remain ignored. Independent review found no blockers for this isolated experiment.

[Reproduction](../experiments/content-pagination/advancing-README.md) · [Sanitized results](../experiments/content-pagination/advancing-results-2026-09-07.json)
