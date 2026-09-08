
// Format only selected story fields. Detached template contents never activate
// source scripts, links, frames, or resources in the application document.
function readableText(html: string): string {
  if (!/<[a-z][\w:-]*(?:\s[^>]*|\/?)>|&(?:#\d+|#x[\da-f]+|[a-z][\w]+);/i.test(html)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const children = (node: Node): string => Array.from(node.childNodes).map(render).join('');
  const render = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent || '').replace(/[ \t\r\n\f]+/g, ' ');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'template'].includes(tag)) return '';
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'img') return element.getAttribute('alt') || '';
    const content = children(node);
    if (tag === 'a') {
      const href = element.getAttribute('href'); // Preserve relative targets; never resolve through .href.
      if (href === null) return content;
      const label = content.trim().replace(/([\\\[\]])/g, '\\$1');
      return `[${label || 'Link'}](<${href}>)`;
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === 'li') {
      const parent = element.parentElement;
      const siblings = Array.from(parent?.children || []).filter(item => item.tagName.toLowerCase() === 'li');
      const start = Number(parent?.getAttribute('start') || 1);
      const marker = parent?.tagName.toLowerCase() === 'ol' ? `${start + siblings.indexOf(element)}.` : '-';
      return `\n${marker} ${content.trim()}\n`;
    }
    if (tag === 'td' || tag === 'th') return `${content.trim()} | `;
    if (tag === 'tr') return `\n${content.replace(/ \| $/, '').trim()}\n`;
    if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'table', 'center', 'pre'].includes(tag)) return `\n\n${content.trim()}\n\n`;
    return content;
  };
  return children(template.content).replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const linkRanges = (text: string) => [...text.matchAll(/\[(?:\\.|[^\]\\])*\]\(<[^>]*>\)/g)]
  .map(match => ({start: match.index!, end: match.index! + match[0].length}));

function paragraphs(text: string): string[] {
  const links = linkRanges(text);
  const result: string[] = [];
  let start = 0;
  for (const match of text.matchAll(/\n[ \t]*\n/g)) {
    const end = match.index! + match[0].length;
    if (links.some(link => end > link.start && end < link.end)) continue;
    result.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

function precedingContext(text: string): string {
  text = text.trimEnd();
  let start = Math.max(0, text.length - 300);
  if (start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start++;
  const links = linkRanges(text);
  const crossedLink = links.find(link => start > link.start && start < link.end);
  if (crossedLink) start = crossedLink.end;
  else if (start && !/\s/.test(text[start - 1])) {
    const boundary = text.slice(start).search(/\s/);
    start = boundary < 0 ? text.length : start + boundary;
  }
  const linkAfterWordBoundary = links.find(link => start > link.start && start < link.end);
  if (linkAfterWordBoundary) start = linkAfterWordBoundary.end;
  return text.slice(start).trim();
}

type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
type Path = (string | number)[];
interface Slot {location: Path; text: string}
const isObject = (value: Json): value is {[key: string]: Json} => value !== null && typeof value === 'object' && !Array.isArray(value);

// Each passage contains one advancing story chunk and up to 300 characters of
// prior context. The 1,400-character target is soft: paragraphs and links stay whole.
export function sourcePassages(sourceJson: string): string[] {
  const source: Json = JSON.parse(sourceJson);
  const slots: Slot[] = [];
  let hasComments = false;
  const collect = (value: Json, semanticPath: Path, location: Path): void => {
    if (semanticPath[0] === 'comments' && value !== null) {
      hasComments ||= typeof value === 'string' ? !!value.trim()
        : Array.isArray(value) ? value.length > 0
        : isObject(value) ? Object.keys(value).length > 0 : !!value;
    }
    const isStory = (semanticPath.length === 1 && semanticPath[0] === 'story')
      || (semanticPath.length === 2 && ((semanticPath[0] === 'article' && semanticPath[1] === 'story')
        || (semanticPath[0] === 'story' && semanticPath[1] === 'text')));
    if (typeof value === 'string' && isStory) {
      slots.push({location, text: value});
    } else if (Array.isArray(value)) value.forEach((item, index) => collect(item, [...semanticPath, index], [...location, index]));
    else if (isObject(value)) for (const [key, item] of Object.entries(value)) {
      if (key !== 'context') collect(item, [...semanticPath, key], [...location, key]);
    }
  };
  if (isObject(source) && Array.isArray(source.blocks) && source.blocks.every(block => isObject(block) && Array.isArray(block.path) && block.path.every(key => typeof key === 'string' || typeof key === 'number') && 'value' in block)) {
    source.blocks.forEach((item, index) => {
      const block = item as {[key: string]: Json};
      collect(block.value, block.path as Path, ['blocks', index, 'value']);
    });
  } else collect(source, [], []);
  // Listings and mixed discussion views retain scrolling so comments stay reachable.
  if (!slots.length || hasComments) return [sourceJson];
  for (const slot of slots) slot.text = readableText(slot.text);
  // Blank narrative fields must not terminate scrolling through other source content.
  if (slots.every(slot => !slot.text.trim())) return [sourceJson];
  if (!isObject(source)) throw new Error('Expected a source object containing stories');
  if ('contentWindow' in source) throw new Error('Source already has contentWindow metadata');
  const windows: {slot: Slot; chunk: string; previousContext: string}[] = [];
  for (const slot of slots) {
    let chunk = '', preceding = '';
    const emit = () => {
      if (!chunk) return;
      windows.push({slot, chunk, previousContext: precedingContext(preceding)});
      preceding += chunk;
      chunk = '';
    };
    for (const paragraph of paragraphs(slot.text)) {
      if (chunk && chunk.length + paragraph.length > 1400) emit();
      chunk += paragraph;
    }
    emit();
  }
  return windows.map((window, cursor) => {
    const output: {[key: string]: Json} = JSON.parse(sourceJson);
    for (const slot of slots) {
      let parent: Json = output;
      for (const key of slot.location.slice(0, -1)) parent = (parent as {[key: string]: Json})[key];
      (parent as {[key: string]: Json})[slot.location[slot.location.length - 1]] = slot === window.slot ? window.chunk : '';
    }
    output.contentWindow = {cursor, count: windows.length, hasMore: cursor < windows.length - 1, previousContext: window.previousContext};
    return JSON.stringify(output);
  });
}
