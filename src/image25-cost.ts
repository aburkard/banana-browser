export type Image25Quality = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Verified 2026-09-08 against the official guide's GptImageTokenCalculator.
// https://developers.openai.com/api/docs/guides/image-generation
// Asset: /_astro/GptImageTokenCalculator.react.yz8GdjDh.js
// Both GPT Image 2.5 Sunburst and Flare use this output-token calculation.
const qualityEdges: Record<Image25Quality, number> = {
  low: 16, medium: 24, high: 48, xhigh: 64, max: 96,
};
export const IMAGE25_OUTPUT_USD_PER_MILLION = 30;

/** Image output only; excludes input tokens and streaming partial images. */
export function estimateImage25OutputCost(width: number, height: number, quality: Image25Quality) {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value % 16 === 0)) {
    throw new RangeError('Width and height must be positive integers divisible by 16.');
  }
  const pixels = width * height;
  const aspect = Math.max(width, height) / Math.min(width, height);
  if (pixels < 655360 || pixels > 8294400 || Math.max(width, height) > 3840 || aspect > 3) {
    throw new RangeError('Size must have 655360–8294400 pixels, edges up to 3840, and aspect ratio up to 3:1.');
  }
  const longGrid = qualityEdges[quality];
  if (typeof longGrid !== 'number') throw new RangeError('Unsupported image quality.');
  const shortEdge = longGrid / aspect;
  const floor = Math.floor(shortEdge);
  // The official calculator rounds exact half ties to the nearest even integer.
  const shortGrid = shortEdge - floor === 0.5 ? floor + floor % 2 : Math.round(shortEdge);
  const outputTokens = Math.ceil(longGrid * shortGrid * (2000000 + pixels) / 4000000);
  return {outputTokens, outputCostUsd: outputTokens * IMAGE25_OUTPUT_USD_PER_MILLION / 1000000};
}
