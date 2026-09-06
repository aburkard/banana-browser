import {isExampleApiUrl} from './api-examples'

/** Render provider credits outside the generated image, so attribution is always accessible. */
export function renderSourceAttribution(container: HTMLElement, currentUrl: string | null, data: unknown): void {
  container.replaceChildren()
  container.hidden = true
  if (!currentUrl || !isExampleApiUrl(currentUrl) || !data || typeof data !== 'object') return
  const page = data as Record<string, unknown>
  const host = new URL(currentUrl).hostname
  const art = host === 'api.artic.edu' && page.source === 'Art Institute of Chicago'
  const tv = host === 'api.tvmaze.com' && page.source === 'TVmaze'
  if (!art && !tv) return
  let sourceUrl: URL
  try { sourceUrl = new URL(String(page.sourceUrl)) } catch { return }
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password || sourceUrl.port ||
      sourceUrl.hostname !== (art ? 'www.artic.edu' : 'www.tvmaze.com')) return
  const link = (label: string, href: string) => {
    const anchor = container.ownerDocument.createElement('a')
    anchor.textContent = label
    anchor.href = href
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    return anchor
  }
  container.append('Source: ', link(art ? 'Art Institute of Chicago' : 'TVmaze', sourceUrl.href))
  if (art) container.append(' · Public-domain artwork')
  else container.append(' · ', link('CC BY-SA', 'https://creativecommons.org/licenses/by-sa/4.0/'))
  container.hidden = false
}
