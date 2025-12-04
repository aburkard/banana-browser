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

// Bookmarked API endpoints
export const BOOKMARKS = {
  'ESPN NFL News': 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news',
  'ESPN NBA Scores': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
  'Hacker News': 'https://hacker-news.firebaseio.com/v0/topstories.json',
  'Reddit r/news': 'https://www.reddit.com/r/news.json',
  'Reddit r/technology': 'https://www.reddit.com/r/technology.json',
  'Reddit r/science': 'https://www.reddit.com/r/science.json',
} as const

export type Bookmark = keyof typeof BOOKMARKS

const DEFAULT_HOME_URL = BOOKMARKS['ESPN NFL News']

// Image generation models
export const IMAGE_MODELS = {
  flash: 'gemini-2.5-flash-image',        // Nano Banana - faster (500 RPM, 2K RPD)
  pro: 'gemini-3-pro-image-preview',      // Nano Banana Pro - higher quality (20 RPM, 250 RPD)
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
  private historyIndex: number = -1

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

  private async fetchApiData(url: string): Promise<unknown> {
    // Special handling for Hacker News
    if (url.includes('hacker-news.firebaseio.com') && url.includes('topstories')) {
      return this.fetchHackerNews()
    }

    // Default: just fetch the URL
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.json()
  }

  private async fetchHackerNews(): Promise<unknown> {
    this.updateState({ status: 'Fetching Hacker News stories...' })

    // Get top story IDs
    const idsResponse = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')
    if (!idsResponse.ok) throw new Error('Failed to fetch HN stories')
    const ids: number[] = await idsResponse.json()

    // Fetch first 15 stories in parallel
    const top15Ids = ids.slice(0, 15)
    this.updateState({ status: `Fetching ${top15Ids.length} stories...` })

    const stories = await Promise.all(
      top15Ids.map(async (id) => {
        const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
        return res.json()
      })
    )

    return {
      source: 'Hacker News',
      stories: stories.filter(Boolean),
    }
  }

  async goHome() {
    await this.navigate(DEFAULT_HOME_URL)
  }

  async goBack() {
    if (this.historyIndex > 0) {
      this.historyIndex--
      const entry = this.history[this.historyIndex]
      this.updateState({
        currentUrl: entry.url,
        currentImage: entry.image,
        currentApiData: entry.apiData,
        status: 'Navigated back',
      })
    }
  }

  async goForward() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++
      const entry = this.history[this.historyIndex]
      this.updateState({
        currentUrl: entry.url,
        currentImage: entry.image,
        currentApiData: entry.apiData,
        status: 'Navigated forward',
      })
    }
  }

  async navigate(url: string) {
    // Check cache first (includes model and style in key)
    const cacheKey = getCacheKey(url, this.imageModel, this.currentStyle)
    const cached = imageCache.get(cacheKey)
    if (cached) {
      // Truncate forward history and add new entry
      this.history = this.history.slice(0, this.historyIndex + 1)
      this.history.push({ url, apiData: cached.apiData, image: cached.image })
      this.historyIndex = this.history.length - 1
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
      // Fetch API data (with special handling for HN)
      const apiData = await this.fetchApiData(url)

      this.updateState({
        status: 'Generating webpage image...',
        currentApiData: apiData,
      })

      // Generate image from API data
      const image = await this.generatePageImage(url, apiData)

      // Save to cache (keyed by url+model+style)
      imageCache.set(cacheKey, { image, apiData })

      // Truncate forward history and add new entry
      this.history = this.history.slice(0, this.historyIndex + 1)
      this.history.push({ url, apiData, image })
      this.historyIndex = this.history.length - 1

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

    console.log('[BananaBrowser] ====== IMAGE GENERATION ======')
    console.log('[BananaBrowser] Model:', this.imageModel)
    console.log('[BananaBrowser] Prompt:', prompt)
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

  private buildImagePrompt(_url: string, apiData: unknown): string {
    // Truncate API data if too large
    let dataStr = JSON.stringify(apiData, null, 2)
    if (dataStr.length > 10000) {
      dataStr = dataStr.substring(0, 10000) + '\n... (truncated)'
    }

    return `Generate a screenshot of a webpage displaying this content.

VISUAL STYLE: ${this.currentStyle}

DATA:
${dataStr}

Render this data as a realistic webpage.`
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

    console.log('[BananaBrowser] ====== CLICK INTERPRETATION ======')
    console.log('[BananaBrowser] Click coordinates:', { x, y })
    console.log('[BananaBrowser] Prompt sent to model:')
    console.log(prompt)
    console.log('[BananaBrowser] Image size (base64 length):', base64Data.length)

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

    console.log('[BananaBrowser] Raw model response:')
    console.log(text)

    // Parse JSON from response
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0])
        console.log('[BananaBrowser] Parsed result:', result)
        return result
      }
    } catch (e) {
      console.log('[BananaBrowser] JSON parse error:', e)
    }

    console.log('[BananaBrowser] Failed to parse response, returning none')
    return { action: 'none', reason: 'Could not interpret click' }
  }
}
