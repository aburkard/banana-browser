// What the image and click models see of a page: the whole source when it fits,
// otherwise a run of consecutive lossless fragments around the estimated scroll
// position. The model finds its place from the previous screenshot, so the
// estimate only has to keep the window roughly in step; no extra calls track it.
//
// Image models only draw text, so they get an image view without link targets,
// markdown images or webpage link lists (reference photos are attached
// separately). The window is sized by that view, which fits far more page text
// than raw markdown full of URLs. Clicks get the same fragments with URLs intact.
import { sourceSections } from './source-sections';

/** Original JSON per fragment; small enough that windows start close to the scroll position. */
export const FRAGMENT_CHARS = 6_000;
/** Image-view characters per request: with instructions this stays under GPT Image's 32,000-character prompt. */
export const IMAGE_WINDOW_CHARS = 24_000;
/** Roughly how much image-view text one screen shows, so the window slides with scrolling. */
export const TEXT_CHARS_PER_SCREEN = 2_000;
/** Scrolling stops after one screen per 1,000 image-view characters (at least three), so the end is not redrawn forever. */
const TEXT_CHARS_PER_SCROLL_LIMIT = 1_000;

const MARKDOWN_LINK = /(!?)\[((?:\\.|[^\]\\])*)\]\((?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g;
// Webpage link and photo lists duplicate the text's labels and the attached reference photos.
const IMAGE_ONLY_OMITTED = new Set(['links', 'imageUrls']);

function stripTargets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(MARKDOWN_LINK, (_, image: string, label: string) => image ? '' : label.replace(/\\([\\[\]])/g, '$1'));
  }
  if (Array.isArray(value)) return value.map(stripTargets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripTargets(item)]));
  return value;
}

// A window's first or last piece can start or end inside a link: a target with its label in
// the previous fragment, or a label whose target falls in the next one.
const CUT_TARGET_START = /^<?https?:\/\/[^\s)>]*>?\)/;
const CUT_LINK_END = /(!?)\[((?:\\.|[^\]\\])*)\]\((?:<[^>]*|[^)\s]*)$/;

type Block = {path: unknown[]; value: unknown; context?: unknown};

/** Adjacent pieces of one split string, rejoined so links cut by fragment boundaries strip cleanly. */
function joinPieces(blocks: Block[]): Block[] {
  const joined: Block[] = [];
  for (const block of blocks) {
    const last = joined[joined.length - 1];
    if (last && typeof last.value === 'string' && typeof block.value === 'string' && JSON.stringify(last.path) === JSON.stringify(block.path)) {
      joined[joined.length - 1] = {...last, value: last.value + block.value};
    } else joined.push(block);
  }
  return joined;
}

/** The page data an image model needs: text and labels, without link targets or link and photo lists. */
export function imageView(json: string): string {
  const data = JSON.parse(json) as Record<string, unknown> & {blocks?: Block[]};
  if (Array.isArray(data.blocks) && Object.keys(data).length === 1) {
    const blocks = joinPieces(data.blocks.filter(block => !IMAGE_ONLY_OMITTED.has(String(block.path?.[0]))))
      .map(block => typeof block.value === 'string'
        ? {...block, value: (stripTargets(block.value) as string).replace(CUT_TARGET_START, '').replace(CUT_LINK_END, (_, image: string, label: string) => image ? '' : label)}
        : {...block, value: stripTargets(block.value)});
    return JSON.stringify({blocks});
  }
  const kept = Object.fromEntries(Object.entries(data).filter(([key]) => !IMAGE_ONLY_OMITTED.has(key)));
  return JSON.stringify(stripTargets(kept));
}

export function pageFragments(data: unknown): string[] {
  const whole = JSON.stringify(data);
  if (whole === undefined) throw new Error('Source must be JSON');
  return imageView(whole).length <= IMAGE_WINDOW_CHARS ? [whole] : sourceSections(data, FRAGMENT_CHARS);
}

function merge(fragments: string[]): string {
  return JSON.stringify({blocks: fragments.flatMap(fragment => (JSON.parse(fragment) as {blocks: unknown[]}).blocks)});
}

/** Fragments [start, end) for a scroll position: one fragment before the estimate, then as many as the image budget holds. */
function windowRange(fragments: string[], scrollIndex: number): [number, number] {
  const sizes = fragments.map(fragment => imageView(fragment).length);
  const estimate = scrollIndex * TEXT_CHARS_PER_SCREEN;
  let current = 0, offset = 0;
  while (current < sizes.length - 1 && offset + sizes[current] <= estimate) offset += sizes[current++];
  let start = Math.max(0, current - 1), end = start, total = 0;
  while (end < sizes.length && (end === start || total + sizes[end] <= IMAGE_WINDOW_CHARS)) total += sizes[end++];
  // Near the end, extend backwards so the last windows stay full.
  while (end === sizes.length && start > 0 && total + sizes[start - 1] <= IMAGE_WINDOW_CHARS) total += sizes[--start];
  return [start, end];
}

/** The source both models see at a scroll position, with URLs intact (image prompts apply imageView). */
export function pageWindow(fragments: string[], scrollIndex: number): string {
  if (fragments.length === 1) return fragments[0];
  const [start, end] = windowRange(fragments, scrollIndex);
  return merge(fragments.slice(start, end));
}

export function maxScreens(fragments: string[]): number {
  const chars = fragments.reduce((total, fragment) => total + imageView(fragment).length, 0);
  return Math.max(3, Math.ceil(chars / TEXT_CHARS_PER_SCROLL_LIMIT));
}
