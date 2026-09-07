# Passage-size comparison

Question: which passage target gives the best coverage/readability/cost balance for the current 1K article-rendering flow? This small experiment compares 1,000 and 2,200 characters with the previously measured 1,400-character baseline. It cannot establish a universal optimum across articles, styles, image sizes or models.

## Fixed comparison setup

Use the same captured Jacksonville article section and source hash as the prior advancing experiment, the same readable formatter, paragraph boundaries, up-to-300-character preceding context, source-window instructions, previous image, 20% visual overlap instruction, Gemini 3.1 Flash Image, 1K/minimal, and 2,048 requested output tokens. Only the paragraph packing target changes. Whole paragraphs remain intact, so target size is a soft limit.

The prior 1,400-character run is reused to avoid unnecessary charges. The baseline was measured earlier; new runs were unreplicated and partly concurrent. Timing and visual variance are not controlled. Compare complete assigned text traversal rather than equal call counts, because fewer/larger windows are part of the tradeoff.

## Criteria set before live calls

- Coverage: opening statistics, receiver strength, running-game concern, QB statistics, best/worst cases, success criterion, fantasy outlook, prediction and final navigation all appear somewhere in order.
- Errors: note altered facts, missing substantive passages, duplicated blocks or lines, and leaked formatting separately from source delivery correctness.
- Readability: judge visible text density and clipping at the same displayed image width; no assumption that a supplied passage necessarily fits.
- Exhaustion: last view should end, with further requests disabled locally.
- Cost: record complete-run call counts and usage, distinguishing known cost portions from conservative estimates. Smaller input alone is not a saving if it requires extra images.

No production change is justified merely by the lowest observed cost. Click targeting and production source-cursor/history restoration remain separate adoption requirements in #20.

## Offline packing

| Target characters | Actual story passage sizes | Image calls to traverse |
| --- | --- | ---: |
| 1,000 | 940 / 669 / 886 / 791 | 4 |
| 1,400 | 940 / 1,307 / 1,039 | 3 |
| 2,200 | 2,062 / 1,224 | 2 |

All variants preserve the same 3,286 story characters and 15 link targets. The two new variants require six image calls total. A lower packing target does not imply that each passage exactly fills it; paragraph boundaries determine actual sizes.

## Recommendation

Keep **1,400 characters with up to 300 characters of preceding context** as the practical experimental default for this 1K article flow. It is the best observed compromise here, not a statistically established optimum. No production setting changes; advancing source remains experimental.

At 1,000, text was often larger but layout size varied considerably; images continued to repeat or garble words. The third image ended the success paragraph early and printed End of section with one passage still remaining. More requests did not produce reliably better coverage. At 2,200, the two-image run was noticeably denser, mangled text around quarterback statistics, and corrupted that statistic in its repeated overlap. The prior 1,400 run covered all major passages and ended correctly with fewer calls than 1,000, although it also duplicated some lines.

The first assigned passage was identical at 1,000 and 1,400 (940 characters), yet their rendered layouts differed substantially. That is direct evidence of generation variance and a reason not to attribute every visual difference to the packing target. New variant requests partly overlapped in wall-clock time; no provider-latency conclusion is drawn.

Do not spend more calls on tiny target adjustments until there is a more stable rendering/coverage check. Further adoption work should address duplicated overlap and source/image/click history together. A future comparison across another article, style or image size may favor a different target.

## Completed measurements

| Target | Calls | Conservative run cost | Observed tradeoff |
| --- | ---: | ---: | --- |
| 1,000 | 4 | $0.4134 | Large type, but omitted/garbled prose and premature end label; extra call not justified |
| 1,400 (prior baseline) | 3 | $0.3132 | Best observed compromise; still some duplicated lines |
| 2,200 | 2 | $0.2346 | Lowest cost, but denser text and corrupted statistics/overlap |

Both new runs reached their actual last passage, displayed a final end label and disabled further generation locally. Cached Up/Down added no requests (7 ms for the smaller variant, 4 ms for the larger), with the previously documented harness-managed source restoration. No model click checks ran.

New calls cost $0.4074715 in known portions, or $0.6480115 conservatively valuing unclassified output at the higher image rate. Modeled cumulative testing is approximately $2.68 of the $10 budget. No retries or subscription calls. Billing remains incomplete; the larger first response reported 2,088 aggregate output tokens despite the requested 2,048, so request settings are not a billing guarantee.

Fifteen offline sizing/helper/guard tests passed, including actual bundled default/small/large flows, no automatic calls, source retention, exhaustion, cached navigation and persisted reload locks. Independent review found no blockers. The existing 1,400 default, its prior lock, and production code remain unchanged.

[Sanitized results](../experiments/content-pagination/size-results-2026-09-07.json) · [Experiment instructions](../experiments/content-pagination/advancing-README.md)
