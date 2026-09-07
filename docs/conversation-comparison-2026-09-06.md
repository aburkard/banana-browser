# Gemini image conversation comparison

The three-call comparison completed using `gemini-3.1-flash-image`, requested 512px output, minimal thinking, one candidate and 2,048 maximum output tokens. No production conversation-history change is justified by this small screen.

A seed dashboard contained TASK BOARD, Alpha-17 / Ready / green, Beta-29 / Waiting / orange, Gamma-43 / Done / blue, and Source verified. Both branches requested only Beta-29 → Ready / green. The control supplied the previous image and edit instruction; the candidate supplied the initial user request, full returned model parts including its thought signature, then the same edit instruction.

Side-by-side visual review found the seed content correct and both edits correct, with no obvious unwanted text, color, card-order or layout changes. This was a visual inspection, not a pixel-exact comparison. It does not establish performance on real articles, dense pages, red-pointer navigation, or scrolling.

| Measurement | Seed | Image-only edit | Conversation edit |
| --- | ---: | ---: | ---: |
| Elapsed ms | 6,782 | 6,346 | 6,830 |
| Input tokens | 81 | 294 | 376 |
| Output tokens | 1,107 | 978 | 935 |
| Reported image-output tokens | 747 | 747 | 747 |
| Known portion of estimated cost | $0.0448605 | $0.0449670 | $0.0450080 |

Conversation history used 82 more input tokens (27.9%) and was 484 ms slower (7.6%) for this pair. These are single observations, not general latency estimates. Both paths share the same seed cost. All three responses contained one signed final-image part; returned parts were kept intact in candidate memory.

The provider's aggregate output counts exceeded its reported image-output counts without identifying the remaining output modality. The app correctly marked all costs incomplete. The known portion for three calls is **$0.1348355**. Pricing every unclassified output token at the higher image rate gives a conservative estimate of **$0.1815755** for the completed run, not an invoice or enforced cap. Complete total-cost savings cannot be established from these diagnostics.

## Interrupted first attempt and budget

The original development-page run attempted one seed call, then reloaded while source/test files were being edited. Its persisted record is `running`, attempted 1, results empty. Its outcome and billing are unknown. No automatic retry ran. The original origin-local lock remains intact.

After diagnosing the development reload, a standalone bundled version with no Vite reload client ran once under a separate v2 lock. It used the same saved Gemini key only inside the existing Brave browser origin. No key, image bytes or thought signature was exported into the results file. Four image calls were attempted across both runs, with three recorded responses. There were no subscription calls.

At the experiment's frozen rates, allowing all 2,048 output tokens of the interrupted request at image-output pricing adds approximately $0.123 plus its tiny prompt input. Combined with the documented earlier API-test subtotal of approximately $0.1563, the conservative modeled subtotal remains below $0.47. This reconciles recorded experiments, not account-wide charges. The $10 app-testing budget was not approached; no broader paid benchmark was run.

## Decision and reproducibility

Keep the existing production previous-image route. Both branches passed the same simple edit screen, and conversation history provided no observed fidelity advantage. Retaining growing history would add complexity and billable input without evidence supporting adoption. The red pointer, separate click/image requests, and scrolling behavior remain unchanged.

[Sanitized measurements](../experiments/cache-comparison/conversation-results-2026-09-06.json), [harness instructions](../experiments/cache-comparison/conversation-README.md), and five offline harness tests are checked in. The standalone build script prevents development reloads; temporary public output must be removed before a production build.
