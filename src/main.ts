import './style.css'
import { BananaBrowser, STYLE_PRESETS, type ImageModel, type StylePreset } from './browser'

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
        <button id="home-btn" title="Go home">🏠</button>
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
        <button id="apply-style-btn" style="display: none;">Apply</button>
      </div>
      <div class="viewport" id="viewport">
        <div class="placeholder">
          <p>Click "Go Home" to load the ESPN NFL news page</p>
        </div>
      </div>
      <div class="status-bar" id="status">Ready</div>
    </div>
  `

  const browser = new BananaBrowser(apiKey)

  const viewport = document.querySelector<HTMLDivElement>('#viewport')!
  const urlInput = document.querySelector<HTMLInputElement>('#url-input')!
  const goBtn = document.querySelector<HTMLButtonElement>('#go-btn')!
  const statusBar = document.querySelector<HTMLDivElement>('#status')!
  const homeBtn = document.querySelector<HTMLButtonElement>('#home-btn')!
  const backBtn = document.querySelector<HTMLButtonElement>('#back-btn')!
  const forwardBtn = document.querySelector<HTMLButtonElement>('#forward-btn')!
  const resetKeyBtn = document.querySelector<HTMLButtonElement>('#reset-key-btn')!

  // Update UI based on browser state
  browser.onStateChange = (state) => {
    urlInput.value = state.currentUrl || ''
    statusBar.textContent = state.status

    if (state.loading) {
      viewport.innerHTML = `
        <div class="loading">
          <div class="spinner"></div>
          <p>${state.status}</p>
        </div>
      `
    } else if (state.error) {
      viewport.innerHTML = `
        <div class="placeholder">
          <p>Error occurred</p>
          <div class="error">${state.error}</div>
        </div>
      `
    } else if (state.currentImage) {
      viewport.innerHTML = ''
      const canvas = document.createElement('canvas')
      const img = new Image()
      img.onload = () => {
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        viewport.appendChild(canvas)

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

  const modelSelect = document.querySelector<HTMLSelectElement>('#model-select')!
  const styleSelect = document.querySelector<HTMLSelectElement>('#style-select')!
  const customStyleInput = document.querySelector<HTMLInputElement>('#custom-style')!
  const applyStyleBtn = document.querySelector<HTMLButtonElement>('#apply-style-btn')!

  homeBtn.addEventListener('click', () => browser.goHome())
  backBtn.addEventListener('click', () => browser.goBack())
  forwardBtn.addEventListener('click', () => browser.goForward())

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
      applyStyleBtn.style.display = 'block'
    } else {
      customStyleInput.style.display = 'none'
      applyStyleBtn.style.display = 'none'
      browser.setStyle(styleSelect.value as StylePreset)
    }
  })

  applyStyleBtn.addEventListener('click', () => {
    const customStyle = customStyleInput.value.trim()
    if (customStyle) {
      browser.setStyle(customStyle)
    }
  })

  customStyleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyStyleBtn.click()
  })

  resetKeyBtn.addEventListener('click', () => {
    if (confirm('Change API key?')) {
      renderSetup()
    }
  })
}

// Start the app
if (savedApiKey) {
  startBrowser(savedApiKey)
} else {
  renderSetup()
}
