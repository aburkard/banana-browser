export interface WebpageAppearance {
  imageUrl?: string;
  imageCaption?: string;
  siteAppearance?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function screenshotUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1000 || /[\x00-\x20\x7f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        !host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host) ||
        !/^[a-z0-9.-]+$/.test(host) || host.split('.').some(label => !label || label.startsWith('-') || label.endsWith('-')) ||
        /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion|arpa)$/.test(host) ||
        url.href.length > 1000) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Take visual hints only; never copy arbitrary branding text into instructions. */
export function webpageAppearance(data: unknown): WebpageAppearance {
  const source = record(data);
  const appearance: WebpageAppearance = {};
  const imageUrl = screenshotUrl(source.screenshot);
  if (imageUrl) {
    appearance.imageUrl = imageUrl;
    appearance.imageCaption = 'Original site layout reference only, not factual content or a continuation of the generated page. The selected style takes precedence.';
  }
  const branding = record(source.branding);
  const colors = record(branding.colors);
  const palette = [...new Set(['primary', 'secondary', 'accent', 'background', 'textPrimary', 'textSecondary', 'link', 'success', 'warning', 'error']
    .map(key => colors[key])
    .filter((value): value is string => typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
    .map(value => value.toUpperCase()))].slice(0, 6);
  const families = record(record(branding.typography).fontFamilies);
  const topFamilies = record(branding.fontFamilies);
  const fonts = [...new Set([
    ...['primary', 'heading', 'code'].map(key => families[key]),
    ...['primary', 'heading', 'code'].map(key => topFamilies[key]),
    ...(Array.isArray(branding.fonts) ? branding.fonts.slice(0, 20).map(font => record(font).family) : []),
  ].filter((value): value is string => typeof value === 'string' && value.length <= 60 && /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(value))
    .map(value => value.trim()))].slice(0, 3);
  const hints: string[] = [];
  if (palette.length) hints.push(`Colors: ${palette.join(', ')}`);
  if (fonts.length) hints.push(`Font family names: ${fonts.map(font => JSON.stringify(font)).join(', ')}`);
  if (branding.colorScheme === 'light' || branding.colorScheme === 'dark') hints.push(`Scheme: ${branding.colorScheme}`);
  if (hints.length) {
    appearance.siteAppearance = `Original site appearance reference; selected style takes precedence. ${hints.join('; ')}.`.slice(0, 500);
  }
  return appearance;
}
