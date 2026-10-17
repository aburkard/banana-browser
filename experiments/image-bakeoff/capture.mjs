// Freeze one production ESPN page request (prompt + reference photos) for the bake-off.
// Runs the app's own navigate() with the image provider stubbed: public ESPN/CDN fetches only, no model calls.
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_DIR = path.join(ROOT, 'tmp/image-bakeoff/fixture');
const ALLOWED_HOSTS = new Set(['site.api.espn.com', 'a.espncdn.com', 'a1.espncdn.com', 'a2.espncdn.com', 'a3.espncdn.com', 'a4.espncdn.com', 'espnmedia-cdn.akamaized.net', 's.espncdn.com']);
const STUB_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function loadApp() {
  const server = await createServer({ root: ROOT, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } } });
  try {
    return { ...await server.ssrLoadModule('/src/browser.ts'), usage: await server.ssrLoadModule('/src/usage.ts') };
  } finally {
    await server.close();
  }
}

export async function capture({ fetchImpl = globalThis.fetch, outputDirectory = FIXTURE_DIR } = {}) {
  const { BananaBrowser, BOOKMARKS, IMAGE_MODELS } = await loadApp();
  const url = BOOKMARKS['ESPN NFL News'];
  let rawSource = null;
  const blocked = new Set();
  const originalFetch = globalThis.fetch;
  // Only the ESPN feed and its photo CDNs may be reached; anything else fails the capture.
  globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input.url);
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      blocked.add(target.hostname);
      throw new Error(`Blocked capture request to ${target.hostname}`);
    }
    const response = await fetchImpl(input, { ...init, redirect: 'error' });
    if (target.href === url) rawSource = await response.clone().text();
    return response;
  };
  const log = console.log;
  console.log = () => {};
  let request = null;
  try {
    // GPT Image 2 is the app's API default and allows the full six-image reference budget.
    const browser = new BananaBrowser(undefined, 'capture-only-not-a-key', 'gpt-image-2');
    browser.generateWithOpenAI = async (fullPrompt, referenceImages) => {
      request = { fullPrompt, referenceImages, activeSource: browser.activeSource, basePrompt: browser.buildImagePrompt(url, null) };
      return STUB_IMAGE;
    };
    await browser.navigate(url);
    if (browser.state.error) throw new Error(`Navigation failed: ${browser.state.error}`);
    if (!request || !rawSource) throw new Error('No image request was captured');
    // The app silently skips failed photos; a blocked host would shrink the reference set.
    if (blocked.size) throw new Error(`Capture needed unlisted hosts: ${[...blocked].join(', ')}`);
    const maxReferences = IMAGE_MODELS['gpt-image-2'].maxInputImages ?? 6;

    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(path.join(outputDirectory, 'refs'), { recursive: true });
    const references = [];
    for (const [index, reference] of request.referenceImages.entries()) {
      const match = reference.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      const bytes = Buffer.from(match[2], 'base64');
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[match[1]];
      const file = `refs/ref-${index}.${extension}`;
      await writeFile(path.join(outputDirectory, file), bytes);
      references.push({ file, mimeType: match[1], description: reference.description, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const fixture = {
      capturedAt: new Date().toISOString(),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      url,
      style: 'modern (app default)',
      maxReferences,
      basePrompt: request.basePrompt,
      fullPrompt: request.fullPrompt,
      fullPromptSha256: sha256(request.fullPrompt),
      requestSha256: sha256(JSON.stringify([request.fullPrompt, request.referenceImages.map(image => image.dataUrl)])),
      references,
    };
    await writeFile(path.join(outputDirectory, 'fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
    await writeFile(path.join(outputDirectory, 'source.json'), JSON.stringify(JSON.parse(request.activeSource), null, 2) + '\n');
    await writeFile(path.join(outputDirectory, 'espn-raw.json'), rawSource);
    return fixture;
  } finally {
    globalThis.fetch = originalFetch;
    console.log = log;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fixture = await capture();
  console.log(JSON.stringify({
    fixture: path.relative(ROOT, path.join(FIXTURE_DIR, 'fixture.json')),
    commit: fixture.commit,
    promptChars: fixture.fullPrompt.length,
    references: fixture.references.length,
    requestSha256: fixture.requestSha256,
  }, null, 2));
}
