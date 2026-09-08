// Sections are valid JSON fragments with original paths. Whole records stay together
// when possible; oversized text is split without losing characters or URL targets.
export const SOURCE_SECTION_BUDGET = 8000;
function isHomepageList(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const source = data as Record<string, unknown>;
  if (source.source === 'Web' && typeof source.content === 'string') return true;
  return !['story', 'article', 'comments'].some(key => key in source)
    && ['articles', 'stories', 'posts'].some(key => Array.isArray(source[key]));
}
interface Block { path: (string | number)[]; value: unknown; context?: Record<string, unknown> }
export const LIST_SECTION_BUDGET = 24000;
export function sourceSections(data: unknown, budget = isHomepageList(data) ? LIST_SECTION_BUDGET : SOURCE_SECTION_BUDGET): string[] {
  if (!Number.isSafeInteger(budget) || budget < 256) throw new Error('Invalid source section budget');
  const whole = JSON.stringify(data);
  if (whole === undefined) throw new Error('Source must be JSON');
  if (whole.length <= budget) return [whole];
  const sections: string[] = [];
  let blocks: Block[] = [];
  const serialize = (items: Block[]) => JSON.stringify({blocks: items});
  const fits = (block: Block) => serialize([block]).length <= budget;
  const flush = () => { if (blocks.length) sections.push(serialize(blocks)); blocks = []; };
  const append = (block: Block) => {
    if (!fits(block)) throw new Error('Source metadata or navigation target exceeds section budget');
    if (serialize([...blocks, block]).length > budget) flush();
    blocks.push(block);
  };
  const visit = (value: unknown, path: Block['path'], context?: Block['context']) => {
    const block = (part: unknown): Block => ({path, value: part, ...(context && Object.keys(context).length ? {context} : {})});
    const fitsRemaining = (part: unknown) => serialize([...blocks, block(part)]).length <= budget;
    // Navigation values are identities, not prose. Move the whole value to the
    // next section when needed, including relative targets such as ../next/page.
    const navigationField = /^(url|apiUrl|imageUrl|permalink|href|src)$/i.test(String(path[path.length - 1]))
      || (typeof path[path.length - 1] === 'number' && /^(links|imageUrls|urls)$/i.test(String(path[path.length - 2])));
    if (typeof value === 'string' && navigationField) { append(block(value)); return; }
    // Fill the space after metadata with prose instead of flushing a title-only
    // first section before a string sized for an otherwise empty section.
    if (fits(block(value)) && (typeof value !== 'string' || fitsRemaining(value))) { append(block(value)); return; }
    if (typeof value === 'string') {
      if (!value.length) { append(block(value)); return; }
      let part = '';
      const emit = () => { if (part) append(block(part)); part = ''; };
      const add = (unit: string, atomic = false) => {
        if (!fitsRemaining(part + unit)) emit();
        if (!fitsRemaining(unit) && fits(block(unit))) flush();
        if (!fits(block(unit))) {
          if (atomic) throw new Error('Source metadata or navigation target exceeds section budget');
          // Very long unbroken prose still splits at Unicode boundaries.
          for (const character of unit) {
            if (!fitsRemaining(part + character)) { emit(); if (!fitsRemaining(character)) flush(); }
            if (!fits(block(character))) throw new Error('Source metadata exceeds section budget');
            part += character;
          }
        } else part += unit;
      };
      const prose = (text: string) => {
        // Keep complete URLs (including relative navigation targets) together.
        text.split(/((?:https?:\/\/|\/)[^\s<>"']+)/g).forEach((token, index) => {
          for (const unit of index % 2 ? [token] : (token.match(/\s+|\S+\s*/gu) ?? [])) add(unit, !!(index % 2));
        });
      };
      if (/<(?:p|h[1-6]|a)\b/i.test(value)) {
        // Article HTML is data, never executed. Prefer whole paragraphs and keep
        // anchor markup atomic so section boundaries cannot expose half an href.
        const attributes = `(?:[^>"']|"[^"]*"|'[^']*')*`;
        const inline = new RegExp(`<a\\b${attributes}>[\\s\\S]*?<\\/a\\s*>|<${attributes}>|[^<]+|<`, 'gi');
        const elements = new RegExp(`<(p|h[1-6]|center|ul|ol|table|blockquote)\\b${attributes}>[\\s\\S]*?<\\/\\1\\s*>|${inline.source}`, 'gi');
        const units = value.match(elements) ?? [value];
        for (let index = 0; index < units.length; index++) {
          let unit = units[index];
          // A horizontal rule marks a thematic boundary (e.g. the next team).
          if (/^<hr\b/i.test(unit)) { emit(); flush(); }
          // Keep a heading with its first paragraph whenever they fit together.
          if (/^<h[1-6]\b/i.test(unit)) {
            let next = index + 1;
            while (next < units.length && !units[next].trim()) next++;
            const joined = units.slice(index, next + 1).join('');
            if (/^<p\b/i.test(units[next] ?? '') && fits(block(joined))) { unit = joined; index = next; }
          }
          if (fits(block(unit))) add(unit);
          else for (const fragment of unit.match(inline) ?? [unit]) {
            if (fragment.startsWith('<')) add(fragment, true);
            else prose(fragment);
          }
        }
      } else prose(value);
      emit();
    } else if (Array.isArray(value)) {
      if (!value.length) { append(block(value)); return; }
      value.forEach((item, index) => visit(item, [...path, index], context));
    } else if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      if (!entries.length) { append(block(value)); return; }
      // Repeat compact record identity/navigation beside split story text.
      const identity = Object.fromEntries(entries.filter(([key, item]) =>
        /^(id|headline|title|name|label|apiUrl|url|permalink|links|imageUrl|imageCaption|siteAppearance)$/.test(key) && JSON.stringify(item).length < budget / 4));
      const nextContext = {...context, ...identity};
      entries.forEach(([key, item]) => visit(item, [...path, key], nextContext));
    } else append(block(value));
  };
  visit(data, []);
  if (blocks.length) sections.push(serialize(blocks));
  return sections;
}
