import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';

const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } } });
const { normalizeWebpage } = await server.ssrLoadModule('/src/webpage-source.ts');
const { sourcePassages } = await server.ssrLoadModule('/src/source-passages.ts');
const { sourceSections } = await server.ssrLoadModule('/src/source-sections.ts');
await server.close();

const base = (overrides = {}, requestedUrl = 'https://example.com/start') => ({
  markdown: '# Hello\n\nSee [Guide](/docs/guide?q=1) for details.\n',
  links: ['https://example.com/docs/guide?q=1'],
  metadata: { title: 'Example Page', sourceURL: 'https://example.com/start', statusCode: 200 },
  ...overrides,
});

test('markdown tables, link text, and unicode are preserved verbatim in story', () => {
  const markdown = '# Café 🦋 漢字\n\n| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n\nRead [Player [one]](/next?q=1&x=🦋) and <https://example.com/auto>.\n\nFinal paragraph.\n';
  const source = normalizeWebpage({ markdown, links: [], metadata: { title: 'Tables', sourceURL: 'https://example.com/page', statusCode: 200 } }, 'https://example.com/page');
  assert.equal(source.source, 'Web');
  assert.equal(source.story, markdown);
  assert.ok(source.story.includes('| Name | Value |'));
  assert.ok(source.story.includes('Café 🦋 漢字'));
  assert.ok(source.story.includes('[Player [one]](/next?q=1&x=🦋)'));
  const urls = source.links.map((link) => link.url);
  assert.ok(urls.includes('https://example.com/next?q=1&x=%F0%9F%A6%8B') || urls.some((url) => url.startsWith('https://example.com/next?q=1&x=')));
  assert.ok(urls.includes('https://example.com/auto'));
  const labeled = source.links.find((link) => link.url.startsWith('https://example.com/next'));
  assert.match(labeled.title, /Player/);
});

test('relative navigation targets resolve against the final metadata URL', () => {
  const source = normalizeWebpage({
    markdown: 'See [Guide](../guide) and [Root](/root/path?q=1#frag).',
    links: ['../guide', '/root/path?q=1#frag', 'relative/page'],
    metadata: { title: 'Rel', sourceURL: 'https://example.com/docs/section/page', statusCode: 200 },
  }, 'https://example.com/requested');
  assert.equal(source.url, 'https://example.com/docs/section/page');
  const byUrl = Object.fromEntries(source.links.map((link) => [link.url, link.title]));
  assert.ok(byUrl['https://example.com/docs/guide']);
  assert.ok(byUrl['https://example.com/root/path?q=1#frag']);
  assert.ok(byUrl['https://example.com/docs/section/relative/page']);
  assert.equal(byUrl['https://example.com/docs/guide'], 'Guide');
});

test('redirect base wins over the requested URL and fallback works when metadata base is invalid', () => {
  const redirected = normalizeWebpage({
    markdown: 'Go [there](next).',
    links: [],
    metadata: { title: 'Final', sourceURL: 'https://intermediate.example/x', url: 'https://final.example/articles/1', statusCode: 200 },
  }, 'https://requested.example/start');
  assert.equal(redirected.url, 'https://final.example/articles/1');
  assert.equal(redirected.links[0].url, 'https://final.example/articles/next');

  const fallback = normalizeWebpage({
    markdown: 'Go [there](next).',
    links: [],
    metadata: { title: 'Fallback', sourceURL: 'javascript:alert(1)', url: 'data:text/plain,hi', statusCode: 200 },
  }, 'https://requested.example/base/path/');
  assert.equal(fallback.url, 'https://requested.example/base/path/');
  assert.equal(fallback.links[0].url, 'https://requested.example/base/path/next');
});

test('missing/empty markdown and failed metadata status are rejected', () => {
  assert.throws(() => normalizeWebpage({}, 'https://example.com/'), /markdown/);
  assert.throws(() => normalizeWebpage({ markdown: '   ' }, 'https://example.com/'), /markdown/);
  assert.throws(() => normalizeWebpage({ markdown: 42 }, 'https://example.com/'), /markdown/);
  assert.throws(() => normalizeWebpage(base({ metadata: { ...base().metadata, statusCode: 404 } }), 'https://example.com/start'), /status/);
  assert.throws(() => normalizeWebpage(base({ metadata: { ...base().metadata, statusCode: 500 } }), 'https://example.com/start'), /status/);
  assert.throws(() => normalizeWebpage({ markdown: '# Hi\n', metadata: {} }, 'not a url'), /valid.*URL/i);
  assert.throws(() => normalizeWebpage({ markdown: '# Hi\n', metadata: { sourceURL: 'javascript:alert(1)' } }, 'data:text/plain,hi'), /valid.*URL/i);
  assert.throws(() => normalizeWebpage({ markdown: 'x'.repeat(1024 * 1024 + 1) }, 'https://example.com/'), /1 MiB/);
});

test('unsafe, credentialed, and fragment-only targets are excluded and duplicates are capped', () => {
  const links = [
    'javascript:alert(1)',
    'data:text/plain,hi',
    'https://user:pass@example.com/secret',
    'https://user@example.com/',
    '#section',
    '   ',
    'mailto:someone@example.com',
    'https://example.com/ok',
    'https://example.com/ok',
    '/ok',
  ];
  const source = normalizeWebpage({
    markdown: 'Ok [here](https://example.com/ok).',
    links,
    metadata: { title: 'Safe', sourceURL: 'https://example.com/page', statusCode: 200 },
  }, 'https://example.com/page');
  assert.deepEqual(source.links, [{ title: 'here', url: 'https://example.com/ok' }]);

  const manyLinks = Array.from({ length: 300 }, (_, i) => `https://example.com/p/${i}`);
  const manyImages = Array.from({ length: 10 }, (_, i) => `https://example.com/i/${i}.jpg`);
  const capped = normalizeWebpage({
    markdown: '# Big\n\nBody.\n',
    links: manyLinks,
    images: manyImages,
    metadata: { title: 'Caps', sourceURL: 'https://example.com/', statusCode: 200, ogImage: 'https://example.com/i/og.jpg' },
  }, 'https://example.com/');
  assert.equal(capped.links.length, 200);
  assert.equal(new Set(capped.links.map((link) => link.url)).size, 200);
  assert.equal(capped.imageUrls.length, 5);
  assert.equal(new Set(capped.imageUrls).size, 5);
  assert.equal(capped.imageUrls[0], 'https://example.com/i/og.jpg');
});

test('images resolve relative targets, dedup, and are omitted when empty', () => {
  const withImages = normalizeWebpage({
    markdown: '# Pics\n\nBody.\n',
    links: [],
    images: ['/a.jpg', 'https://example.com/a.jpg', 'relative/b.png', 'data:image/png;base64,xx', 'javascript:alert(1)'],
    metadata: { title: 'Img', sourceURL: 'https://example.com/articles/1', statusCode: 200, ogImage: '/og.jpg' },
  }, 'https://example.com/articles/1');
  assert.deepEqual(withImages.imageUrls, [
    'https://example.com/og.jpg',
    'https://example.com/a.jpg',
    'https://example.com/articles/relative/b.png',
  ]);
  const empty = normalizeWebpage(base({ images: [], metadata: { ...base().metadata, ogImage: undefined } }), 'https://example.com/start');
  assert.equal('imageUrls' in empty, false);
});

test('untrusted markdown/html is never executed and stays intact as story text', () => {
  const markdown = '# Title\n\n<script>globalThis.executedWebpageSource = true</script>\n\n<img src="x" onerror="alert(1)">\n';
  const source = normalizeWebpage({ markdown, links: [], metadata: { title: 'X', sourceURL: 'https://example.com/x', statusCode: 200 } }, 'https://example.com/x');
  assert.equal(source.story, markdown);
  assert.equal(globalThis.executedWebpageSource, undefined);
  assert.equal(source.links.length, 0);
});

test('story integrates with existing passage and section pipelines without losing targets', () => {
  const markdown = ['# Long article', '', ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i} with [link ${i}](https://example.com/l/${i}) and table | a | b | content ${'word '.repeat(30)}`), ''].join('\n\n');
  const source = normalizeWebpage({ markdown, links: Array.from({ length: 30 }, (_, i) => `https://example.com/l/${i}`), metadata: { title: 'Long', sourceURL: 'https://example.com/long', statusCode: 200 } }, 'https://example.com/long');
  const passages = sourcePassages(JSON.stringify(source)).map(JSON.parse);
  assert.ok(passages.length >= 1);
  assert.equal(passages.map((view) => view.story).join(''), markdown);
  const sections = sourceSections(source);
  const blocks = sections.flatMap((section) => JSON.parse(section).blocks ?? [JSON.parse(section)]);
  const storyText = blocks.filter((block) => Array.isArray(block.path) && block.path.join('.') === 'story').map((block) => block.value).join('');
  const whole = sections.length === 1 ? JSON.parse(sections[0]).story : storyText;
  assert.equal(whole, markdown);
  for (const view of passages) {
    assert.equal(view.source, 'Web');
    assert.equal(view.title, 'Long');
    assert.equal(view.url, 'https://example.com/long');
  }
});
