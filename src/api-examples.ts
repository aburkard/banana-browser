/** Keyless example endpoints; routes come from each provider's published API. */
import {isPokemonApiUrl, normalizePokemonApiUrl} from './pokemon'
export const ART_FIELDS = 'id,title,artist_display,date_display,description,medium_display,dimensions,credit_line,image_id,is_public_domain,thumbnail'
export const ART_PAGE_SIZE = 12

export function artGalleryUrl(page = 1, query = ''): string {
  const url = new URL('https://api.artic.edu/api/v1/artworks/search')
  url.searchParams.set('query[term][is_public_domain]', 'true')
  url.searchParams.set('fields', ART_FIELDS)
  url.searchParams.set('limit', String(ART_PAGE_SIZE))
  url.searchParams.set('page', String(Math.max(1, Math.min(833, Math.floor(page) || 1))))
  if (query) url.searchParams.set('q', query)
  return url.href
}

export const ART_GALLERY_URL = artGalleryUrl()
export const TVMAZE_SEARCH_URL = 'https://api.tvmaze.com/search/shows?q=star%20trek'

export function isExampleApiUrl(value: string): boolean {
  if (isPokemonApiUrl(value)) return true
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    return (url.hostname === 'api.artic.edu' && /^\/api\/v1\/artworks(?:\/search|\/\d+)?$/.test(url.pathname)) ||
      (url.hostname === 'api.tvmaze.com' && /^(?:\/search\/shows|\/shows\/\d+(?:\/seasons)?|\/seasons\/\d+\/episodes|\/episodes\/\d+)$/.test(url.pathname))
  } catch { return false }
}

/** Prevent large embedded payloads and keep artwork requests public-domain and field-selected. */
export function normalizeExampleApiUrl(value: string): string {
  if (isPokemonApiUrl(value)) return normalizePokemonApiUrl(value)
  if (!isExampleApiUrl(value)) return value
  const url = new URL(value)
  if (url.hostname === 'api.artic.edu') {
    if (!/\/\d+$/.test(url.pathname)) return artGalleryUrl(Number(url.searchParams.get('page') || 1), url.searchParams.get('q') || '')
    url.search = ''
    url.searchParams.set('fields', ART_FIELDS)
  } else {
    const query = url.searchParams.get('q') || ''
    url.search = ''
    if (url.pathname === '/search/shows') url.searchParams.set('q', query)
  }
  return url.href
}
