// Load the frozen capture and rebuild the app's prompt for a model's reference-image limit.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Mirrors BananaBrowser.generatePageImage; loadFixture verifies it reproduces the captured prompt. */
export function composePrompt(basePrompt, references) {
  if (!references.length) return basePrompt;
  const imageDescriptions = references.map((image, i) => `  ${i + 1}. ${image.description}`).join('\n');
  return `# REFERENCE IMAGES
${references.length} photo(s) from the actual content are provided:
${imageDescriptions}

Use these as inspiration. You have creative freedom - incorporate them directly, stylize them to match the visual style, or reimagine them artistically. The visual style takes precedence over literal reproduction.

${basePrompt}`;
}

/** Strings the rendered page must show, from the exact source section in the prompt. */
export function expectedText(source) {
  return (source.articles || []).flatMap(article => [
    ...(article.headline ? [{ kind: 'headline', text: article.headline }] : []),
    ...(article.description ? [{ kind: 'description', text: article.description }] : []),
  ]);
}

export async function loadFixture(directory) {
  const fixture = JSON.parse(await readFile(path.join(directory, 'fixture.json'), 'utf8'));
  const source = JSON.parse(await readFile(path.join(directory, 'source.json'), 'utf8'));
  const references = await Promise.all(fixture.references.map(async reference => ({
    ...reference,
    dataUrl: `data:${reference.mimeType};base64,${(await readFile(path.join(directory, reference.file))).toString('base64')}`,
  })));
  if (composePrompt(fixture.basePrompt, references) !== fixture.fullPrompt) {
    throw new Error('Prompt template no longer matches the captured production prompt; re-capture or update composePrompt.');
  }
  return {
    fixture,
    source,
    references,
    expected: expectedText(source),
    /** Production behaviour: a model limited to N inputs receives the first N references. */
    requestFor(maxReferences) {
      const used = references.slice(0, Math.max(0, maxReferences));
      return { prompt: composePrompt(fixture.basePrompt, used), references: used };
    },
  };
}
