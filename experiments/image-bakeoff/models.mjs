// Bake-off candidates. `guardUSD` is a deliberately high per-call estimate used only to stop before the budget.
// Limits and prices checked 2026-10-15: Gemini/OpenAI pricing pages, OpenRouter /api/v1/images/models + endpoints.
const perMillion = dollars => dollars / 1_000_000;

export const MODELS = [
  // Existing app models, sent through the production request code with app defaults.
  { id: 'gpt-image-2', label: 'GPT Image 2 (current API default)', route: 'app', appKey: 'gpt-image-2', key: 'openai', maxReferences: 5, guardUSD: 0.10, settings: 'low, 1920x1280' },
  { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite (current Gemini default)', route: 'app', appKey: 'flash-lite', key: 'gemini', maxReferences: 1, guardUSD: 0.05, settings: '1K, minimal thinking' },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', route: 'app', appKey: 'flash-2', key: 'gemini', maxReferences: 5, guardUSD: 0.09, settings: '1K, minimal thinking' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro', route: 'app', appKey: 'pro', key: 'gemini', maxReferences: 5, guardUSD: 0.16, settings: '2K, high thinking' },
  // New models on existing providers: production request code with an injected model spec.
  {
    id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', route: 'app', appKey: 'bakeoff-gpt-image-2.5-flare', key: 'openai', maxReferences: 5, guardUSD: 0.10, settings: 'low, 1920x1280',
    spec: { provider: 'openai', model: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', sizes: [{ value: '1920x1280', label: '1920×1280' }], defaultSize: '1920x1280', qualities: ['low', 'medium', 'high'], defaultQuality: 'low' },
    // Same published token prices as GPT Image 2.
    pricing: { input: perMillion(5), imageInput: perMillion(8), cachedInput: perMillion(1.25), cachedImageInput: perMillion(2), imageOutput: perMillion(30) },
  },
  {
    id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1', route: 'app', appKey: 'bakeoff-nano-banana-2.1', key: 'gemini', maxReferences: 5, guardUSD: 0.07, settings: '1K, minimal thinking',
    spec: { provider: 'gemini', model: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1', sizes: [{ value: '1K', label: '1K', tokens: 1120 }], defaultSize: '1K', thinkingLevels: ['minimal', 'medium', 'high'], defaultThinkingLevel: 'minimal' },
    pricing: { input: perMillion(1.5), output: perMillion(7.5), imageOutput: perMillion(30) },
  },
  {
    id: 'gemini-nano-banana-2.1@2K', label: 'Nano Banana 2.1 (2K)', route: 'app', appKey: 'bakeoff-nano-banana-2.1-2k', key: 'gemini', maxReferences: 5, guardUSD: 0.08, settings: '2K, minimal thinking',
    spec: { provider: 'gemini', model: 'gemini-nano-banana-2.1', name: 'Nano Banana 2.1 (2K)', sizes: [{ value: '2K', label: '2K', tokens: 1680 }], defaultSize: '2K', thinkingLevels: ['minimal', 'medium', 'high'], defaultThinkingLevel: 'minimal' },
    pricing: { input: perMillion(1.5), output: perMillion(7.5), imageOutput: perMillion(30) },
  },
  // New providers through OpenRouter's Image API; cost comes from the response's usage.cost.
  { id: 'x-ai/grok-imagine-image-2.0', label: 'Grok Imagine Image 2.0', route: 'openrouter', key: 'openrouter', maxReferences: 3, guardUSD: 0.08, params: { resolution: '1K', aspect_ratio: '3:2', quality: 'low' }, settings: 'low, 1K, 3:2' },
  { id: 'microsoft/mai-image-2.6-flash', label: 'MAI-Image-2.6-Flash', route: 'openrouter', key: 'openrouter', maxReferences: 5, guardUSD: 0.15, params: { aspect_ratio: '3:2' }, settings: '3:2' },
  { id: 'microsoft/mai-image-2.6', label: 'MAI-Image-2.6', route: 'openrouter', key: 'openrouter', maxReferences: 5, guardUSD: 0.30, params: { aspect_ratio: '3:2' }, settings: '3:2' },
  { id: 'bytedance-seed/seedream-5-0-flash', label: 'Seedream 5.0 Flash', route: 'openrouter', key: 'openrouter', maxReferences: 5, guardUSD: 0.03, params: { resolution: '1K', aspect_ratio: '3:2' }, settings: '1K, 3:2' },
  { id: 'bytedance-seed/seedream-5-0-pro', label: 'Seedream 5.0 Pro', route: 'openrouter', key: 'openrouter', maxReferences: 5, guardUSD: 0.08, params: { resolution: '1K', aspect_ratio: '3:2' }, settings: '1K, 3:2' },
  { id: 'black-forest-labs/flux-3-image', label: 'FLUX 3 Image', route: 'openrouter', key: 'openrouter', maxReferences: 5, guardUSD: 0.07, params: { resolution: '1K', aspect_ratio: '3:2' }, settings: '1K, 3:2' },
  { id: 'qwen/qwen-image-3', label: 'Qwen-Image-3', route: 'openrouter', key: 'openrouter', maxReferences: 4, guardUSD: 0.05, params: { resolution: '1K', aspect_ratio: '3:2' }, settings: '1K, 3:2' },
  // OpenRouter lists no size or reference parameters for Muse, so it gets the prompt only.
  { id: 'meta/muse-image', label: 'Muse Image', route: 'openrouter', key: 'openrouter', maxReferences: 0, guardUSD: 0.05, params: {}, settings: 'provider default' },
];
