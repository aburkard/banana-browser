# Advancing article passages

Experiment for #20: advance the source text on each scroll rather than resending the whole selected section. Production is unchanged.

`advancingSources()` operates on the common story paths after normal API processing and readable-text conversion. It packs intact paragraphs toward a soft 1,400-character target and returns immutable source JSON windows. Each contains only its assigned story passage, unchanged metadata, and `contentWindow` with cursor/count/hasMore and up to 300 characters of preceding context. Link targets remain intact. An oversized paragraph stays whole rather than cutting links or dropping content.

This is shared logic for article story fields, not a custom ESPN scroll adapter or a claim to support arbitrary API schemas. The frozen Jacksonville section yields three passages. The experiment adds an explicit prompt explanation of the window fields while preserving the existing previous image and approximately 20% overlap instruction. It compares progression against the prior readable-source run; it does not isolate chunking from the new window instructions statistically.

Build: `node experiments/content-pagination/advancing-build.mjs tmp/real-content-fixtures/manifest.json`

Open `http://127.0.0.1:5178/banana-browser/tmp/advancing-article-check/index.html` on the saved-key origin. Generate the first passage, inspect it, then explicitly scroll to each next passage. Three Gemini 1K/minimal requests maximum, candidate count one, requested 2,048 output tokens and 90-second timeout. No clicks or automatic retries. Independent persistent lock `banana-advancing-article-v1` prevents reload reruns; do not clear it. Approximate three-image allowance $0.40, not a provider billing cap.

The last passage disables further scrolling locally, without asking the model to decide whether more source exists. Cached Up/Down checks image reuse, with source-window restoration performed by the harness. This does not establish production history correctness: adoption would require storing/restoring the source window with every image and matching clicks to that source.

Offline: `node --test experiments/content-pagination/advancing*.test.mjs experiments/content-pagination/article-fix.test.mjs`. The bundled test uses fake credentials and mock network; it skips if the ignored bundle is absent. These experiment tests are not in default CI.

Clean before production builds: `node experiments/content-pagination/advancing-build.mjs --clean`. Raw fixtures and compiled bundles remain ignored. Any visual result must distinguish exact source delivery from successful rendering of all assigned text.

## Passage-size comparison

Explicit sizing builds accept `--target=1000`, `--target=1400`, or `--target=2200`, appended to the build command. They use separate `advancing-article-<target>` directories and permanent `banana-advancing-size-v1-<target>` locks. Their absolute request cap is five, and local source exhaustion stops earlier (four/three/two passages for the frozen fixture). These are manually run experiments, not a production setting. The default command above retains its original directory, lock, 1,400-character target and three-call cap.

Clean each sizing build with its matching flag, for example `node experiments/content-pagination/advancing-build.mjs --target=1000 --clean`. Do not clear saved attempt locks. The helper accepts a validated optional character target but keeps the 1,400 default.

[Comparison results and recommendation](../../docs/passage-size-comparison-2026-09-07.md): retain 1,400 plus 300 preceding context as the practical experimental default; neither tested alternative established a better quality/cost balance.
