import './frame-sizing.css'

type ChromeSize = {width: number; height: number}
type FrameSize = {width: number; height: number; viewportWidth: number; viewportHeight: number}
const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
const validRatio = (ratio: number) => Number.isFinite(ratio) && ratio > 0 ? ratio : 1.5

/** Choose the narrowest frame that shows the largest image, remeasuring controls as they wrap. */
export function fitFrame({availableWidth, availableHeight, ratio, chromeAtWidth, minWidth = 520}: {
  availableWidth: number
  availableHeight: number
  ratio: number
  chromeAtWidth: (width: number) => ChromeSize
  minWidth?: number
}): FrameSize {
  const maxWidth = nonnegative(availableWidth)
  const maxHeight = nonnegative(availableHeight)
  const aspect = validRatio(ratio)
  const minimum = Math.min(maxWidth, nonnegative(minWidth))
  const imageWidth = (width: number, chrome = chromeAtWidth(width)) =>
    Math.max(0, Math.min(width - nonnegative(chrome.width), Math.max(0, maxHeight - nonnegative(chrome.height)) * aspect))
  const fullChrome = chromeAtWidth(maxWidth)
  const largest = imageWidth(maxWidth, fullChrome)
  let width = Math.max(minimum, Math.min(maxWidth, largest + nonnegative(fullChrome.width)))
  if (imageWidth(width) < largest - 0.5) {
    // Hugging the image wraps controls onto more rows, which would shrink it.
    // Keep the narrowest width where they still fit, leaving side gutters.
    let low = width
    let high = maxWidth
    while (high - low > 1) {
      const middle = (low + high) / 2
      if (imageWidth(middle) >= largest - 0.5) high = middle
      else low = middle
    }
    width = high
  }
  let chrome = chromeAtWidth(width)
  let viewportWidth = Math.max(0, width - nonnegative(chrome.width))
  let viewportHeight = Math.min(viewportWidth / aspect, Math.max(0, maxHeight - nonnegative(chrome.height)))
  if (viewportHeight < 120 && maxWidth > 0 && maxHeight > 0) {
    // In short windows, prioritize fewer wrapped controls and a usable image.
    // The resulting frame may need vertical scrolling in these extremes.
    width = maxWidth
    chrome = chromeAtWidth(width)
    viewportWidth = Math.max(0, width - nonnegative(chrome.width))
    viewportHeight = Math.max(120, Math.min(viewportWidth / aspect, Math.max(0, maxHeight - nonnegative(chrome.height))))
  }
  return {width, height: nonnegative(chrome.height) + viewportHeight, viewportWidth, viewportHeight}
}

/** Fit the browser around its image while retaining enough width for controls. */
export function attachFrameSizing(container: HTMLElement, viewport: HTMLElement, app = container.parentElement!) {
  const view = container.ownerDocument.defaultView!
  const controls = Array.from(container.children).filter(element => !element.contains(viewport))
  const originalWidth = container.style.width
  const originalHeight = container.style.height
  let ratio = 1.5
  let disposed = false
  let frame: number | null = null
  let measuredLayout = ''
  const layoutKey = () => [app.clientWidth, app.clientHeight,
    ...controls.flatMap(element => {
      const rect = element.getBoundingClientRect()
      return [rect.width, rect.height]
    })].join(',')

  const resize = () => {
    frame = null
    if (disposed || !container.isConnected) return
    const style = view.getComputedStyle(app)
    const availableWidth = app.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')
    const availableHeight = app.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0')
    if (availableWidth <= 0 || availableHeight <= 0) return
    // Always fit with Settings expanded. When collapsed, leave its space outside
    // the frame so opening it moves the canvas down without resizing the image.
    const settings = container.querySelector<HTMLElement>('#advanced-bar')
    const settingsDisplay = settings?.style.display
    const collapsed = settingsDisplay === 'none'
    if (settings) settings.style.display = ''
    container.style.height = `${availableHeight}px`
    const fitted = fitFrame({availableWidth, availableHeight, ratio, chromeAtWidth: width => {
      container.style.width = `${width}px`
      const outer = container.getBoundingClientRect()
      const inner = viewport.getBoundingClientRect()
      const containerStyle = view.getComputedStyle(container)
      const borders = parseFloat(containerStyle.borderTopWidth || '0') + parseFloat(containerStyle.borderBottomWidth || '0')
      const contentHeight = Math.max(outer.height, container.scrollHeight + borders)
      return {width: outer.width - inner.width, height: contentHeight - inner.height}
    }})
    container.style.width = `${fitted.width}px`
    let reservedHeight = 0
    if (settings && collapsed) {
      const settingsStyle = view.getComputedStyle(settings)
      reservedHeight = settings.getBoundingClientRect().height
        + parseFloat(settingsStyle.marginTop || '0') + parseFloat(settingsStyle.marginBottom || '0')
    }
    if (settings) settings.style.display = settingsDisplay ?? ''
    container.style.height = `${Math.max(0, fitted.height - reservedHeight)}px`
    // Ignore observer notifications caused by our own completed layout.
    measuredLayout = layoutKey()
  }
  const schedule = () => {
    if (!disposed && frame === null) frame = view.requestAnimationFrame(resize)
  }
  const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(() => {
    if (layoutKey() !== measuredLayout) schedule()
  }) : null
  container.classList.add('frame-sized')
  observer?.observe(app)
  controls.forEach(element => observer?.observe(element))
  view.addEventListener('resize', schedule)
  schedule()
  return {
    setRatio(next: number) {
      const normalized = validRatio(next)
      if (normalized === ratio) return
      ratio = normalized
      schedule()
    },
    dispose() {
      disposed = true
      if (frame !== null) view.cancelAnimationFrame(frame)
      observer?.disconnect()
      view.removeEventListener('resize', schedule)
      container.classList.remove('frame-sized')
      container.style.width = originalWidth
      container.style.height = originalHeight
    },
  }
}
