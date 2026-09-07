# Readable article source experiment

Issue #20 remains open. Converting the selected article HTML to readable Markdown did not meet rendering acceptance, so production behavior is unchanged.

The test used the same frozen ESPN response, Jacksonville section (index 17 of 34), Gemini model, 1K size, minimal thinking, editorial style, photo references and production scroll prompt as the prior corrected-HTML check. Only the selected source representation changed. It retained all 15 href targets and 59 nonempty text nodes in an offline comparison, reducing serialized source from 5,063 to 3,672 characters. The full source and other sections stayed unchanged.

| Measurement | Previous HTML run | Readable run |
| --- | ---: | ---: |
| Input tokens, initial + scroll | 2,366 + 2,782 | 1,722 + 2,138 |
| Initial image time | 12.819 s | 13.905 s |
| Scroll image time | 10.159 s | 10.906 s |

The readable run used about 25% fewer input tokens, but was not faster in this single pair. Its first image summarized or omitted prose despite all source text being supplied. Its scroll repeated content, displayed Markdown syntax, and altered a visible URL. Best/worst-case records remained correct (12-5 and 6-11), but that is insufficient for a pass. The model turned a source-formatting change into a different layout; formatting alone is not a reliable solution to progress or completeness.

Two image calls ran, no clicks or retries. Known cost portions total $0.13633; valuing unclassified output at the higher image rate gives $0.21421. Modeled cumulative project testing is approximately $1.72 of $10, with the previously documented billing uncertainty. This is not a complete account ledger. No subscription calls ran.

The formatter stays under experiments and is not imported by production. A review flagged possible native resource loading with DOMParser; it was changed after the paid run to detached template parsing, with equivalent source output checked offline. No second paid run was needed for that harness hardening. The report's empty per-request heading arrays come from an HTML-only extractor; the original heading and source-identity checks remained valid.

Validation: 106 app tests and the production build passed. Six formatter tests, two request-guard tests, and each of the two bundled variants passed offline. A Chromium check parsed image/iframe/script-bearing source in the detached template: zero sentinel-host requests, no script execution and no source nodes attached to the page. Independent review found no remaining blockers. Temporary bundles were removed before the production build; app asset hashes remained unchanged.

Next useful experiment would separate visible prose from a structured link map, with explicit content progression measured independently of the rendered screenshot. That would require a carefully scoped comparison before changing the established scrolling strategy. Dense episode-list fidelity also remains unaddressed by this article-only experiment.

See [measurements](../experiments/content-pagination/readable-results-2026-09-07.json) and [reproduction](../experiments/content-pagination/readable-README.md). This is a single sequential comparison against prior output, not a randomized benchmark or general model-quality claim.
