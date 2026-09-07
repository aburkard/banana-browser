# Corrected article acceptance

After the production article segmentation/prompt fix is ready, build from the existing captured raw ESPN response:

`node experiments/content-pagination/article-fix-build.mjs tmp/real-content-fixtures/manifest.json`

Open `http://127.0.0.1:5178/banana-browser/tmp/article-fix-check/index.html` on the same saved-key browser origin. This is a separate static bundle with no live reload and its own permanent `banana-article-fix-v1` lock. It does not modify or clear earlier experiment records.

The harness selects the production source section containing the actual Jacksonville `h2`, regardless of its numeric position after segmentation changes. Its exact team headings are displayed for visual comparison. It initializes the browser on that selected section without generating an intro or changing any source content. The style is identical to the real baseline harness.

Click **Generate Jacksonville section**, inspect/save the output, then **Scroll within same section** once. Compare headings, facts and exhaustion behavior against the displayed source headings and original article. The first step calls production `buildImagePrompt` and `generatePageImage`; the second uses production `scrollDown`. Both assert identical source input, preserve production references, and track usage. No click interpretation or navigation is available.

Limits: two Gemini 3.1 Flash Image network attempts total, 1K, minimal thinking, one candidate, 2,048 output tokens, 90-second provider timeout; references use approved hosts and 15-second timeouts with production size/concurrency limits. No retries. Errors stop the test. Two normal 1K image outputs are approximately $0.1344 plus input/text/thinking; the two-call all-output-at-image-rate allowance is $0.24576 plus input, using locally documented rates. This is an estimate, not a billing cap.

Save JSON and each PNG with the page buttons. Run `node experiments/content-pagination/article-fix-build.mjs --clean` before production builds. Raw fixtures and generated public files remain Git-ignored. Guard tests run without network: `node --test experiments/content-pagination/article-fix.test.mjs`.
