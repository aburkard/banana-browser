# Overnight work — September 6, 2026

## Constraints

- GPT-6 Astra only. Codex-session tokens are authorized.
- No further live Banana Browser model calls overnight; use mocked/offline tests. The user's $10 spending limits apply to Banana Browser, not this Codex task.
- No usage-reset credits, paid services, deployments, or merges.
- Keep existing prompts, screenshot markers, reference images, and turn boundaries intact.

## Filed issues

1. [Connection and billing choice](https://github.com/aburkard/banana-browser/issues/1)
2. [Subscription usage visibility](https://github.com/aburkard/banana-browser/issues/2)
3. [Caching and conversation reuse](https://github.com/aburkard/banana-browser/issues/3)
4. [Latency and fast-mode benchmarks](https://github.com/aburkard/banana-browser/issues/4)
5. [Generation progress](https://github.com/aburkard/banana-browser/issues/5)
6. [Existing API transformations](https://github.com/aburkard/banana-browser/issues/6)
7. [New API examples](https://github.com/aburkard/banana-browser/issues/7)

## Subscription integration

- Minimal sign-in instructions now identify the new tab and its full URL explicitly.
- Independent review found a duplicated-sessionStorage refresh-token replay edge case. Fixed with shared consumed-token fingerprints and reconnecting after uncertain results; the fix passed re-review.
- 30 main tests and 3 relay tests pass. Static build passes. No new live model calls were made during overnight work.
- PR publication is the next step, followed by the separate billing-choice improvement.
