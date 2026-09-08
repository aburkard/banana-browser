import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } } });
const { webpageAppearance } = await server.ssrLoadModule('/src/webpage-appearance.ts');
await server.close();

test('validated screenshots have an explicit layout-only caption with selected style precedence', () => {
  for (const screenshot of ['https://cdn.example.com/capture.png', 'http://cdn.example.com/capture.png']) {
    const result = webpageAppearance({ screenshot });
    assert.equal(result.imageUrl, screenshot);
    assert.match(result.imageCaption, /Original site layout reference only/);
    assert.match(result.imageCaption, /not factual content or a continuation/);
    assert.match(result.imageCaption, /selected style takes precedence/);
  }
});

test('rejects malformed, credentialed, IP, local and oversized screenshot URLs', () => {
  for (const screenshot of [undefined, null, {}, [], '', '/capture.png', '//example.com/a', 'data:image/png;base64,abc',
    'javascript:alert(1)', 'https://user:pass@example.com/a', 'https://localhost/a', 'http://127.0.0.1/a',
    'http://2130706433/a', 'http://0x7f000001/a', 'http://[::1]/a', 'http://169.254.169.254/a',
    'https://a.local./a', 'https://a.internal/a', 'https://a.lan/a', 'https://a.home/a',
    'https://a.invalid/a', 'https://-bad.com/a', 'https://example.com/\na',
    'https://example.com/\\a', `https://example.com/${'a'.repeat(1000)}`]) {
    assert.deepEqual(webpageAppearance({ screenshot }), {}, String(screenshot));
  }
});

test('extracts only compact allowlisted colors, font names and light/dark scheme', () => {
  const result = webpageAppearance({ branding: {
    colors: { primary: '#abc', secondary: '#123456', accent: '#ABC', arbitrary: '#def', background: 'red', textPrimary: 'url(secret)' },
    typography: { fontFamilies: { primary: 'Inter', heading: 'Source Sans 3', code: 'Roboto Mono' }, instructions: 'HIDDEN' },
    colorScheme: 'dark', instructions: 'HIDDEN', description: 'HIDDEN', images: { logo: 'HIDDEN' },
  } });
  assert.match(result.siteAppearance, /#ABC, #123456/);
  assert.match(result.siteAppearance, /"Inter", "Source Sans 3", "Roboto Mono"/);
  assert.match(result.siteAppearance, /Scheme: dark/);
  assert.doesNotMatch(result.siteAppearance, /HIDDEN|#def|url\(|\bred\b/);
  assert.equal(result.imageUrl, undefined);
});

test('bounds palette, fonts, and total context; ignores malformed values and arbitrary nesting', () => {
  const result = webpageAppearance({ branding: {
    colors: Object.fromEntries(['primary', 'secondary', 'accent', 'background', 'textPrimary', 'textSecondary', 'link', 'success'].map((key, i) => [key, `#00000${i}`])),
    fontFamilies: { primary: 'A'.repeat(60), heading: 'B'.repeat(60), code: 'C'.repeat(60) },
    fonts: [{ family: 'Fourth Font' }], colorScheme: 'light',
  } });
  assert.equal(result.siteAppearance.match(/#[0-9A-F]+/g).length, 6);
  assert.doesNotMatch(result.siteAppearance, /Fourth Font/);
  assert.ok(result.siteAppearance.length <= 500);
  for (const data of [null, [], 'string', 2, {}, { data: { screenshot: 'https://example.com/a' } },
    { branding: { colors: { primary: { nested: '#abc' } }, typography: { fontFamilies: { primary: '<instructions>', heading: 'A'.repeat(61), code: 'Inter\nsecret' } }, colorScheme: 'instructions' } }]) {
    assert.deepEqual(webpageAppearance(data), {});
  }
  assert.match(webpageAppearance({ branding: { fonts: [{ family: 'Inter' }, { family: 'Inter' }, { family: 'Arial' }] } }).siteAppearance, /"Inter", "Arial"/);
});
