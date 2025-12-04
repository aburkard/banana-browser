import './style.css'
import { BananaBrowser } from './browser'

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
        <button id="home-btn" title="Go home">🏠</button>
        <div class="url" id="current-url">Ready to browse...</div>
        <button id="reset-key-btn" title="Change API key">🔑</button>
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
  const urlBar = document.querySelector<HTMLDivElement>('#current-url')!
  const statusBar = document.querySelector<HTMLDivElement>('#status')!
  const homeBtn = document.querySelector<HTMLButtonElement>('#home-btn')!
  const backBtn = document.querySelector<HTMLButtonElement>('#back-btn')!
  const resetKeyBtn = document.querySelector<HTMLButtonElement>('#reset-key-btn')!

  // Update UI based on browser state
  browser.onStateChange = (state) => {
    urlBar.textContent = state.currentUrl || 'Ready to browse...'
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

  homeBtn.addEventListener('click', () => browser.goHome())
  backBtn.addEventListener('click', () => browser.goBack())
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
