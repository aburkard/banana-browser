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
- [PR #8](https://github.com/aburkard/banana-browser/pull/8) is open and unmerged.

## Billing choice

- [PR #9](https://github.com/aburkard/banana-browser/pull/9) is open against the subscription branch; neither PR is merged.

- A visible connection button identifies ChatGPT plan versus API credits. Switching to API credits requires confirmation; both sets of credentials are retained.
- The selected connection survives reloads. Missing credentials open setup instead of silently changing billing.
- Eight offline policy/UI tests pass, including cancellation, reload, and switching both ways. Independent review found no important issues.
- Native browser Escape and Cancel both dismissed the confirmation. Reload restored ChatGPT mode; the dummy API key was never saved. No model requests were made.

## Generation progress

- [PR #10](https://github.com/aburkard/banana-browser/pull/10) is open against the billing branch.

- Existing fetching, click interpretation, and generation phases now show elapsed seconds in the loading overlay and status bar. No predicted completion times or percentages.
- Timers stop on completion, error, or leaving the browser view; late callbacks cannot restart them.
- 41 offline tests and the static build pass. Independent review found no important issues. Prompts and model calls are unchanged.

## Subscription usage

- Usage is visible before the first call. Its summary shows image/click counts; the breakdown includes model calls and total tokens, with clear reset scope and no API dollar estimates.
- This does not claim to measure remaining ChatGPT allowance. Cached-token reporting and durable usage history remain in issue #2.
- 42 offline tests and the static build pass; browser inspection confirmed the control opens. Independent review found no important issues. No live model calls.
