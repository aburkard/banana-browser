// Experiment only: advance through an already-selected readable source without
// fetching, model calls, or changing production section selection.
const CONTEXT_CHARS = 300;
const linkRanges = text => [...text.matchAll(/\[(?:\\.|[^\]\\])*\]\(<[^>]*>\)/g)]
  .map(match => ({start: match.index, end: match.index + match[0].length}));

function paragraphs(text) {
  const links = linkRanges(text);
  const result = [];
  let start = 0;
  for (const match of text.matchAll(/\n[ \t]*\n/g)) {
    const end = match.index + match[0].length;
    if (links.some(link => end > link.start && end < link.end)) continue;
    result.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

function precedingContext(text) {
  text = text.trimEnd();
  let start = Math.max(0, text.length - CONTEXT_CHARS);
  if (start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start++;
  // A shortened overlap may omit a long link, but must never expose half of it.
  const crossedLink = linkRanges(text).find(link => start > link.start && start < link.end);
  if (crossedLink) start = crossedLink.end;
  else if (start && !/\s/.test(text[start - 1])) {
    const boundary = text.slice(start).search(/\s/);
    start = boundary < 0 ? text.length : start + boundary;
  }
  const linkAfterWordBoundary = linkRanges(text).find(link => start > link.start && start < link.end);
  if (linkAfterWordBoundary) start = linkAfterWordBoundary.end;
  return text.slice(start).trim();
}

export function advancingSources(sourceJson, targetChars = 1400) {
  if (!Number.isSafeInteger(targetChars) || targetChars < 256 || targetChars > 8000) throw new Error('Target passage size must be an integer from 256 to 8000');
  const source = JSON.parse(sourceJson);
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Expected a source object');
  if ('contentWindow' in source) throw new Error('Source already has contentWindow metadata');
  const slots = [];
  const collect = (value, semanticPath, location) => {
    if (typeof value === 'string' && (semanticPath.at(-1) === 'story' || (semanticPath.includes('story') && semanticPath.at(-1) === 'text'))) {
      slots.push({location, text: value});
    } else if (Array.isArray(value)) value.forEach((item, index) => collect(item, [...semanticPath, index], [...location, index]));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (key !== 'context') collect(item, [...semanticPath, key], [...location, key]);
    }
  };
  if (Array.isArray(source.blocks) && source.blocks.every(block => block && Array.isArray(block.path) && 'value' in block)) {
    source.blocks.forEach((block, index) => collect(block.value, block.path, ['blocks', index, 'value']));
  } else collect(source, [], []);
  const windows = [];
  for (const slot of slots) {
    let chunk = '', preceding = '';
    const emit = () => {
      if (!chunk) return;
      windows.push({slot, chunk, previousContext: precedingContext(preceding)});
      preceding += chunk;
      chunk = '';
    };
    for (const paragraph of paragraphs(slot.text)) {
      if (chunk && chunk.length + paragraph.length > targetChars) emit();
      chunk += paragraph; // Soft size target: an indivisible paragraph stays intact.
    }
    emit();
  }
  if (!windows.length) windows.push({slot: null, chunk: '', previousContext: ''});
  return windows.map((window, cursor) => {
    const output = JSON.parse(sourceJson);
    for (const slot of slots) {
      const parent = slot.location.slice(0, -1).reduce((node, key) => node[key], output);
      parent[slot.location.at(-1)] = slot === window.slot ? window.chunk : '';
    }
    output.contentWindow = {cursor, count: windows.length, hasMore: cursor < windows.length - 1, previousContext: window.previousContext};
    return JSON.stringify(output);
  });
}
