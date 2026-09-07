// Experiment only: format an already-selected source section. No fetching,
// section selection, model calls, or insertion of source HTML into the page.
export function htmlToReadableText(html, document = globalThis.document) {
  if (!/<[a-z][^>]*>|&(?:#\d+|#x[\da-f]+|[a-z][\w]+);/i.test(html)) return html;
  if (!document?.createElement) throw new Error('Readable source formatting requires a document');
  // Template contents stay inert: resources, scripts, and frames are never activated.
  const template = document.createElement('template');
  template.innerHTML = html;
  const children = node => Array.from(node.childNodes).map(render).join('');
  const render = node => {
    if (node.nodeType === 3) return node.textContent.replace(/[ \t\r\n\f]+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'template'].includes(tag)) return '';
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'img') return node.getAttribute('alt') || '';
    const content = children(node);
    if (tag === 'a') {
      const href = node.getAttribute('href'); // Keep relative URLs and query strings; never resolve via .href.
      if (href === null) return content;
      const label = content.trim().replace(/([\\\[\]])/g, '\\$1');
      return `[${label || 'Link'}](<${href}>)`;
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === 'li') {
      const parent = node.parentElement;
      const siblings = Array.from(parent?.children || []).filter(item => item.tagName.toLowerCase() === 'li');
      const start = Number(parent?.getAttribute('start') || 1);
      const marker = parent?.tagName.toLowerCase() === 'ol' ? `${start + siblings.indexOf(node)}.` : '-';
      return `\n${marker} ${content.trim()}\n`;
    }
    if (tag === 'td' || tag === 'th') return `${content.trim()} | `;
    if (tag === 'tr') return `\n${content.replace(/ \| $/, '').trim()}\n`;
    if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'table', 'center', 'pre'].includes(tag)) return `\n\n${content.trim()}\n\n`;
    return content;
  };
  return children(template.content).replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function readableSource(sourceJson, document = globalThis.document) {
  const source = JSON.parse(sourceJson);
  const isStory = path => path.at(-1) === 'story' || (path.includes('story') && path.at(-1) === 'text');
  const visit = (value, path = []) => {
    if (typeof value === 'string') return isStory(path) ? htmlToReadableText(value, document) : value;
    if (Array.isArray(value)) return value.map((item, index) => visit(item, [...path, index]));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'context' ? item : visit(item, [...path, key])]));
  };
  if (Array.isArray(source?.blocks) && source.blocks.every(block => block && Array.isArray(block.path) && 'value' in block)) {
    return JSON.stringify({...source, blocks: source.blocks.map(block => ({...block, value: visit(block.value, block.path)}))});
  }
  return JSON.stringify(visit(source));
}
