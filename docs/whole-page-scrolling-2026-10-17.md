# Whole-page scrolling — October 17, 2026

The Previous section / Next section buttons and app-chosen article passages are gone. The scroll bar is the only control.

## How scrolling works now

- **What the models see.** Each image request gets the page source plus the previous screenshot and an instruction to continue from it. A page up to about 24,000 characters goes whole. A longer page goes as a 24,000-character window: two consecutive lossless 12,000-character fragments ([src/page-window.ts](../src/page-window.ts)). That is the same prompt size the largest sections had, so cost and latency are unchanged, and it stays under GPT Image's reported 32,000-character prompt limit.
- **Long pages.** The window slides as you scroll, estimating about 2,500 source characters per screen. The model finds its exact place from the previous screenshot, so no extra call tracks position.
- **End of page.** The app doesn't know when the model has drawn the end. The prompt asks it to keep the end in view rather than invent more. Scrolling stops after one screen per 1,000 source characters, with a minimum of three, so the end is not redrawn indefinitely.
- **Clicks.** A click gets the same window as the image on screen. Gemini clicks now send the rules and page data first, then the pointer screenshot and coordinates, like OpenAI and OpenRouter clicks already did. Repeated clicks on a page therefore share a cacheable prefix. Gemini 3.8 Flash's implicit cache needs 4,096 tokens, which long-page windows reach.

## Why

Sections existed to bound prompts. The 8,000/24,000-character budgets came from older truncation caps, not from model limits: Nano Banana 2.1 accepts 131K tokens. Passages had been added in September because Nano Banana 2, given a whole section, skipped or repeated text when scrolling.

A small live test showed Nano Banana 2.1 can keep its place on its own. It used [experiments/whole-page-scroll](../experiments/whole-page-scroll/README.md): a 30,000-character window, a first view plus three scrolls, on Wikipedia's "Banana" article and NPR's homepage, scored by OCR.

| Page | Variant | Paragraphs shown | Skipped between first and last | Notes |
|---|---|---:|---:|---|
| Wikipedia | pure | 16 | 0 | Advanced 5, 5, 3, 3 paragraphs per screen |
| Wikipedia | pure (repeat) | 16 | 0 | Fourth screen mostly repeated the third |
| Wikipedia | screenshot-read anchor | 15 | 2 | No better than pure |
| NPR | pure | 24 | 10 | Third call returned no image |
| NPR | pure (repeat) | 33 | 20 | Fourth screen mostly repeated |
| NPR | screenshot-read anchor | 42 | 11 | Steadiest progression |

Skipped items on a homepage are partly normal layout choice. The screenshot-read anchor (Gemini 3.5 Flash-Lite reading the last line of the previous screenshot, about $0.0004 per scroll) helped on NPR but not on Wikipedia. It would add a call and latency to every scroll, so it is not used; simplicity and speed won. Nano Banana 2.1 never returned the text line asking where it stopped, so a self-reported anchor is not available. GPT Image's Images API cannot return text at all.

Image calls get no prompt caching. Google lists caching as not supported for Nano Banana 2.1, and the October 15 bake-off's identical repeats got zero cached tokens on both GPT Image and Nano Banana. Requests therefore stay standalone with only the previous screenshot. A September 6 comparison found that conversation history added about 28% input tokens with no visible benefit.

## Cost and limitation

- **Cost.** About $1.49 of Nano Banana calls: 23 test images at roughly $0.06 each with the larger 30,000-character window, three production-check images, and two Flash-Lite reads.
- **Starved first views on navigation-heavy pages.** This limitation existed before the change. The keyless reader keeps all navigation, so Wikipedia's text has about 19,000 characters of menus and table of contents before the article. The production check's first view therefore had only about 4,000 characters of article in its window, and the model filled the screen with invented, garbled text. The harness's 30,000-character window, with about 11,000 characters of article, rendered the lead verbatim. The scroll that followed rendered the real lead correctly.
- **Likely fix.** The image model only draws link labels, but the window carries every link URL. Dropping URLs from the image prompt would fit far more article text in the same size, or make prompts cheaper. This needs a small paid check before it becomes the default.
