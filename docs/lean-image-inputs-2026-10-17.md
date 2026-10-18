# Lean image inputs — October 17, 2026

Two changes make image requests cheaper and more accurate without dropping content.

## Image prompts carry text, not link targets

The image model only draws link labels, but the page window carried every URL. The keyless reader's Wikipedia "Banana" text opens with about 19,000 characters of menus and table of contents, mostly link targets. The 24,000-character window therefore held only about 4,000 characters of article, and the model filled the screen with invented text.

Image prompts now get an *image view* of the window ([src/page-window.ts](../src/page-window.ts)):
- markdown links become their labels;
- markdown images and webpage `links` and `imageUrls` lists are dropped, since reference photos are attached separately;
- pieces of one field split across fragments are rejoined first, so a link cut by a fragment boundary still strips cleanly.

The window is chosen by how much image view fits in 24,000 characters, from 6,000-character lossless fragments, starting one fragment before the estimated scroll position (about 2,000 image-view characters per screen). On Wikipedia the first window now holds about 15,800 characters of article, and the menus shrink to about 4,500. Clicks and reference photos still use the same fragments with URLs intact, so a click prompt on a link-heavy page can now be about 48,000 characters (about 12K tokens). Gemini 3.8 Flash's implicit cache covers repeated clicks at that size.

Paid before/after through `BananaBrowser` (first views, plus one scroll after the change; OCR words not found anywhere in the page source):

| Page | Model | Before | After |
|---|---|---|---|
| Wikipedia | Nano Banana 2.1 | 24.2% foreign, lead 1/3 sentences | 0.0%, lead 3/3 |
| Wikipedia | GPT Image 2.5 Flare | unrelated stock photo, 6 words | 0.3%, lead 3/3, scroll 0.0% |
| NPR | Nano Banana 2.1 | 8.8% | 10.3% (scroll 3.1%) |
| NPR | GPT Image 2.5 Flare | 1.3% | 2.8% (scroll 1.8%) |

NPR, a homepage, was unchanged within single-sample noise. Flare first views were faster after the change (16.4 s and 14.9 s, against 21.5 s and 20.6 s). Twelve images cost $0.48.

## Reference photos at 256 px

Up to five reference photos go with each image request. GPT Image bills them by pixel area. Gemini bills a flat 1,120 tokens each at its default media resolution. Measured on the bake-off's frozen ESPN request with five photos:

| Variant | Image-input tokens | Cost | Time |
|---|---:|---:|---:|
| Flare, original photos (bake-off) | 4,399 | $0.048 | ~18 s |
| Flare, photos at 512 px | 4,032 | $0.045 | 17.6 s |
| **Flare, photos at 256 px** | **1,008** | **$0.021** | **13.2 s** |
| Flare, one 3×2 collage | 1,536 | $0.025 | 14.4 s |
| Flare, two photos only | 1,600 | $0.025 | 17.9 s |
| Nano Banana 2.1, original photos | 5,600 | $0.044 | ~16 s |
| Nano Banana 2.1, low media resolution | 350 | $0.042 | 13.8 s |
| Nano Banana 2.1, one collage | 1,120 | $0.043 | 13.6 s |

The 256-px render kept all six headlines and descriptions and drew each story's photo, at less than half the cost. A two-photo cap was rejected: it saved no more than 256-px photos and lost real photos on photo-heavy pages. GPT Image 2.5 Flare rejects `input_fidelity`. Gemini's low media resolution saves only about $0.002 a page, because output dominates its cost, and it would also lower the resolution of the previous screenshot that scrolling relies on, so it is not used.

Reference photos are now downscaled in the browser to fit 256 px, as JPEG on white ([src/reference-images.ts](../src/reference-images.ts)). The site layout screenshot from Firecrawl's site-reference option keeps 1,024 px, because its detail is the point. Where `createImageBitmap` or `OffscreenCanvas` is unavailable, photos pass through unchanged.
