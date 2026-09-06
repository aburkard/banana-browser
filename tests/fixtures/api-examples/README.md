# Public API fixtures

Captured without authentication on 2026-09-06:

- `art-gallery.json`: the `ART_GALLERY_URL` constant in `src/api-examples.ts`, requesting 12 public-domain artworks with selected fields. Art Institute of Chicago.

- `artwork.json`: https://api.artic.edu/api/v1/artworks/27992?fields=id,title,artist_display,date_display,description,medium_display,dimensions,credit_line,image_id,is_public_domain,thumbnail — Art Institute of Chicago, public-domain artwork. [API documentation](https://api.artic.edu/docs/).
- `tv-show.json`: https://api.tvmaze.com/shows/1 — TVmaze data, [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/), [source show](https://www.tvmaze.com/shows/1/under-the-dome). [API documentation](https://www.tvmaze.com/api). The fixture retains the original response.
- `tv-search.json`: https://api.tvmaze.com/search/shows?q=star%20trek — original TVmaze search response, under the same CC BY-SA license; individual source URLs are retained in the fixture.

The focused tests use these saved responses; they perform no network or model calls.
