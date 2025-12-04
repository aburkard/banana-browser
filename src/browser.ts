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

export class BananaBrowser {
  private ai: GoogleGenAI
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

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey })
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

      // Save to history
      this.history.push({ url, apiData, image })

      this.updateState({
        loading: false,
        status: 'Page loaded',
        currentImage: image,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.updateState({
        loading: false,
        status: 'Error',
        error: message,
      })
    }
  }

  private async generatePageImage(url: string, apiData: unknown): Promise<string> {
    const prompt = this.buildImagePrompt(url, apiData)

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
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

The page should look like a modern, clean ESPN-style sports news website with:
- A header with the ESPN logo and navigation
- News article cards with headlines, images, and brief descriptions
- Clean typography and professional layout
- Proper spacing and visual hierarchy

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

If the click is on a news article, story, or any clickable element that has an associated API URL in the data, respond with JSON:
{"action": "navigate", "url": "THE_API_URL_HERE"}

If the click is not on any navigable element, respond with JSON:
{"action": "none", "reason": "Brief explanation of what was clicked"}

Look for URLs in the API data under fields like: "links", "href", "api", "$ref", "url", etc.

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
