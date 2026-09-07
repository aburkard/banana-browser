export type UsageProvider = 'gemini' | 'openai';

/** Missing provider fields stay undefined; zero means the provider reported zero. */
export interface NormalizedUsage {
  provider: UsageProvider;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  candidateTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  textInputTokens?: number;
  imageInputTokens?: number;
  textOutputTokens?: number;
  imageOutputTokens?: number;
  outputModalityDetailsReported?: boolean;
  cachedTextTokens?: number;
  cachedImageTokens?: number;
}

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' ? value as RecordValue : {};
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

function modality(value: unknown, name: string): number | undefined {
  if (!Array.isArray(value)) return undefined;
  const matching = value.map(record).filter(item => item.modality === name);
  if (!matching.length) return undefined;
  const counts = matching.map(item => count(item.tokenCount));
  return counts.every(value => value !== undefined)
    ? count(counts.reduce<number>((sum, value) => sum + value!, 0)) : undefined;
}

export function normalizeUsage(raw: unknown, provider: UsageProvider): NormalizedUsage {
  const usage = record(raw);
  if (provider === 'gemini') {
    const candidates = count(usage.candidatesTokenCount);
    const thoughts = count(usage.thoughtsTokenCount);
    return {
      provider,
      inputTokens: count(usage.promptTokenCount),
      // Gemini thoughts are separate from candidate tokens, unlike OpenAI reasoning.
      outputTokens: candidates === undefined ? undefined : count(candidates + (thoughts ?? 0)),
      candidateTokens: candidates,
      totalTokens: count(usage.totalTokenCount),
      cachedTokens: count(usage.cachedContentTokenCount),
      reasoningTokens: thoughts,
      textInputTokens: modality(usage.promptTokensDetails, 'TEXT'),
      imageInputTokens: modality(usage.promptTokensDetails, 'IMAGE'),
      textOutputTokens: modality(usage.candidatesTokensDetails, 'TEXT'),
      imageOutputTokens: modality(usage.candidatesTokensDetails, 'IMAGE'),
      cachedTextTokens: modality(usage.cacheTokensDetails, 'TEXT'),
      cachedImageTokens: modality(usage.cacheTokensDetails, 'IMAGE'),
    };
  }
  const input = record(usage.input_tokens_details);
  const output = record(usage.output_tokens_details);
  const cached = record(input.cached_tokens_details);
  return {
    provider,
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    totalTokens: count(usage.total_tokens),
    cachedTokens: count(input.cached_tokens),
    cacheWriteTokens: count(input.cache_write_tokens),
    reasoningTokens: count(output.reasoning_tokens),
    textInputTokens: count(input.text_tokens),
    imageInputTokens: count(input.image_tokens),
    textOutputTokens: count(output.text_tokens),
    imageOutputTokens: count(output.image_tokens),
    outputModalityDetailsReported: 'text_tokens' in output || 'image_tokens' in output,
    cachedTextTokens: count(cached.text_tokens),
    cachedImageTokens: count(cached.image_tokens),
  };
}

/** Rates are dollars per token. Cache rates must be supplied for the exact model. */
export interface UsagePricing {
  input: number;
  output?: number;
  imageInput?: number;
  imageOutput?: number;
  cachedInput?: number;
  cachedImageInput?: number;
  cacheWriteInput?: number;
}

export interface UsageCost {
  inputCost: number;
  outputCost: number;
  cost: number;
  /** False when some usage or a required rate is unknown or inconsistent. */
  complete: boolean;
}

/** Sum only the portions with known counts and rates; never infer a cache discount. */
export function estimateUsageCost(
  usage: NormalizedUsage,
  pricing: UsagePricing,
  type: 'image' | 'text',
): UsageCost {
  let complete = true;
  const price = (tokens: number | undefined, rate: number | undefined): number => {
    const safeTokens = count(tokens);
    if (safeTokens === 0) return 0;
    if (safeTokens === undefined || count(rate) === undefined) {
      complete = false;
      return 0;
    }
    const cost = safeTokens * rate!;
    if (!Number.isFinite(cost)) { complete = false; return 0; }
    return cost;
  };
  const inputTokens = count(usage.inputTokens);
  const cachedTokens = count(usage.cachedTokens);
  const writes = count(usage.cacheWriteTokens);
  // Missing cache counts cannot establish a discount or premium. The ordinary
  // input rate remains an estimate; completeness records that uncertainty.
  if (cachedTokens === undefined || (pricing.cacheWriteInput !== undefined && writes === undefined)) {
    complete = false;
  }
  let inputCost = 0;
  if (pricing.imageInput !== undefined && pricing.imageInput !== pricing.input) {
    const text = count(usage.textInputTokens);
    const image = count(usage.imageInputTokens);
    if (inputTokens === undefined || text === undefined || image === undefined || text + image !== inputTokens) {
      complete = false;
    }
    if ((cachedTokens ?? 0) > 0) {
      const cachedText = count(usage.cachedTextTokens);
      const cachedImage = count(usage.cachedImageTokens);
      if (text !== undefined && image !== undefined && cachedText !== undefined && cachedImage !== undefined &&
          cachedText <= text && cachedImage <= image && cachedText + cachedImage === cachedTokens && !writes) {
        inputCost = price(text - cachedText, pricing.input) + price(image - cachedImage, pricing.imageInput)
          + price(cachedText, pricing.cachedInput) + price(cachedImage, pricing.cachedImageInput);
      } else {
        // A combined cache count cannot be assigned to text versus image prices.
        complete = false;
      }
    } else if ((writes ?? 0) > 0) {
      // No cache-write modality breakdown is available in this usage schema.
      complete = false;
    } else {
      inputCost = price(text, pricing.input) + price(image, pricing.imageInput);
    }
  } else if (inputTokens !== undefined && (cachedTokens ?? 0) + (writes ?? 0) <= inputTokens) {
    inputCost = price(inputTokens - (cachedTokens ?? 0) - (writes ?? 0), pricing.input)
      + price(cachedTokens ?? 0, pricing.cachedInput)
      + price(writes ?? 0, pricing.cacheWriteInput);
  } else {
    complete = false;
  }

  let outputCost: number;
  if (type === 'image' && usage.provider === 'gemini') {
    const text = count(usage.textOutputTokens);
    const image = count(usage.imageOutputTokens);
    const candidates = count(usage.candidateTokens);
    // Candidate totals contain text AND image. Thoughts are billed separately.
    if (candidates === undefined || text === undefined || image === undefined || text + image !== candidates) {
      complete = false;
    }
    outputCost = price(text, pricing.output) + price(image, pricing.imageOutput)
      + price(usage.reasoningTokens, pricing.output);
  } else if (usage.provider === 'gemini') {
    outputCost = price(usage.candidateTokens, pricing.output) + price(usage.reasoningTokens, pricing.output);
  } else if (type === 'image' && (usage.outputModalityDetailsReported ||
      usage.textOutputTokens !== undefined || usage.imageOutputTokens !== undefined)) {
    const text = count(usage.textOutputTokens);
    const image = count(usage.imageOutputTokens);
    const total = count(usage.outputTokens);
    if (total === undefined || text === undefined || image === undefined || text + image !== total) {
      complete = false;
    }
    outputCost = price(text, pricing.output) + price(image, pricing.imageOutput);
  } else {
    // OpenAI output_tokens already includes reasoning; don't add it again.
    // Legacy Images API responses report only the image output total.
    outputCost = price(usage.outputTokens, type === 'image' ? pricing.imageOutput : pricing.output);
  }
  return { inputCost, outputCost, cost: inputCost + outputCost, complete };
}
