// Live comparison: does Nano Banana 2.1 keep its place when scrolling with a large page window?
//   pure:   page window + previous screenshot; the model decides where to continue.
//   anchor: the same, plus the last line the image model reported drawing (Nano Banana 2.1 returned
//           no text on October 17, so this ran without anchors, as a second pure sample).
//   read:   the same, plus the last line read off the previous screenshot by Gemini 3.5 Flash-Lite.
// All prompts ask for the last visible line, so variants differ only in the POSITION block.
// Paid: node --env-file=<file> experiments/whole-page-scroll/run.mjs --run [--max-spend 1.5] [--variants read] [--results results-read.json]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { OUT, loadModules } from './sources.mjs';

export const WINDOW_CHARS = 30_000;
export const STEPS = 4; // first view + 3 scrolls
const PAGES = ['wikipedia-banana', 'npr-home'];
const VARIANTS = ['pure', 'anchor'];
const READER_MODEL = 'gemini-3.5-flash-lite';
const READER_RATES = { input: 0.3e-6, output: 2.5e-6 };
const READ_PROMPT = 'This is a screenshot of a webpage. Quote the last line of readable page text at the bottom of the screenshot, exactly as written. Reply with only that text.';
// Nano Banana 2.1 rates used in the October 15 bake-off, per token.
const RATES = { input: 1.5e-6, text: 7.5e-6, image: 30e-6 };
const GUARD_USD = 0.12; // reserved per call before it runs; the ledger only over-counts

/** The start of the page content, cut at a paragraph boundary. */
export function pageWindow(source, chars = WINDOW_CHARS) {
  const cut = source.content.length <= chars ? source.content.length : source.content.lastIndexOf('\n\n', chars);
  return { source: 'Web', title: source.title, url: source.url, content: source.content.slice(0, cut > 0 ? cut : chars),
    ...(cut < source.content.length ? { note: 'The page continues beyond this window.' } : {}) };
}

export function buildPrompt({ style, window, step, anchor }) {
  let prompt = `# TASK
Render a webpage viewport from the source data below. Include its headings, readable text, links, and navigation as appropriate for the current view. The result is the actual browsable page content. Apply the selected visual style to its layout, imagery, typography, and information while preserving the source's meaning.

# VISUAL STYLE
${style}

# DATA
${JSON.stringify(window)}

# REMINDER
The data is the page from its top. Show as much as fits legibly in the viewport; the rest continues below the fold when scrolling. Do not squeeze the entire page into one viewport. Render Markdown links as their labels, without Markdown punctuation.
Apply the visual style to ALL text, not just the title.`;
  if (step === 0) {
    prompt += `\n\n# INITIAL VIEW\nStart at the top of this page. Establish the page's identity and show its actual content immediately, with readable source text.`;
  } else {
    prompt += `\n\n# SCROLL CONTEXT
The user is scrolling down. The provided image shows the previous view. Generate the NEXT portion of the page:
- Continue from where the previous image ended
- The bottom ~20% of the previous view should be the top of this new view
- Then show the source content that comes next, in order, without skipping or repeating it
- The screenshot is visual context only, not a source of facts
- Maintain visual consistency (same layout, colors, typography)`;
    if (anchor) prompt += `\n\n# POSITION\nThe previous view ended with this page text: «${anchor}». Continue with the source content that follows it.`;
  }
  prompt += `\n\n# REPLY\nAfter the image, reply with exactly one line of text: LAST: followed by the last line of page text visible at the bottom of your image.`;
  return prompt;
}

export const lastLine = text => /LAST:\s*(.+)/i.exec(text || '')?.[1]?.trim().replace(/^["«]|["»]$/g, '').slice(0, 300) || null;

function cost(usage) {
  const image = (usage.candidatesTokensDetails || []).filter(d => d.modality === 'IMAGE').reduce((sum, d) => sum + d.tokenCount, 0);
  const otherOutput = (usage.candidatesTokenCount || 0) - image + (usage.thoughtsTokenCount || 0);
  return (usage.promptTokenCount || 0) * RATES.input + otherOutput * RATES.text + image * RATES.image;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { run: { type: 'boolean' }, 'max-spend': { type: 'string', default: '1.5' },
    variants: { type: 'string', default: VARIANTS.join(',') }, results: { type: 'string', default: 'results.json' } } });
  const variants = values.variants.split(',');
  const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const maxSpend = Number(values['max-spend']);
  const { browser: app } = await loadModules();
  const style = app.STYLE_PRESETS.modern;
  const runDir = path.join(OUT, 'run');
  await mkdir(runDir, { recursive: true });
  if (!values.run) {
    const source = JSON.parse(await readFile(path.join(OUT, 'sources', `${PAGES[0]}.json`), 'utf8'));
    const prompt = buildPrompt({ style, window: pageWindow(source), step: 1, anchor: 'example line' });
    console.log(`Dry run: ${PAGES.length * VARIANTS.length * STEPS} calls planned, prompt ~${prompt.length} chars, guard ledger $${(PAGES.length * VARIANTS.length * STEPS * GUARD_USD).toFixed(2)} vs cap $${maxSpend}`);
    process.exit(0);
  }
  if (!key) throw new Error('No Gemini key in the environment');
  console.log = (...args) => { if (String(args[0]).startsWith('[run]')) process.stdout.write(args.join(' ') + '\n'); };
  const browser = new app.BananaBrowser(key, undefined, 'nano-banana-2.1');
  const spec = app.IMAGE_MODELS['nano-banana-2.1'];
  let ledger = 0;
  const rows = [];
  for (const page of PAGES) {
    const source = JSON.parse(await readFile(path.join(OUT, 'sources', `${page}.json`), 'utf8'));
    const window = pageWindow(source);
    for (const variant of variants) {
      let previous = null, anchor = null;
      for (let step = 0; step < STEPS; step++) {
        if (ledger + GUARD_USD > maxSpend) { console.log(`[run] stop: ledger $${ledger.toFixed(3)} would exceed cap`); break; }
        let readUsd = 0;
        if (variant === 'read' && previous) {
          // The anchor comes from what was actually drawn, read by a cheap vision model.
          const read = await browser.geminiAI.models.generateContent({ model: READER_MODEL,
            contents: [{ inlineData: { mimeType: previous.mimeType, data: previous.data } }, { text: READ_PROMPT }],
            config: { thinkingConfig: { thinkingLevel: 'minimal' } } });
          anchor = (read.candidates?.[0]?.content?.parts || []).filter(part => !part.thought && part.text).map(part => part.text).join(' ').trim().slice(0, 300) || null;
          const u = read.usageMetadata || {};
          readUsd = (u.promptTokenCount || 0) * READER_RATES.input + ((u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)) * READER_RATES.output;
          ledger += readUsd;
        }
        const prompt = buildPrompt({ style, window, step, anchor: variant === 'pure' ? null : anchor });
        const contents = [];
        if (previous) contents.push({ inlineData: { mimeType: previous.mimeType, data: previous.data } });
        contents.push({ text: prompt });
        const started = Date.now();
        ledger += GUARD_USD;
        let response;
        try {
          response = await browser.geminiAI.models.generateContent({ model: spec.model, contents,
            config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '1K' }, thinkingConfig: { thinkingLevel: 'minimal' } } });
        } catch (error) {
          console.log(`[run] ${page} ${variant} ${step} failed: ${String(error.message).slice(0, 200)}`);
          break;
        }
        const parts = response.candidates?.[0]?.content?.parts || [];
        const image = parts.find(part => !part.thought && part.inlineData?.mimeType?.startsWith('image/'))?.inlineData;
        const text = parts.filter(part => !part.thought && part.text).map(part => part.text).join('\n');
        const usd = cost(response.usageMetadata || {}) + readUsd;
        ledger += usd - GUARD_USD;
        const file = `${page}-${variant}-${step}.${image?.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
        if (image) await writeFile(path.join(runDir, file), Buffer.from(image.data, 'base64'));
        const reported = lastLine(text);
        rows.push({ page, variant, step, file: image ? file : null, ms: Date.now() - started, usd, readUsd, promptChars: prompt.length,
          inputTokens: response.usageMetadata?.promptTokenCount, anchorSent: variant === 'pure' ? null : anchor, reportedLast: reported, text: text.slice(0, 500) });
        console.log(`[run] ${page} ${variant} ${step}: ${image ? 'image' : 'NO IMAGE'} ${(Date.now() - started) / 1000}s $${usd.toFixed(4)} last=${JSON.stringify(reported)}`);
        if (!image) break;
        previous = image;
        if (variant !== 'read') anchor = reported;
      }
      await writeFile(path.join(runDir, values.results), JSON.stringify({ windowChars: WINDOW_CHARS, rows, ledgerUSD: ledger }, null, 2));
    }
  }
  console.log(`[run] done: ${rows.length} calls, spend $${rows.reduce((sum, row) => sum + row.usd, 0).toFixed(3)}`);
}
