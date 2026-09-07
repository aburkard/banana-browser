import './style.css'
import { createProgress } from './progress'
import { renderSourceAttribution } from './source-attribution'
import { mountChatGPTPanel } from './chatgpt-ui'
import { hasSubscription, subscriptionGenerate } from './subscription'
import { CONNECTION_KEY, readPreferredConnection, resolveStartupConnection } from './connections'
import {
  BananaBrowser,
  BOOKMARKS,
  CLICK_MODELS,
  IMAGE_MODELS,
  STYLE_PRESETS,
  estimateImageCost,
  type ClickModel,
  type ImageModel,
  type Quality,
  type ReasoningEffort,
  type StylePreset,
  type ThinkingLevel,
  type UsageStats,
} from './browser'

const app = document.querySelector<HTMLDivElement>('#app')!
let disposeSetup: (() => void) | undefined
let disposeBrowser: (() => void) | undefined

function renderSetup(onBack?: () => void) {
  if (!onBack) {
    disposeBrowser?.()
    disposeBrowser = undefined
  }
  disposeSetup?.()
  app.innerHTML = `
    <header>
      <h1>🍌 Banana Browser</h1>
      <p>The web, made up as you go.</p>
    </header>
    <div class="setup-panel">
      ${onBack ? '<button id="back-to-browser" class="secondary-button">← Back to browser</button>' : ''}
      <section id="chatgpt-panel" aria-label="ChatGPT connection"></section>
      <section class="api-key-option" aria-labelledby="api-option-title"><h2 id="api-option-title">Use API credits</h2>
      <label for="gemini-key">Gemini API Key (for Gemini Flash/Pro)</label>
      <input
        type="password"
        id="gemini-key"
        placeholder="Enter your Gemini API key..."
      />
      <p style="margin-top: 4px; margin-bottom: 12px; font-size: 0.75rem; color: #666;">
        Get from <a href="https://aistudio.google.com/apikey" target="_blank" style="color: #f0db4f;">Google AI Studio</a>
      </p>

      <label for="openai-key">OpenAI API Key</label>
      <input
        type="password"
        id="openai-key"
        placeholder="Enter your OpenAI API key..."
      />
      <p style="margin-top: 4px; margin-bottom: 16px; font-size: 0.75rem; color: #666;">
        Get from <a href="https://platform.openai.com/api-keys" target="_blank" style="color: #f0db4f;">OpenAI Platform</a>
      </p>

      <button id="start-btn">Use API credits</button>
      </section>
    </div>
    <dialog id="api-confirmation" aria-labelledby="api-confirmation-title">
      <h2 id="api-confirmation-title">Use API credits?</h2>
      <p>Billed to your API keys, separately from ChatGPT.</p>
      <div class="confirmation-actions"><button id="cancel-api">Cancel</button><button id="confirm-api">Use API credits</button></div>
    </dialog>
  `

  const geminiInput = document.querySelector<HTMLInputElement>('#gemini-key')!
  const openaiInput = document.querySelector<HTMLInputElement>('#openai-key')!
  const btn = document.querySelector<HTMLButtonElement>('#start-btn')!
  geminiInput.value = localStorage.getItem('gemini_api_key') || ''
  openaiInput.value = localStorage.getItem('openai_api_key') || ''
  const dialog = document.querySelector<HTMLDialogElement>('#api-confirmation')!
  let pendingKeys: {gemini: string; openai: string} | undefined
  const disposeChatGPT = mountChatGPTPanel(document.querySelector('#chatgpt-panel')!, () => startBrowser(undefined, undefined, true))
  disposeSetup = () => { disposeChatGPT(); pendingKeys = undefined; dialog.close() }
  document.querySelector<HTMLButtonElement>('#back-to-browser')?.addEventListener('click', () => {
    disposeSetup?.()
    disposeSetup = undefined
    onBack?.()
  })

  btn.addEventListener('click', () => {
    const geminiKey = geminiInput.value.trim()
    const openaiKey = openaiInput.value.trim()
    if (!geminiKey && !openaiKey) {
      alert('Please enter at least one API key')
      return
    }
    pendingKeys = {gemini: geminiKey, openai: openaiKey}
    dialog.showModal()
    document.querySelector<HTMLButtonElement>('#cancel-api')!.focus()
  })

  document.querySelector('#cancel-api')!.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => { pendingKeys = undefined })
  document.querySelector('#confirm-api')!.addEventListener('click', () => {
    if (!pendingKeys) return
    const {gemini: geminiKey, openai: openaiKey} = pendingKeys
    pendingKeys = undefined
    dialog.close()
    if (geminiKey) localStorage.setItem('gemini_api_key', geminiKey)
    else localStorage.removeItem('gemini_api_key')
    if (openaiKey) localStorage.setItem('openai_api_key', openaiKey)
    else localStorage.removeItem('openai_api_key')
    startBrowser(geminiKey || undefined, openaiKey || undefined)
  })

  // Allow Enter key to submit from either input
  const handleEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') btn.click()
  }
  geminiInput.addEventListener('keydown', handleEnter)
  openaiInput.addEventListener('keydown', handleEnter)
}

function startBrowser(geminiApiKey?: string, openaiApiKey?: string, useSubscription = false) {
  disposeBrowser?.()
  disposeBrowser = undefined
  disposeSetup?.()
  disposeSetup = undefined
  localStorage.setItem(CONNECTION_KEY, useSubscription ? 'chatgpt' : 'api')
  // Determine which models are available based on API keys
  const availableModels = Object.entries(IMAGE_MODELS).filter(([key, info]) => {
    if (useSubscription) return key === 'gpt-image-2'
    if (info.provider === 'gemini') return !!geminiApiKey
    if (info.provider === 'openai') return !!openaiApiKey
    return false
  })
  const availableClickModels = Object.entries(CLICK_MODELS).filter(([key, info]) => {
    if (useSubscription) return ['gpt-5.6-luna', 'gpt-5.6-terra'].includes(key)
    if (info.provider === 'gemini') return !!geminiApiKey
    if (info.provider === 'openai') return !!openaiApiKey
    return false
  })

  // Prefer gpt-image-2 when available, otherwise use Google's fastest/cheapest
  // Gemini image model for Gemini-only users.
  const initialImageModelKey: ImageModel = (useSubscription || openaiApiKey ? 'gpt-image-2' : 'flash-lite') as ImageModel

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
          ${availableModels.map(([key, info]) =>
            `<option value="${key}"${key === initialImageModelKey ? ' selected' : ''}>${info.name}</option>`
          ).join('')}
        </select>
        <span id="price-badge" class="price-badge" title="Estimated cost per image generation"></span>
        <button id="advanced-toggle" title="Advanced settings">⚙</button>
        <button id="reset-key-btn" class="connection-button" title="Change connection" aria-label="Change connection: ${useSubscription ? 'ChatGPT plan' : 'API credits'}">${useSubscription ? 'ChatGPT plan' : 'API credits'} ▾</button>
      </div>
      <div class="advanced-bar" id="advanced-bar" style="display: none;">
        <div class="advanced-row" id="image-advanced">
          <span class="advanced-label">Image:</span>
          <label id="size-wrap">Size <select id="size-select"></select></label>
          <label id="quality-wrap" style="display:none;">Quality <select id="quality-select"></select></label>
          <label id="image-thinking-wrap" style="display:none;">Thinking <select id="image-thinking-select"></select></label>
        </div>
        <div class="advanced-row" id="click-advanced">
          <span class="advanced-label">Clicks:</span>
          <label>Model <select id="click-model-select">
            ${availableClickModels.map(([key, info]) =>
              `<option value="${key}">${info.name}</option>`
            ).join('')}
          </select></label>
          <label id="effort-wrap" style="display:none;">Effort <select id="effort-select"></select></label>
          <label id="click-thinking-wrap" style="display:none;">Thinking <select id="click-thinking-select"></select></label>
        </div>
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
      <div class="section-controls" id="section-controls" hidden>
        <button id="previous-section">Previous section</button>
        <span id="section-position"></span>
        <button id="next-section">Next section</button>
      </div>
      <div class="viewport-wrapper">
        <div class="viewport" id="viewport">
          <div class="placeholder">
            <p>Select a bookmark and click Go to start browsing</p>
          </div>
        </div>
        <div class="scrollbar" id="scrollbar">
          <button class="scroll-btn scroll-up" id="scroll-up" aria-label="Scroll up">▲</button>
          <div class="scroll-track" id="scroll-track">
            <div class="scroll-thumb" id="scroll-thumb"></div>
          </div>
          <button class="scroll-btn scroll-down" id="scroll-down" aria-label="Scroll down">▼</button>
        </div>
      </div>
      <div class="source-attribution" id="source-attribution" hidden></div>
      <div class="status-bar">
        <span id="status">Ready</span>
        <details id="usage-details" class="usage-details" ${useSubscription ? '' : 'style="display: none;"'}>
          <summary id="usage-stats" class="usage-stats">${useSubscription ? 'Usage ▾' : ''}</summary>
          <div id="usage-breakdown" class="usage-breakdown">${useSubscription ? '<p class="breakdown-empty">No calls yet. Counts reset when you reload or change connections.</p>' : ''}</div>
        </details>
      </div>
    </div>
  `

  const browser = new BananaBrowser(geminiApiKey, openaiApiKey, initialImageModelKey, useSubscription ? subscriptionGenerate : undefined)

  const viewport = document.querySelector<HTMLDivElement>('#viewport')!
  const sourceAttribution = document.querySelector<HTMLDivElement>('#source-attribution')!
  const urlInput = document.querySelector<HTMLInputElement>('#url-input')!
  const goBtn = document.querySelector<HTMLButtonElement>('#go-btn')!
  const statusSpan = document.querySelector<HTMLSpanElement>('#status')!
  const progress = createProgress(text => {
    statusSpan.textContent = text
    const caption = viewport.querySelector('.loading-overlay p')
    if (caption) caption.textContent = text
  })
  let disposed = false
  disposeBrowser = () => { disposed = true; progress.dispose() }
  const usageStats = document.querySelector<HTMLElement>('#usage-stats')!
  const usageBreakdown = document.querySelector<HTMLDivElement>('#usage-breakdown')!
  const usageDetails = document.querySelector<HTMLDetailsElement>('#usage-details')!
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
    if (useSubscription) {
      return `Usage · ${usage.imageGenerations} ${usage.imageGenerations === 1 ? 'image' : 'images'} · ${usage.clickInterpretations} ${usage.clickInterpretations === 1 ? 'click' : 'clicks'} ▾`
    }
    const parts = []
    if (usage.totalInputTokens > 0 || usage.totalOutputTokens > 0) {
      parts.push(`${formatTokens(usage.totalInputTokens)} in / ${formatTokens(usage.totalOutputTokens)} out`)
    }
    if (usage.estimatedCost > 0 || usage.costIncomplete) {
      parts.push(usage.costIncomplete && usage.estimatedCost === 0 ? 'Cost unavailable ▾' : `Session ~$${usage.estimatedCost.toFixed(3)}${usage.costIncomplete ? ' (partial)' : ''} ▾`)
    }
    return parts.length > 0 ? parts.join(' | ') : ''
  }

  function renderBreakdown(usage: UsageStats) {
    const tokenDetails = (line: UsageStats['byModel'][string]) => {
      const details = [
        line.cachedTokens !== undefined ? `${formatTokens(line.cachedTokens)} cached` : '',
        line.cacheWriteTokens !== undefined ? `${formatTokens(line.cacheWriteTokens)} cache writes` : '',
        line.reasoningTokens !== undefined ? `${formatTokens(line.reasoningTokens)} reasoning` : '',
        line.unknownUsageCalls ? `${line.unknownUsageCalls} with missing usage` : '',
      ].filter(Boolean);
      return details.length ? `<br><small>Reported: ${details.join(' · ')}</small>` : '';
    };
    const lines = Object.values(usage.byModel).sort((a, b) => b.cost - a.cost)
    if (useSubscription) {
      usageBreakdown.innerHTML = `<table class="breakdown-table"><thead><tr><th>Model</th><th>Calls</th><th>Tokens (in/out)</th></tr></thead><tbody>${lines.map(l => `<tr><td>${l.label}</td><td class="num">${l.calls}</td><td class="num">${formatTokens(l.inputTokens)} / ${formatTokens(l.outputTokens)}${tokenDetails(l)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${lines.reduce((sum, line) => sum + line.calls, 0)}</td><td class="num">${formatTokens(usage.totalInputTokens)} / ${formatTokens(usage.totalOutputTokens)}</td></tr></tfoot></table><p class="breakdown-empty">Counts reset when you reload or change connections. Remaining ChatGPT limits aren’t shown here.</p>`
      return
    }
    if (lines.length === 0) {
      usageBreakdown.innerHTML = '<p class="breakdown-empty">No calls yet.</p>'
      return
    }
    const total = usage.estimatedCost || 1
    const rows = lines.map(l => {
      const pct = Math.round((l.cost / total) * 100)
      const tag = l.category === 'image' ? 'img' : 'click'
      return `
        <tr>
          <td><span class="breakdown-tag tag-${l.category}">${tag}</span> ${l.label}</td>
          <td class="num">${l.calls}</td>
          <td class="num">${formatTokens(l.inputTokens)} / ${formatTokens(l.outputTokens)}${tokenDetails(l)}</td>
          <td class="num">$${l.inputCost.toFixed(4)}</td>
          <td class="num">$${l.outputCost.toFixed(4)}</td>
          <td class="num">${l.costIncomplete && l.cost === 0 ? 'Unknown*' : `$${l.cost.toFixed(4)}${l.costIncomplete ? '*' : ''}`}</td>
          <td class="num">${pct}%</td>
        </tr>
      `
    }).join('')
    const totalInputCost = lines.reduce((s, l) => s + l.inputCost, 0)
    const totalOutputCost = lines.reduce((s, l) => s + l.outputCost, 0)
    usageBreakdown.innerHTML = `
      <table class="breakdown-table">
        <thead>
          <tr>
            <th>Model</th>
            <th class="num">Calls</th>
            <th class="num">Tokens (in/out)</th>
            <th class="num">In $</th>
            <th class="num">Out $</th>
            <th class="num">Total</th>
            <th class="num">%</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td class="num">${lines.reduce((s, l) => s + l.calls, 0)}</td>
            <td class="num">${formatTokens(usage.totalInputTokens)} / ${formatTokens(usage.totalOutputTokens)}</td>
            <td class="num">$${totalInputCost.toFixed(4)}</td>
            <td class="num">$${totalOutputCost.toFixed(4)}</td>
            <td class="num">${usage.costIncomplete && usage.estimatedCost === 0 ? 'Unknown*' : `$${usage.estimatedCost.toFixed(4)}${usage.costIncomplete ? '*' : ''}`}</td>
            <td class="num">100%</td>
          </tr>
        </tfoot>
      </table>
      <p class="breakdown-empty">This connection session; resets on reload. ${usage.costIncomplete ? '* Some usage or rates are missing; charges may be higher. ' : ''}Provider billing is authoritative.</p>
    `
  }

  const sectionControls = document.querySelector<HTMLElement>('#section-controls')!
  const previousSectionButton = document.querySelector<HTMLButtonElement>('#previous-section')!
  const nextSectionButton = document.querySelector<HTMLButtonElement>('#next-section')!
  const sectionPosition = document.querySelector<HTMLElement>('#section-position')!

  // Update UI based on browser state
  browser.onStateChange = (state) => {
    if (disposed) return
    document.querySelectorAll<HTMLSelectElement | HTMLInputElement>(
      '#model-select, #style-select, #custom-style, #size-select, #quality-select, #image-thinking-select, #click-model-select, #effort-select, #click-thinking-select'
    ).forEach(control => { control.disabled = state.loading })
    renderSourceAttribution(sourceAttribution, state.currentUrl, state.currentApiData)
    urlInput.value = state.currentUrl || ''
    const hasUsage = useSubscription || state.usage.imageGenerations > 0 || state.usage.clickInterpretations > 0
    usageDetails.style.display = hasUsage ? '' : 'none'
    usageStats.textContent = formatUsage(state.usage)
    renderBreakdown(state.usage)

    sectionControls.hidden = state.sectionCount <= 1
    previousSectionButton.disabled = state.loading || state.sectionIndex === 0
    nextSectionButton.disabled = state.loading || state.sectionIndex >= state.sectionCount - 1
    sectionPosition.textContent = `${state.sectionIndex + 1} / ${state.sectionCount}`
    scrollUpBtn.disabled = state.loading || !state.currentImage || !browser.canScrollUp()
    scrollDownBtn.disabled = state.loading || !state.currentImage || !browser.canScrollDown()

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
          <p></p>
        `
        overlay.querySelector('p')!.textContent = state.status
        viewport.appendChild(overlay)
      } else {
        // Update status text
        const statusP = existingOverlay.querySelector('p')
        if (statusP) statusP.textContent = state.status
      }
    } else if (state.error) {
      requestedImage = null
      imageRevision++
      viewport.classList.remove('glitching')
      viewport.querySelector('.loading-overlay')?.remove()
      viewport.innerHTML = `
        <div class="placeholder">
          <p>Error occurred</p>
          <div class="error"></div>
        </div>
      `
      viewport.querySelector('.error')!.textContent = state.error
    } else if (state.currentImage) {
      viewport.classList.remove('glitching')
      viewport.querySelector('.loading-overlay')?.remove()

      // Status-only changes must not restart an in-flight image or animation.
      if (state.currentImage !== requestedImage) {
        requestedImage = state.currentImage
        const revision = ++imageRevision
        // Determine scroll direction for animation
        const scrollDirection = state.scrollIndex > lastScrollIndex ? 'down' :
                                state.scrollIndex < lastScrollIndex ? 'up' : null
        lastScrollIndex = state.scrollIndex

        const canvas = document.createElement('canvas')
        const img = new Image()
        img.onload = () => {
          if (disposed || revision !== imageRevision) return
          const canvases = Array.from(viewport.querySelectorAll('canvas'))
          const oldCanvas = canvases.pop()
          canvases.forEach(stale => stale.remove())
          if (oldCanvas) oldCanvas.className = ''
          viewport.querySelector('.placeholder')?.remove()
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
              if (disposed || revision !== imageRevision) return
              viewport.querySelectorAll('canvas').forEach(stale => { if (stale !== canvas) stale.remove() })
              canvas.classList.remove(`scroll-enter-${scrollDirection}`)
            }, 300)
          } else {
            oldCanvas?.remove()
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
    progress.update(state.loading, state.status)
  }

  // Track scroll position for animation direction
  let lastScrollIndex = 0
  let requestedImage: string | null = null
  let imageRevision = 0

  const modelSelect = document.querySelector<HTMLSelectElement>('#model-select')!
  const bookmarksSelect = document.querySelector<HTMLSelectElement>('#bookmarks-select')!
  const styleSelect = document.querySelector<HTMLSelectElement>('#style-select')!
  const customStyleInput = document.querySelector<HTMLInputElement>('#custom-style')!
  const advancedToggle = document.querySelector<HTMLButtonElement>('#advanced-toggle')!
  const advancedBar = document.querySelector<HTMLDivElement>('#advanced-bar')!
  const priceBadge = document.querySelector<HTMLSpanElement>('#price-badge')!
  const sizeSelect = document.querySelector<HTMLSelectElement>('#size-select')!
  const qualityWrap = document.querySelector<HTMLLabelElement>('#quality-wrap')!
  const qualitySelect = document.querySelector<HTMLSelectElement>('#quality-select')!
  const imageThinkingWrap = document.querySelector<HTMLLabelElement>('#image-thinking-wrap')!
  const imageThinkingSelect = document.querySelector<HTMLSelectElement>('#image-thinking-select')!
  const clickModelSelect = document.querySelector<HTMLSelectElement>('#click-model-select')!
  const effortWrap = document.querySelector<HTMLLabelElement>('#effort-wrap')!
  const effortSelect = document.querySelector<HTMLSelectElement>('#effort-select')!
  const clickThinkingWrap = document.querySelector<HTMLLabelElement>('#click-thinking-wrap')!
  const clickThinkingSelect = document.querySelector<HTMLSelectElement>('#click-thinking-select')!

  function fillSelect(sel: HTMLSelectElement, options: { value: string; label: string }[], current?: string) {
    sel.innerHTML = options.map(o => `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`).join('')
  }

  function updatePriceBadge() {
    if (useSubscription) {
      priceBadge.textContent = ''
      priceBadge.title = ''
      return
    }
    const modelKey = modelSelect.value as ImageModel
    const opts = browser.getImageOptions()
    const est = estimateImageCost(modelKey, opts)
    if (est == null) {
      priceBadge.textContent = ''
      priceBadge.title = ''
      return
    }
    priceBadge.textContent = `~$${est.total.toFixed(3)}/img`
    priceBadge.title =
      `Estimated per generation:\n` +
      `  input  ~$${est.input.toFixed(4)} (assumes ${1500} prompt tokens)\n` +
      `  output ~$${est.output.toFixed(4)}\n` +
      `  total  ~$${est.total.toFixed(4)}`
  }

  function renderImageAdvanced() {
    const modelKey = modelSelect.value as ImageModel
    const spec = IMAGE_MODELS[modelKey]
    const opts = browser.getImageOptions()
    // The plan endpoint overrides size and quality; do not offer controls it ignores.
    document.querySelector<HTMLElement>('#size-wrap')!.style.display = useSubscription ? 'none' : ''
    fillSelect(sizeSelect, spec.sizes.map(s => ({ value: s.value, label: s.label })), opts.size)
    if (spec.qualities && !useSubscription) {
      fillSelect(qualitySelect, spec.qualities.map(q => ({ value: q, label: q })), opts.quality)
      qualityWrap.style.display = ''
    } else {
      qualityWrap.style.display = 'none'
    }
    if (spec.thinkingLevels) {
      fillSelect(imageThinkingSelect, spec.thinkingLevels.map(t => ({ value: t, label: t })), opts.thinkingLevel)
      imageThinkingWrap.style.display = ''
    } else {
      imageThinkingWrap.style.display = 'none'
    }
    updatePriceBadge()
  }

  function renderClickAdvanced() {
    const modelKey = browser.getClickModel()
    clickModelSelect.value = modelKey
    const spec = CLICK_MODELS[modelKey]
    const opts = browser.getClickOptions()
    if (spec.reasoningEfforts) {
      fillSelect(effortSelect, spec.reasoningEfforts.map(e => ({ value: e, label: e })), opts.reasoningEffort)
      effortWrap.style.display = ''
    } else {
      effortWrap.style.display = 'none'
    }
    if (spec.thinkingLevels) {
      fillSelect(clickThinkingSelect, spec.thinkingLevels.map(t => ({ value: t, label: t })), opts.thinkingLevel)
      clickThinkingWrap.style.display = ''
    } else {
      clickThinkingWrap.style.display = 'none'
    }
  }

  // Initialize advanced UI
  renderImageAdvanced()
  renderClickAdvanced()

  advancedToggle.addEventListener('click', () => {
    const hidden = advancedBar.style.display === 'none'
    advancedBar.style.display = hidden ? '' : 'none'
    advancedToggle.classList.toggle('active', hidden)
  })

  sizeSelect.addEventListener('change', () => {
    browser.setImageOptions({ size: sizeSelect.value })
    updatePriceBadge()
  })
  qualitySelect.addEventListener('change', () => {
    browser.setImageOptions({ quality: qualitySelect.value as Quality })
    updatePriceBadge()
  })
  imageThinkingSelect.addEventListener('change', () => {
    browser.setImageOptions({ thinkingLevel: imageThinkingSelect.value as ThinkingLevel })
  })
  clickModelSelect.addEventListener('change', () => {
    browser.setClickModel(clickModelSelect.value as ClickModel)
    renderClickAdvanced()
  })
  effortSelect.addEventListener('change', () => {
    browser.setClickOptions({ reasoningEffort: effortSelect.value as ReasoningEffort })
  })
  clickThinkingSelect.addEventListener('change', () => {
    browser.setClickOptions({ thinkingLevel: clickThinkingSelect.value as ThinkingLevel })
  })

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
    renderImageAdvanced()
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
    const browserView = document.createDocumentFragment()
    browserView.append(...app.childNodes)
    renderSetup(() => {
      app.replaceChildren(browserView)
      resetKeyBtn.focus()
    })
  })

  // Scroll controls
  document.querySelector('#previous-section')!.addEventListener('click', () => browser.previousSection())
  document.querySelector('#next-section')!.addEventListener('click', () => browser.nextSection())

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

// Restore the selected billing source, never a silent fallback to another one.
const savedGeminiKey = localStorage.getItem('gemini_api_key')
const savedOpenaiKey = localStorage.getItem('openai_api_key')
const initialConnection = resolveStartupConnection(readPreferredConnection(localStorage), {
  chatgpt: hasSubscription(), api: !!(savedGeminiKey || savedOpenaiKey),
})
if (initialConnection === 'chatgpt') {
  startBrowser(undefined, undefined, true)
} else if (initialConnection === 'api') {
  startBrowser(savedGeminiKey || undefined, savedOpenaiKey || undefined)
} else {
  renderSetup()
}
