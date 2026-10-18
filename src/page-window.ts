// What the image and click models see of a page: the whole source when it fits,
// otherwise two consecutive lossless fragments around the estimated scroll
// position. The model finds its place from the previous screenshot, so the
// estimate only has to keep the window roughly in step; no extra calls track it.
import { sourceSections } from './source-sections';

/** Fragment size: two of them plus instructions stay under GPT Image's 32,000-character prompt. */
export const WINDOW_FRAGMENT_CHARS = 12_000;
/** Roughly how much source one screen shows (Oct 17 scroll test), so the window slides with scrolling. */
export const SOURCE_CHARS_PER_SCREEN = 2_500;
/** Scrolling stops after one screen per 1,000 source characters (at least three), so the end is not redrawn forever. */
const SOURCE_CHARS_PER_SCROLL_LIMIT = 1_000;

export function pageFragments(data: unknown): string[] {
  const whole = JSON.stringify(data);
  if (whole === undefined) throw new Error('Source must be JSON');
  return whole.length <= 2 * WINDOW_FRAGMENT_CHARS ? [whole] : sourceSections(data, WINDOW_FRAGMENT_CHARS);
}

export function pageWindow(fragments: string[], scrollIndex: number): string {
  if (fragments.length === 1) return fragments[0];
  const first = Math.min(Math.floor(scrollIndex * SOURCE_CHARS_PER_SCREEN / WINDOW_FRAGMENT_CHARS), fragments.length - 2);
  const blocks = fragments.slice(first, first + 2).flatMap(fragment => (JSON.parse(fragment) as {blocks: unknown[]}).blocks);
  return JSON.stringify({blocks});
}

export function maxScreens(fragments: string[]): number {
  const chars = fragments.reduce((total, fragment) => total + fragment.length, 0);
  return Math.max(3, Math.ceil(chars / SOURCE_CHARS_PER_SCROLL_LIMIT));
}
