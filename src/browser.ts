import { GoogleGenAI } from '@google/genai'

export interface BrowserState {
  loading: boolean
  status: string
  currentUrl: string | null
  currentImage: string | null // base64 data URL
  currentApiData: unknown | null
  error: string | null
}

interface HistoryEntry {
  url: string
  apiData: unknown
  image: string
}

const ESPN_NFL_NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news'

// Image generation models
export const IMAGE_MODELS = {
  flash: 'gemini-2.5-flash-image',        // Nano Banana - faster, cheaper
  pro: 'gemini-2.0-flash-exp',  // Nano Banana Pro - higher quality. NOTE I think the 3 is in waitlist only
} as const

export type ImageModel = keyof typeof IMAGE_MODELS

// Style presets
export const STYLE_PRESETS = {
  modern: 'A modern, clean, professional website with good typography and spacing',
  geocities: '90s Geocities style with animated GIFs, bright colors, comic sans, starry backgrounds, under construction signs, visitor counters, and marquee text',
  brutalist: 'Brutalist web design with raw HTML aesthetic, monospace fonts, stark black and white, no images, dense text',
  vaporwave: 'Vaporwave aesthetic with pink/cyan/purple gradients, retro 80s graphics, glitch effects, Japanese text, marble busts',
  newspaper: 'Classic newspaper layout with serif fonts, columns, black and white, headline hierarchy like New York Times',
  hacker: 'Dark hacker terminal aesthetic with green text on black, monospace font, command line interface look',
} as const

export type StylePreset = keyof typeof STYLE_PRESETS

// Simple in-memory cache for generated images (keyed by url+model+style)
const imageCache = new Map<string, { image: string; apiData: unknown }>()

function getCacheKey(url: string, model: string, style: string): string {
  return `${url}|${model}|${style}`
}

export class BananaBrowser {
  private ai: GoogleGenAI
  private imageModel: string = IMAGE_MODELS.flash
  private currentStyle: string = STYLE_PRESETS.modern
  private state: BrowserState = {
    loading: false,
    status: 'Ready',
    currentUrl: null,
    currentImage: null,
    currentApiData: null,
    error: null,
  }
  private history: HistoryEntry[] = []

  onStateChange: (state: BrowserState) => void = () => {}

  constructor(apiKey: string, model: ImageModel = 'flash') {
    console.log('[BananaBrowser] Initializing with API key:', apiKey.substring(0, 8) + '...')
    this.ai = new GoogleGenAI({ apiKey })
    this.imageModel = IMAGE_MODELS[model]
  }

  setModel(model: ImageModel) {
    this.imageModel = IMAGE_MODELS[model]
    console.log('[BananaBrowser] Switched to model:', this.imageModel)
  }

  setStyle(style: StylePreset | string) {
    // Accept either a preset key or custom string
    if (style in STYLE_PRESETS) {
      this.currentStyle = STYLE_PRESETS[style as StylePreset]
    } else {
      this.currentStyle = style
    }
    console.log('[BananaBrowser] Switched to style:', this.currentStyle)
  }

  getStylePresets() {
    return STYLE_PRESETS
  }

  private updateState(partial: Partial<BrowserState>) {
    this.state = { ...this.state, ...partial }
    this.onStateChange(this.state)
  }

  async goHome() {
    await this.navigate(ESPN_NFL_NEWS_URL)
  }

  async goBack() {
    if (this.history.length > 1) {
      this.history.pop() // Remove current
      const prev = this.history[this.history.length - 1]
      this.updateState({
        currentUrl: prev.url,
        currentImage: prev.image,
        currentApiData: prev.apiData,
        status: 'Navigated back',
      })
    }
  }

  async navigate(url: string) {
    // Check cache first (includes model and style in key)
    const cacheKey = getCacheKey(url, this.imageModel, this.currentStyle)
    const cached = imageCache.get(cacheKey)
    if (cached) {
      this.history.push({ url, apiData: cached.apiData, image: cached.image })
      this.updateState({
        loading: false,
        status: 'Page loaded (cached)',
        currentUrl: url,
        currentImage: cached.image,
        currentApiData: cached.apiData,
        error: null,
      })
      return
    }

    this.updateState({
      loading: true,
      status: 'Fetching data...',
      currentUrl: url,
      error: null,
    })

    try {
      // Fetch API data
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      const apiData = await response.json()

      this.updateState({
        status: 'Generating webpage image...',
        currentApiData: apiData,
      })

      // Generate image from API data
      const image = await this.generatePageImage(url, apiData)

      // Save to cache (keyed by url+model+style)
      imageCache.set(cacheKey, { image, apiData })

      // Save to history
      this.history.push({ url, apiData, image })

      this.updateState({
        loading: false,
        status: 'Page loaded',
        currentImage: image,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      // Parse rate limit errors for friendlier message
      const rateLimitMatch = message.match(/retry in (\d+)/i)
      if (rateLimitMatch) {
        this.updateState({
          loading: false,
          status: 'Error',
          error: `Rate limited. Please wait ${rateLimitMatch[1]} seconds and try again.`,
        })
      } else {
        this.updateState({
          loading: false,
          status: 'Error',
          error: message,
        })
      }
    }
  }

  private async generatePageImage(url: string, apiData: unknown): Promise<string> {
    const prompt = this.buildImagePrompt(url, apiData)

    console.log('[BananaBrowser] Generating image with model:', this.imageModel)
    const response = await this.ai.models.generateContent({
      model: this.imageModel,
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    })

    // Extract image from response
    const parts = response.candidates?.[0]?.content?.parts || []
    for (const part of parts) {
      if (part.inlineData) {
        const base64 = part.inlineData.data
        const mimeType = part.inlineData.mimeType || 'image/png'
        return `data:${mimeType};base64,${base64}`
      }
    }

    throw new Error('No image generated in response')
  }

  private buildImagePrompt(url: string, apiData: unknown): string {
    // Truncate API data if too large
    let dataStr = JSON.stringify(apiData, null, 2)
    if (dataStr.length > 10000) {
      dataStr = dataStr.substring(0, 10000) + '\n... (truncated)'
    }

    return `You are a web browser renderer. Generate an image of a webpage displaying this content.

VISUAL STYLE: ${this.currentStyle}

The page should display the data as a website with:
- A header with navigation
- Content sections with headlines, images, and descriptions
- Layout appropriate to the visual style specified above

Current URL: ${url}

API Data to display:
${dataStr}

Generate a realistic-looking webpage screenshot showing this content. Make it look like an actual website someone would browse.`
  }

  async handleClick(x: number, y: number) {
    if (!this.state.currentImage || !this.state.currentApiData) {
      return
    }

    this.updateState({
      loading: true,
      status: `Interpreting click at (${x}, ${y})...`,
      error: null,
    })

    try {
      // Send image + click to Gemini for interpretation
      const result = await this.interpretClick(x, y)

      if (result.action === 'navigate' && result.url) {
        console.log('[BananaBrowser] Navigating to:', result.url)
        await this.navigate(result.url)
      } else if (result.action === 'none') {
        this.updateState({
          loading: false,
          status: result.reason || 'No navigation target found',
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.updateState({
        loading: false,
        status: 'Error interpreting click',
        error: message,
      })
    }
  }

  private async interpretClick(
    x: number,
    y: number
  ): Promise<{ action: 'navigate' | 'none'; url?: string; reason?: string }> {
    // Extract base64 data from data URL
    const base64Match = this.state.currentImage!.match(/^data:([^;]+);base64,(.+)$/)
    if (!base64Match) {
      throw new Error('Invalid image format')
    }
    const mimeType = base64Match[1]
    const base64Data = base64Match[2]

    // Build prompt with API data context
    let apiDataStr = JSON.stringify(this.state.currentApiData, null, 2)
    if (apiDataStr.length > 8000) {
      apiDataStr = apiDataStr.substring(0, 8000) + '\n... (truncated)'
    }

    const prompt = `You are analyzing a click on a generated webpage image.

The user clicked at coordinates (${x}, ${y}) on this webpage image.

The page was generated from this API data:
${apiDataStr}

Look at the image and determine:
1. What element/content is at or near the click location?
2. Does it correspond to something in the API data that has a link/URL?

IMPORTANT: This is an API-based browser. You MUST use EXACT API URLs from the data.
- Use the EXACT URL from "links.api.self.href" - do NOT modify or guess URLs
- Copy the URL exactly as it appears in the API data
- Example correct URL: "https://content.core.api.espn.com/v1/sports/news/47168214"
- Do NOT shorten or alter paths (e.g., don't drop "/sports" from the path)
- If you cannot find an exact API URL in the data, respond with action "none"

If the click is on a news article, story, or any clickable element that has an associated API URL in the data, respond with JSON:
{"action": "navigate", "url": "THE_API_URL_HERE"}

If the click is not on any navigable element, respond with JSON:
{"action": "none", "reason": "Brief explanation of what was clicked"}

Respond ONLY with the JSON object, no other text.`

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        { text: prompt },
      ],
    })

    const text = response.text || ''

    // Parse JSON from response
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch {
      // If parsing fails, assume no navigation
    }

    return { action: 'none', reason: 'Could not interpret click' }
  }
}
