// Cheaper reference photos without dropping any: measured on the bake-off's frozen ESPN request.
//   openai-256:      GPT Image 2.5 Flare, five photos shrunk to 256 px
//   openai-lowfid:   GPT Image 2.5 Flare, five original photos with input_fidelity=low
//   openai-collage:  GPT Image 2.5 Flare, the five photos as one 3x2 collage
//   gemini-lowres:   Nano Banana 2.1, five original photos with mediaResolution LOW
//   gemini-collage:  Nano Banana 2.1, the collage
// Paid (five images): node --env-file=<file> experiments/whole-page-scroll/photo-tokens.mjs <fixture dir> <work dir> [variant...]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const [fixtureDir, workDir, ...only] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(path.join(fixtureDir, 'fixture.json'), 'utf8'));
const read = async file => readFile(file);
const originals = await Promise.all(fixture.references.map(ref => read(path.join(fixtureDir, ref.file))));
const small = await Promise.all(fixture.references.map(ref => read(path.join(workDir, 'r256', path.basename(ref.file)))));
const collage = await read(path.join(workDir, 'collage.jpg'));
const collagePrompt = fixture.fullPrompt.replace(/5 photo\(s\) from the actual content are provided:/,
  'One collage image is provided, holding 5 photos from the actual content in a grid of three columns and two rows, numbered left to right, then top to bottom. Use each photo separately:');
const keys = { gemini: process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY, openai: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY };

async function openai(name, images, prompt, extra = {}) {
  const form = new FormData();
  form.append('model', 'gpt-image-2.5-flare');
  images.forEach((bytes, i) => form.append('image[]', new Blob([bytes], { type: 'image/jpeg' }), `reference-${i}.jpg`));
  form.append('prompt', prompt); form.append('size', '1920x1280'); form.append('quality', 'low'); form.append('moderation', 'low');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const started = Date.now();
  const response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${keys.openai}` }, body: form });
  const body = await response.json();
  if (!response.ok) return { name, error: `${response.status} ${body?.error?.message?.slice(0, 200)}` };
  await writeFile(path.join(workDir, `${name}.png`), Buffer.from(body.data[0].b64_json, 'base64'));
  const u = body.usage;
  const usd = u.input_tokens_details.text_tokens * 5e-6 + u.input_tokens_details.image_tokens * 8e-6 + u.output_tokens * 30e-6;
  return { name, ms: Date.now() - started, imageInputTokens: u.input_tokens_details.image_tokens, textTokens: u.input_tokens_details.text_tokens, outputTokens: u.output_tokens, usd };
}

async function gemini(name, images, prompt, config = {}) {
  const ai = new GoogleGenAI({ apiKey: keys.gemini });
  const started = Date.now();
  try {
    const response = await ai.models.generateContent({ model: 'gemini-nano-banana-2.1',
      contents: [...images.map(bytes => ({ inlineData: { mimeType: 'image/jpeg', data: bytes.toString('base64') } })), { text: prompt }],
      config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '1K' }, thinkingConfig: { thinkingLevel: 'minimal' }, ...config } });
    const part = response.candidates?.[0]?.content?.parts?.find(p => !p.thought && p.inlineData);
    if (part) await writeFile(path.join(workDir, `${name}.png`), Buffer.from(part.inlineData.data, 'base64'));
    const u = response.usageMetadata;
    const imageIn = u.promptTokensDetails?.find(d => d.modality === 'IMAGE')?.tokenCount ?? 0;
    const imageOut = u.candidatesTokensDetails?.find(d => d.modality === 'IMAGE')?.tokenCount ?? 0;
    const usd = u.promptTokenCount * 1.5e-6 + (u.candidatesTokenCount - imageOut + (u.thoughtsTokenCount || 0)) * 7.5e-6 + imageOut * 30e-6;
    return { name, ms: Date.now() - started, imageInputTokens: imageIn, promptTokens: u.promptTokenCount, image: !!part, usd };
  } catch (error) { return { name, error: String(error.message).slice(0, 300) }; }
}

const variants = {
  'openai-256': () => openai('openai-256', small, fixture.fullPrompt),
  'openai-lowfid': () => openai('openai-lowfid', originals, fixture.fullPrompt, { input_fidelity: 'low' }),
  'openai-collage': () => openai('openai-collage', [collage], collagePrompt),
  'gemini-lowres': () => gemini('gemini-lowres', originals, fixture.fullPrompt, { mediaResolution: 'MEDIA_RESOLUTION_LOW' }),
  'gemini-collage': () => gemini('gemini-collage', [collage], collagePrompt),
};
const results = [];
for (const [name, run] of Object.entries(variants)) {
  if (only.length && !only.includes(name)) continue;
  const result = await run();
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(path.join(workDir, 'results.json'), JSON.stringify(results, null, 2));
