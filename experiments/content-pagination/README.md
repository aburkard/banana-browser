# Offline content pagination experiment

`paginate.mjs` takes already-normalized paragraphs with explicit navigation links and returns complete JSON pages within a character budget. It preserves paragraph identity, text and links. It splits only paragraphs that cannot fit on a page alone and rejects metadata that cannot fit without cutting a URL.

This is deliberately independent of the application, model providers and relay. It performs no fetching or model calls and cannot access login storage. The existing generation flow does not import it.

Run the fixture tests with:

```sh
node --test tests/content-pagination-experiment.test.mjs
```

The tests establish source retention and JSON/URL integrity. They do **not** establish how much text fits on a generated screenshot. Before integration, separately verify:

- HTML-to-paragraph extraction preserves headings, captions and useful links without executing or fetching embedded content.
- Image generation and click interpretation receive exactly the source view associated with the displayed image.
- Scroll overlap includes the necessary prior source, and advancing does not skip text that the model failed to fit in the previous image.
- Back/Forward restore the source view alongside the saved screenshot.

A character budget is not a token count or a layout measurement. This experiment therefore does not yet replace production scroll behavior or claim token/cost savings.
