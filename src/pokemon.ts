/** Keyless PokéAPI list/detail adapter. Each page uses one API response. */
const BASE = 'https://pokeapi.co/api/v2/pokemon'
export const POKEMON_PAGE_SIZE = 12

export function pokemonListUrl(offset = 0): string {
  const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
  return `${BASE}?limit=${POKEMON_PAGE_SIZE}&offset=${safeOffset}`
}
export const POKEMON_URL = pokemonListUrl()

export function isPokemonApiUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'pokeapi.co' || url.username || url.password || url.port) return false
    const match = url.pathname.match(/^\/api\/v2\/pokemon(?:\/([1-9]\d*|[a-z][a-z0-9]*(?:-[a-z0-9]+)*))?\/?$/)
    return !!match && (!match[1] || !/^\d+$/.test(match[1]) || Number.isSafeInteger(Number(match[1])))
  } catch { return false }
}

const isList = (url: URL) => /^\/api\/v2\/pokemon\/?$/.test(url.pathname)
const validOffset = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))

export function normalizePokemonApiUrl(value: string): string {
  if (!isPokemonApiUrl(value)) return value
  const url = new URL(value)
  if (isList(url)) {
    const offset = url.searchParams.get('offset') || '0'
    return pokemonListUrl(validOffset(offset) ? Number(offset) : 0)
  }
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.href
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : []
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const headline = (value: unknown) => {const name = text(value); return name.charAt(0).toUpperCase() + name.slice(1)}

function apiLink(value: unknown, listing: boolean): string | undefined {
  if (typeof value !== 'string' || !isPokemonApiUrl(value)) return undefined
  const url = new URL(value)
  if (isList(url) !== listing) return undefined
  if (listing && !validOffset(url.searchParams.get('offset') || '0')) return undefined
  return normalizePokemonApiUrl(value)
}

function artworkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com' && !url.username && !url.password && !url.port
      && /^\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/official-artwork\/\d+\.png$/.test(url.pathname) && !url.search && !url.hash) return url.href
  } catch { /* Missing or malformed artwork is optional. */ }
  return undefined
}

export function processPokemon(raw: unknown, requestUrl: string) {
  if (!isPokemonApiUrl(requestUrl)) throw new Error('Unsupported Pokémon API URL')
  const request = new URL(normalizePokemonApiUrl(requestUrl))
  const data = record(raw)
  const links: Array<{label: string; url: string}> = []
  const attribution = 'Pokémon data: PokéAPI. Artwork supplied through PokéAPI.'
  if (isList(request)) {
    for (const [key, label] of [['previous', 'Previous Pokémon'], ['next', 'Next Pokémon']]) {
      const url = apiLink(data[key], true)
      if (url) links.push({label, url})
    }
    const articles = rows(data.results).flatMap(row => {
      const apiUrl = apiLink(row.url, false)
      return apiUrl && text(row.name) ? [{apiUrl, headline: headline(row.name), name: text(row.name)}] : []
    })
    return {
      links, source: 'PokéAPI', title: 'Pokémon', type: 'listing', sourceUrl: 'https://pokeapi.co', attribution,
      offset: Number(request.searchParams.get('offset')), count: number(data.count), articles, imageUrls: [] as string[],
    }
  }
  links.push({label: 'Browse Pokémon', url: POKEMON_URL})
  const imageUrl = artworkUrl(record(record(record(data.sprites).other)['official-artwork']).front_default)
  const height = number(data.height), weight = number(data.weight)
  const types = rows(data.types).map(row => text(record(row.type).name)).filter(Boolean)
  const article = {
    apiUrl: request.href, headline: headline(data.name) || 'Pokémon', id: number(data.id), name: text(data.name),
    types, heightMeters: height === undefined ? undefined : height / 10, weightKg: weight === undefined ? undefined : weight / 10,
    abilities: rows(data.abilities).flatMap(row => {
      const name = text(record(row.ability).name)
      return name ? [{name, hidden: row.is_hidden === true}] : []
    }),
    stats: rows(data.stats).flatMap(row => {
      const name = text(record(row.stat).name), base = number(row.base_stat)
      return name && base !== undefined ? [{name, base}] : []
    }),
    imageUrl, ...(imageUrl ? {imageCaption: `${headline(data.name) || 'Pokémon'} — official artwork supplied by PokéAPI`} : {}),
  }
  return {
    links, source: 'PokéAPI', title: article.headline, type: 'pokemon', sourceUrl: 'https://pokeapi.co', attribution,
    article, imageUrls: imageUrl ? [imageUrl] : [],
  }
}
