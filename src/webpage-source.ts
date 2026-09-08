// Convert untrusted scrape data into readable source with explicit navigation targets.
export interface WebpageScrapeMetadata {
  title?: unknown;
  sourceURL?: unknown;
  url?: unknown;
  statusCode?: unknown;
  ogImage?: unknown;
  description?: unknown;
}

export interface WebpageScrapeData {
  markdown?: unknown;
  links?: unknown;
  metadata?: unknown;
  images?: unknown;
}

export interface WebpageLink {
  title: string;
  url: string;
}

export interface WebpageSource {
  source: 'Web';
  title: string;
  url: string;
  story: string;
  links: WebpageLink[];
  imageUrls?: string[];
}

export const WEBPAGE_MAX_BYTES = 1024 * 1024;
export const WEBPAGE_MAX_LINKS = 200;
export const WEBPAGE_MAX_IMAGES = 5;
const WEBPAGE_MAX_TITLE_CHARS = 500;
const WEBPAGE_MAX_LINK_TITLE_CHARS = 200;

function byteLength(value: string): number {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

function asPublicHttpHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (!url.hostname.includes('.') || url.hostname.startsWith('[') || /^[\d.]+$/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(url.hostname)) return undefined;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function metadataRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = (data as Record<string, unknown>).metadata;
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      return record as Record<string, unknown>;
    }
  }
  return {};
}

function pickBase(metadata: Record<string, unknown>, requestedUrl: unknown): string {
  const candidates: unknown[] = [metadata.url, metadata.sourceURL];
  for (const candidate of candidates) {
    const href = asPublicHttpHref(candidate);
    if (href) return href;
  }
  const fallback = asPublicHttpHref(requestedUrl);
  if (fallback) return fallback;
  throw new Error('Webpage scrape has no valid public http/https URL.');
}

function pickTitle(metadata: Record<string, unknown>, baseHref: string): string {
  const raw = metadata.title;
  if (typeof raw === 'string') {
    const title = raw.trim().replace(/\s+/g, ' ');
    if (title) return title.slice(0, WEBPAGE_MAX_TITLE_CHARS);
  }
  return baseHref;
}

/** Resolve one raw navigation/image target against the base, or drop it. */
function resolveTarget(raw: unknown, baseHref: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('#')) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed, baseHref);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  if (!url.hostname) return undefined;
  return url.href;
}

function cleanLabel(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const label = text || fallback;
  return label.slice(0, WEBPAGE_MAX_LINK_TITLE_CHARS) || fallback;
}

interface RawLink {
  title: string;
  raw: string;
}

function stripAngles(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Extract titled link targets from markdown without executing anything. */
function extractMarkdownLinks(markdown: string): RawLink[] {
  const found: RawLink[] = [];
  const push = (title: string, raw: string): void => {
    if (found.length >= 500) return;
    if (typeof raw !== 'string') return;
    const target = raw.trim();
    if (!target || target.startsWith('#')) return;
    found.push({ title, raw: target });
  };
  // Reference definitions: `[ref]: <url>` or `[ref]: url`.
  const definitions = new Map<string, string>();
  const definitionPattern = /^[ \t]{0,3}\[([^\]\n]{1,200})\]:[ \t]*(<[^<>\n]{1,2000}>|[^ \t\n()<>]{1,2000})/gm;
  let definitionMatch: RegExpExecArray | null;
  while ((definitionMatch = definitionPattern.exec(markdown)) !== null) {
    if (definitions.size >= 200) break;
    const key = definitionMatch[1].trim().toLowerCase();
    const target = stripAngles(definitionMatch[2]);
    if (key && target && !definitions.has(key)) definitions.set(key, target);
  }
  // Inline links: `[label](target)` / `[label](<target>)` with optional title.
  // Labels may contain one level of balanced `[inner]`; image embeds
  // (`![alt](url)`) are not navigation links and are skipped.
  const inlinePattern = /\[((?:\\.|[^\[\]]|\[[^\[\]\n]*\]){0,500}?)\]\(\s*(<[^<>\n]{1,2000}>|[^()\s\n]{1,2000})\s*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))?\s*\)/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlinePattern.exec(markdown)) !== null) {
    const matchStart = inlineMatch.index;
    if (matchStart > 0 && markdown[matchStart - 1] === '!') continue;
    push(inlineMatch[1].replace(/\\([\\\[\]])/g, '$1'), stripAngles(inlineMatch[2]));
  }
  // Reference links: `[text][ref]` and collapsed `[text][]` (ref defaults to text).
  const referencePattern = /\[((?:\\.|[^\[\]]|\[[^\[\]\n]*\]){1,500})\]\[([^\[\]\n]{0,200})\]/g;
  let referenceMatch: RegExpExecArray | null;
  while ((referenceMatch = referencePattern.exec(markdown)) !== null) {
    const matchStart = referenceMatch.index;
    if (matchStart > 0 && markdown[matchStart - 1] === '!') continue;
    const label = referenceMatch[1].replace(/\\([\\\[\]])/g, '$1');
    const ref = (referenceMatch[2] || label).trim().toLowerCase();
    const target = definitions.get(ref);
    if (target) push(label, target);
  }
  // Autolinks: `<https://example.com/path>`.
  const autolinkPattern = /<((?:https?:\/\/)[^<>\s"'`]{1,2000})>/g;
  let autolinkMatch: RegExpExecArray | null;
  while ((autolinkMatch = autolinkPattern.exec(markdown)) !== null) {
    push(autolinkMatch[1], autolinkMatch[1]);
  }
  return found;
}

function explicitLinkCandidates(links: unknown): RawLink[] {
  if (!Array.isArray(links)) return [];
  const found: RawLink[] = [];
  for (const entry of links.slice(0, 500)) {
    if (typeof entry === 'string') {
      if (entry.trim()) found.push({ title: '', raw: entry });
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const raw = record.url ?? record.href ?? record.link;
      const title = record.title ?? record.label ?? record.text;
      if (typeof raw === 'string' && raw.trim()) {
        found.push({ title: typeof title === 'string' ? title : '', raw });
      }
    }
  }
  return found;
}

function explicitImageCandidates(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  const found: string[] = [];
  for (const entry of images.slice(0, 50)) {
    if (typeof entry === 'string') {
      if (entry.trim()) found.push(entry);
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const raw = record.url ?? record.src ?? record.image;
      if (typeof raw === 'string' && raw.trim()) found.push(raw);
    }
  }
  return found;
}

function ogImageCandidates(ogImage: unknown): string[] {
  if (typeof ogImage === 'string') return ogImage.trim() ? [ogImage] : [];
  if (Array.isArray(ogImage)) {
    const found: string[] = [];
    for (const entry of ogImage.slice(0, 10)) {
      if (typeof entry === 'string' && entry.trim()) found.push(entry);
      else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const raw = (entry as Record<string, unknown>).url;
        if (typeof raw === 'string' && raw.trim()) found.push(raw);
      }
    }
    return found;
  }
  if (ogImage && typeof ogImage === 'object' && !Array.isArray(ogImage)) {
    const raw = (ogImage as Record<string, unknown>).url;
    if (typeof raw === 'string' && raw.trim()) return [raw];
  }
  return [];
}

/**
 * Normalize Firecrawl scrape data into a `source: 'Web'` record.
 *
 * @param data Firecrawl payload with `markdown`, optional `links`/`images`,
 * and optional `metadata` (`title`, `sourceURL`/`url`, `statusCode`, `ogImage`).
 * @param requestedUrl Navigation URL used when metadata has no valid final URL.
 * @throws When markdown is missing/empty, the metadata status failed, no valid
 * base URL exists, or the ~1 MiB bound would be exceeded.
 */
export function normalizeWebpage(data: unknown, requestedUrl: string): WebpageSource {
  const record = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
  const markdown = record?.markdown;
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('Webpage scrape is missing markdown.');
  }
  if (byteLength(markdown) > WEBPAGE_MAX_BYTES) {
    throw new Error('Webpage scrape exceeds the 1 MiB source limit.');
  }
  const metadata = metadataRecord(data);
  const statusCode = metadata.statusCode;
  if (typeof statusCode === 'number' && Number.isFinite(statusCode) && statusCode >= 400) {
    throw new Error(`Webpage scrape failed with status ${statusCode}.`);
  }
  const baseHref = pickBase(metadata, requestedUrl);
  const title = pickTitle(metadata, baseHref);
  const candidates: RawLink[] = [
    ...extractMarkdownLinks(markdown),
    ...explicitLinkCandidates(record?.links),
  ];
  const seen = new Map<string, string>();
  for (const candidate of candidates) {
    if (seen.size >= WEBPAGE_MAX_LINKS) break;
    const href = resolveTarget(candidate.raw, baseHref);
    if (!href || seen.has(href)) continue;
    seen.set(href, cleanLabel(candidate.title, href));
  }
  const links: WebpageLink[] = [...seen].map(([url, titleText]) => ({ title: titleText, url }));
  const imageSeen = new Set<string>();
  const imageUrls: string[] = [];
  for (const raw of [...ogImageCandidates(metadata.ogImage), ...explicitImageCandidates(record?.images)]) {
    if (imageUrls.length >= WEBPAGE_MAX_IMAGES) break;
    const href = resolveTarget(raw, baseHref);
    if (!href || imageSeen.has(href)) continue;
    imageSeen.add(href);
    imageUrls.push(href);
  }
  const source: WebpageSource = {
    source: 'Web',
    title,
    url: baseHref,
    story: markdown,
    links,
    ...(imageUrls.length ? { imageUrls } : {}),
  };
  if (byteLength(JSON.stringify(source)) > WEBPAGE_MAX_BYTES) {
    throw new Error('Webpage source exceeds the 1 MiB source limit.');
  }
  return source;
}
