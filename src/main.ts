import './style.css'
import { BananaBrowser, BOOKMARKS, STYLE_PRESETS, type ImageModel, type StylePreset, type UsageStats } from './browser'

const app = document.querySelector<HTMLDivElement>('#app')!

// Check for saved API key
const savedApiKey = localStorage.getItem('gemini_api_key')

function renderSetup() {
  app.innerHTML = `
    <header>
      <h1>🍌 Banana Browser</h1>
      <p>AI-generated web browsing powered by Gemini</p>
    </header>
    <div class="setup-panel">
      <label for="api-key">Gemini API Key</label>
      <input
        type="password"
        id="api-key"
        placeholder="Enter your Gemini API key..."
        value="${savedApiKey || ''}"
      />
      <button id="start-btn">Start Browsing</button>
      <p style="margin-top: 12px; font-size: 0.8rem; color: #666;">
        Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank" style="color: #f0db4f;">Google AI Studio</a>
      </p>
    </div>
  `

  const input = document.querySelector<HTMLInputElement>('#api-key')!
  const btn = document.querySelector<HTMLButtonElement>('#start-btn')!

  btn.addEventListener('click', () => {
    const apiKey = input.value.trim()
    if (!apiKey) {
      alert('Please enter an API key')
      return
    }
    localStorage.setItem('gemini_api_key', apiKey)
    startBrowser(apiKey)
  })

  // Allow Enter key to submit
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btn.click()
  })
}

function startBrowser(apiKey: string) {
  app.innerHTML = `
    <header>
      <h1>🍌 Banana Browser</h1>
      <p>Click anywhere on the page to navigate</p>
    </header>
    <div class="browser-container">
      <div class="address-bar">
        <button id="back-btn" title="Go back">←</button>
        <button id="forward-btn" title="Go forward">→</button>
        <select id="bookmarks-select" title="Bookmarks">
          <option value="">Bookmarks</option>
          ${Object.keys(BOOKMARKS).map(name =>
            `<option value="${name}">${name}</option>`
          ).join('')}
        </select>
        <input type="text" class="url-input" id="url-input" placeholder="Enter API URL..." />
        <button id="go-btn" title="Navigate">Go</button>
        <select id="model-select" title="Select image model">
          <option value="flash">Flash (fast)</option>
          <option value="pro">Pro (quality)</option>
        </select>
        <button id="reset-key-btn" title="Change API key">🔑</button>
      </div>
      <div class="style-bar">
        <label>Style:</label>
        <select id="style-select">
          ${Object.keys(STYLE_PRESETS).map(key =>
            `<option value="${key}">${key.charAt(0).toUpperCase() + key.slice(1)}</option>`
          ).join('')}
          <option value="custom">Custom...</option>
        </select>
        <input type="text" id="custom-style" placeholder="Describe your style..." style="display: none;" />
      </div>
      <div class="viewport-wrapper">
        <div class="viewport" id="viewport">
          <div class="placeholder">
            <p>Select a bookmark and click Go to start browsing</p>
          </div>
        </div>
        <div class="scrollbar" id="scrollbar">
          <button class="scroll-btn scroll-up" id="scroll-up">▲</button>
          <div class="scroll-track" id="scroll-track">
            <div class="scroll-thumb" id="scroll-thumb"></div>
          </div>
          <button class="scroll-btn scroll-down" id="scroll-down">▼</button>
        </div>
      </div>
      <div class="status-bar">
        <span id="status">Ready</span>
        <span id="usage-stats" class="usage-stats"></span>
      </div>
    </div>
  `

  const browser = new BananaBrowser(apiKey)

  const viewport = document.querySelector<HTMLDivElement>('#viewport')!
  const urlInput = document.querySelector<HTMLInputElement>('#url-input')!
  const goBtn = document.querySelector<HTMLButtonElement>('#go-btn')!
  const statusSpan = document.querySelector<HTMLSpanElement>('#status')!
  const usageStats = document.querySelector<HTMLSpanElement>('#usage-stats')!
  const backBtn = document.querySelector<HTMLButtonElement>('#back-btn')!
  const forwardBtn = document.querySelector<HTMLButtonElement>('#forward-btn')!
  const resetKeyBtn = document.querySelector<HTMLButtonElement>('#reset-key-btn')!
  const scrollUpBtn = document.querySelector<HTMLButtonElement>('#scroll-up')!
  const scrollDownBtn = document.querySelector<HTMLButtonElement>('#scroll-down')!
  const scrollTrack = document.querySelector<HTMLDivElement>('#scroll-track')!
  const scrollThumb = document.querySelector<HTMLDivElement>('#scroll-thumb')!

  // Format token count for display (e.g., 1234 -> "1.2k", 1234567 -> "1.2M")
  function formatTokens(count: number): string {
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(1)}M`
    } else if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}k`
    }
    return count.toString()
  }

  // Format usage stats for display
  function formatUsage(usage: UsageStats) {
    const parts = []
    if (usage.totalInputTokens > 0 || usage.totalOutputTokens > 0) {
      parts.push(`${formatTokens(usage.totalInputTokens)} in / ${formatTokens(usage.totalOutputTokens)} out`)
    }
    if (usage.estimatedCost > 0) {
      parts.push(`~$${usage.estimatedCost.toFixed(3)}`)
    }
    return parts.length > 0 ? parts.join(' | ') : ''
  }

  // Update UI based on browser state
  browser.onStateChange = (state) => {
    urlInput.value = state.currentUrl || ''
    statusSpan.textContent = state.status
    usageStats.textContent = formatUsage(state.usage)

    // Update scroll indicator
    if (state.scrollDepth > 1) {
      scrollThumb.style.display = 'block'
      const thumbHeight = Math.max(20, 100 / state.scrollDepth)
      scrollThumb.style.height = `${thumbHeight}%`
      const maxTop = 100 - thumbHeight
      const thumbTop = state.scrollDepth > 1 ? (state.scrollIndex / (state.scrollDepth - 1)) * maxTop : 0
      scrollThumb.style.top = `${thumbTop}%`
    } else {
      // At top with no scroll history - show thumb at top
      scrollThumb.style.display = 'block'
      scrollThumb.style.height = '100%'
      scrollThumb.style.top = '0%'
    }

    if (state.loading) {
      // Add glitch effect to existing content and overlay dancing banana
      viewport.classList.add('glitching')
      // Remove any existing loading overlay
      const existingOverlay = viewport.querySelector('.loading-overlay')
      if (!existingOverlay) {
        const overlay = document.createElement('div')
        overlay.className = 'loading-overlay'
        overlay.innerHTML = `
          <div class="dancing-banana">🍌</div>
          <p>${state.status}</p>
        `
        viewport.appendChild(overlay)
      } else {
        // Update status text
        const statusP = existingOverlay.querySelector('p')
        if (statusP) statusP.textContent = state.status
      }
    } else if (state.error) {
      viewport.classList.remove('glitching')
      viewport.querySelector('.loading-overlay')?.remove()
      viewport.innerHTML = `
        <div class="placeholder">
          <p>Error occurred</p>
          <div class="error">${state.error}</div>
        </div>
      `
    } else if (state.currentImage) {
      viewport.classList.remove('glitching')
      viewport.querySelector('.loading-overlay')?.remove()

      // Determine scroll direction for animation
      const oldCanvas = viewport.querySelector('canvas')
      const scrollDirection = state.scrollIndex > lastScrollIndex ? 'down' :
                              state.scrollIndex < lastScrollIndex ? 'up' : null
      lastScrollIndex = state.scrollIndex

      const canvas = document.createElement('canvas')
      const img = new Image()
      img.onload = () => {
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)

        // Apply scroll animation if we have an old canvas and a direction
        if (oldCanvas && scrollDirection) {
          canvas.classList.add(`scroll-enter-${scrollDirection}`)
          oldCanvas.classList.add(`scroll-exit-${scrollDirection}`)
          viewport.appendChild(canvas)

          // Remove old canvas after animation
          setTimeout(() => {
            oldCanvas.remove()
            canvas.classList.remove(`scroll-enter-${scrollDirection}`)
          }, 300)
        } else {
          viewport.innerHTML = ''
          viewport.appendChild(canvas)
        }

        // Handle clicks on the canvas
        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect()
          const scaleX = canvas.width / rect.width
          const scaleY = canvas.height / rect.height
          const x = Math.round((e.clientX - rect.left) * scaleX)
          const y = Math.round((e.clientY - rect.top) * scaleY)
          browser.handleClick(x, y)
        })
      }
      img.src = state.currentImage
    }
  }

  // Track scroll position for animation direction
  let lastScrollIndex = 0

  const modelSelect = document.querySelector<HTMLSelectElement>('#model-select')!
  const bookmarksSelect = document.querySelector<HTMLSelectElement>('#bookmarks-select')!
  const styleSelect = document.querySelector<HTMLSelectElement>('#style-select')!
  const customStyleInput = document.querySelector<HTMLInputElement>('#custom-style')!

  backBtn.addEventListener('click', () => browser.goBack())
  forwardBtn.addEventListener('click', () => browser.goForward())

  bookmarksSelect.addEventListener('change', () => {
    const selected = bookmarksSelect.value
    console.log('[UI] Bookmark selected:', selected)
    console.log('[UI] BOOKMARKS object:', BOOKMARKS)
    console.log('[UI] URL to set:', (BOOKMARKS as Record<string, string>)[selected])
    if (selected && (BOOKMARKS as Record<string, string>)[selected]) {
      urlInput.value = (BOOKMARKS as Record<string, string>)[selected]
      bookmarksSelect.value = '' // Reset to "Bookmarks" label
    }
  })

  goBtn.addEventListener('click', () => {
    const url = urlInput.value.trim()
    if (url) browser.navigate(url)
  })

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goBtn.click()
  })
  modelSelect.addEventListener('change', () => {
    browser.setModel(modelSelect.value as ImageModel)
  })

  styleSelect.addEventListener('change', () => {
    if (styleSelect.value === 'custom') {
      customStyleInput.style.display = 'block'
      // Apply custom style if there's already text
      const customStyle = customStyleInput.value.trim()
      if (customStyle) {
        browser.setStyle(customStyle)
      }
    } else {
      customStyleInput.style.display = 'none'
      browser.setStyle(styleSelect.value as StylePreset)
    }
  })

  // Apply custom style on blur or Enter
  customStyleInput.addEventListener('blur', () => {
    const customStyle = customStyleInput.value.trim()
    if (customStyle) {
      browser.setStyle(customStyle)
    }
  })

  customStyleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const customStyle = customStyleInput.value.trim()
      if (customStyle) {
        browser.setStyle(customStyle)
      }
      customStyleInput.blur()
    }
  })

  resetKeyBtn.addEventListener('click', () => {
    if (confirm('Change API key?')) {
      renderSetup()
    }
  })

  // Scroll controls
  scrollUpBtn.addEventListener('click', () => {
    browser.scrollUp()
  })

  scrollDownBtn.addEventListener('click', () => {
    browser.scrollDown()
  })

  // Click on track also scrolls down (simpler UX)
  scrollTrack.addEventListener('click', () => {
    browser.scrollDown()
  })
}

// Start the app
if (savedApiKey) {
  startBrowser(savedApiKey)
} else {
  renderSetup()
}
