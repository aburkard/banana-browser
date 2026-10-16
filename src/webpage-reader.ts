// Keyless webpage reading: the Banana Browser relay fetches public HTML (see
// experiments/encrypted-relay/page-reader.mjs) and this module extracts the
// page's text, links and image URLs in the browser, in the same shape as a
// Firecrawl scrape. Nothing here executes page content: parsed documents are
// inert, and only text and http(s) URLs leave this module.
import type {WebpageScrapeData} from './webpage-source';

const RELAY = (import.meta.env.VITE_BANANA_RELAY as string | undefined) || 'https://aburkard--banana-browser-relay-web.modal.run';
export const READER_ENDPOINT = `${RELAY.replace(/\/$/, '')}/page`;
export const FIRECRAWL_HINT = 'Add a Firecrawl key in connection settings (▾ beside the address bar) for JavaScript-heavy or protected sites.';
const MAX_MARKDOWN_CHARS = 600_000;
const MAX_IMAGES = 20;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'BUTTON',
  'SELECT', 'INPUT', 'TEXTAREA', 'LINK', 'META', 'HEAD', 'DIALOG', 'VIDEO', 'AUDIO', 'MAP']);
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'ASIDE', 'FIGURE', 'FIGCAPTION',
  'UL', 'OL', 'DL', 'DT', 'DD', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'ADDRESS', 'DETAILS', 'SUMMARY', 'CENTER', 'BODY']);

function absolute(raw: string | null | undefined, base: string): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim(), base);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function hidden(element: Element): boolean {
  return element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true'
    || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute('style') || '');
}

/** Largest candidate from srcset, else src or a common lazy-loading attribute. */
function imageSource(image: Element): string | null {
  const srcset = image.getAttribute('srcset') || image.getAttribute('data-srcset');
  if (srcset) {
    const best = srcset.split(',').map(part => part.trim().split(/\s+/)).filter(([url]) => url)
      .map(([url, size]) => ({url, size: parseFloat(size || '1') || 1})).sort((a, b) => b.size - a.size)[0];
    if (best) return best.url;
  }
  return image.getAttribute('src') || image.getAttribute('data-src') || image.getAttribute('data-lazy-src');
}

const escapeLabel = (text: string) => text.replace(/([\\[\]])/g, '\\$1');
const squash = (text: string) => text.replace(/\s+/g, ' ');
// Angle brackets keep URLs with parentheses intact for the markdown link parser.
const target = (url: string) => /[()<>\s]/.test(url) ? `<${url.replace(/[<>\s]/g, encodeURIComponent)}>` : url;

/** Convert an HTML document into Firecrawl-like scrape data. */
export function htmlToScrape(html: string, pageUrl: string): WebpageScrapeData & {markdown: string} {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = absolute(doc.querySelector('base[href]')?.getAttribute('href'), pageUrl) || pageUrl;
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content')?.trim() || '';
  const title = squash(meta('meta[property="og:title"]') || doc.title || doc.querySelector('h1')?.textContent || '').trim();
  const description = squash(meta('meta[name="description"]') || meta('meta[property="og:description"]')).trim();
  const ogImage = absolute(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'), base);
  const links: {url: string; title: string}[] = [];
  const images: string[] = [];
  // Preformatted text skips whitespace normalization, so it is held aside until the end.
  const preserved: string[] = [];

  // Returns markdown with "\n\n" as block separators; whitespace inside text is collapsed.
  function render(node: Node, inPre = false): string {
    if (node.nodeType === 3) return inPre ? node.textContent || '' : squash(node.textContent || '');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.tagName.toUpperCase();
    if (SKIP.has(tag) || hidden(element)) return '';
    const children = () => Array.from(element.childNodes).map(child => render(child, inPre || tag === 'PRE')).join('');
    switch (tag) {
      case 'BR': return '\n';
      case 'HR': return '\n\n---\n\n';
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const text = squash(children()).trim();
        return text ? `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n` : '';
      }
      case 'LI': {
        // Icon-only items (social links, toggles) carry no readable text.
        const text = squash(children()).trim();
        return text ? `\n- ${text}` : '';
      }
      case 'BLOCKQUOTE': return `\n\n${children().trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
      case 'PRE': {
        preserved.push(element.textContent?.replace(/^\n|\n+$/g, '') || '');
        return `\n\n\u0000${preserved.length - 1}\u0000\n\n`;
      }
      case 'TR': {
        const cells = Array.from(element.children).filter(cell => ['TD', 'TH'].includes(cell.tagName.toUpperCase()))
          .map(cell => squash(render(cell)).trim().replace(/\|/g, '\\|'));
        return cells.some(Boolean) ? `\n| ${cells.join(' | ')} |` : '';
      }
      case 'IMG': {
        const src = absolute(imageSource(element), base);
        const width = Number(element.getAttribute('width')), height = Number(element.getAttribute('height'));
        // Tracking pixels and icons are not useful page imagery.
        if (!src || (width > 0 && width < 48) || (height > 0 && height < 48)) return '';
        if (images.length < MAX_IMAGES && !images.includes(src)) images.push(src);
        return ` ![${escapeLabel(squash(element.getAttribute('alt') || '').trim())}](${target(src)}) `;
      }
      case 'A': {
        const href = absolute(element.getAttribute('href'), base);
        const text = squash(children()).trim();
        if (!href || !text || element.getAttribute('href')?.trim().startsWith('#')) return text ? ` ${text} ` : '';
        const label = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim() || element.getAttribute('aria-label')?.trim() || '';
        if (!label) return ` ${text} `;
        // A linked story card wraps a heading plus summary and byline: link the
        // heading itself and keep the rest of the card as a paragraph below it.
        const headingElement = element.querySelector('h1,h2,h3,h4,h5,h6');
        const headingText = squash(headingElement?.textContent || '').trim();
        if (headingElement && headingText) {
          const marks = '#'.repeat(Number(headingElement.tagName[1]));
          const rest = label.replace(`${marks} ${headingText}`, '').trim();
          links.push({url: href, title: headingText.slice(0, 200)});
          return `\n\n${marks} [${escapeLabel(headingText)}](${target(href)})\n\n${rest}\n\n`;
        }
        links.push({url: href, title: label.slice(0, 200)});
        return ` [${escapeLabel(label)}](${target(href)}) `;
      }
      default: {
        const body = children();
        return BLOCK.has(tag) ? `\n\n${body}\n\n` : body;
      }
    }
  }

  let markdown = render(doc.body || doc.documentElement)
    .split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()
      // Link and image padding must not detach punctuation.
      .replace(/ +([.,;:!?)])/g, '$1').replace(/\( +/g, '(')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim()
    .replace(/\u0000(\d+)\u0000/g, (_, index) => `\`\`\`\n${preserved[Number(index)]}\n\`\`\``);
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    const cut = markdown.lastIndexOf('\n', MAX_MARKDOWN_CHARS);
    markdown = `${markdown.slice(0, cut > 0 ? cut : MAX_MARKDOWN_CHARS)}\n\n[Page truncated]`;
  }
  return {
    markdown,
    links,
    images,
    metadata: {title, description, url: pageUrl, sourceURL: pageUrl, ...(ogImage ? {ogImage} : {})},
  };
}

/** Read one public page through the relay; failures explain when Firecrawl would help. */
export async function readWebpage(url: string) {
  let response: Response;
  try {
    response = await fetch(`${READER_ENDPOINT}?url=${encodeURIComponent(url)}`, {credentials: 'omit', signal: AbortSignal.timeout(25_000)});
  } catch {
    throw new Error(`The page reader could not be reached. ${FIRECRAWL_HINT}`);
  }
  let body: {url?: unknown; html?: unknown; error?: unknown} | null = null;
  try { body = await response.json(); } catch { /* A missing endpoint answers without JSON. */ }
  if (!response.ok || !body) {
    if (response.status === 503 || response.status === 429) throw new Error('The page reader is busy. Try again shortly.');
    if (response.status === 415) throw new Error('This address is not a webpage.');
    // Only the reader's own static messages are shown, never upstream page content.
    const reason = response.status === 400 || response.status === 502 || response.status === 504
      ? typeof body?.error === 'string' ? body.error.slice(0, 120) : '' : '';
    throw new Error(`This page could not be read${reason ? `: ${reason}` : '.'} ${FIRECRAWL_HINT}`);
  }
  if (typeof body.html !== 'string' || typeof body.url !== 'string' || !absolute(body.url, body.url)) {
    throw new Error(`The page reader returned an invalid response. ${FIRECRAWL_HINT}`);
  }
  const data = htmlToScrape(body.html, body.url);
  if (!data.markdown) throw new Error(`This page shows no text without JavaScript. ${FIRECRAWL_HINT}`);
  return data;
}
