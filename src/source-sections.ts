// Sections are valid JSON fragments with original paths. Whole records stay together
// when possible; oversized text is split without losing characters or URL targets.
export const SOURCE_SECTION_BUDGET = 8000;
interface Block { path: (string | number)[]; value: unknown; context?: Record<string, unknown> }
export function sourceSections(data: unknown, budget = SOURCE_SECTION_BUDGET): string[] {
  if (!Number.isSafeInteger(budget) || budget < 256) throw new Error('Invalid source section budget');
  const whole = JSON.stringify(data);
  if (whole === undefined) throw new Error('Source must be JSON');
  if (whole.length <= budget) return [whole];
  const sections: string[] = [];
  let blocks: Block[] = [];
  const serialize = (items: Block[]) => JSON.stringify({blocks: items});
  const fits = (block: Block) => serialize([block]).length <= budget;
  const append = (block: Block) => {
    if (!fits(block)) throw new Error('Source metadata or navigation target exceeds section budget');
    if (serialize([...blocks, block]).length > budget) { sections.push(serialize(blocks)); blocks = []; }
    blocks.push(block);
  };
  const visit = (value: unknown, path: Block['path'], context?: Block['context']) => {
    const block = (part: unknown): Block => ({path, value: part, ...(context && Object.keys(context).length ? {context} : {})});
    if (fits(block(value))) { append(block(value)); return; }
    if (typeof value === 'string') {
      if (!value.length) { append(block(value)); return; }
      // Treat URLs as indivisible tokens, including long query strings.
      const tokens = value.split(/((?:https?:\/\/|\/)[^\s<>"']+)/g);
      let part = '';
      for (let i = 0; i < tokens.length; i++) {
        const units = i % 2 ? [tokens[i]] : (tokens[i].match(/\s+|\S+\s*/gu) ?? []);
        for (const unit of units) {
          if (!fits(block(part + unit))) { if (part) append(block(part)); part = ''; }
          if (!fits(block(unit))) {
            if (i % 2) throw new Error('Source metadata or navigation target exceeds section budget');
            // Very long unbroken prose still splits at Unicode boundaries.
            for (const character of unit) {
              if (!fits(block(part + character))) { if (part) append(block(part)); part = ''; }
              if (!fits(block(character))) throw new Error('Source metadata exceeds section budget');
              part += character;
            }
          } else part += unit;
        }
      }
      if (part) append(block(part));
    } else if (Array.isArray(value)) {
      if (!value.length) { append(block(value)); return; }
      value.forEach((item, index) => visit(item, [...path, index], context));
    } else if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      if (!entries.length) { append(block(value)); return; }
      // Repeat compact record identity/navigation beside split story text.
      const identity = Object.fromEntries(entries.filter(([key, item]) =>
        /^(id|headline|title|name|label|apiUrl|url|permalink|links|imageUrl|imageCaption)$/.test(key) && JSON.stringify(item).length < budget / 4));
      const nextContext = {...context, ...identity};
      entries.forEach(([key, item]) => visit(item, [...path, key], nextContext));
    } else append(block(value));
  };
  visit(data, []);
  if (blocks.length) sections.push(serialize(blocks));
  return sections;
}
