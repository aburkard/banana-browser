export type Image25Quality = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type GptImageFamily = 'gpt-image-2' | 'gpt-image-2.5' | 'gpt-image-2.6';

// Verified 2026-10-16 against the official guide's GptImageTokenCalculator, and again on
// 2026-11-05 for GPT Image 2.6 (asset /_astro/GptImageTokenCalculator.react.B8NGWY1d.js).
// https://developers.openai.com/api/docs/guides/image-generation
// GPT Image 2.5 (Sunburst and Flare) and GPT Image 2 share the calculation; only the grid differs.
// GPT Image 2.6 uses 2.5's grid, then scales low and medium by the multipliers below and rounds.
// GPT Image 2 matches recorded usage: 197 tokens at 1920×1280 low, 1,372 at 1536×1024 medium.
const qualityEdges: Record<GptImageFamily, Partial<Record<Image25Quality, number>>> = {
  'gpt-image-2': { low: 16, medium: 48, high: 96 },
  'gpt-image-2.5': { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 },
  'gpt-image-2.6': { low: 16, medium: 24, high: 48, xhigh: 64, max: 96 },
};
const image26Multipliers: Record<Image25Quality, number> = { low: 4.2, medium: 3.3, high: 1, xhigh: 1, max: 1 };
export const IMAGE25_OUTPUT_USD_PER_MILLION = 30;

/** Image output only; excludes input tokens and streaming partial images. */
export function estimateGptImageOutputCost(family: GptImageFamily, width: number, height: number, quality: Image25Quality) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value % 16 === 0)) {
    throw new RangeError('Width and height must be positive integers divisible by 16.');
  }
  const pixels = width * height;
  const aspect = Math.max(width, height) / Math.min(width, height);
  if (pixels < 655360 || pixels > 8294400 || Math.max(width, height) > 3840 || aspect > 3) {
    throw new RangeError('Size must have 655360–8294400 pixels, edges up to 3840, and aspect ratio up to 3:1.');
  }
  const longGrid = qualityEdges[family][quality];
  if (typeof longGrid !== 'number') throw new RangeError('Unsupported image quality.');
  const shortEdge = longGrid / aspect;
  const floor = Math.floor(shortEdge);
  // The official calculator rounds exact half ties to the nearest even integer.
  const shortGrid = shortEdge - floor === 0.5 ? floor + floor % 2 : Math.round(shortEdge);
  const baseTokens = Math.ceil(longGrid * shortGrid * (2000000 + pixels) / 4000000);
  const outputTokens = family === 'gpt-image-2.6' ? Math.round(baseTokens * image26Multipliers[quality]) : baseTokens;
  return {outputTokens, outputCostUsd: outputTokens * IMAGE25_OUTPUT_USD_PER_MILLION / 1000000};
}

export function estimateImage25OutputCost(width: number, height: number, quality: Image25Quality) {
  return estimateGptImageOutputCost('gpt-image-2.5', width, height, quality);
}
