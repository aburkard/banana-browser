# Offline cache comparison

Run from the repository after `npm install`:

```sh
node experiments/cache-comparison/measure.mjs
```

The script loads the production prompt builders and captures requests through a fake Gemini SDK. It uses the checked-in TVmaze fixture and synthetic image bytes. Fetch is disabled, no port is bound, and no credentials or browser storage are read.

It compares two clicks on the same page and two scroll requests with different previous images. Output includes the current content order and a hypothetical text-first order. The latter is measured only; it does not change production requests.

Counts are characters and matching content parts, **not tokens, cache hits, latency, or savings**. Request-envelope bytes and base64 strings are not a useful approximation of provider image-token costs. The script must be rerun after prompt or source-window changes.

See [findings and the paid-comparison protocol](../../docs/cache-comparison-2026-09-06.md).

## Optional live API comparison

Start the app's local Vite server and open `/banana-browser/experiments/cache-comparison/index.html` on the same origin where you saved an OpenAI API key. It uses that key only in the browser to call `https://api.openai.com/v1/responses`; it does not send it to the local server, print it, or use subscription credentials.

“Run comparison” makes at most six sequential Luna calls with 512 maximum output tokens each. It stops on errors, incomplete results, cancellation, or after its conservative accumulated cost exceeds $0.10; that is a stop threshold checked between calls, not a provider-enforced billing cap. The optional short-prefix button makes one separate capped compatibility call. There are no automatic retries. Reloading the page allows another run, which spends again.

The live harness reconstructs the image-first control even if production has already adopted the candidate layout. Its synthetic screenshot has three obvious show cards; it does not establish general click accuracy. Read the result before deciding whether a wider test is justified. The checked-in September 6 results used seven calls total and cost approximately $0.00302312.
