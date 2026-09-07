# Pokémon example adapter — 2026-09-07

Implemented in `src/pokemon.ts` and connected to the Pokémon bookmark, shared source routing, reference images, pointer navigation and source attribution.

The [official PokéAPI v2 documentation](https://pokeapi.co/docs/v2#resource-listspagination-section) confirms public GET access without authentication and list pagination using `limit`/`offset`. Its [Pokémon endpoint](https://pokeapi.co/docs/v2#pokemon) accepts an ID or name and supplies types, abilities, base stats and sprites. Height is in decimetres and weight in hectograms; the adapter displays metres and kilograms. PokéAPI asks clients to cache responses locally.

Verification:

- Live listing `/api/v2/pokemon?limit=12&offset=0` returned 12 entries and provider next offset 12.
- Live `/api/v2/pokemon/pikachu` returned ID 25, electric type, height 0.4 m, weight 6 kg, six stats and official artwork. Both captured responses passed through the adapter locally.
- Parent task verified browser fetch from the app's localhost origin: listing and Bulbasaur detail returned 200; the returned official artwork URL fetched as PNG and decoded to 475 × 475 pixels.
- Five offline adapter tests and TypeScript compilation passed. No generated images or paid API calls.

Integration:

The bookmark uses `POKEMON_URL`; shared URL normalization applies `normalizePokemonApiUrl` before the normal browser GET (using the browser's HTTP cache). The response passes through `processPokemon`, and source attribution links to PokéAPI. Back/Forward reuse stored data and images.

Listings contain only provider names/detail URLs; detail supplies one observed official-artwork URL. No per-row fetches, synthesized gallery images, or species/move lookups.

Page size stays 12. Invalid offsets reset to zero; unsupported hosts/routes remain unrecognized. Only provider pagination links are offered. The detail remains structured facts without a narrative `story` field. Artwork attribution is descriptive, with no public-domain license claim.

After integration, 125 app tests and the production build passed; independent review found no blockers. A Chromium app-core check used live public data with mocked image/click models: 12-entry listing → Bulbasaur detail → cached Back → next page at offset 12. The app's reference-image pipeline loaded one artwork successfully. Three mocked images and one mocked click were observed, no errors and no paid calls. Generated Pokémon image fidelity has not been tested.
