// Offline experiment: accepts already-normalized paragraphs and explicit links.
// It performs no fetching, authentication, HTML execution, or model calls.
export function paginate(blocks, maxChars = 6000) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 256) throw new Error('Invalid page budget');
  const pages = [];
  let page = [];
  const serialized = items => JSON.stringify({blocks: items});
  const flush = () => { if (page.length) pages.push(serialized(page)); page = []; };
  const append = block => {
    if (serialized([...page, block]).length > maxChars) flush();
    if (serialized([block]).length > maxChars) throw new Error('Block metadata exceeds page budget');
    page.push(block);
  };
  const ids = new Set();
  for (const block of blocks) {
    if (!block || typeof block.id !== 'string' || !block.id || ids.has(block.id) || typeof block.text !== 'string') {
      throw new Error('Each block needs a unique id and text');
    }
    ids.add(block.id);
    const links = block.links ?? [];
    if (!Array.isArray(links)) throw new Error('Invalid links');
    const targets = links.map(link => {
      if (!link || typeof link.label !== 'string' || typeof link.url !== 'string') throw new Error('Invalid link');
      const url = new URL(link.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid link URL');
      return {label: link.label, url: link.url};
    });
    const item = text => ({id: block.id, text, links: targets});
    if (serialized([item('')]).length >= maxChars) throw new Error('Block metadata exceeds page budget');
    if (serialized([item(block.text)]).length <= maxChars) {
      append(item(block.text));
      continue;
    }
    // Split only oversized paragraphs. Preserve every character and complete URLs.
    // A whole paragraph that fits stays atomic, even when a prior page is nearly full.
    let rest = block.text;
    while (rest) {
      let low = 0, high = rest.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (serialized([item(rest.slice(0, mid))]).length <= maxChars) low = mid;
        else high = mid - 1;
      }
      let end = low;
      if (end && end < rest.length && /[\uD800-\uDBFF]/.test(rest[end - 1]) && /[\uDC00-\uDFFF]/.test(rest[end])) end--;
      if (!end) throw new Error('Block metadata leaves no room for text');
      if (end < rest.length) {
        const space = rest.lastIndexOf(' ', end - 1);
        if (space >= Math.floor(end / 2)) end = space + 1;
      }
      append(item(rest.slice(0, end)));
      rest = rest.slice(end);
    }
  }
  flush();
  return pages;
}
