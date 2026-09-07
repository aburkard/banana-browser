# Real-content navigation and fast checks

## Outcome

Real article and episode navigation completed, with a correct red-pointer episode destination and exact cached Back/Forward restoration. The image-quality acceptance is only partial: generated text still repeats or changes facts. Operational completion in a harness does not mean visual acceptance passed.

The baseline ESPN article split HTML mid-anchor and mixed team content. Source sections now preserve paragraph/anchor boundaries and prefer thematic separators. All 158,835 story characters and 546 complete anchors are retained; the captured article becomes 34 sections instead of 23, with a maximum serialized section length of 7,986. Jacksonville is isolated at index 17 (5,063 characters). This can require more explicit section navigation, but creates no automatic image requests.

Scrolling still requests approximately 20% overlap and uses the previous image. A narrow prompt addition treats only current source data as factual, forbids inferred later records, and requests “End of section” after exhaustion. Red-pointer clicking, separate click/image requests, and cached navigation remain intact.

## Live observations

- ESPN baseline: first view, later section, then same-section scroll. The later image mixed statistics; scrolling invented a Detroit section absent from its Jacksonville/Chicago source.
- Corrected ESPN: initial Jacksonville view showed the correct best/worst-case records (12-5 and 6-11). Scrolling stayed with Jacksonville, but repeated paragraphs and displayed anchor markup. The requested end label did not appear. This is an improvement in the observed sample, not proof of reliable scrolling.
- TVmaze Doctor Who season list: reached section 2, selected The Screaming Jungle with the red pointer, and opened the exact expected endpoint `/episodes/67382`. Back, Forward, Back restored source, image, section and scroll state with no additional calls (5 ms harness check). List images still changed some dates, ratings and labels.

Public responses were captured once and fed through the actual production fetch/transform/section paths. Selected episode detail and reference photos used normal bounded public fetches. Standalone harness bundles prevented development reloads. Saved API keys remained inside their browser origin. Images were inspected in the live browser; raw article bodies and generated images are not committed.

Reproduction: [real-source harness](../experiments/content-pagination/real-README.md), [corrected article harness](../experiments/content-pagination/article-fix-README.md), [sanitized measurements](../experiments/content-pagination/real-results-2026-09-06.json). Fixtures include source hashes; public responses can change on recapture.

## Fast GitHub checks

One Linux job runs the offline app tests and build. The job has a three-minute limit; dependency installation has a two-minute limit, and tests/build each have a one-minute limit. New commits cancel superseded runs. PRs do not upload deployment artifacts or deploy. Main retains the existing deployment with a three-minute limit. No paid model tests, browser downloads, matrix, schedule or live harnesses run in CI.

Local baseline: 104 tests in 1.63 seconds and build in 1.34 seconds; final source changes add two regressions. The actual hosted check is verified on the PR before merge.

## Spend and remaining limitation

Eight 1K Gemini images and one Luna click ran, with no retries. Known cost portions total $0.55020015; valuing all unclassified output at the higher image rate gives approximately $0.89112 for this run. Including prior documented work yields approximately $1.50 of the $10 budget. These are modeled costs, not a complete account billing ledger; prior interrupted-request billing remains unknown. No subscription testing ran.

Further image fidelity work needs its own measured comparison: dense list labels, HTML-to-visible-text behavior, and repeated scroll content remain unresolved. Prompt instructions alone are not a correctness guarantee. Increasing paid test volume or changing the established scroll/click strategy was not necessary to establish these failures.
