// Pure text-accuracy scoring for bake-off images. Inputs are OCR lines and the source strings the page must show.

/** Letters, digits and single spaces only: OCR punctuation noise is not a model spelling error. */
export function normalize(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Minimum edit distance between `pattern` and any substring of `text` (semi-global alignment). */
export function substringDistance(pattern, text) {
  if (!pattern) return 0;
  let previous = new Array(text.length + 1).fill(0);
  for (let i = 1; i <= pattern.length; i++) {
    const current = new Array(text.length + 1);
    current[0] = i;
    for (let j = 1; j <= text.length; j++) {
      const substitute = previous[j - 1] + (pattern[i - 1] === text[j - 1] ? 0 : 1);
      current[j] = Math.min(substitute, previous[j] + 1, current[j - 1] + 1);
    }
    previous = current;
  }
  return Math.min(...previous);
}

/** Join wrapped lines; a trailing hyphen continues the word on the next line. */
function joinLines(lines) {
  return lines.reduce((text, line) => text.endsWith('-') ? text.slice(0, -1) + line.text : text ? `${text} ${line.text}` : line.text, '');
}

/**
 * Group OCR lines into column blocks so a headline wrapped across lines in a
 * multi-column layout is read as one passage. Lines join a block when they
 * overlap it horizontally (or share its left edge) and sit just below it.
 */
export function textBlocks(lines) {
  const sorted = [...lines].filter(line => line.text?.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const blocks = [];
  for (const line of sorted) {
    const block = blocks.find(candidate => {
      const last = candidate.at(-1);
      const overlap = Math.min(last.x + last.w, line.x + line.w) - Math.max(last.x, line.x);
      const aligned = Math.abs(last.x - line.x) <= Math.max(last.h, line.h);
      const gap = line.y - (last.y + last.h);
      return (aligned || overlap > 0.5 * Math.min(last.w, line.w)) && gap > -0.5 * line.h && gap < 1.2 * Math.max(last.h, line.h);
    });
    if (block) block.push(line); else blocks.push([line]);
  }
  return blocks.map(joinLines);
}

/** Best similarity (1 - edits / length) of `expected` within any block or the whole page. */
export function bestMatch(expected, blocks, pageText) {
  const pattern = normalize(expected);
  let best = { similarity: 0, distance: pattern.length };
  for (const text of [...blocks, pageText]) {
    const normalized = normalize(text);
    if (!normalized) continue;
    // A substring can never beat the length difference bound; skip blocks far too short.
    if (normalized.length < pattern.length * 0.5) continue;
    const distance = substringDistance(pattern, normalized);
    if (distance < best.distance) best = { similarity: 1 - distance / pattern.length, distance };
    if (distance === 0) break;
  }
  return best;
}

export const FOUND_THRESHOLD = 0.75;

/** Lines cut by the frame edge (content continuing below the fold) are half glyphs to OCR; ignore them. */
export function visibleLines(ocr) {
  if (!ocr.height) return ocr.lines;
  const edge = Math.max(2, ocr.height * 0.005);
  return ocr.lines.filter(line => line.y > edge && line.y + line.h < ocr.height - edge);
}

/**
 * A deliberate cut such as "…shooting of 49ers' Kei…": at least 40% of the
 * expected words appear verbatim and are followed within a partial word by an ellipsis.
 */
export function isTruncated(expected, blocks) {
  const words = expected.split(/\s+/);
  for (let count = words.length - 1; count >= Math.ceil(words.length * 0.4); count--) {
    const prefix = normalize(words.slice(0, count).join(' '));
    for (const block of blocks) {
      for (const ellipsis of block.matchAll(/\.\.\.|…/g)) {
        const before = normalize(block.slice(0, ellipsis.index));
        const at = before.lastIndexOf(prefix);
        if (at >= 0 && before.length - (at + prefix.length) <= 12) return true;
      }
    }
  }
  return false;
}

/** verbatim | truncated (layout cut with an ellipsis) | altered (shown with dropped, added or changed characters) | missing. */
export function classify(item, blocks) {
  if (item.distance === 0) return 'verbatim';
  if (isTruncated(item.text, blocks)) return 'truncated';
  return item.similarity >= FOUND_THRESHOLD ? 'altered' : 'missing';
}

/** The system word list has base forms only; accept common inflections of a known word. */
export function isKnownWord(word, vocabulary) {
  if (vocabulary.has(word)) return true;
  const stems = [
    word.endsWith('ies') && word.slice(0, -3) + 'y', word.endsWith('es') && word.slice(0, -2), word.endsWith('s') && word.slice(0, -1),
    word.endsWith('ed') && word.slice(0, -2), word.endsWith('ed') && word.slice(0, -1), word.endsWith('ing') && word.slice(0, -3),
    word.endsWith('ing') && word.slice(0, -3) + 'e', word.endsWith('er') && word.slice(0, -2), word.endsWith('ers') && word.slice(0, -3),
  ];
  return stems.some(stem => stem && stem.length >= 3 && vocabulary.has(stem));
}

/** Words of four or more letters that are in neither the prompt nor the dictionary suggest garbled text. */
export function nonWordRate(pageText, vocabulary) {
  const words = (pageText.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]s\b/g, '').match(/[a-z]{4,}/g) || []);
  const unknown = words.filter(word => !isKnownWord(word, vocabulary));
  return { words: words.length, unknown: unknown.length, rate: words.length ? unknown.length / words.length : null, examples: [...new Set(unknown)].slice(0, 12) };
}

export function buildVocabulary(texts, dictionaryWords = []) {
  const vocabulary = new Set(dictionaryWords.map(word => word.toLowerCase()));
  for (const text of texts) for (const word of text.toLowerCase().replace(/['’]s\b/g, '').match(/[a-z]+/g) || []) vocabulary.add(word);
  return vocabulary;
}

/** Score one OCR result against the expected strings grouped by kind (e.g. headline, description). */
export function scoreImage(ocr, expected, vocabulary) {
  const lines = visibleLines(ocr);
  const blocks = textBlocks(lines);
  const pageText = joinLines([...lines].sort((a, b) => a.y - b.y || a.x - b.x));
  const items = expected.map(item => {
    const match = { ...item, ...bestMatch(item.text, blocks, pageText) };
    return { ...match, status: classify(match, blocks) };
  });
  const summary = {};
  for (const kind of [...new Set(expected.map(item => item.kind))]) {
    const ofKind = items.filter(item => item.kind === kind);
    const count = status => ofKind.filter(item => item.status === status).length;
    summary[kind] = { total: ofKind.length, verbatim: count('verbatim'), truncated: count('truncated'), altered: count('altered'), missing: count('missing') };
  }
  return { items, summary, nonWords: nonWordRate(pageText, vocabulary) };
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
