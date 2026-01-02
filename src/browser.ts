import { GoogleGenAI } from "@google/genai";
import { processApiResponse, processHNFrontPage, processHNStoryWithComments } from "./api-processors";

export interface UsageStats {
  imageGenerations: number;
  clickInterpretations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number; // in USD
}

export interface BrowserState {
  loading: boolean;
  status: string;
  currentUrl: string | null;
  currentImage: string | null; // base64 data URL
  currentApiData: unknown | null;
  error: string | null;
  usage: UsageStats;
  scrollIndex: number; // Current position in scroll stack (0 = top of page)
  scrollDepth: number; // Total images in scroll stack
}

interface HistoryEntry {
  url: string;
  apiData: unknown;
  image: string;
}

// Bookmarked API endpoints
export const BOOKMARKS = {
  "ESPN NFL News": "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news",
  "Hacker News": "https://hacker-news.firebaseio.com/v0/topstories.json",
  "Reddit r/todayilearned": "https://www.reddit.com/r/todayilearned.json",
} as const;

export type Bookmark = keyof typeof BOOKMARKS;

const DEFAULT_HOME_URL = BOOKMARKS["ESPN NFL News"];

// Image generation models
export const IMAGE_MODELS = {
  // Gemini models
  flash: { provider: "gemini", model: "gemini-2.5-flash-image", name: "Nano Banana" },
  pro: { provider: "gemini", model: "gemini-3-pro-image-preview", name: "Nano Banana Pro" },
  // OpenAI models
  "gpt-image": { provider: "openai", model: "gpt-image-1.5", name: "GPT Image 1.5" },
  "gpt-image-mini": { provider: "openai", model: "gpt-image-1-mini", name: "GPT Image Mini" },
} as const;

export type ImageModel = keyof typeof IMAGE_MODELS;

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

// Simple in-memory cache for generated images (keyed by url+model+style)
const imageCache = new Map<string, { image: string; apiData: unknown }>();

function getCacheKey(url: string, model: string, style: string): string {
  return `${url}|${model}|${style}`;
}

export class BananaBrowser {
  private geminiAI: GoogleGenAI | null = null;
  private openaiApiKey: string | null = null;
  private currentModelKey: ImageModel = "flash";
  private currentStyle: string = STYLE_PRESETS.modern;
  private state: BrowserState = {
    loading: false,
    status: "Ready",
    currentUrl: null,
    currentImage: null,
    currentApiData: null,
    error: null,
    usage: {
      imageGenerations: 0,
      clickInterpretations: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCost: 0,
    },
    scrollIndex: 0,
    scrollDepth: 1,
  };
  private history: HistoryEntry[] = [];
  private historyIndex: number = -1;
  // Session image context - passed to model for design continuity
  // Reset when user presses Go, kept during clicks/scrolls/style changes
  private sessionImage: string | null = null;
  // True when the session image includes click pointer overlay
  private sessionClickContext: boolean = false;
  // Stack of images for current page scroll (index 0 = top of page)
  private scrollStack: string[] = [];
  // True when generating a scroll-down image
  private isScrollingDown: boolean = false;

  onStateChange: (state: BrowserState) => void = () => {};

  constructor(geminiApiKey?: string, openaiApiKey?: string, model: ImageModel = "flash") {
    if (geminiApiKey) {
      console.log("[BananaBrowser] Initializing Gemini with key:", geminiApiKey.substring(0, 8) + "...");
      this.geminiAI = new GoogleGenAI({ apiKey: geminiApiKey });
    }
    if (openaiApiKey) {
      console.log("[BananaBrowser] Initializing OpenAI with key:", openaiApiKey.substring(0, 8) + "...");
      this.openaiApiKey = openaiApiKey;
    }
    this.currentModelKey = model;
  }

  setModel(model: ImageModel) {
    const modelConfig = IMAGE_MODELS[model];
    // Check if we have the required API key for this model
    if (modelConfig.provider === "gemini" && !this.geminiAI) {
      console.warn("[BananaBrowser] Cannot use Gemini model without Gemini API key");
      return;
    }
    if (modelConfig.provider === "openai" && !this.openaiApiKey) {
      console.warn("[BananaBrowser] Cannot use OpenAI model without OpenAI API key");
      return;
    }
    this.currentModelKey = model;
    console.log("[BananaBrowser] Switched to model:", modelConfig.name);
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
    return true; // Can always try to scroll down (will generate new content)
  }

  getStylePresets() {
    return STYLE_PRESETS;
  }

  private updateState(partial: Partial<BrowserState>) {
    this.state = { ...this.state, ...partial };
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
    const results: { dataUrl: string; mimeType: string; description: string }[] = [];

    for (const info of imageInfo.slice(0, maxImages)) {
      try {
        const response = await fetch(info.url);
        if (!response.ok) continue;

        const blob = await response.blob();
        const mimeType = blob.type || "image/jpeg";

        // Convert to base64
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ""
          )
        );
        const dataUrl = `data:${mimeType};base64,${base64}`;

        results.push({ dataUrl, mimeType, description: info.description });
        console.log(`[BananaBrowser] Fetched reference image: ${info.description}`);
        this.logImage(dataUrl);
      } catch (err) {
        console.warn(`[BananaBrowser] Failed to fetch image: ${info.url}`, err);
      }
    }

    return results;
  }

  /**
   * Extract image info (URL + description) from API data
   */
  private extractImageInfo(apiData: unknown): { url: string; description: string }[] {
    if (!apiData || typeof apiData !== "object") return [];
    const data = apiData as Record<string, unknown>;

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

  // Pricing per 1M tokens (USD)
  private static readonly PRICING = {
    // Gemini 2.5 Flash Image (Nano Banana)
    flash: {
      input: 0.075 / 1_000_000, // $0.075 per 1M input tokens
      output: 0.3 / 1_000_000, // $0.30 per 1M output tokens
      imageOutput: 30 / 1_000_000, // $30 per 1M tokens for image output (~1290 tokens/image = ~$0.039)
    },
    // Gemini 3 Pro Image Preview (Nano Banana Pro)
    pro: {
      input: 2.0 / 1_000_000, // $2.00 per 1M input tokens
      output: 12.0 / 1_000_000, // $12.00 per 1M output tokens (text/thinking)
      imageOutput: 120 / 1_000_000, // $120 per 1M tokens for image output (~1120 tokens = ~$0.134)
    },
    // OpenAI GPT Image 1.5
    "gpt-image": {
      input: 5.0 / 1_000_000, // $5.00 per 1M text input tokens
      imageInput: 8.0 / 1_000_000, // $8.00 per 1M image input tokens
      imageOutput: 32.0 / 1_000_000, // $32.00 per 1M image output tokens (~$0.04 medium quality)
    },
    // OpenAI GPT Image 1 Mini
    "gpt-image-mini": {
      input: 2.5 / 1_000_000, // $2.50 per 1M input tokens
      imageInput: 2.5 / 1_000_000, // Using same as input (not specified separately)
      imageOutput: 8.0 / 1_000_000, // $8.00 per 1M output tokens
    },
    // Gemini 2.5 Flash (text/vision for click interpretation)
    text: {
      input: 0.075 / 1_000_000, // $0.075 per 1M input tokens
      output: 0.3 / 1_000_000, // $0.30 per 1M output tokens
    },
    // OpenAI GPT-5-mini (text/vision for click interpretation when no Gemini key)
    "gpt-5-mini": {
      input: 0.25 / 1_000_000, // $0.25 per 1M input tokens (text + image)
      output: 1.0 / 1_000_000, // $1.00 per 1M output tokens (estimated)
    },
  };

  private trackUsage(
    type: "image" | "text",
    usageMetadata?: {
      // Gemini format
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      // OpenAI format
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { text_tokens?: number; image_tokens?: number };
    }
  ) {
    // Handle both Gemini and OpenAI response formats
    const inputTokens = usageMetadata?.promptTokenCount || usageMetadata?.input_tokens || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || usageMetadata?.output_tokens || 0;

    let costIncrement = 0;
    if (type === "image") {
      // Image generation - use model-specific pricing
      const modelConfig = IMAGE_MODELS[this.currentModelKey];
      const pricing = BananaBrowser.PRICING[this.currentModelKey] || BananaBrowser.PRICING.flash;

      if (modelConfig.provider === "openai") {
        // OpenAI has separate text/image input pricing
        const textInputTokens = usageMetadata?.input_tokens_details?.text_tokens || 0;
        const imageInputTokens = usageMetadata?.input_tokens_details?.image_tokens || 0;
        const gptPricing = pricing as (typeof BananaBrowser.PRICING)["gpt-image"];
        costIncrement =
          textInputTokens * gptPricing.input +
          imageInputTokens * gptPricing.imageInput +
          outputTokens * gptPricing.imageOutput;
      } else {
        // Gemini pricing
        const geminiPricing = pricing as typeof BananaBrowser.PRICING.flash;
        costIncrement = inputTokens * geminiPricing.input + outputTokens * geminiPricing.imageOutput;
      }
      this.state.usage.imageGenerations++;
    } else {
      // Text/vision model (click interpretation)
      // Use gpt-5-mini pricing if no Gemini key, otherwise use Gemini text pricing
      const textPricing = this.geminiAI ? BananaBrowser.PRICING.text : BananaBrowser.PRICING["gpt-5-mini"];
      costIncrement = inputTokens * textPricing.input + outputTokens * textPricing.output;
      this.state.usage.clickInterpretations++;
    }

    this.state.usage.totalInputTokens += inputTokens;
    this.state.usage.totalOutputTokens += outputTokens;
    this.state.usage.estimatedCost += costIncrement;

    // Trigger state update to refresh UI
    this.updateState({});

    console.log("[BananaBrowser] Usage tracked:", {
      type,
      model: IMAGE_MODELS[this.currentModelKey].model,
      inputTokens,
      outputTokens,
      costIncrement: `$${costIncrement.toFixed(4)}`,
      totalCost: `$${this.state.usage.estimatedCost.toFixed(4)}`,
    });
  }

  private async fetchApiData(url: string): Promise<unknown> {
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

    // Default: fetch the URL and process the response
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    // Process the response to keep only essential data
    return processApiResponse(url, data);
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
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const entry = this.history[this.historyIndex];
      this.scrollStack = [entry.image];
      this.sessionImage = entry.image;
      this.updateState({
        currentUrl: entry.url,
        currentImage: entry.image,
        currentApiData: entry.apiData,
        scrollIndex: 0,
        scrollDepth: 1,
        status: "Navigated back",
      });
    }
  }

  async goForward() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const entry = this.history[this.historyIndex];
      this.scrollStack = [entry.image];
      this.sessionImage = entry.image;
      this.updateState({
        currentUrl: entry.url,
        currentImage: entry.image,
        currentApiData: entry.apiData,
        scrollIndex: 0,
        scrollDepth: 1,
        status: "Navigated forward",
      });
    }
  }

  /**
   * Scroll up - returns to previously viewed scroll position (instant, no generation)
   */
  async scrollUp() {
    if (!this.canScrollUp() || !this.state.currentUrl) {
      return;
    }

    const newIndex = this.state.scrollIndex - 1;
    const previousImage = this.scrollStack[newIndex];

    this.sessionImage = previousImage;
    this.updateState({
      scrollIndex: newIndex,
      currentImage: previousImage,
      status: `Scroll position ${newIndex + 1} of ${this.scrollStack.length}`,
    });
  }

  /**
   * Scroll down - generates new image continuing from bottom of current view
   */
  async scrollDown() {
    if (!this.state.currentUrl || !this.state.currentApiData || !this.state.currentImage) {
      return;
    }

    const newIndex = this.state.scrollIndex + 1;

    // If we already have this scroll position cached, just show it
    if (newIndex < this.scrollStack.length) {
      const cachedImage = this.scrollStack[newIndex];
      this.sessionImage = cachedImage;
      this.updateState({
        scrollIndex: newIndex,
        currentImage: cachedImage,
        status: `Scroll position ${newIndex + 1} of ${this.scrollStack.length}`,
      });
      return;
    }

    // Need to generate new scroll content
    this.updateState({
      loading: true,
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
        status: `Scroll position ${newIndex + 1} of ${this.scrollStack.length}`,
      });
    } catch (err) {
      this.isScrollingDown = false;
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
    if (!this.state.currentUrl || !this.state.currentApiData) {
      return;
    }

    this.updateState({
      loading: true,
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
        currentImage: image,
        scrollIndex: 0,
        scrollDepth: 1,
      });
    } catch (err) {
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
    // Fresh start clears the session context and resets scroll
    if (freshStart) {
      this.sessionImage = null;
      this.scrollStack = [];
    }

    // Check cache first
    const cacheKey = getCacheKey(url, this.currentModelKey, this.currentStyle);
    const cached = imageCache.get(cacheKey);
    if (cached) {
      // Truncate forward history and add new entry
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ url, apiData: cached.apiData, image: cached.image });
      this.historyIndex = this.history.length - 1;
      this.sessionImage = cached.image;
      this.scrollStack = [cached.image];
      this.updateState({
        loading: false,
        status: "Page loaded (cached)",
        currentUrl: url,
        currentImage: cached.image,
        currentApiData: cached.apiData,
        scrollIndex: 0,
        scrollDepth: 1,
        error: null,
      });
      return;
    }

    this.updateState({
      loading: true,
      status: "Fetching data...",
      currentUrl: url,
      error: null,
    });

    try {
      // Fetch API data (with special handling for HN)
      const apiData = await this.fetchApiData(url);

      this.updateState({
        status: "Generating webpage image...",
        currentApiData: apiData,
      });

      // Generate image from API data (with session context if available)
      const image = await this.generatePageImage(url, apiData);

      // Save to cache
      imageCache.set(cacheKey, { image, apiData });

      // Update session image and scroll stack
      this.sessionImage = image;
      this.scrollStack = [image];

      // Truncate forward history and add new entry
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push({ url, apiData, image });
      this.historyIndex = this.history.length - 1;

      this.updateState({
        loading: false,
        status: "Page loaded",
        currentImage: image,
        scrollIndex: 0,
        scrollDepth: 1,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // Parse rate limit errors for friendlier message
      const rateLimitMatch = message.match(/retry in (\d+)/i);
      if (rateLimitMatch) {
        this.updateState({
          loading: false,
          status: "Error",
          error: `Rate limited. Please wait ${rateLimitMatch[1]} seconds and try again.`,
        });
      } else {
        this.updateState({
          loading: false,
          status: "Error",
          error: message,
        });
      }
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

    // Fetch reference images from API data (e.g., ESPN article images)
    const imageInfo = this.extractImageInfo(apiData);
    const referenceImages = imageInfo.length > 0
      ? await this.fetchReferenceImages(imageInfo, 5)
      : [];

    // Build the full prompt with reference image context
    let fullPrompt = basePrompt;
    if (referenceImages.length > 0) {
      const imageDescriptions = referenceImages
        .map((img, i) => `  ${i + 1}. ${img.description}`)
        .join("\n");
      fullPrompt = `# REFERENCE IMAGES
${referenceImages.length} photo(s) from the actual content are provided:
${imageDescriptions}

Use these as inspiration. You have creative freedom - incorporate them directly, stylize them to match the visual style, or reimagine them artistically. The visual style takes precedence over literal reproduction.

${basePrompt}`;
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
      return this.generateWithOpenAI(fullPrompt, referenceImages);
    } else {
      return this.generateWithGemini(fullPrompt, referenceImages);
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

    const response = await this.geminiAI.models.generateContent({
      model: IMAGE_MODELS[this.currentModelKey].model,
      contents,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "3:2", // Matches viewport and OpenAI's 1536x1024
        },
      },
    });

    // Track usage from response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usageMetadata = (response as any).usageMetadata;
    this.trackUsage("image", usageMetadata);

    // Extract image from response
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData) {
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
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODELS[this.currentModelKey].model,
        prompt,
        n: 1,
        size: "1536x1024", // landscape for better web page feel
        quality: "medium",
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();

    // Track usage
    if (data.usage) {
      this.trackUsage("image", data.usage);
    }

    // Extract base64 image
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("No image generated in OpenAI response");
    }

    return `data:image/png;base64,${b64}`;
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

    // Add reference images first
    for (let i = 0; i < referenceImages.length; i++) {
      const blob = this.dataUrlToBlob(referenceImages[i].dataUrl);
      if (blob) {
        formData.append("image[]", blob, `reference-${i}.png`);
      }
    }

    // Add session context image (previous page design)
    if (this.sessionImage) {
      const sessionBlob = this.dataUrlToBlob(this.sessionImage);
      if (sessionBlob) {
        formData.append("image[]", sessionBlob, "context.png");
      }
    }

    // Add prompt (reference image context already included)
    formData.append("prompt", prompt);
    formData.append("size", "1536x1024"); // landscape for better web page feel
    formData.append("quality", "medium");

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();

    // Track usage
    if (data.usage) {
      this.trackUsage("image", data.usage);
    }

    // Extract base64 image
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("No image generated in OpenAI response");
    }

    return `data:image/png;base64,${b64}`;
  }

  private buildImagePrompt(_url: string, apiData: unknown): string {
    // Truncate API data if too large
    let dataStr = JSON.stringify(apiData, null, 2);
    if (dataStr.length > 10000) {
      dataStr = dataStr.substring(0, 10000) + "\n... (truncated)";
    }

    let prompt = `# TASK
Visualize the data below as an image. The visual style MUST completely transform how the content appears - not just as a background or frame, but fundamentally changing how the text and information is rendered.

# VISUAL STYLE
${this.currentStyle}

# DATA
${dataStr}

# REMINDER
Apply the visual style to ALL text, not just the title. The style should transform how the entire content appears and feels.`;

    // Add context about previous image if available
    if (this.sessionImage) {
      if (this.isScrollingDown) {
        prompt += `

# SCROLL CONTEXT
The user is scrolling down. The provided image shows the previous view. Generate the NEXT portion of the page:
- Continue from where the previous image ended
- The bottom ~20% of the previous view should be the top of this new view
- Show NEW content that comes after what was visible
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
    if (!this.state.currentImage || !this.state.currentApiData) {
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

    // Build prompt with API data context
    let apiDataStr = JSON.stringify(this.state.currentApiData, null, 2);
    if (apiDataStr.length > 8000) {
      apiDataStr = apiDataStr.substring(0, 8000) + "\n... (truncated)";
    }

    const prompt = `You are analyzing a click on a generated webpage image.

The user clicked at coordinates (${x}, ${y}). A RED CURSOR/POINTER has been drawn on the image showing exactly where they clicked.

The page was generated from this API data:
${apiDataStr}

Look at the RED CURSOR in the image and determine:
1. What element/content is the cursor pointing at?
2. Does it correspond to something in the API data that has a link/URL or an ID?

IMPORTANT: This is an API-based browser. Use these URL patterns:

For ESPN data:
- Use the EXACT URL from "links.api.self.href"
- Example: "https://content.core.api.espn.com/v1/sports/news/47168214"

For Hacker News data:
- If the user clicks on a story, use: https://hacker-news.firebaseio.com/v0/item/{id}.json
- The story's "id" field contains the ID number
- Example: if story has "id": 46138238, return "https://hacker-news.firebaseio.com/v0/item/46138238.json"

For Reddit data:
- Use the "permalink" field with .json appended: https://www.reddit.com{permalink}.json

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

    if (this.geminiAI) {
      // Use Gemini for click interpretation
      const response = await this.geminiAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      });

      // Track usage from response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usageMetadata = (response as any).usageMetadata;
      this.trackUsage("text", usageMetadata);

      text = response.text || "";
    } else if (this.openaiApiKey) {
      // Use OpenAI gpt-5-mini for click interpretation
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_image",
                  image_url: `data:${mimeType};base64,${base64Data}`,
                },
                {
                  type: "input_text",
                  text: prompt,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      // Track usage
      if (data.usage) {
        this.trackUsage("text", {
          promptTokenCount: data.usage.input_tokens,
          candidatesTokenCount: data.usage.output_tokens,
        });
      }
      text = data.output?.[0]?.content?.[0]?.text || "";
    } else {
      throw new Error("No API key configured for click interpretation");
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
