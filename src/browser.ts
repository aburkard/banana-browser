import { readImageStream } from './openai-image-stream';
import {estimateGptImageOutputCost} from './image25-cost';
import {discoveryAddress, fetchDiscovery} from './web-discovery';
import {fetchWebpage} from './webpage-fetch';
import { fetchRedditFeed } from './reddit-feed';
import { GoogleGenAI } from "@google/genai";
import { processApiResponse, processHNFrontPage, processHNStoryWithComments } from "./api-processors";
import type { subscriptionGenerate } from './subscription';
import { timed } from './timing';
import { sourceSections } from "./source-sections";
import { sourcePassages } from "./source-passages";
import { compactClickSource } from "./click-source";
import { POKEMON_URL } from "./pokemon";
import { BoundedCache } from './cache';
import { normalizeUsage, estimateUsageCost, type UsagePricing } from './usage';
import { TVMAZE_SEARCH_URL, normalizeExampleApiUrl } from './api-examples';

export interface ModelUsageLine {
  label: string; // display name, e.g. "Nano Banana 2"
  category: "image" | "click";
  calls: number;
  inputTokens: number;
  outputTokens: number;
  inputCost: number; // cost from text + image input tokens
  outputCost: number; // cost from output tokens (text/image output)
  reportedCost?: number; // provider-charged totals without an input/output split (OpenRouter)
  cost: number; // inputCost + outputCost
  costIncomplete?: boolean;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  unknownUsageCalls?: number;
}

export interface UsageStats {
  webCredits?: number;
  webUnknownCalls?: number;
  imageGenerations: number;
  clickInterpretations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number; // in USD
  costIncomplete?: boolean;
  // Per-model breakdown keyed by registry key (e.g. "nano-banana-2.1" or "gpt-6-luna")
  byModel: Record<string, ModelUsageLine>;
}

export interface BrowserState {
  loading: boolean;
  status: string;
  currentUrl: string | null;
  viewTransition: 'up' | 'down' | 'back' | 'forward' | null;
  navigationRevision: number; // Successful navigation/history commits, including the same URL.
  currentImage: string | null;
  previewIndex: number | null;
  previewReceived: number;
  previewRequested: number;
  previewImage: string | null; // base64 data URL
  currentApiData: unknown | null;
  error: string | null;
  usage: UsageStats;
  scrollIndex: number; // Current position in scroll stack (0 = top of page)
  sectionIndex: number;
  sectionCount: number;
  scrollDepth: number; // Total images in scroll stack
}

interface SectionView { source: string; passages?: string[]; images: string[]; scrollIndex: number }

interface HistoryEntry {
  sections: SectionView[];
  sectionIndex: number;
  url: string;
  apiData: unknown;
  images: string[];
  scrollIndex: number;
}

// Bookmarked API endpoints
export const BOOKMARKS = {
  "ESPN NFL News": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news",
  "Hacker News": "https://hacker-news.firebaseio.com/v0/topstories.json",
  "Reddit r/todayilearned": "https://www.reddit.com/r/todayilearned.json",
  "TV shows": TVMAZE_SEARCH_URL,
  "Pokémon": POKEMON_URL,
} as const;

export type Bookmark = keyof typeof BOOKMARKS;

const DEFAULT_HOME_URL = BOOKMARKS["ESPN NFL News"];

// ----- Image generation: per-model option metadata -----

export type Quality = "low" | "medium" | "high" | "xhigh" | "max";
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface SizeOption {
  value: string; // API value: "1K"/"2K"/"4K"/"512" for Gemini, "WxH" for OpenAI
  label: string; // shown in UI
  tokens?: number; // image-output tokens (Gemini) for cost estimate
}

export type ModelProvider = "gemini" | "openai" | "openrouter";

export interface ImageModelSpec {
  provider: ModelProvider;
  model: string;
  name: string;
  sizes: SizeOption[];
  defaultSize: string;
  maxInputImages?: number;
  qualities?: Quality[];
  outputFormats?: ImageOutputFormat[];
  defaultQuality?: Quality;
  thinkingLevels?: ThinkingLevel[];
  defaultThinkingLevel?: ThinkingLevel;
  /** OpenRouter Image API controls sent with every request, and a list-price estimate for the badge. */
  openRouter?: {params: Record<string, string>; estimateUSD: number};
}

/**
 * A curated OpenRouter image model. `maxInputImages` is the endpoint's reference
 * limit (capped at the app's usual six); `estimateUSD` comes from OpenRouter's
 * listed per-image or per-token prices on October 17, 2026. Billing uses usage.cost.
 */
function openRouterImage(model: string, name: string, params: Record<string, string>, maxInputImages: number, estimateUSD: number): ImageModelSpec {
  const size = params.resolution ?? 'auto';
  return {provider: 'openrouter', model, name: `${name} · OpenRouter`, sizes: [{value: size, label: `${params.resolution ?? 'Provider default'}, 3:2`}],
    defaultSize: size, maxInputImages: Math.min(maxInputImages, 6), openRouter: {params, estimateUSD}};
}

export const IMAGE_MODELS: Record<string, ImageModelSpec> = {
  // Gemini 3.1 Flash Lite Image: 1K-only, optimized for latency and cost.
  // Keep input image count low because Lite is not optimized for multiple
  // reference inputs or sequential editing.
  "flash-lite": {
    provider: "gemini",
    model: "gemini-3.1-flash-lite-image",
    name: "Nano Banana 2 Lite",
    sizes: [{ value: "1K", label: "1K (fastest)", tokens: 1120 }],
    defaultSize: "1K",
    maxInputImages: 1,
    thinkingLevels: ["minimal", "high"],
    defaultThinkingLevel: "minimal",
  },
  // Gemini Nano Banana 2.1: no 0.5K; tokens scale with size (1120/1680/3780).
  // The API defaults to medium thinking; minimal was measured in the October 15 bake-off.
  // It accepts 14 input images, but keeps the app's default reference budget.
  "nano-banana-2.1": {
    provider: "gemini",
    model: "gemini-nano-banana-2.1",
    name: "Nano Banana 2.1",
    sizes: [
      { value: "1K", label: "1K (recommended)", tokens: 1120 },
      { value: "2K", label: "2K (sharper)", tokens: 1680 },
      { value: "4K", label: "4K (max)", tokens: 3780 },
    ],
    defaultSize: "1K",
    thinkingLevels: ["minimal", "medium", "high"],
    defaultThinkingLevel: "minimal",
  },
  // Nano Banana 2 (gemini-3.1-flash-image) was removed: Google recommends 2.1,
  // which cost less and garbled less text in the October 15 bake-off.
  // Gemini 3 Pro Image: 1K=2K (same tokens), 4K costs more.
  // Docs say Pro variants do NOT support thinkingLevel: "minimal" — omit it.
  pro: {
    provider: "gemini",
    model: "gemini-3-pro-image",
    name: "Nano Banana Pro",
    sizes: [
      { value: "1K", label: "1K", tokens: 1120 },
      { value: "2K", label: "2K (free upgrade)", tokens: 1120 },
      { value: "4K", label: "4K (~80% more $)", tokens: 2000 },
    ],
    defaultSize: "2K",
    thinkingLevels: ["low", "medium", "high"],
    defaultThinkingLevel: "high",
  },
  "gpt-image-2.5-flare": {
    provider: "openai", model: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare",
    sizes: [
      {value:"1024x1024",label:"1024×1024 (square)"},
      {value:"1536x1024",label:"1536×1024"},
      {value:"1920x1280",label:"1920×1280 (recommended)"},
      {value:"2560x1440",label:"2560×1440 (wide)"},
      {value:"3840x2160",label:"3840×2160 (experimental)"},
    ], defaultSize:"1920x1280", qualities:["low","medium","high","xhigh","max"], defaultQuality:"low",
    outputFormats:['png','jpeg','webp'],
  },
  "gpt-image-2.5-sunburst": {
    provider: "openai", model: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst",
    sizes: [
      {value:"1024x1024",label:"1024×1024 (square)"},
      {value:"1536x1024",label:"1536×1024"},
      {value:"1920x1280",label:"1920×1280 (recommended)"},
      {value:"2560x1440",label:"2560×1440 (wide)"},
      {value:"3840x2160",label:"3840×2160 (experimental)"},
    ], defaultSize:"1920x1280", qualities:["low","medium","high","xhigh","max"], defaultQuality:"low",
    outputFormats:['png','jpeg','webp'],
  },
  // OpenAI GPT Image 2: arbitrary sizes supported.
  // Low quality is empirically indistinguishable from medium for this app's
  // webpage-rendering use case and 8x cheaper, so low is the default.
  "gpt-image-2": {
    provider: "openai",
    model: "gpt-image-2",
    name: "GPT Image 2",
    sizes: [
      { value: "1536x1024", label: "1536×1024 (cheap)" },
      { value: "1920x1280", label: "1920×1280 (recommended)" },
      { value: "2304x1536", label: "2304×1536 (premium)" },
    ],
    defaultSize: "1920x1280",
    qualities: ["low", "medium", "high"],
    defaultQuality: "low",
  },
  // GPT Image 1.5 and 1 Mini were removed ahead of OpenAI's December 1, 2026 shutdown.

  // OpenRouter: the app's own defaults when there is no direct key for that provider, plus
  // fast models from other providers. Flare and Nano Banana 2.1 were measured in the
  // October 15 bake-off; the others are listed for trying and are not yet measured here.
  "openrouter:openai/gpt-image-2.5-flare": openRouterImage("openai/gpt-image-2.5-flare", "GPT Image 2.5 Flare", {aspect_ratio: "3:2", quality: "low"}, 16, 0.015),
  "openrouter:google/gemini-nano-banana-2.1": openRouterImage("google/gemini-nano-banana-2.1", "Nano Banana 2.1", {resolution: "1K", aspect_ratio: "3:2"}, 14, 0.036),
  "openrouter:bytedance-seed/seedream-5-0-flash": openRouterImage("bytedance-seed/seedream-5-0-flash", "Seedream 5.0 Flash", {resolution: "1K", aspect_ratio: "3:2"}, 14, 0.018),
  "openrouter:microsoft/mai-image-2.6-flash": openRouterImage("microsoft/mai-image-2.6-flash", "MAI-Image-2.6-Flash", {aspect_ratio: "3:2"}, 5, 0.03),
  "openrouter:qwen/qwen-image-3": openRouterImage("qwen/qwen-image-3", "Qwen-Image-3", {resolution: "1K", aspect_ratio: "3:2"}, 4, 0.04),
  "openrouter:x-ai/grok-imagine-image-2.0": openRouterImage("x-ai/grok-imagine-image-2.0", "Grok Imagine Image 2.0", {resolution: "1K", aspect_ratio: "3:2", quality: "low"}, 3, 0.07),
  "openrouter:black-forest-labs/flux-3-image": openRouterImage("black-forest-labs/flux-3-image", "FLUX 3 Image", {resolution: "1K", aspect_ratio: "3:2"}, 10, 0.048),
};

export type ImageModel = keyof typeof IMAGE_MODELS;

export interface ImageOptions {
  size: string;
  quality?: Quality;
  thinkingLevel?: ThinkingLevel;
  partialImages?: number;
  outputFormat?: ImageOutputFormat;
}

export function defaultImageOptions(modelKey: ImageModel): ImageOptions {
  const spec = IMAGE_MODELS[modelKey];
  return {
    size: spec.defaultSize,
    quality: spec.defaultQuality,
    thinkingLevel: spec.defaultThinkingLevel,
    partialImages: 0,
    ...(spec.outputFormats ? {outputFormat:'png' as const} : {}),
  };
}

// Assumed input prompt size for badge estimates. Real values land near this for
// the app's webpage-rendering prompts (style boilerplate + truncated API JSON).
const ASSUMED_INPUT_TOKENS = 1500;

export interface ImageCostEstimate {
  input: number;
  output: number;
  total: number;
}

/** Estimate $/image for the given model + options. Returns null if unknown. */
export function estimateImageCost(
  modelKey: ImageModel,
  opts: ImageOptions
): ImageCostEstimate | null {
  const spec = IMAGE_MODELS[modelKey];

  // OpenRouter bills its own reported cost; the badge shows the list-price estimate.
  if (spec.openRouter) return {input: 0, output: spec.openRouter.estimateUSD, total: spec.openRouter.estimateUSD};

  // Every OpenAI image model uses the official guide's token calculator (image25-cost.ts).
  if (spec.provider === 'openai') {
    const [width,height] = opts.size.split('x').map(Number);
    let estimate;
    try { estimate = estimateGptImageOutputCost(modelKey === 'gpt-image-2' ? 'gpt-image-2' : 'gpt-image-2.5',width,height,opts.quality || spec.defaultQuality!); }
    catch { return null; }
    const input = ASSUMED_INPUT_TOKENS * 5 / 1_000_000;
    const output = estimate.outputCostUsd + (opts.partialImages ?? 0) * 100 * 30 / 1_000_000;
    return {input,output,total:input+output};
  }

  if (spec.provider === "gemini") {
    const sizeOpt = spec.sizes.find((s) => s.value === opts.size);
    if (!sizeOpt?.tokens) return null;
    const pricing = BananaBrowser.PRICING[modelKey as keyof typeof BananaBrowser.PRICING] as
      | { input: number; imageOutput: number }
      | undefined;
    if (!pricing?.imageOutput) return null;
    const input = ASSUMED_INPUT_TOKENS * pricing.input;
    const output = sizeOpt.tokens * pricing.imageOutput;
    return { input, output, total: input + output };
  }
  return null;
}

// ----- Click interpretation models -----

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ClickModelSpec {
  provider: ModelProvider;
  model: string;
  name: string;
  // Either reasoning effort (OpenAI) or thinking level (Gemini 3.x)
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  thinkingLevels?: ThinkingLevel[];
  defaultThinkingLevel?: ThinkingLevel;
}

// Current-generation models only. October 16, 2026 click check (12 headline clicks each):
// 3.8 Flash and 4 Argon 12/12, 3.5 Flash-Lite 10/12 (wrong story twice), Argon ~6 s median.
export const CLICK_MODELS: Record<string, ClickModelSpec> = {
  "gemini-3.5-flash-lite": {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite ($)",
    thinkingLevels: ["minimal", "low", "medium", "high"],
    defaultThinkingLevel: "minimal",
  },
  "gemini-3.8-flash": {
    provider: "gemini",
    model: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash ($$)",
    // Unlike earlier Flash models, 3.8 rejects "minimal".
    thinkingLevels: ["low", "medium", "high"],
    defaultThinkingLevel: "low",
  },
  "gemini-4-argon": {
    provider: "gemini",
    model: "gemini-4-argon",
    name: "Gemini 4 Argon ($$$)",
    // Thinking cannot be disabled; "minimal" is rejected.
    thinkingLevels: ["low", "medium", "high"],
    defaultThinkingLevel: "low",
  },
  "gpt-6-luna": {
    provider: "openai",
    model: "gpt-6-luna",
    name: "GPT-6 Luna ($)",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "low",
  },
  "gpt-6.1-sol": {
    provider: "openai",
    model: "gpt-6.1-sol",
    name: "GPT-6.1 Sol ($$$)",
    // Sol and Astra reject "none".
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "low",
  },
  "gpt-6-astra": {
    provider: "openai",
    model: "gpt-6-astra",
    name: "GPT-6 Astra ($$$$)",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "low",
  },
  // Removed as superseded: Gemini 3.1 Flash-Lite, 3 Flash (legacy preview), 3.1 Pro
  // (preview; 4 Argon replaces it), GPT-5.4 and GPT-5.4 Mini (GPT-6 replaces them),
  // GPT-5.6 Luna and Terra (the ChatGPT plan now offers GPT-6).

  // OpenRouter chat completions with image input. Effort lists are each model's
  // supported_efforts from OpenRouter's model list (October 17, 2026); "low" keeps clicks fast.
  "openrouter:openai/gpt-6-luna": {provider: "openrouter", model: "openai/gpt-6-luna", name: "GPT-6 Luna · OpenRouter ($)",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "low"},
  "openrouter:anthropic/claude-haiku-5.5": {provider: "openrouter", model: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5 · OpenRouter ($)",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "low"},
  "openrouter:google/gemini-3.8-flash": {provider: "openrouter", model: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash · OpenRouter ($$)",
    reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "low"},
  "openrouter:anthropic/claude-sonnet-5.5": {provider: "openrouter", model: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5 · OpenRouter ($$$)",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "low"},
  "openrouter:google/gemini-4-argon": {provider: "openrouter", model: "google/gemini-4-argon", name: "Gemini 4 Argon · OpenRouter ($$$)",
    reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "low"},
  "openrouter:x-ai/grok-4.7": {provider: "openrouter", model: "x-ai/grok-4.7", name: "Grok 4.7 · OpenRouter ($$$)",
    reasoningEfforts: ["low", "medium", "high", "xhigh"], defaultReasoningEffort: "low"},
};

export type ClickModel = keyof typeof CLICK_MODELS;

// Click models on the ChatGPT plan. Codex's model list for a ChatGPT account
// (October 17, 2026) includes all three, with image input.
export const PLAN_CLICK_MODELS: ClickModel[] = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'];

// GPT-5.6 and later accept explicit prompt-cache breakpoints (and bill cache writes).
const EXPLICIT_CACHE_CLICK_MODELS = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'];
// OpenAI long-context pricing (>272K input tokens) applies to the full request.
const LONG_CONTEXT_272K_MODELS = EXPLICIT_CACHE_CLICK_MODELS;

export interface ClickOptions {
  reasoningEffort?: ReasoningEffort;
  thinkingLevel?: ThinkingLevel;
}

export function defaultClickOptions(modelKey: ClickModel): ClickOptions {
  const spec = CLICK_MODELS[modelKey];
  return {
    reasoningEffort: spec.defaultReasoningEffort,
    thinkingLevel: spec.defaultThinkingLevel,
  };
}

// Style presets
export const STYLE_PRESETS = {
  modern: "A modern, clean, professional website with good typography and spacing",
  geocities:
    "90s Geocities style with animated GIFs, bright colors, comic sans, starry backgrounds, under construction signs, visitor counters, and marquee text",
  brutalist:
    "Brutalist web design with raw HTML aesthetic, monospace fonts, stark black and white, no images, dense text",
  vaporwave:
    "Vaporwave aesthetic with pink/cyan/purple gradients, retro 80s graphics, glitch effects, Japanese text, marble busts",
  newspaper:
    "Classic newspaper layout with serif fonts, columns, black and white, headline hierarchy like New York Times",
  hacker: "Dark hacker terminal aesthetic with green text on black, monospace font, command line interface look",
} as const;

export type StylePreset = keyof typeof STYLE_PRESETS;

/** Providers can answer with an HTML error page; keep the status rather than a JSON parse error or the page. */
async function openAIError(response: Response, provider = 'OpenAI') {
  let message: unknown;
  try { message = JSON.parse(await response.text())?.error?.message; } catch { /* non-JSON or unreadable body */ }
  return new Error(typeof message === 'string' && message ? message : `${provider} API error: ${response.status} ${response.statusText}`.trim());
}

const OPENROUTER_API = 'https://openrouter.ai/api/v1';

export class BananaBrowser {
  private imageCache = new BoundedCache<string>(32 * 1024 * 1024, 16);
  private referenceCache = new BoundedCache<{dataUrl: string; mimeType: string}>(16 * 1024 * 1024, 24, 5 * 60_000);
  private geminiAI: GoogleGenAI | null = null;
  private openaiApiKey: string | null = null;
  private openrouterApiKey: string | null = null;
  private currentModelKey: ImageModel = "flash-lite";
  private imageOptions: ImageOptions = defaultImageOptions("flash-lite");
  private currentClickModelKey: ClickModel = "gemini-3.8-flash";
  private clickOptions: ClickOptions = defaultClickOptions("gemini-3.8-flash");
  private currentStyle: string = STYLE_PRESETS.modern;
  private state: BrowserState = {
    loading: false,
    status: "Ready",
    currentUrl: null,
    navigationRevision: 0,
    viewTransition: null,
    currentImage: null,
    previewIndex: null,
    previewReceived: 0,
    previewRequested: 0,
    previewImage: null,
    currentApiData: null,
    error: null,
    usage: {
      imageGenerations: 0,
      clickInterpretations: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCost: 0,
      byModel: {},
    },
    scrollIndex: 0,
    scrollDepth: 1,
    sectionIndex: 0,
    sectionCount: 1,
  };
  private history: HistoryEntry[] = [];
  private historyIndex: number = -1;
  private navigating = false;
  // Session image context - passed to model for design continuity
  // Reset when user presses Go, kept during clicks/scrolls/style changes
  private sessionImage: string | null = null;
  // True when the session image includes click pointer overlay
  private sessionClickContext: boolean = false;
  // Stack of images for current page scroll (index 0 = top of page)
  private scrollStack: string[] = [];
  private sections: SectionView[] = [];
  private activeSource: string | null = null;
  // True when generating a scroll-down image
  private isScrollingDown: boolean = false;

  onStateChange: (state: BrowserState) => void = () => {};

  constructor(geminiApiKey?: string, openaiApiKey?: string, model: ImageModel = "flash-lite", private subscription?: typeof subscriptionGenerate, openrouterApiKey?: string) {
    if (geminiApiKey) {
      this.geminiAI = new GoogleGenAI({ apiKey: geminiApiKey });
    }
    if (openaiApiKey) {
      this.openaiApiKey = openaiApiKey;
    }
    if (openrouterApiKey) {
      this.openrouterApiKey = openrouterApiKey;
    }
    this.currentModelKey = model;
    this.imageOptions = defaultImageOptions(model);
    // Prefer Gemini 3.8 Flash for clicks: it matched the old Gemini 3 Flash default (12/12 clicks).
    // Without a Gemini key, use it through OpenRouter when possible; otherwise GPT-6 Luna.
    this.currentClickModelKey = subscription ? "gpt-6-luna" : geminiApiKey ? "gemini-3.8-flash"
      : openrouterApiKey ? "openrouter:google/gemini-3.8-flash" : "gpt-6-luna";
    this.clickOptions = defaultClickOptions(this.currentClickModelKey);
  }

  private hasKeyFor(provider: ModelProvider) {
    return provider === "gemini" ? !!this.geminiAI : provider === "openai" ? !!this.openaiApiKey || !!this.subscription : !!this.openrouterApiKey;
  }

  setModel(model: ImageModel) {
    if (this.state.loading) return;
    if (this.subscription && !['gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(model)) return;
    const modelConfig = IMAGE_MODELS[model];
    // Check if we have the required API key for this model
    if (!this.hasKeyFor(modelConfig.provider)) {
      console.warn(`[BananaBrowser] Cannot use ${modelConfig.name} without a ${modelConfig.provider} key`);
      return;
    }
    this.currentModelKey = model;
    this.imageOptions = defaultImageOptions(model);
    console.log("[BananaBrowser] Switched to model:", modelConfig.name);
  }

  setImageOptions(opts: Partial<ImageOptions>) {
    if (this.state.loading) return;
    if (opts.partialImages !== undefined && (!Number.isInteger(opts.partialImages) || opts.partialImages < 0 || opts.partialImages > 3)) {
      throw new RangeError('Preview count must be an integer from 0 to 3');
    }
    if (opts.outputFormat !== undefined && !IMAGE_MODELS[this.currentModelKey].outputFormats?.includes(opts.outputFormat)) throw new RangeError('Unsupported image output format');
    this.imageOptions = { ...this.imageOptions, ...opts };
  }

  getImageOptions(): ImageOptions {
    return { ...this.imageOptions };
  }

  setClickModel(model: ClickModel) {
    if (this.state.loading) return;
    if (this.subscription && !PLAN_CLICK_MODELS.includes(model)) return;
    const spec = CLICK_MODELS[model];
    if (!this.hasKeyFor(spec.provider)) {
      console.warn(`[BananaBrowser] Cannot use ${spec.name} without a ${spec.provider} key`);
      return;
    }
    this.currentClickModelKey = model;
    this.clickOptions = defaultClickOptions(model);
  }

  getClickModel(): ClickModel {
    return this.currentClickModelKey;
  }

  setClickOptions(opts: Partial<ClickOptions>) {
    if (this.state.loading) return;
    this.clickOptions = { ...this.clickOptions, ...opts };
  }

  getClickOptions(): ClickOptions {
    return { ...this.clickOptions };
  }

  setOpenAIKey(apiKey: string) {
    this.openaiApiKey = apiKey;
    console.log("[BananaBrowser] OpenAI API key updated");
  }

  setGeminiKey(apiKey: string) {
    this.geminiAI = new GoogleGenAI({ apiKey });
    console.log("[BananaBrowser] Gemini API key updated");
  }

  getCurrentModel(): ImageModel {
    return this.currentModelKey;
  }

  setStyle(style: StylePreset | string) {
    if (this.state.loading) return;
    // Accept either a preset key or custom string
    if (style in STYLE_PRESETS) {
      this.currentStyle = STYLE_PRESETS[style as StylePreset];
    } else {
      this.currentStyle = style;
    }
    console.log("[BananaBrowser] Switched to style:", this.currentStyle);
  }

  getScrollIndex(): number {
    return this.state.scrollIndex;
  }

  canScrollUp(): boolean {
    return this.state.scrollIndex > 0;
  }

  canScrollDown(): boolean {
    const passages = this.sections[this.state.sectionIndex]?.passages;
    return !passages || this.state.scrollIndex + 1 < passages.length;
  }

  getStylePresets() {
    return STYLE_PRESETS;
  }

  private updateState(partial: Partial<BrowserState>) {
    const previewSummary = this.state.loading && partial.loading === false && !partial.error && partial.currentImage && this.state.previewRequested > 0
      ? {status: `${partial.status ?? this.state.status} · ${this.state.previewReceived}/${this.state.previewRequested} previews received`} : {};
    this.state = { ...this.state, ...((partial.loading || partial.error) ? {viewTransition: null} : {}),
      ...(partial.loading ? {previewIndex: null, previewReceived: 0, previewRequested: 0} : {}),
      ...partial, ...previewSummary, ...(partial.loading === false ? {previewImage: null, previewIndex: null} : {}) };
    this.onStateChange(this.state);
  }

  /**
   * Log an image to the console as a visual thumbnail
   */
  private logImage(dataUrl: string) {
    const img = new Image();
    img.onload = () => {
      // Scale down for console display
      const maxWidth = 200;
      const scale = Math.min(1, maxWidth / img.width);
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      console.log(
        "%c ",
        `
          font-size: 1px;
          padding: ${height / 2}px ${width / 2}px;
          background: url(${dataUrl}) no-repeat center;
          background-size: ${width}px ${height}px;
        `
      );
    };
    img.src = dataUrl;
  }

  /**
   * Fetch images from URLs and convert to base64 data URLs
   * Returns array of successfully fetched images (skips failures)
   */
  private async fetchReferenceImages(
    imageInfo: { url: string; description: string }[],
    maxImages: number = 5
  ): Promise<{ dataUrl: string; mimeType: string; description: string }[]> {
    const unique = new Map<string, string>();
    for (const info of imageInfo) {
      const previous = unique.get(info.url);
      unique.set(info.url, previous && previous !== info.description ? `${previous}; ${info.description}` : info.description);
    }
    const inputs = [...unique].slice(0, maxImages);
    const results: ({dataUrl: string; mimeType: string; description: string} | undefined)[] = new Array(inputs.length);
    let next = 0;
    const worker = async () => {
      while (next < inputs.length) {
        const index = next++;
        const [url, description] = inputs[index];
        try {
          let image = this.referenceCache.get(url);
          if (!image) {
            const response = await fetch(url, {signal: AbortSignal.timeout(15_000)});
            if (!response.ok) continue;
            const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) { await response.body?.cancel(); continue; }
            const reader = response.body?.getReader();
            if (!reader) continue;
            const chunks: Uint8Array[] = [];
            let length = 0;
            try {
              while (true) {
                const {value, done} = await reader.read();
                if (done) break;
                length += value.length;
                if (length > 8 * 1024 * 1024) throw new Error('Reference image too large');
                chunks.push(value);
              }
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            image = {dataUrl: `data:${mimeType};base64,${btoa(binary)}`, mimeType};
            this.referenceCache.set(url, image, image.dataUrl.length * 2);
          }
          results[index] = {...image, description};
        } catch { console.warn('[BananaBrowser] A reference image was unavailable.'); }
      }
    };
    await Promise.all(Array.from({length: Math.min(3, inputs.length)}, worker));
    return results.filter((image): image is NonNullable<typeof image> => image !== undefined);
  }

  /**
   * Extract image info (URL + description) from API data
   */
  private extractImageInfo(apiData: unknown): { url: string; description: string }[] {
    if (!apiData || typeof apiData !== "object") return [];
    const data = apiData as Record<string, unknown>;

    // Section fragments keep record paths and identity alongside split content.
    if (Array.isArray(data.blocks) && data.blocks.every(block => block && typeof block === 'object' && Array.isArray(block.path) && 'value' in block)) {
      return data.blocks.flatMap((block: {value?: unknown; context?: Record<string, unknown>; path?: (string | number)[]}) => {
        const record = block.value && typeof block.value === 'object' && !Array.isArray(block.value)
          ? {...block.context, ...block.value} : {...block.context};
        const key = block.path?.[block.path.length - 1];
        if (typeof key === 'string') record[key] = block.value;
        return this.extractImageInfo(record.imageUrl ? {article: record} : record);
      });
    }

    if (data.source === 'Web') {
      const references = typeof data.imageUrl === 'string' ? [{url:data.imageUrl,description:typeof data.imageCaption === 'string' ? data.imageCaption : 'Original site reference'}] : [];
      const photos = Array.isArray(data.imageUrls) ? data.imageUrls.filter((url): url is string => typeof url === 'string').slice(0,5)
        .map(url=>({url,description:typeof data.title === 'string' ? data.title : 'Page image'})) : [];
      return [...references,...photos].slice(0,5);
    }

    // Processed detail pages use a single article rather than an articles array.
    if (data.article && typeof data.article === 'object') {
      const article = data.article as {imageUrl?: string; imageCaption?: string; headline?: string};
      const urls = [article.imageUrl, ...(Array.isArray(data.imageUrls) ? data.imageUrls : [])];
      return [...new Set(urls.filter((url): url is string => typeof url === 'string' && !!url))]
        .slice(0, 5).map(url => ({url, description: article.imageCaption || article.headline || 'Article image'}));
    }

    // Processed ESPN news listing format
    if ("articles" in data && Array.isArray(data.articles)) {
      const articles = data.articles as Array<{
        headline?: string;
        imageUrl?: string;
        images?: Array<{ url?: string; type?: string; caption?: string; alt?: string }>;
      }>;
      const results: { url: string; description: string }[] = [];
      for (const article of articles) {
        // Check for processed format (imageUrl) or raw format (images array)
        if (article.imageUrl) {
          results.push({
            url: article.imageUrl,
            description: article.headline || "Article image",
          });
        } else if (article.images && Array.isArray(article.images)) {
          const headerImg = article.images.find((img) => img.type === "header");
          const firstImg = article.images[0];
          const img = headerImg || firstImg;
          if (img?.url) {
            results.push({
              url: img.url,
              description: img.caption || img.alt || article.headline || "Article image",
            });
          }
        }
      }
      return results.slice(0, 5);
    }

    // Raw ESPN article format (has headlines[].images[])
    if ("headlines" in data && Array.isArray(data.headlines)) {
      const headlines = data.headlines as Array<{
        headline?: string;
        images?: Array<{ url?: string; caption?: string; alt?: string }>;
      }>;
      const results: { url: string; description: string }[] = [];
      for (const headline of headlines) {
        if (headline.images && Array.isArray(headline.images)) {
          for (const img of headline.images) {
            if (img.url) {
              results.push({
                url: img.url,
                description: img.caption || img.alt || headline.headline || "Content image",
              });
            }
          }
        }
      }
      return results.slice(0, 5);
    }

    return [];
  }

  // USD per token, standard processing. Verified 2026-09-05; see docs/pricing.md.
  // Public so the UI can estimate costs.
  static readonly PRICING = {
    // Gemini 3.1 Flash Lite Image (Nano Banana 2 Lite)
    "flash-lite": {
      input: 0.25 / 1_000_000, // $0.25 per 1M input tokens (text/image/video)
      output: 1.5 / 1_000_000, // $1.50 per 1M output tokens (text/thinking)
      imageOutput: 30 / 1_000_000, // $30 per 1M tokens. 1K output consumes 1120 tokens (~$0.034/image)
    },
    // Gemini Nano Banana 2.1
    "nano-banana-2.1": {
      input: 1.5 / 1_000_000, // $1.50 per 1M input tokens (text/image)
      output: 7.5 / 1_000_000, // $7.50 per 1M output tokens (text/thinking)
      imageOutput: 30 / 1_000_000, // $30 per 1M tokens: 1K=1120 ($0.0336), 2K=1680 ($0.0504), 4K=3780 ($0.113)
    },
    // Gemini 3 Pro Image (Nano Banana Pro)
    pro: {
      input: 2.0 / 1_000_000, // $2.00 per 1M input tokens
      output: 12.0 / 1_000_000, // $12.00 per 1M output tokens (text/thinking)
      imageOutput: 120 / 1_000_000, // $120 per 1M tokens for image output (~1120 tokens = ~$0.134)
    },
    "gpt-image-2.5-flare": {input:5/1_000_000,imageInput:8/1_000_000,cachedInput:1.25/1_000_000,cachedImageInput:2/1_000_000,imageOutput:30/1_000_000},
    "gpt-image-2.5-sunburst": {input:5/1_000_000,imageInput:8/1_000_000,cachedInput:1.25/1_000_000,cachedImageInput:2/1_000_000,imageOutput:30/1_000_000},
    // OpenAI GPT Image 2
    "gpt-image-2": {
      input: 5.0 / 1_000_000, // $5.00 per 1M text input tokens
      imageInput: 8.0 / 1_000_000, // $8.00 per 1M image input tokens
      cachedInput: 1.25 / 1_000_000,
      cachedImageInput: 2 / 1_000_000,
      imageOutput: 30.0 / 1_000_000, // $30.00 per 1M image output tokens (~$0.06 medium at 1920x1280)
    },
    // ----- Click-interpretation text/vision models -----
    // Gemini (text/vision)
    "gemini-3.5-flash-lite": {
      cachedInput: 0.03 / 1_000_000,
      input: 0.3 / 1_000_000,
      output: 2.5 / 1_000_000,
    },
    "gemini-3.8-flash": {
      get cachedInput() {
        return (Date.now() < Date.UTC(2027, 0, 1) ? 0.075 : 0.15) / 1_000_000;
      },
      // The published promotion ends January 1, 2027 (UTC for estimates).
      // Getters also handle a browser session left open across the cutoff.
      get input() {
        return (Date.now() < Date.UTC(2027, 0, 1) ? 0.75 : 1.5) / 1_000_000;
      },
      get output() {
        return (Date.now() < Date.UTC(2027, 0, 1) ? 3.75 : 7.5) / 1_000_000;
      },
    },
    // Introductory prices double on December 1, 2026 (UTC for estimates).
    // Implicit caching only; no long-context tier is published.
    "gemini-4-argon": {
      get cachedInput() {
        return (Date.now() < Date.UTC(2026, 11, 1) ? 0.1 : 0.2) / 1_000_000;
      },
      get input() {
        return (Date.now() < Date.UTC(2026, 11, 1) ? 2 : 4) / 1_000_000;
      },
      get output() {
        return (Date.now() < Date.UTC(2026, 11, 1) ? 10 : 20) / 1_000_000;
      },
    },
    // GPT-6: cache writes cost 1.25x input; above 272K input tokens see trackUsage.
    "gpt-6-luna": {
      input: 0.1 / 1_000_000,
      cachedInput: 0.01 / 1_000_000,
      cacheWriteInput: 0.125 / 1_000_000,
      output: 0.5 / 1_000_000,
    },
    "gpt-6.1-sol": {
      input: 2 / 1_000_000,
      cachedInput: 0.1 / 1_000_000,
      cacheWriteInput: 2.5 / 1_000_000,
      output: 10 / 1_000_000,
    },
    "gpt-6-astra": {
      input: 10 / 1_000_000,
      cachedInput: 1 / 1_000_000,
      cacheWriteInput: 12.5 / 1_000_000,
      output: 50 / 1_000_000,
    },
  };

  /** Count every dispatched request once, even if its usage response is lost. */
  private async withUsage<T>(type: "image" | "text", request: () => Promise<T>, usage: (result: T) => unknown): Promise<T> {
    let result: T;
    try { result = await request(); }
    catch (error) { this.trackUsage(type); throw error; }
    this.trackUsage(type, usage(result));
    return result;
  }

  /** One OpenRouter call; the key goes only to the fixed OpenRouter API origin. */
  private async openRouterRequest(type: "image" | "text", path: "/images" | "/chat/completions", body: object, timeoutMs: number) {
    return this.withUsage(type, async () => {
      const response = await fetch(`${OPENROUTER_API}${path}`, {
        method: "POST", credentials: "omit",
        headers: {Authorization: `Bearer ${this.openrouterApiKey}`, "Content-Type": "application/json", "X-Title": "Banana Browser"},
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw await openAIError(response, "OpenRouter");
      return response.json();
    }, data => data?.usage);
  }

  /** OpenRouter Image API: references then the previous page, as for OpenAI edits. */
  private async generateWithOpenRouter(prompt: string, referenceImages: { dataUrl: string; mimeType: string; description: string }[] = []): Promise<string> {
    if (!this.openrouterApiKey) throw new Error("OpenRouter API key not configured");
    const spec = IMAGE_MODELS[this.currentModelKey];
    const images = [...referenceImages.map(image => image.dataUrl), ...(this.sessionImage ? [this.sessionImage] : [])];
    const data = await this.openRouterRequest("image", "/images", {
      model: spec.model, prompt, n: 1, ...spec.openRouter?.params,
      ...(images.length ? {input_references: images.map(url => ({type: "image_url", image_url: {url}}))} : {}),
    }, 180_000);
    const image = data?.data?.[0];
    if (typeof image?.b64_json !== "string" || !image.b64_json) throw new Error("OpenRouter returned no image. Try again or choose another model.");
    const mediaType = typeof image.media_type === "string" && /^image\/(png|jpeg|webp)$/.test(image.media_type) ? image.media_type : "image/png";
    return `data:${mediaType};base64,${image.b64_json}`;
  }

  private async openAIRequest(type: "image" | "text", url: string, init: RequestInit) {
    return this.withUsage(type, async () => {
      const response = await fetch(url, init);
      if (!response.ok) throw await openAIError(response);
      return response.json();
    }, data => data?.usage);
  }

  private async openAIImageRequest(url: string, init: RequestInit) {
    this.updateState({previewImage: null, previewIndex: null, previewReceived: 0, previewRequested: this.imageOptions.partialImages ?? 0});
    try {
      return await this.withUsage('image', async () => {
        const response = await fetch(url, {...init, signal: AbortSignal.timeout(180_000)});
        if (!response.ok) throw await openAIError(response);
        if (response.headers.get('content-type')?.includes('text/event-stream')) {
          return readImageStream(response, (previewImage, previewIndex) => this.updateState({previewImage, previewIndex, previewReceived: this.state.previewReceived + 1}), this.imageOptions.outputFormat);
        }
        return response.json();
      }, data => data?.usage);
    } finally {
      this.updateState({previewImage: null});
    }
  }

  private trackUsage(type: "image" | "text", usageMetadata?: unknown) {
    const isImage = type === "image";
    const modelKey = isImage ? this.currentModelKey : this.currentClickModelKey;
    const model = isImage ? IMAGE_MODELS[modelKey] : CLICK_MODELS[modelKey];
    const usage = normalizeUsage(usageMetadata, model.provider);
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    let pricing: UsagePricing = BananaBrowser.PRICING[modelKey as keyof typeof BananaBrowser.PRICING];
    if (LONG_CONTEXT_272K_MODELS.includes(modelKey) && inputTokens > 272_000) {
      pricing = {...pricing, input: pricing.input * 2,
        cachedInput: pricing.cachedInput === undefined ? undefined : pricing.cachedInput * 2,
        cacheWriteInput: pricing.cacheWriteInput === undefined ? undefined : pricing.cacheWriteInput * 2,
        output: pricing.output === undefined ? undefined : pricing.output * 1.5};
    }
    const estimate = pricing ? estimateUsageCost(usage, pricing, type)
      : {inputCost: 0, outputCost: 0, cost: 0, complete: false};
    // OpenRouter reports the charged total, which replaces any token-rate estimate.
    const reportedCost = model.provider === "openrouter" ? usage.reportedCost ?? 0 : 0;
    const inputCost = this.subscription ? 0 : estimate.inputCost;
    const outputCost = this.subscription ? 0 : estimate.outputCost;
    const costIncrement = inputCost + outputCost + reportedCost;
    const costIncomplete = model.provider === "openrouter" ? usage.reportedCost === undefined
      : !this.subscription && !estimate.complete;

    if (isImage) this.state.usage.imageGenerations++;
    else this.state.usage.clickInterpretations++;
    this.state.usage.totalInputTokens += inputTokens;
    this.state.usage.totalOutputTokens += outputTokens;
    this.state.usage.estimatedCost += costIncrement;
    this.state.usage.costIncomplete ||= costIncomplete;

    const line = this.state.usage.byModel[modelKey] ??= {
      label: model.name, category: isImage ? "image" : "click", calls: 0,
      inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, cost: 0,
    };
    line.calls++;
    line.inputTokens += inputTokens;
    line.outputTokens += outputTokens;
    line.inputCost += inputCost;
    line.outputCost += outputCost;
    if (model.provider === "openrouter") line.reportedCost = (line.reportedCost ?? 0) + reportedCost;
    line.cost += costIncrement;
    line.costIncomplete ||= costIncomplete;
    if (usage.inputTokens === undefined || usage.outputTokens === undefined) {
      line.unknownUsageCalls = (line.unknownUsageCalls ?? 0) + 1;
    }
    for (const field of ['cachedTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
      if (usage[field] !== undefined) line[field] = (line[field] ?? 0) + usage[field];
    }
    this.updateState({});
    console.log("[BananaBrowser] Usage tracked:", {
      type, model: model.model, inputTokens, outputTokens,
      cachedTokens: usage.cachedTokens, reasoningTokens: usage.reasoningTokens,
      costIncrement: `$${costIncrement.toFixed(4)}`, costIncomplete,
      totalCost: `$${this.state.usage.estimatedCost.toFixed(4)}`,
    });
  }

  private recordWebUsage(usage: {credits:number|null;cached:boolean}) {
    this.updateState({usage:{...this.state.usage,
      webCredits:(this.state.usage.webCredits || 0)+(usage.credits || 0),
      webUnknownCalls:(this.state.usage.webUnknownCalls || 0)+(usage.credits === null ? 1 : 0)}});
  }

  private async fetchApiData(url: string): Promise<unknown> {
    const discovery = discoveryAddress(url);
    if (discovery) return fetchDiscovery(discovery.kind,discovery.input,usage=>this.recordWebUsage(usage));
    // Special handling for Hacker News
    if (url.includes("hacker-news.firebaseio.com")) {
      if (url.includes("topstories")) {
        return this.fetchHackerNews();
      }
      // Single item (story with comments)
      const itemMatch = url.match(/\/item\/(\d+)\.json/);
      if (itemMatch) {
        return this.fetchHackerNewsItem(parseInt(itemMatch[1]));
      }
    }

    // Public Reddit feeds are fetched by the backend to avoid browser CORS.
    const hostname = new URL(url).hostname;
    const isReddit = hostname === 'reddit.com' || hostname.endsWith('.reddit.com');
    if (isReddit) return fetchRedditFeed(url);
    const knownApi = ['hacker-news.firebaseio.com','site.api.espn.com','content.core.api.espn.com','api.tvmaze.com','api.artic.edu','pokeapi.co'].includes(hostname);
    try {
      const response = await fetch(url,{signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const data = await response.json();
      return processApiResponse(url, data);
    } catch (error) {
      if (knownApi) throw error;
      this.updateState({status:'Reading webpage...'});
      return fetchWebpage(url,usage=>this.recordWebUsage(usage));
    }
  }

  private async fetchHackerNews(): Promise<unknown> {
    this.updateState({ status: "Fetching Hacker News stories..." });

    // Get top story IDs
    const idsResponse = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!idsResponse.ok) throw new Error("Failed to fetch HN stories");
    const ids: number[] = await idsResponse.json();

    // Fetch first 15 stories in parallel
    const top15Ids = ids.slice(0, 15);
    this.updateState({ status: `Fetching ${top15Ids.length} stories...` });

    const stories = await Promise.all(
      top15Ids.map(async (id) => {
        const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return res.json();
      })
    );

    // Process to keep only essential fields
    return processHNFrontPage(stories.filter(Boolean));
  }

  private async fetchHackerNewsItem(id: number): Promise<unknown> {
    this.updateState({ status: "Fetching story..." });

    // Fetch the story
    const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    if (!storyRes.ok) throw new Error("Failed to fetch HN story");
    const story = await storyRes.json();

    // Fetch top comments (kids are comment IDs)
    const commentIds: number[] = story.kids || [];
    const topCommentIds = commentIds.slice(0, 10);

    let comments: unknown[] = [];
    if (topCommentIds.length > 0) {
      this.updateState({ status: `Fetching ${topCommentIds.length} comments...` });

      comments = await Promise.all(
        topCommentIds.map(async (cid) => {
          const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${cid}.json`);
          return res.json();
        })
      );
    }

    // Process to keep only essential fields
    return processHNStoryWithComments(story, comments.filter(Boolean));
  }

  async goHome() {
    await this.navigate(DEFAULT_HOME_URL);
  }

  async goBack() {
    if (!this.state.loading && this.historyIndex > 0) {
      this.saveHistoryView();
      this.historyIndex--;
      this.restoreHistoryView('back');
    }
  }

  async goForward() {
    if (!this.state.loading && this.historyIndex < this.history.length - 1) {
      this.saveHistoryView();
      this.historyIndex++;
      this.restoreHistoryView('forward');
    }
  }

  private saveHistoryView() {
    const section = this.sections[this.state.sectionIndex];
    if (section) { section.images = [...this.scrollStack]; section.scrollIndex = this.state.scrollIndex; }
    const entry = this.history[this.historyIndex];
    if (entry && entry.url === this.state.currentUrl) {
      entry.sections = this.sections;
      entry.sectionIndex = this.state.sectionIndex;
      entry.images = [...this.scrollStack];
      entry.scrollIndex = this.state.scrollIndex;
    }
  }

  private restoreHistoryView(direction: 'back' | 'forward') {
    const entry = this.history[this.historyIndex];
    this.sections = entry.sections;
    this.activeSource = this.viewSource(entry.sections[entry.sectionIndex], entry.scrollIndex);
    this.scrollStack = [...entry.images];
    this.sessionImage = entry.images[entry.scrollIndex];
    this.sessionClickContext = false;
    this.updateState({currentUrl: entry.url, navigationRevision: this.state.navigationRevision + 1, currentImage: this.sessionImage, currentApiData: entry.apiData,
      sectionIndex: entry.sectionIndex, sectionCount: entry.sections.length,
      scrollIndex: entry.scrollIndex, scrollDepth: entry.images.length, viewTransition: direction, status: `Navigated ${direction}`, error: null});
  }

  async previousSection() { await this.changeSection(this.state.sectionIndex - 1); }
  async nextSection() { await this.changeSection(this.state.sectionIndex + 1); }

  private viewSource(section: SectionView, index: number): string {
    return section.passages?.[index] ?? section.source;
  }

  private async changeSection(index: number) {
    if (this.state.loading || !this.state.currentUrl || index < 0 || index >= this.sections.length) return;
    this.saveHistoryView();
    const target = this.sections[index];
    const previousSource = this.activeSource;
    this.updateState({loading: true, error: null, status: 'Loading section...'});
    this.activeSource = this.viewSource(target, target.scrollIndex);
    this.sessionClickContext = false;
    try {
      if (!target.images.length) {
        const image = await this.generatePageImage(this.state.currentUrl, this.state.currentApiData);
        target.images = [image];
      }
      this.scrollStack = [...target.images];
      this.sessionImage = target.images[target.scrollIndex];
      this.updateState({loading: false, viewTransition: null, sectionIndex: index, currentImage: this.sessionImage,
        scrollIndex: target.scrollIndex, scrollDepth: target.images.length, status: `Section ${index + 1} of ${this.sections.length}`});
      this.saveHistoryView();
    } catch (err) {
      this.activeSource = previousSource;
      this.sessionImage = this.state.currentImage;
      this.updateState({loading: false, status: 'Error loading section', error: err instanceof Error ? err.message : 'Unknown error'});
    }
  }

  /**
   * Scroll up - returns to previously viewed scroll position (instant, no generation)
   */
  async scrollUp() {
    if (this.state.loading || !this.canScrollUp() || !this.state.currentUrl) {
      return;
    }

    const newIndex = this.state.scrollIndex - 1;
    const previousImage = this.scrollStack[newIndex];

    this.activeSource = this.viewSource(this.sections[this.state.sectionIndex], newIndex);
    this.sessionImage = previousImage;
    this.updateState({
      scrollIndex: newIndex,
      currentImage: previousImage,
      viewTransition: 'up',
      status: `Scroll position ${newIndex + 1} of ${this.scrollStack.length}`,
    });
    this.saveHistoryView();
  }

  /**
   * Scroll down - generates new image continuing from bottom of current view
   */
  async scrollDown() {
    if (this.state.loading || !this.canScrollDown() || !this.state.currentUrl || !this.state.currentApiData || !this.state.currentImage) {
      return;
    }

    const newIndex = this.state.scrollIndex + 1;

    // If we already have this scroll position cached, just show it
    if (newIndex < this.scrollStack.length) {
      const cachedImage = this.scrollStack[newIndex];
      this.activeSource = this.viewSource(this.sections[this.state.sectionIndex], newIndex);
      this.sessionImage = cachedImage;
      this.updateState({
        scrollIndex: newIndex,
        currentImage: cachedImage,
        viewTransition: 'down',
        status: `Scroll position ${newIndex + 1} of ${this.scrollStack.length}`,
      });
      this.saveHistoryView();
      return;
    }

    const previousSource = this.activeSource;
    this.activeSource = this.viewSource(this.sections[this.state.sectionIndex], newIndex);
    // Need to generate new scroll content
    this.updateState({
      loading: true,
      error: null,
      status: "Scrolling down...",
    });

    try {
      // Set up context for scroll generation
      this.sessionImage = this.state.currentImage;
      this.isScrollingDown = true;

      const image = await this.generatePageImage(this.state.currentUrl, this.state.currentApiData);

      this.isScrollingDown = false;

      // Add to scroll stack
      this.scrollStack.push(image);
      this.sessionImage = image;

      this.updateState({
        loading: false,
        scrollIndex: newIndex,
        scrollDepth: this.scrollStack.length,
        currentImage: image,
        viewTransition: 'down',
        status: `Scroll position ${newIndex + 1} of ${this.scrollStack.length}`,
      });
      this.saveHistoryView();
    } catch (err) {
      this.isScrollingDown = false;
      this.activeSource = previousSource;
      this.sessionImage = this.state.currentImage;
      const message = err instanceof Error ? err.message : "Unknown error";
      this.updateState({
        loading: false,
        status: "Error scrolling",
        error: message,
      });
    }
  }

  /**
   * Re-render current page with new style (resets scroll stack)
   */
  async rerender() {
    if (this.state.loading || !this.state.currentUrl || !this.state.currentApiData) {
      return;
    }

    const previousSource = this.activeSource;
    const section = this.sections[this.state.sectionIndex];
    this.activeSource = this.viewSource(section, 0);
    this.updateState({
      loading: true,
      error: null,
      status: "Re-rendering with new style...",
    });

    try {
      const image = await this.generatePageImage(this.state.currentUrl, this.state.currentApiData);

      // Reset scroll stack with new styled image
      this.scrollStack = [image];
      this.sessionImage = image;

      this.updateState({
        loading: false,
        status: "Page re-rendered",
        viewTransition: null,
        currentImage: image,
        scrollIndex: 0,
        scrollDepth: 1,
      });
      this.saveHistoryView();
    } catch (err) {
      this.activeSource = previousSource;
      const message = err instanceof Error ? err.message : "Unknown error";
      this.updateState({
        loading: false,
        status: "Error re-rendering",
        error: message,
      });
    }
  }

  /**
   * Navigate to a URL
   * @param url - The URL to navigate to
   * @param freshStart - If true, starts a new session (clears context).
   *                     Called with true from Go button, false from clicks.
   */
  async navigate(url: string, freshStart: boolean = true) {
    if (this.navigating || (freshStart && this.state.loading)) return;
    this.navigating = true;
    this.saveHistoryView();
    const previous = {currentUrl: this.state.currentUrl, currentImage: this.state.currentImage,
      currentApiData: this.state.currentApiData, scrollIndex: this.state.scrollIndex,
      scrollDepth: this.state.scrollDepth, sectionIndex: this.state.sectionIndex, sectionCount: this.state.sectionCount};
    const previousSections = this.sections;
    const previousSource = this.activeSource;
    const previousStack = [...this.scrollStack];
    if (freshStart) {
      this.sessionImage = null;
      this.sessionClickContext = false;
      this.scrollStack = [];
    }
    this.updateState({loading: true, status: 'Fetching data...', error: null});
    try {
      url = normalizeExampleApiUrl(url);
      const apiData = await timed('Source data', () => this.fetchApiData(url));
      const sections = sourceSections(apiData).map(source => {
        const passages = sourcePassages(source);
        return {source, ...(passages[0] !== source ? {passages} : {}), images: [] as string[], scrollIndex: 0};
      });
      this.activeSource = this.viewSource(sections[0], 0);
      // Source data and effective options are part of the key. Clicks also depend
      // on the previous screenshot, so only independent renders use this cache.
      const {partialImages: _partialImages, ...renderOptions} = this.imageOptions;
      const bytes = new TextEncoder().encode(JSON.stringify([url, this.currentModelKey,
        this.currentStyle, renderOptions, apiData]));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const cacheKey = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
      const cached = freshStart ? this.imageCache.get(cacheKey) : undefined;
      this.updateState({status: 'Generating webpage image...'});
      const image = cached ?? await this.generatePageImage(url, apiData);
      if (freshStart && !cached) this.imageCache.set(cacheKey, image, image.length * 2);
      this.sessionImage = image;
      this.scrollStack = [image];
      this.history = this.history.slice(0, this.historyIndex + 1);
      sections[0].images = [image];
      this.sections = sections;
      this.history.push({url, apiData, images: [image], scrollIndex: 0, sections, sectionIndex: 0});
      this.historyIndex = this.history.length - 1;
      this.updateState({loading: false, viewTransition: null, status: cached ? 'Page loaded (cached)' : 'Page loaded',
        navigationRevision: this.state.navigationRevision + 1,
        currentUrl: url, currentApiData: apiData, currentImage: image, scrollIndex: 0, scrollDepth: 1, sectionIndex: 0, sectionCount: sections.length});
    } catch (err) {
      this.sections = previousSections;
      this.activeSource = previousSource;
      this.scrollStack = previousStack;
      this.sessionImage = previous.currentImage;
      this.sessionClickContext = false;
      const message = err instanceof Error ? err.message : 'Unknown error';
      const retry = message.match(/retry in (\d+)/i);
      this.updateState({...previous, loading: false, status: 'Error',
        error: retry ? `Rate limited. Please wait ${retry[1]} seconds and try again.` : message});
    } finally {
      this.navigating = false;
    }
  }

  private async drawPointerOnImage(imageDataUrl: string, x: number, y: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;

        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Draw a red cursor/pointer at click location
        ctx.fillStyle = "red";
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;

        // Draw pointer shape (arrow-like cursor)
        ctx.beginPath();
        ctx.moveTo(x, y); // Tip of pointer
        ctx.lineTo(x, y + 24); // Down
        ctx.lineTo(x + 6, y + 18); // Indent
        ctx.lineTo(x + 12, y + 28); // Tail out
        ctx.lineTo(x + 16, y + 26); // Tail
        ctx.lineTo(x + 10, y + 16); // Tail in
        ctx.lineTo(x + 18, y + 16); // Right
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Also draw a circle around the click point for visibility
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = "red";
        ctx.lineWidth = 3;
        ctx.stroke();

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("Failed to load image for pointer overlay"));
      img.src = imageDataUrl;
    });
  }

  private async generatePageImage(url: string, apiData: unknown): Promise<string> {
    const basePrompt = this.buildImagePrompt(url, apiData);
    const modelConfig = IMAGE_MODELS[this.currentModelKey];

    // Fetch reference images from API data (e.g., ESPN article images).
    // Some image models are tuned for speed over multiple references, so count
    // the session image against their input-image budget.
    const imageInfo = this.extractImageInfo(this.activeSource ? JSON.parse(this.activeSource) : apiData);
    const maxInputImages = modelConfig.maxInputImages ?? 6;
    const maxReferenceImages = Math.max(0, maxInputImages - (this.sessionImage ? 1 : 0));
    const referenceImages = imageInfo.length > 0 && maxReferenceImages > 0
      ? await timed('Reference images', () => this.fetchReferenceImages(imageInfo, maxReferenceImages))
      : [];

    // Build the full prompt with reference image context
    let fullPrompt = basePrompt;
    if (referenceImages.length > 0) {
      const imageDescriptions = referenceImages
        .map((img, i) => `  ${i + 1}. ${img.description}`)
        .join("\n");
      fullPrompt = `${basePrompt}

# REFERENCE IMAGES
${referenceImages.length} reference image(s) are provided:
${imageDescriptions}

Use content photos as assets within the webpage layout, styled to match the selected visual style. A site screenshot is layout guidance. Keep the source headings, readable text, and links visible; reference images must not replace the webpage with a standalone photo or illustration.`;
    }

    console.log("[BananaBrowser] ====== IMAGE GENERATION ======");
    console.log("[BananaBrowser] Model:", modelConfig.name, `(${modelConfig.provider})`);
    console.log("[BananaBrowser] Scroll index:", this.state.scrollIndex, "of", this.state.scrollDepth);
    console.log("[BananaBrowser] Has session context:", !!this.sessionImage);
    console.log("[BananaBrowser] Reference images:", referenceImages.length);
    if (this.sessionImage) {
      console.log("[BananaBrowser] Session image:");
      this.logImage(this.sessionImage);
    }
    console.log("[BananaBrowser] Full prompt:");
    console.log(fullPrompt);

    if (modelConfig.provider === "openai") {
      return timed(this.subscription ? 'ChatGPT page image' : 'OpenAI API page image', () => this.generateWithOpenAI(fullPrompt, referenceImages));
    } else if (modelConfig.provider === "openrouter") {
      return timed('OpenRouter page image', () => this.generateWithOpenRouter(fullPrompt, referenceImages));
    } else {
      return timed('Gemini page image', () => this.generateWithGemini(fullPrompt, referenceImages));
    }
  }

  private async generateWithGemini(
    prompt: string,
    referenceImages: { dataUrl: string; mimeType: string; description: string }[] = []
  ): Promise<string> {
    if (!this.geminiAI) {
      throw new Error("Gemini API key not configured");
    }

    // Build contents array - include previous image if we have session context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contents: any[] = [];

    // Add reference images first (content images from API data)
    for (const img of referenceImages) {
      const match = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        contents.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }

    // Add session context image (previous page design)
    if (this.sessionImage) {
      // Extract base64 from data URL
      const match = this.sessionImage.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        contents.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }

    // Add prompt (reference image context already included)
    contents.push({ text: prompt });

    const spec = IMAGE_MODELS[this.currentModelKey];
    const { size, thinkingLevel } = this.imageOptions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageConfig: Record<string, any> = {
      aspectRatio: "3:2", // Matches viewport
      imageSize: size,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: Record<string, any> = {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig,
    };
    // Only Gemini 3.x image models accept thinkingConfig
    if (thinkingLevel && spec.thinkingLevels) {
      config.thinkingConfig = { thinkingLevel };
    }

    const response = await this.withUsage('image', () => this.geminiAI!.models.generateContent({
      model: spec.model,
      contents,
      config,
    }), result => result.usageMetadata);

    // Extract image from response
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (!part.thought && part.inlineData?.mimeType?.startsWith('image/')) {
        const base64 = part.inlineData.data;
        const mimeType = part.inlineData.mimeType || "image/png";
        return `data:${mimeType};base64,${base64}`;
      }
    }

    throw new Error("No image generated in response");
  }

  private async generateWithOpenAI(
    prompt: string,
    referenceImages: { dataUrl: string; mimeType: string; description: string }[] = []
  ): Promise<string> {
    if (this.subscription) {
      const images = referenceImages.map(image => image.dataUrl);
      if (this.sessionImage) images.push(this.sessionImage);
      const result = await this.withUsage('image', () => this.subscription!({kind:'image', model:IMAGE_MODELS[this.currentModelKey].model, prompt, images, size:this.imageOptions.size, quality:this.imageOptions.quality}), result => result.usage);
      if (!result.image) throw new Error('ChatGPT returned no image. Try again.');
      return result.image;
    }
    if (!this.openaiApiKey) {
      throw new Error("OpenAI API key not configured");
    }

    // For OpenAI, we use the /images/edits endpoint if we have a session image or reference images,
    // otherwise use /images/generations
    const hasSessionImage = !!this.sessionImage;
    const hasReferenceImages = referenceImages.length > 0;

    if (hasSessionImage || hasReferenceImages) {
      return this.generateWithOpenAIEdit(prompt, referenceImages);
    } else {
      return this.generateWithOpenAICreate(prompt);
    }
  }

  private async generateWithOpenAICreate(prompt: string): Promise<string> {
    const data = await this.openAIImageRequest( "https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODELS[this.currentModelKey].model,
        prompt,
        n: 1,
        size: this.imageOptions.size,
        quality: this.imageOptions.quality || "medium",
        moderation: "low",
        stream: true,
        partial_images: this.imageOptions.partialImages ?? 0,
        output_format: this.imageOptions.outputFormat,
        ...(this.imageOptions.outputFormat && this.imageOptions.outputFormat !== 'png' ? {output_compression:95} : {}),
      }),
    });

    // Extract base64 image
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("No image generated in OpenAI response");
    }

    return `data:image/${this.imageOptions.outputFormat || 'png'};base64,${b64}`;
  }

  /**
   * Convert a base64 data URL to a Blob
   */
  private dataUrlToBlob(dataUrl: string): Blob | null {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const binaryString = atob(match[2]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: match[1] || "image/png" });
  }

  private async generateWithOpenAIEdit(
    prompt: string,
    referenceImages: { dataUrl: string; mimeType: string; description: string }[] = []
  ): Promise<string> {
    const formData = new FormData();
    formData.append("model", IMAGE_MODELS[this.currentModelKey].model);
    formData.append('n','1');

    // Add reference images first
    for (let i = 0; i < referenceImages.length; i++) {
      const blob = this.dataUrlToBlob(referenceImages[i].dataUrl);
      if (blob) {
        formData.append("image[]", blob, `reference-${i}.${blob.type.split('/')[1] || 'png'}`);
      }
    }

    // Add session context image (previous page design)
    if (this.sessionImage) {
      const sessionBlob = this.dataUrlToBlob(this.sessionImage);
      if (sessionBlob) {
        formData.append("image[]", sessionBlob, `context.${sessionBlob.type.split('/')[1] || 'png'}`);
      }
    }

    // Add prompt (reference image context already included)
    formData.append("prompt", prompt);
    formData.append("size", this.imageOptions.size);
    formData.append("quality", this.imageOptions.quality || "medium");
    formData.append("moderation", "low");
    formData.append("stream", "true");
    formData.append("partial_images", String(this.imageOptions.partialImages ?? 0));
    if (this.imageOptions.outputFormat) {
      formData.append('output_format', this.imageOptions.outputFormat);
      if (this.imageOptions.outputFormat !== 'png') formData.append('output_compression','95');
    }

    const data = await this.openAIImageRequest( "https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: formData,
    });

    // Extract base64 image
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("No image generated in OpenAI response");
    }

    return `data:image/${this.imageOptions.outputFormat || 'png'};base64,${b64}`;
  }

  private buildImagePrompt(_url: string, apiData: unknown): string {
    const source = JSON.parse(this.activeSource ?? sourceSections(apiData)[0]);
    const dataStr = JSON.stringify(source);

    let prompt = `# TASK
Render a webpage viewport from the source data below. Include its headings, readable text, links, and navigation as appropriate for the current view. The result is the actual browsable page content. Apply the selected visual style to its layout, imagery, typography, and information while preserving the source's meaning.

# VISUAL STYLE
${this.currentStyle}

# DATA
${dataStr}

# REMINDER
This is one source section. Show only its content. For a homepage or listing, use a natural website layout and density. Show as much as fits legibly in the viewport; remaining records continue below the fold when scrolling. Do not enlarge a few stories just to fill the image, and do not squeeze the entire source into one viewport. Blocks with paths are fragments of the original JSON; context identifies their record. Section navigation is provided outside the image.
Apply the visual style to ALL text, not just the title. The style should transform how the entire content appears and feels.`;

    if (!this.sessionImage) {
      prompt += `\n\n# INITIAL VIEW\nStart at the top of this page. Establish the page's identity and show its actual content immediately, with readable source text. A photographic or illustrated style must still convey the page's information and usable navigation.`;
    }

    if (JSON.parse(dataStr)?.contentWindow) {
      prompt += `\n\n# ARTICLE PASSAGE\nThe story contains the current passage only. Render the entire current passage, fitting its text into this view. contentWindow is navigation metadata, never visible copy. previousContext is the tail of the preceding passage for continuity, not new text to repeat in full. Preserve the existing visual overlap when scrolling, then show the current passage. Render Markdown links as their labels, without Markdown punctuation. Show "End of section" only when hasMore is false, after the complete passage. When hasMore is true, do not claim the section has ended.`;
    }

    // Add context about previous image if available
    if (this.sessionImage) {
      if (this.isScrollingDown) {
        prompt += `

# SCROLL CONTEXT
The user is scrolling down. The provided image shows the previous view. Generate the NEXT portion of the page:
- Continue from where the previous image ended
- The bottom ~20% of the previous view should be the top of this new view
- Show NEW content that comes after what was visible, using only facts and records in the current source section
- The screenshot is visual context only, not a source of facts. Do not infer later teams, items, statistics, or text from it
- If all content in this source section has already been shown, retain the overlap and show "End of section". Do not invent a continuation; section navigation is outside the image
- Maintain visual consistency (same layout, colors, typography)`;
      } else if (this.sessionClickContext) {
        prompt += `

# NAVIGATION CONTEXT
The provided image shows the previous page with a RED ARROW indicating where the user clicked. This led to the current page. Maintain visual consistency with the previous page (same layout style, colors, typography).`;
      } else {
        prompt += `

# CONTINUITY CONTEXT
The provided image shows the previous page state. Maintain visual consistency (same layout style, colors, typography).`;
      }
    }

    return prompt;
  }

  async handleClick(x: number, y: number) {
    if (this.state.loading || !this.state.currentImage || !this.state.currentApiData) {
      return;
    }

    this.updateState({
      loading: true,
      status: `Interpreting click at (${x}, ${y})...`,
      error: null,
    });

    try {
      // Send image + click to Gemini for interpretation
      const result = await this.interpretClick(x, y);

      if (result.action === "navigate" && result.url) {
        console.log("[BananaBrowser] Navigating to:", result.url);
        // Set session image to the one with pointer overlay so next page
        // generation sees where the user clicked
        this.sessionImage = result.imageWithPointer || null;
        this.sessionClickContext = true;
        // Continue session (preserve context) when navigating from click
        await this.navigate(result.url, false);
        this.sessionClickContext = false;
      } else if (result.action === "none") {
        this.updateState({
          loading: false,
          status: result.reason || "No navigation target found",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.updateState({
        loading: false,
        status: "Error interpreting click",
        error: message,
      });
    }
  }

  private async interpretClick(
    x: number,
    y: number
  ): Promise<{ action: "navigate" | "none"; url?: string; reason?: string; imageWithPointer?: string }> {
    // Draw pointer overlay on the image at click location
    const imageWithPointer = await this.drawPointerOnImage(this.state.currentImage!, x, y);

    // Extract base64 data from data URL
    const base64Match = imageWithPointer.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      throw new Error("Invalid image format");
    }
    const mimeType = base64Match[1];
    const base64Data = base64Match[2];

    let apiDataStr = this.activeSource ?? sourceSections(this.state.currentApiData)[0];
    const section = this.sections[this.state.sectionIndex];
    if (section?.passages && this.state.scrollIndex > 0) {
      // The retained visual overlap can include a link outside the 300-character
      // prose tail. Keep the preceding passage available to pointer interpretation.
      apiDataStr = JSON.stringify({currentView: JSON.parse(apiDataStr),
        previousView: JSON.parse(section.passages[this.state.scrollIndex - 1])});
    }
    const sourceName = (this.state.currentApiData as {source?: string} | null)?.source;
    let sourceHost = '';
    try { sourceHost = new URL(this.state.currentUrl || '').hostname; } catch { /* Unknown source stays intact. */ }
    const explicitCache = !this.subscription && EXPLICIT_CACHE_CLICK_MODELS.includes(this.currentClickModelKey);
    if (!explicitCache && sourceName && ['ESPN', 'Hacker News', 'Reddit', 'TVmaze', 'Art Institute of Chicago', 'PokéAPI'].includes(sourceName)
      && ['site.api.espn.com', 'content.core.api.espn.com', 'hacker-news.firebaseio.com', 'www.reddit.com', 'api.tvmaze.com', 'api.artic.edu', 'pokeapi.co'].includes(sourceHost)) {
      apiDataStr = compactClickSource(apiDataStr);
    }

    const clickLocation = `The user clicked at coordinates (${x}, ${y}). A RED CURSOR/POINTER has been drawn on the image showing exactly where they clicked.`;
    const navigationRules = sourceName === 'Hacker News'
      ? 'For a story, use its id: https://hacker-news.firebaseio.com/v0/item/{id}.json.'
      : sourceName === 'Reddit'
        ? 'For a post, use its permalink: https://www.reddit.com{permalink}.json.'
        : 'Use the exact apiUrl for the selected item, or the matching URL in links for page navigation. Otherwise use an explicit navigation URL from the data.';
    const prompt = `You are analyzing a click on a generated webpage image.

${clickLocation}

The page was generated from this API data:
${apiDataStr}

Look at the RED CURSOR in the image and determine:
1. What element/content is the cursor pointing at?
2. Does it correspond to something in the API data that has a link/URL or an ID?

If currentView and previousView are supplied, previousView identifies links retained in the visual overlap from the preceding passage.

IMPORTANT: This is an API-based browser. ${navigationRules}
sourceUrl and licenseUrl are attribution links, not API navigation targets.

If the click is on a clickable element, respond with JSON:
{"action": "navigate", "url": "THE_URL_HERE"}

If the click is not on any navigable element, respond with JSON:
{"action": "none", "reason": "Brief explanation of what was clicked"}

Respond ONLY with the JSON object, no other text.`;

    console.log("[BananaBrowser] ====== CLICK INTERPRETATION ======");
    console.log("[BananaBrowser] Click coordinates:", { x, y });
    console.log("[BananaBrowser] Image with pointer overlay:");
    this.logImage(imageWithPointer);
    console.log("[BananaBrowser] Prompt:");
    console.log(prompt);

    let text: string;
    const clickSpec = CLICK_MODELS[this.currentClickModelKey];

    if (clickSpec.provider === "gemini") {
      if (!this.geminiAI) throw new Error("Gemini API key not configured for click interpretation");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: Record<string, any> = {};
      if (this.clickOptions.thinkingLevel) {
        config.thinkingConfig = { thinkingLevel: this.clickOptions.thinkingLevel };
      }
      const response = await this.withUsage('text', () => this.geminiAI!.models.generateContent({
        model: clickSpec.model,
        contents: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt },
        ],
        ...(Object.keys(config).length > 0 && { config }),
      }), result => result.usageMetadata);
      text = response.text || "";
    } else if (this.subscription) {
      const result = await this.withUsage('text', () => this.subscription!({kind:'click', prompt, images:[imageWithPointer], model:clickSpec.model, effort:this.clickOptions.reasoningEffort}), result => result.usage);
      text = result.text || '';
    } else if (clickSpec.provider === "openrouter") {
      if (!this.openrouterApiKey) throw new Error("OpenRouter API key not configured for click interpretation");
      // Same order as OpenAI: stable source and rules, then the pointer image and coordinates.
      const data = await this.openRouterRequest("text", "/chat/completions", {
        model: clickSpec.model,
        messages: [{role: "user", content: [
          {type: "text", text: prompt.replace(`${clickLocation}\n\n`, '')},
          {type: "image_url", image_url: {url: `data:${mimeType};base64,${base64Data}`}},
          {type: "text", text: clickLocation},
        ]}],
        ...(this.clickOptions.reasoningEffort ? {reasoning: {effort: this.clickOptions.reasoningEffort}} : {}),
      }, 90_000);
      const content = data?.choices?.[0]?.message?.content;
      text = typeof content === "string" ? content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : Array.isArray(content) ? content.map((part: any) => typeof part?.text === "string" ? part.text : '').join('') : '';
    } else {
      if (!this.openaiApiKey) throw new Error("OpenAI API key not configured for click interpretation");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: Record<string, any> = {
        model: clickSpec.model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt.replace(`${clickLocation}\n\n`, '') },
              { type: "input_image", image_url: `data:${mimeType};base64,${base64Data}` },
              { type: "input_text", text: clickLocation },
            ],
          },
        ],
      };
      if (this.clickOptions.reasoningEffort) {
        body.reasoning = { effort: this.clickOptions.reasoningEffort };
      }
      body.prompt_cache_key = 'banana-browser-click-v1';
      if (explicitCache) {
        // Cache only stable rules and source data, excluding pointer pixels and coordinates.
        body.input[0].content[0].prompt_cache_breakpoint = { mode: 'explicit' };
        body.prompt_cache_options = { mode: 'explicit' };
      }
      const data = await this.openAIRequest('text', "https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      // Reasoning models emit a "reasoning" item before the "message" — find the message.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messageItem = (data.output as any[] | undefined)?.find((o) => o?.type === "message");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textPart = messageItem?.content?.find((c: any) => c?.type === "output_text");
      text = textPart?.text || "";
    }

    console.log("[BananaBrowser] Raw model response:");
    console.log(text);

    // Parse JSON from response
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        console.log("[BananaBrowser] Parsed result:", result);
        // Include the image with pointer for session context
        return { ...result, imageWithPointer };
      }
    } catch (e) {
      console.log("[BananaBrowser] JSON parse error:", e);
    }

    console.log("[BananaBrowser] Failed to parse response, returning none");
    return { action: "none", reason: "Could not interpret click", imageWithPointer };
  }
}
