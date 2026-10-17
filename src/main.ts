import { attachFrameSizing } from './frame-sizing';
import './style.css'
import './compact-layout.css'
import { createProgress } from './progress'
import {addressTarget, displayAddress, mapAddress} from './web-discovery'
import {hasFirecrawlKey, loadFirecrawlKey, saveFirecrawlKey} from './firecrawl-client'
import {setWebpageOptions} from './webpage-fetch'
import { renderSourceAttribution } from './source-attribution'
import { mountChatGPTPanel } from './chatgpt-ui'
import { hasSubscription, subscriptionGenerate } from './subscription'
import { CONNECTION_KEY, readPreferredConnection, resolveStartupConnection } from './connections'
import {
  BananaBrowser,
  BOOKMARKS,
  CLICK_MODELS,
  IMAGE_MODELS,
  PLAN_CLICK_MODELS,
  STYLE_PRESETS,
  estimateImageCost,
  type ClickModel,
  type ImageModel,
  type Quality,
  type ImageOutputFormat,
  type ReasoningEffort,
  type StylePreset,
  type ThinkingLevel,
  type UsageStats,
} from './browser'

const app = document.querySelector<HTMLDivElement>('#app')!
// Compact fits the toolbar and Settings on one row each, leaving a larger page image.
// ?layout=classic shows the two-row layout; make 'classic' the default to revert.
const LAYOUT = new URLSearchParams(window.location.search).get('layout') === 'classic' ? 'classic' : 'compact'
let disposeSetup: (() => void) | undefined
let disposeBrowser: (() => void) | undefined

function renderSetup(onBack?: () => void) {
  if (!onBack) {
    disposeBrowser?.()
    disposeBrowser = undefined
  }
  disposeSetup?.()
  app.innerHTML = `
    <header class="setup-header">
      <h1><span aria-hidden="true">🍌</span> Banana Browser</h1>
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
      <p class="key-help">
        Get from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>
      </p>

      <label for="openai-key">OpenAI API Key</label>
      <input
        type="password"
        id="openai-key"
        placeholder="Enter your OpenAI API key..."
      />
      <p class="key-help">
        Get from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a>
      </p>

      <label for="openrouter-key">OpenRouter API Key</label>
      <input
        type="password"
        id="openrouter-key"
        placeholder="Enter your OpenRouter API key..."
      />
      <p class="key-help">
        One key for a curated set of image and click models from several providers. Get from <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter</a>
      </p>

      <button id="start-btn">Use API credits</button>
      </section>
      <section class="web-key-option" aria-labelledby="web-option-title"><h2 id="web-option-title">Web pages</h2>
      <label for="firecrawl-key">Firecrawl API Key (optional)</label>
      <input type="password" id="firecrawl-key" placeholder="Enter your Firecrawl API key..." autocomplete="off" spellcheck="false" aria-describedby="firecrawl-note" />
      <p class="key-help" id="firecrawl-note">
        Ordinary webpages open without a key. Firecrawl adds web search, Explore, and JavaScript-heavy or protected sites, billed to your Firecrawl account. Applies to either connection; saved in this browser and sent only to Firecrawl.
        Get from <a href="https://www.firecrawl.dev/app/api-keys" target="_blank" rel="noopener noreferrer">Firecrawl</a>
      </p>
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
  const openrouterInput = document.querySelector<HTMLInputElement>('#openrouter-key')!
  const btn = document.querySelector<HTMLButtonElement>('#start-btn')!
  geminiInput.value = localStorage.getItem('gemini_api_key') || ''
  openaiInput.value = localStorage.getItem('openai_api_key') || ''
  openrouterInput.value = localStorage.getItem('openrouter_api_key') || ''
  // Saved as typed so it applies to whichever connection starts or resumes next.
  const firecrawlInput = document.querySelector<HTMLInputElement>('#firecrawl-key')!
  firecrawlInput.value = loadFirecrawlKey()
  firecrawlInput.addEventListener('input', () => saveFirecrawlKey(firecrawlInput.value))
  const dialog = document.querySelector<HTMLDialogElement>('#api-confirmation')!
  let pendingKeys: {gemini: string; openai: string; openrouter: string} | undefined
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
    const openrouterKey = openrouterInput.value.trim()
    if (!geminiKey && !openaiKey && !openrouterKey) {
      alert('Please enter at least one API key')
      return
    }
    pendingKeys = {gemini: geminiKey, openai: openaiKey, openrouter: openrouterKey}
    dialog.showModal()
    document.querySelector<HTMLButtonElement>('#cancel-api')!.focus()
  })

  document.querySelector('#cancel-api')!.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => { pendingKeys = undefined })
  document.querySelector('#confirm-api')!.addEventListener('click', () => {
    if (!pendingKeys) return
    const {gemini: geminiKey, openai: openaiKey, openrouter: openrouterKey} = pendingKeys
    pendingKeys = undefined
    dialog.close()
    for (const [name, value] of [['gemini_api_key', geminiKey], ['openai_api_key', openaiKey], ['openrouter_api_key', openrouterKey]]) {
      if (value) localStorage.setItem(name, value)
      else localStorage.removeItem(name)
    }
    startBrowser(geminiKey || undefined, openaiKey || undefined, false, openrouterKey || undefined)
  })

  // Allow Enter key to submit from either input
  const handleEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') btn.click()
  }
  geminiInput.addEventListener('keydown', handleEnter)
  openaiInput.addEventListener('keydown', handleEnter)
  openrouterInput.addEventListener('keydown', handleEnter)
}

// An OpenRouter model duplicates a direct one when the user also has that provider's own key.
function openRouterDuplicate(model: string, keys: {gemini?: string; openai?: string}) {
  return (model.startsWith('google/') && !!keys.gemini) || (model.startsWith('openai/') && !!keys.openai)
}

function startBrowser(geminiApiKey?: string, openaiApiKey?: string, useSubscription = false, openrouterApiKey?: string) {
  disposeBrowser?.()
  disposeBrowser = undefined
  disposeSetup?.()
  disposeSetup = undefined
  localStorage.setItem(CONNECTION_KEY, useSubscription ? 'chatgpt' : 'api')
  loadFirecrawlKey()
  // Determine which models are available based on API keys
  const keys = {gemini: geminiApiKey, openai: openaiApiKey}
  const availableModels = Object.entries(IMAGE_MODELS).filter(([key, info]) => {
    if (useSubscription) return ['gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(key)
    if (info.provider === 'gemini') return !!geminiApiKey
    if (info.provider === 'openai') return !!openaiApiKey
    if (info.provider === 'openrouter') return !!openrouterApiKey && !openRouterDuplicate(info.model, keys)
    return false
  })
  const availableClickModels = Object.entries(CLICK_MODELS).filter(([key, info]) => {
    if (useSubscription) return PLAN_CLICK_MODELS.includes(key as ClickModel)
    if (info.provider === 'gemini') return !!geminiApiKey
    if (info.provider === 'openai') return !!openaiApiKey
    if (info.provider === 'openrouter') return !!openrouterApiKey && !openRouterDuplicate(info.model, keys)
    return false
  })

  // Keep the verified plan default; prefer Flare for API generation, directly or through OpenRouter.
  // Nano Banana 2.1 for Gemini-only users (October 15 bake-off: far fewer garbled words than Lite).
  const initialImageModelKey: ImageModel = (useSubscription ? 'gpt-image-2' : openaiApiKey ? 'gpt-image-2.5-flare'
    : openrouterApiKey ? 'openrouter:openai/gpt-image-2.5-flare' : 'nano-banana-2.1') as ImageModel

  app.innerHTML = `
    <div class="browser-container" data-layout="${LAYOUT}">
      <header class="titlebar"><span class="browser-mark" aria-hidden="true">🍌</span><h1>Banana Browser</h1><p>Click the page to navigate</p></header>
      <div class="toolbar">
      <div class="address-bar">
        <div class="navigation-buttons"><button id="back-btn" title="Go back" aria-label="Go back">←</button><button id="forward-btn" title="Go forward" aria-label="Go forward">→</button></div>
        <div class="location-field"><label for="url-input">Location</label><input type="text" class="url-input" id="url-input" placeholder="Search or enter URL..." spellcheck="false" /><button id="go-btn" title="Navigate">Go</button></div>
        <button id="reset-key-btn" class="connection-button" title="Change connection" aria-label="Change connection: ${useSubscription ? 'ChatGPT plan' : 'API credits'}">${useSubscription ? 'ChatGPT plan' : 'API credits'} ▾</button>
      </div>
      <div class="style-bar">
        <label class="option-field" for="bookmarks-select"><span class="option-name">Bookmarks</span>
        <select id="bookmarks-select" title="Bookmarks"><option value="">${LAYOUT === 'compact' ? 'Bookmarks' : 'Choose…'}</option>${Object.keys(BOOKMARKS).map(name => `<option value="${name}">${name}</option>`).join('')}</select></label>
        <label class="option-field" for="style-select"><span class="option-name">Style</span>
        <select id="style-select" title="Page style">${Object.keys(STYLE_PRESETS).map(key => `<option value="${key}">${key.charAt(0).toUpperCase() + key.slice(1)}</option>`).join('')}<option value="custom">Custom...</option></select></label>
        <input type="text" id="custom-style" aria-label="Custom style" placeholder="Describe your style..." style="display: none;" />
        <label class="option-field model-label" for="model-select"><span class="option-name">Image</span>
        <select id="model-select" title="Select image model">${availableModels.map(([key, info]) => `<option value="${key}"${key === initialImageModelKey ? ' selected' : ''}>${info.name}</option>`).join('')}</select></label>
        <span id="price-badge" class="price-badge" title="Estimated cost per image generation"></span>
        <button id="explore-site" title="Explore pages on this site" disabled>Explore</button>
        <button id="advanced-toggle" title="Advanced settings" aria-expanded="false" aria-controls="advanced-bar">Settings</button>
      </div>
      </div>
      <div class="advanced-bar" id="advanced-bar" style="display: none;" inert>
        <div class="advanced-row" id="web-advanced">
          <span class="advanced-label">Firecrawl:</span>
          <label title="Use the original screenshot and branding as visual references. Adds image-model input; applies on the next page load."><input type="checkbox" id="site-reference" /> Site reference</label>
          <label title="Fetch a fresh webpage instead of Firecrawl's cached copy. May be slower; applies on the next page load."><input type="checkbox" id="fresh-webpages" /> Fresh pages</label>
        </div>
        <div class="advanced-row" id="image-advanced" ${useSubscription ? 'hidden' : ''}>
          <span class="advanced-label">Image:</span>
          <label id="size-wrap">Size <select id="size-select"></select></label>
          <label id="quality-wrap" style="display:none;">Quality <select id="quality-select"></select></label>
          <label id="format-wrap" style="display:none;">Format <select id="format-select"><option value="png">PNG (lossless)</option><option value="jpeg">JPEG (faster)</option><option value="webp">WebP</option></select></label>
          <label id="previews-wrap" style="display:none;" title="Each preview adds 100 image output tokens to the API cost">Previews <select id="previews-select"><option value="0">0 (off)</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
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
        <span id="status" role="status" aria-live="polite">Ready</span>
        <details id="usage-details" class="usage-details" ${useSubscription ? '' : 'style="display: none;"'}>
          <summary id="usage-stats" class="usage-stats">${useSubscription ? 'Usage ▾' : ''}</summary>
          <div id="usage-breakdown" class="usage-breakdown">${useSubscription ? '<p class="breakdown-empty">No calls yet. Counts reset when you reload or change connections.</p>' : ''}</div>
        </details>
      </div>
    </div>
  `

  const browser = new BananaBrowser(geminiApiKey, openaiApiKey, initialImageModelKey, useSubscription ? subscriptionGenerate : undefined, useSubscription ? undefined : openrouterApiKey)

  const viewport = document.querySelector<HTMLDivElement>('#viewport')!
  const frameSizing = attachFrameSizing(document.querySelector<HTMLDivElement>('.browser-container')!, viewport, app)
  const initialSize = browser.getImageOptions().size.match(/^(\d+)x(\d+)$/)
  if (initialSize) frameSizing.setRatio(Number(initialSize[1]) / Number(initialSize[2]))
  const sourceAttribution = document.querySelector<HTMLDivElement>('#source-attribution')!
  const urlInput = document.querySelector<HTMLInputElement>('#url-input')!
  const goBtn = document.querySelector<HTMLButtonElement>('#go-btn')!
  const statusSpan = document.querySelector<HTMLSpanElement>('#status')!
  let progressText = ''
  let previewLabel: string | null = null
  let showingFinal = false
  const updatePreviewCaption = () => {
    const caption = viewport.querySelector('.loading-overlay p')
    if (caption) caption.textContent = showingFinal ? 'Final image' : previewLabel ? `Still generating · ${previewLabel}` : progressText
  }
  const progress = createProgress(text => {
    statusSpan.textContent = text
    progressText = text
    updatePreviewCaption()
  })
  let disposed = false
  let wasLoading = false
  let previewRevision = 0
  type PreviewFrame = {source: string; index: number | null; received: number; requested: number}
  let currentPreviewFrame: PreviewFrame | null = null
  let queuedPreview: PreviewFrame | null = null
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  let visiblePreview: HTMLImageElement | null = null
  let pendingPreview: HTMLImageElement | null = null
  const fadeDuration = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 400
  const releasePreview = (preview: HTMLImageElement | null) => {
    if (!preview) return
    preview.onload = null
    preview.onerror = null
    preview.removeAttribute('src')
    preview.remove()
  }
  const clearLoadingOverlay = () => {
    previewRevision++
    clearTimeout(previewTimer)
    previewTimer = undefined
    currentPreviewFrame = null
    queuedPreview = null
    previewLabel = null
    showingFinal = false
    releasePreview(pendingPreview)
    pendingPreview = visiblePreview = null
    const overlay = viewport.querySelector('.loading-overlay')
    overlay?.querySelectorAll<HTMLImageElement>('img').forEach(releasePreview)
    overlay?.remove()
    viewport.classList.remove('glitching')
  }
  const labelPreview = (frame: PreviewFrame) => {
    const number = typeof frame.index === 'number' ? frame.index + 1 : frame.received
    previewLabel = frame.requested > 0 ? `Preview ${number}/${frame.requested}` : 'Preview'
    updatePreviewCaption()
  }
  const showPreview = (frame: PreviewFrame, overlay: HTMLDivElement) => {
    const {source} = frame
    if (currentPreviewFrame?.source === source) {
      Object.assign(currentPreviewFrame, frame)
      queuedPreview = null
      if (!pendingPreview && visiblePreview) labelPreview(currentPreviewFrame)
      return
    }
    if (previewTimer !== undefined) {
      queuedPreview = frame
      return
    }
    currentPreviewFrame = frame
    releasePreview(pendingPreview)
    const revision = ++previewRevision
    const preview = document.createElement('img')
    pendingPreview = preview
    preview.className = 'image-preview'
    preview.alt = 'Unfinished webpage preview'
    const reveal = () => {
      if (disposed || revision !== previewRevision || pendingPreview !== preview) return
      pendingPreview = null
      const previous = visiblePreview
      visiblePreview = preview
      if (preview.naturalWidth && preview.naturalHeight) frameSizing.setRatio(preview.naturalWidth / preview.naturalHeight)
      labelPreview(frame)
      overlay.prepend(preview)
      if (previous) overlay.insertBefore(previous, preview)
      overlay.classList.add('has-preview')
      viewport.classList.remove('glitching')
      // Establish the transparent frame before starting the decoded image's fade.
      void preview.offsetWidth
      preview.classList.add('visible')
      previewTimer = setTimeout(() => {
        if (revision !== previewRevision) return
        releasePreview(previous)
        previewTimer = undefined
        const next = queuedPreview
        queuedPreview = null
        if (next) showPreview(next, overlay)
      }, fadeDuration())
    }
    preview.onerror = () => {
      if (revision !== previewRevision) return
      releasePreview(preview)
      pendingPreview = null
      currentPreviewFrame = null
    }
    preview.onload = () => {
      if (typeof preview.decode === 'function') return preview.decode().then(reveal, () => preview.onerror?.(new Event('error')))
      else reveal()
    }
    overlay.prepend(preview)
    preview.src = source
  }
  const finishPreview = () => {
    const overlay = viewport.querySelector<HTMLDivElement>('.loading-overlay')
    if (!overlay || !visiblePreview) { clearLoadingOverlay(); return }
    previewRevision++
    clearTimeout(previewTimer)
    queuedPreview = null
    releasePreview(pendingPreview)
    pendingPreview = null
    showingFinal = true
    updatePreviewCaption()
    overlay.classList.add('finishing')
    const revision = previewRevision
    previewTimer = setTimeout(() => {
      if (revision === previewRevision) clearLoadingOverlay()
    }, fadeDuration())
  }
  disposeBrowser = () => { disposed = true; progress.dispose(); frameSizing.dispose(); clearLoadingOverlay() }
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
    const web = usage.webCredits || usage.webUnknownCalls ? ` · Web ${usage.webCredits || 0} credits${usage.webUnknownCalls ? '+' : ''}` : ''
    if (useSubscription) {
      return `Usage · ${usage.imageGenerations} ${usage.imageGenerations === 1 ? 'image' : 'images'} · ${usage.clickInterpretations} ${usage.clickInterpretations === 1 ? 'click' : 'clicks'}${web} ▾`
    }
    const parts = []
    if (usage.totalInputTokens > 0 || usage.totalOutputTokens > 0) {
      parts.push(`${formatTokens(usage.totalInputTokens)} in / ${formatTokens(usage.totalOutputTokens)} out`)
    }
    if (usage.estimatedCost > 0 || usage.costIncomplete) {
      parts.push(usage.costIncomplete && usage.estimatedCost === 0 ? 'Cost unavailable ▾' : `Session ~$${usage.estimatedCost.toFixed(3)}${usage.costIncomplete ? ' (partial)' : ''} ▾`)
    }
    return (parts.length > 0 ? parts.join(' | ') : '') + web
  }

  function renderBreakdown(usage: UsageStats) {
    const webNote = usage.webCredits || usage.webUnknownCalls ? `<p class="breakdown-empty">Web extraction: ${usage.webCredits || 0} Firecrawl credits${usage.webUnknownCalls ? ' + unreported usage' : ''}. Billed to your Firecrawl account; excluded from model dollar totals.</p>` : ''
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
      usageBreakdown.innerHTML = `<table class="breakdown-table"><thead><tr><th>Model</th><th>Calls</th><th>Tokens (in/out)</th></tr></thead><tbody>${lines.map(l => `<tr><td>${l.label}</td><td class="num">${l.calls}</td><td class="num">${formatTokens(l.inputTokens)} / ${formatTokens(l.outputTokens)}${tokenDetails(l)}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${lines.reduce((sum, line) => sum + line.calls, 0)}</td><td class="num">${formatTokens(usage.totalInputTokens)} / ${formatTokens(usage.totalOutputTokens)}</td></tr></tfoot></table><p class="breakdown-empty">Counts reset when you reload or change connections. Remaining ChatGPT limits aren’t shown here.</p>${webNote}`
      return
    }
    if (lines.length === 0) {
      usageBreakdown.innerHTML = webNote || '<p class="breakdown-empty">No calls yet.</p>'
      return
    }
    const total = usage.estimatedCost || 1
    // OpenRouter reports one charged total per call, with no input/output split.
    const reportedOnly = (l: UsageStats['byModel'][string]) => l.reportedCost !== undefined && !l.inputCost && !l.outputCost
    const rows = lines.map(l => {
      const pct = Math.round((l.cost / total) * 100)
      const tag = l.category === 'image' ? 'img' : 'click'
      return `
        <tr>
          <td><span class="breakdown-tag tag-${l.category}">${tag}</span> ${l.label}</td>
          <td class="num">${l.calls}</td>
          <td class="num">${formatTokens(l.inputTokens)} / ${formatTokens(l.outputTokens)}${tokenDetails(l)}</td>
          <td class="num">${reportedOnly(l) ? '—' : `$${l.inputCost.toFixed(4)}`}</td>
          <td class="num">${reportedOnly(l) ? '—' : `$${l.outputCost.toFixed(4)}`}</td>
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
      <p class="breakdown-empty">This connection session; resets on reload. ${usage.costIncomplete ? '* Some usage or rates are missing; charges may be higher. ' : ''}Provider billing is authoritative.</p>${webNote}
    `
  }

  const sectionControls = document.querySelector<HTMLElement>('#section-controls')!
  const previousSectionButton = document.querySelector<HTMLButtonElement>('#previous-section')!
  const nextSectionButton = document.querySelector<HTMLButtonElement>('#next-section')!
  const sectionPosition = document.querySelector<HTMLElement>('#section-position')!
  let addressRevision = 0

  // Update UI based on browser state
  const exploreSite = document.querySelector<HTMLButtonElement>('#explore-site')!
  // Firecrawl-only options appear once a key is saved in connection settings.
  const webAdvanced = document.querySelector<HTMLElement>('#web-advanced')!
  const showWebOptions = () => { webAdvanced.hidden = !hasFirecrawlKey() }
  showWebOptions()
  const siteReference = document.querySelector<HTMLInputElement>('#site-reference')!
  const freshWebpages = document.querySelector<HTMLInputElement>('#fresh-webpages')!
  siteReference.checked = sessionStorage.getItem('web_site_reference') === 'true'
  freshWebpages.checked = sessionStorage.getItem('web_fresh') === 'true'
  const updateWebOptions = () => {
    setWebpageOptions({siteReference:siteReference.checked, fresh:freshWebpages.checked})
    sessionStorage.setItem('web_site_reference',String(siteReference.checked))
    sessionStorage.setItem('web_fresh',String(freshWebpages.checked))
  }
  siteReference.addEventListener('change',updateWebOptions)
  freshWebpages.addEventListener('change',updateWebOptions)
  updateWebOptions()
  let currentPageUrl: string | null = null
  browser.onStateChange = (state) => {
    currentPageUrl = state.currentUrl
    if (disposed) return
    viewport.setAttribute('aria-busy', String(state.loading))
    document.querySelectorAll<HTMLSelectElement | HTMLInputElement>(
      '#model-select, #style-select, #custom-style, #size-select, #quality-select, #previews-select, #image-thinking-select, #click-model-select, #effort-select, #click-thinking-select'
    ).forEach(control => { control.disabled = state.loading })
    renderSourceAttribution(sourceAttribution, state.currentUrl, state.currentApiData)
    if (state.navigationRevision !== addressRevision) {
      addressRevision = state.navigationRevision
      urlInput.value = displayAddress(state.currentUrl || '')
    }
    const currentAddress = state.currentUrl ? displayAddress(state.currentUrl) : ''
    exploreSite.disabled = state.loading || !/^https?:\/\//.test(currentAddress)
    const hasUsage = !!(state.usage.webCredits || state.usage.webUnknownCalls) || useSubscription || state.usage.imageGenerations > 0 || state.usage.clickInterpretations > 0
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

    if (state.loading && !wasLoading) {
      clearLoadingOverlay()
      if (pendingCanvas) {
        imageRevision++
        requestedImage = null
        pendingCanvas = false
      }
    }
    wasLoading = state.loading
    if (!state.loading && (state.error || !state.currentImage || !visiblePreview)) clearLoadingOverlay()
    if (state.loading) {
      viewport.classList.toggle('glitching', !visiblePreview)
      let overlay = viewport.querySelector<HTMLDivElement>('.loading-overlay')
      if (!overlay) {
        overlay = document.createElement('div')
        overlay.className = 'loading-overlay'
        overlay.innerHTML = `
          <div class="dancing-banana">🍌</div>
          <p></p>
        `
        viewport.appendChild(overlay)
      }
      if (state.previewImage) showPreview({source: state.previewImage, index: state.previewIndex, received: state.previewReceived, requested: state.previewRequested}, overlay)
    } else if (state.error) {
      requestedImage = null
      imageRevision++
      viewport.innerHTML = `
        <div class="placeholder">
          <p>Error occurred</p>
          <div class="error"></div>
        </div>
      `
      viewport.querySelector('.error')!.textContent = state.error
    } else if (state.currentImage) {
      // Status-only changes must not restart an in-flight image or animation.
      if (state.currentImage !== requestedImage || state.navigationRevision !== imageNavigationRevision) {
        requestedImage = state.currentImage
        imageNavigationRevision = state.navigationRevision
        const revision = ++imageRevision
        const transition = state.viewTransition
        const animation = transition ? `${transition === 'up' || transition === 'down' ? 'scroll' : 'page'}` : null

        const canvas = document.createElement('canvas')
        const img = new Image()
        pendingCanvas = true
        img.onload = () => {
          if (disposed || revision !== imageRevision) return
          pendingCanvas = false
          const canvases = Array.from(viewport.querySelectorAll('canvas'))
          const oldCanvas = canvases.pop()
          canvases.forEach(stale => stale.remove())
          if (oldCanvas) oldCanvas.className = ''
          viewport.querySelector('.placeholder')?.remove()
          canvas.width = img.width
          canvas.height = img.height
          frameSizing.setRatio(img.width / img.height)
          canvas.style.setProperty('--image-ratio', String(img.width / img.height))
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)

          // Animate the action that produced this view, independent of saved scroll position.
          if (oldCanvas && animation && transition && !visiblePreview) {
            canvas.classList.add(`${animation}-enter-${transition}`)
            oldCanvas.classList.add(`${animation}-exit-${transition}`)
            viewport.appendChild(canvas)

            // Remove old canvas after animation
            setTimeout(() => {
              if (disposed || revision !== imageRevision) return
              viewport.querySelectorAll('canvas').forEach(stale => { if (stale !== canvas) stale.remove() })
              canvas.classList.remove(`${animation}-enter-${transition}`)
            }, 300)
          } else {
            oldCanvas?.remove()
            viewport.appendChild(canvas)
          }
          if (visiblePreview) finishPreview()

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
        img.onerror = () => {
          if (disposed || revision !== imageRevision) return
          pendingCanvas = false
          requestedImage = null
          clearLoadingOverlay()
          // Never leave the old page clickable against the new page's state.
          viewport.innerHTML = '<div class="placeholder"><p>Image could not be displayed.</p></div>'
        }
        img.src = state.currentImage
      } else if (visiblePreview && !pendingCanvas && !viewport.querySelector('.loading-overlay.finishing')) {
        finishPreview()
      }
    }
    progress.update(state.loading, state.status)
  }

  let imageNavigationRevision = 0
  let requestedImage: string | null = null
  let imageRevision = 0
  let pendingCanvas = false

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
  const formatWrap = document.querySelector<HTMLLabelElement>('#format-wrap')!
  const formatSelect = document.querySelector<HTMLSelectElement>('#format-select')!
  const previewsWrap = document.querySelector<HTMLLabelElement>('#previews-wrap')!
  const previewsSelect = document.querySelector<HTMLSelectElement>('#previews-select')!
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
    previewsWrap.style.display = spec.provider === 'openai' && !useSubscription ? '' : 'none'
    previewsSelect.value = String(opts.partialImages ?? 0)
    formatWrap.style.display = spec.outputFormats && !useSubscription ? '' : 'none'
    formatSelect.value = opts.outputFormat || 'png'
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
      // Codex offers GPT-6 on the plan from low effort up, so "none" stays API-only.
      const efforts = useSubscription ? spec.reasoningEfforts.filter(e => e !== 'none') : spec.reasoningEfforts
      fillSelect(effortSelect, efforts.map(e => ({ value: e, label: e })), opts.reasoningEffort)
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
    const hidden = advancedBar.inert
    advancedBar.style.display = hidden ? '' : 'none'
    advancedBar.inert = !hidden
    advancedToggle.classList.toggle('active', hidden)
    advancedToggle.setAttribute('aria-expanded', String(hidden))
  })

  sizeSelect.addEventListener('change', () => {
    browser.setImageOptions({ size: sizeSelect.value })
    updatePriceBadge()
  })
  qualitySelect.addEventListener('change', () => {
    browser.setImageOptions({ quality: qualitySelect.value as Quality })
    updatePriceBadge()
  })
  formatSelect.addEventListener('change', () => browser.setImageOptions({outputFormat:formatSelect.value as ImageOutputFormat}))
  previewsSelect.addEventListener('change', () => {
    browser.setImageOptions({ partialImages: Number(previewsSelect.value) })
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

  exploreSite.addEventListener('click',()=>{
    const current=currentPageUrl
    if(current) browser.navigate(mapAddress(displayAddress(current)))
  })
  goBtn.addEventListener('click', () => {
    const url = urlInput.value.trim()
    if (url) browser.navigate(addressTarget(url))
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
      showWebOptions()
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
const savedOpenrouterKey = localStorage.getItem('openrouter_api_key')
const initialConnection = resolveStartupConnection(readPreferredConnection(localStorage), {
  chatgpt: hasSubscription(), api: !!(savedGeminiKey || savedOpenaiKey || savedOpenrouterKey),
})
if (initialConnection === 'chatgpt') {
  startBrowser(undefined, undefined, true)
} else if (initialConnection === 'api') {
  startBrowser(savedGeminiKey || undefined, savedOpenaiKey || undefined, false, savedOpenrouterKey || undefined)
} else {
  renderSetup()
}
