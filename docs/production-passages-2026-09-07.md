# Production article passages

Article passage advancement is enabled by default using the experiment's 1,400-character soft target and up to 300 characters of preceding context. Whole paragraphs and links stay together, so a long paragraph can exceed the target. This is the best observed compromise from the small comparison, not a universal optimum or a guarantee of faithful generated text.

Each source section keeps its passage sequence alongside generated images. Scroll Down selects the next passage before generation; cached Up/Down, section changes, and Back/Forward restore the matching passage. Failed generation restores the visible source and does not advance or retry automatically. Style rerender starts the current section again at its first passage. At the final passage, Scroll Down is disabled and further calls are rejected locally.

Generation keeps the previous image and approximately 20% visual overlap. Pointer interpretation keeps the existing marked image and separate call; its data includes both current and preceding passages so links visible in the overlap remain available even outside the short prose tail. Image prompts receive only the current passage and short tail.

Scope is narrative detail fields (`article.story`, top-level string `story`, and `story.text`), including source-section fragments. Listings, blank stories, and mixed discussion sections with comments retain existing scrolling. HTML is read in inert templates and links keep their targets. There is no new control or billing behavior.

Validation: 119 app tests passed in approximately 1.8 seconds; production build passed. An independent review found no blockers. The compiled default experiment passed its offline progression, exhaustion and cached-navigation checks. Chromium exercised production HTML parsing and three passages with mocked generation: cursors 0/1/2, three calls total, intact links, local exhaustion, and cached restoration to cursor 1. No new paid API or plan calls were made; cumulative modeled API spend remains approximately $2.68 of $10.

Earlier visual evidence and its limitations are in `passage-size-comparison-2026-09-07.md`. Issue #20 remains open for model text fidelity and long list rendering.
