/**
 * API Response Processors
 *
 * These functions transform raw API responses into lean, focused data
 * that contains only what's needed for webpage generation.
 */

import {ART_GALLERY_URL, ART_PAGE_SIZE, artGalleryUrl, isExampleApiUrl, normalizeExampleApiUrl} from './api-examples'
import {isPokemonApiUrl, processPokemon} from './pokemon'

// ESPN News Article (simplified)
interface ESPNArticle {
  headline: string
  description: string
  published: string
  type: string
  apiUrl: string  // Link for navigation
  imageUrl?: string  // Header image URL for reference
}

// ESPN News Response (simplified)
interface ESPNNewsResponse {
  source: 'ESPN'
  title: string
  articles: ESPNArticle[]
  imageUrls: string[]  // All image URLs for reference generation
}

// ESPN Single Article (full story view)
interface ESPNFullArticle {
  headline: string
  description: string
  story: string  // The actual article content (HTML)
  byline: string
  published: string
  imageUrl?: string
  imageCaption?: string
}

// ESPN Article Response (for individual article pages)
interface ESPNArticleResponse {
  source: 'ESPN'
  type: 'article'
  article: ESPNFullArticle
  imageUrls: string[]
}

/**
 * Process ESPN News API response
 * Keeps: headline, description, published date, type, API link, images
 */
export function processESPNNews(raw: unknown): ESPNNewsResponse {
  const data = raw as {
    header?: string
    articles?: Array<{
      headline?: string
      description?: string
      published?: string
      type?: string
      links?: {
        api?: {
          self?: { href?: string }
        }
      }
      images?: Array<{
        url?: string
        type?: string
      }>
    }>
  }

  const imageUrls: string[] = []

  const articles: ESPNArticle[] = (data.articles || []).map(article => {
    // Get the header image (or first image if no header)
    const headerImage = article.images?.find(img => img.type === 'header')
    const firstImage = article.images?.[0]
    const imageUrl = headerImage?.url || firstImage?.url

    if (imageUrl) {
      imageUrls.push(imageUrl)
    }

    return {
      headline: article.headline || '',
      description: article.description || '',
      published: article.published || '',
      type: article.type || '',
      apiUrl: article.links?.api?.self?.href || '',
      imageUrl,
    }
  })

  return {
    source: 'ESPN',
    title: data.header || 'NFL News',
    articles,
    imageUrls: imageUrls.slice(0, 5), // Limit to 5 images for API limits
  }
}

/**
 * Process ESPN Article API response (individual article pages)
 * Keeps: headline, description, story (the actual article!), byline, published, images
 * Removes: video metadata, links, inline content markers, etc.
 */
export function processESPNArticle(raw: unknown): ESPNArticleResponse {
  const data = raw as {
    headlines?: Array<{
      headline?: string
      description?: string
      story?: string
      byline?: string
      published?: string
      images?: Array<{
        url?: string
        caption?: string
        type?: string
      }>
    }>
  }

  const headline = data.headlines?.[0]
  const imageUrls: string[] = []

  // Get all image URLs
  if (headline?.images) {
    for (const img of headline.images) {
      if (img.url) {
        imageUrls.push(img.url)
      }
    }
  }

  // Get the header image (or first image)
  const headerImage = headline?.images?.find(img => img.type === 'header')
  const firstImage = headline?.images?.[0]
  const imageUrl = headerImage?.url || firstImage?.url
  const imageCaption = headerImage?.caption || firstImage?.caption

  // Clean the story HTML - remove inline markers like <video1>, <alsosee>, <inline1>
  let story = headline?.story || ''
  story = story.replace(/<(video\d*|alsosee|inline\d*)>/g, '')
  story = story.replace(/<\/(video\d*|alsosee|inline\d*)>/g, '')

  return {
    source: 'ESPN',
    type: 'article',
    article: {
      headline: headline?.headline || '',
      description: headline?.description || '',
      story,
      byline: headline?.byline || '',
      published: headline?.published || '',
      imageUrl,
      imageCaption,
    },
    imageUrls: imageUrls.slice(0, 5),
  }
}

// HN Story (simplified)
interface HNStory {
  id: number
  title: string
  url: string | null  // External URL (null for Ask HN, etc.)
  by: string
  score: number
  commentCount: number
  apiUrl: string  // For navigation
}

// HN Front Page Response (simplified)
interface HNFrontPageResponse {
  source: 'Hacker News'
  type: 'front_page'
  stories: HNStory[]
}

/**
 * Process Hacker News front page
 * Keeps: id, title, url, author, score, comment count
 * Removes: kids array (just keep count), time, type, dead, deleted
 */
export function processHNFrontPage(stories: unknown[]): HNFrontPageResponse {
  const processed: HNStory[] = stories.map(raw => {
    const story = raw as {
      id?: number
      title?: string
      url?: string
      by?: string
      score?: number
      descendants?: number
      kids?: number[]
    }
    return {
      id: story.id || 0,
      title: story.title || '',
      url: story.url || null,
      by: story.by || '',
      score: story.score || 0,
      commentCount: story.descendants || story.kids?.length || 0,
      apiUrl: `https://hacker-news.firebaseio.com/v0/item/${story.id}.json`,
    }
  })

  return {
    source: 'Hacker News',
    type: 'front_page',
    stories: processed,
  }
}

// HN Comment (simplified)
interface HNComment {
  id: number
  by: string
  text: string  // HTML content
}

// HN Story with Comments (simplified)
interface HNStoryWithCommentsResponse {
  source: 'Hacker News'
  type: 'story_with_comments'
  story: HNStory & { text?: string }
  comments: HNComment[]
}

/**
 * Process Hacker News story with comments
 * Keeps: story details + comment text/author
 * Removes: nested kids, parent refs, timestamps
 */
export function processHNStoryWithComments(
  story: unknown,
  comments: unknown[]
): HNStoryWithCommentsResponse {
  const s = story as {
    id?: number
    title?: string
    url?: string
    by?: string
    score?: number
    descendants?: number
    kids?: number[]
    text?: string  // For Ask HN, Show HN, etc.
  }

  const processedComments: HNComment[] = comments
    .filter(c => c && typeof c === 'object')
    .map(raw => {
      const comment = raw as {
        id?: number
        by?: string
        text?: string
        dead?: boolean
        deleted?: boolean
      }
      // Skip dead or deleted comments
      if (comment.dead || comment.deleted) {
        return null
      }
      return {
        id: comment.id || 0,
        by: comment.by || '[deleted]',
        text: comment.text || '',
      }
    })
    .filter((c): c is HNComment => c !== null)

  return {
    source: 'Hacker News',
    type: 'story_with_comments',
    story: {
      id: s.id || 0,
      title: s.title || '',
      url: s.url || null,
      by: s.by || '',
      score: s.score || 0,
      commentCount: s.descendants || s.kids?.length || 0,
      apiUrl: `https://hacker-news.firebaseio.com/v0/item/${s.id}.json`,
      ...(s.text ? { text: s.text } : {}),
    },
    comments: processedComments,
  }
}

// Reddit Post (simplified)
interface RedditPost {
  title: string
  author: string
  score: number
  commentCount: number
  url: string  // External link
  selftext: string  // Self post content (if any)
  permalink: string  // Reddit discussion link
  subreddit: string
}

// Reddit Listing Response (simplified)
interface RedditListingResponse {
  source: 'Reddit'
  subreddit: string
  posts: RedditPost[]
}

// Reddit Comment (simplified)
interface RedditComment {
  author: string
  score: number
  body: string
}

// Reddit Post with Comments (for individual post pages)
interface RedditPostWithCommentsResponse {
  source: 'Reddit'
  type: 'post_with_comments'
  post: RedditPost
  comments: RedditComment[]
}

/**
 * Process Reddit listing (subreddit front page)
 * Keeps: title, author, score, comment count, urls, selftext
 * Removes: all the metadata, flairs, awards, media embeds, previews, etc.
 */
export function processRedditListing(raw: unknown): RedditListingResponse {
  const data = raw as {
    data?: {
      children?: Array<{
        data?: {
          title?: string
          author?: string
          score?: number
          num_comments?: number
          url?: string
          selftext?: string
          permalink?: string
          subreddit?: string
        }
      }>
    }
  }

  const children = data.data?.children || []
  const posts: RedditPost[] = children.map(child => {
    const post = child.data || {}
    return {
      title: post.title || '',
      author: post.author || '',
      score: post.score || 0,
      commentCount: post.num_comments || 0,
      url: post.url || '',
      selftext: post.selftext || '',
      permalink: post.permalink || '',
      subreddit: post.subreddit || '',
    }
  })

  // Get subreddit from first post or default
  const subreddit = posts[0]?.subreddit || 'unknown'

  return {
    source: 'Reddit',
    subreddit,
    posts,
  }
}

/**
 * Process Reddit post with comments (individual post page)
 * Keeps: post details + comment author, score, body
 * Removes: all metadata, nested replies structure, awards, flairs, etc.
 */
export function processRedditPostWithComments(raw: unknown): RedditPostWithCommentsResponse {
  const data = raw as Array<{
    kind?: string
    data?: {
      children?: Array<{
        kind?: string
        data?: {
          // Post fields
          title?: string
          author?: string
          score?: number
          num_comments?: number
          url?: string
          selftext?: string
          permalink?: string
          subreddit?: string
          // Comment fields
          body?: string
        }
      }>
    }
  }>

  // First element is the post
  const postData = data[0]?.data?.children?.[0]?.data || {}
  const post: RedditPost = {
    title: postData.title || '',
    author: postData.author || '',
    score: postData.score || 0,
    commentCount: postData.num_comments || 0,
    url: postData.url || '',
    selftext: postData.selftext || '',
    permalink: postData.permalink || '',
    subreddit: postData.subreddit || '',
  }

  // Second element contains comments
  const commentChildren = data[1]?.data?.children || []
  const comments: RedditComment[] = commentChildren
    .filter(child => child.kind === 't1') // t1 = comment, skip "more" items
    .map(child => {
      const c = child.data || {}
      return {
        author: c.author || '[deleted]',
        score: c.score || 0,
        body: c.body || '',
      }
    })
    .slice(0, 20) // Limit to top 20 comments to avoid bloat

  return {
    source: 'Reddit',
    type: 'post_with_comments',
    post,
    comments,
  }
}

/**
 * Detect API type from URL and process accordingly
 */
export function processApiResponse(url: string, data: unknown): unknown {
  if (isPokemonApiUrl(url)) return processPokemon(data, url)
  if (isExampleApiUrl(url)) {
    return new URL(url).hostname === 'api.artic.edu' ? processArtInstitute(data, url) : processTVmaze(data, url)
  }
  // ESPN
  if (url.includes('espn.com') || url.includes('espncdn.com')) {
    // Check if it's a news listing (has articles array)
    if (typeof data === 'object' && data !== null && 'articles' in data) {
      return processESPNNews(data)
    }
    // Check if it's an individual article (has headlines array with story)
    if (typeof data === 'object' && data !== null && 'headlines' in data) {
      const d = data as { headlines?: Array<{ story?: string }> }
      if (d.headlines?.[0]?.story) {
        return processESPNArticle(data)
      }
    }
    return data
  }

  // Reddit
  if (url.includes('reddit.com')) {
    // Check if it's a post with comments (array of 2 Listings)
    if (Array.isArray(data) && data.length === 2) {
      const first = data[0] as { kind?: string }
      const second = data[1] as { kind?: string }
      if (first?.kind === 'Listing' && second?.kind === 'Listing') {
        return processRedditPostWithComments(data)
      }
    }
    // Check if it's a subreddit listing (single Listing object)
    if (typeof data === 'object' && data !== null && 'kind' in data) {
      const d = data as { kind?: string }
      if (d.kind === 'Listing') {
        return processRedditListing(data)
      }
    }
    return data
  }

  // For HN, processing is done in the fetch methods since we build custom responses
  // Just return data as-is for unknown APIs
  return data
}

// Small common shape shared by the two keyless browsing examples.
type ApiRecord = Record<string, unknown>
const record = (value: unknown): ApiRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {}
const string = (value: unknown): string => typeof value === 'string' ? value : ''
const excerpt = (value: unknown, limit = Infinity): string => {
  const text = string(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}
const numericId = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
const httpsUrl = (value: unknown): string | undefined => {
  try { const url = new URL(string(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

export function processArtInstitute(raw: unknown, requestUrl: string) {
  const data = record(raw)
  const listing = Array.isArray(data.data)
  const rows = listing ? (data.data as unknown[]).slice(0, ART_PAGE_SIZE) : [data.data]
  const articles = rows.map(record).filter(row => row.is_public_domain === true && numericId(row.id)).map(row => {
    const imageId = string(row.image_id)
    const imageUrl = /^[\w-]{1,80}$/.test(imageId) ? `https://www.artic.edu/iiif/2/${imageId}/full/843,/0/default.jpg` : undefined
    return {
      // Navigation uses the short documented endpoint; fetch normalization adds fields.
      apiUrl: `https://api.artic.edu/api/v1/artworks/${row.id}`,
      headline: excerpt(row.title, 100),
      description: excerpt([row.artist_display, row.date_display, row.medium_display].filter(value => typeof value === 'string' && value).join(' · '), listing ? 100 : 300),
      imageUrl,
      ...(!listing ? {
        sourceUrl: `https://www.artic.edu/artworks/${row.id}`,
        imageCaption: excerpt(record(row.thumbnail).alt_text || row.title, 300),
        dimensions: excerpt(row.dimensions, 200), credit: excerpt(row.credit_line, 300),
        story: excerpt(row.description),
      } : {}),
    }
  })
  const links: Array<{label: string; url: string}> = []
  const request = new URL(normalizeExampleApiUrl(requestUrl))
  const pagination = record(data.pagination)
  const page = Number(request.searchParams.get('page') || 1)
  const query = request.searchParams.get('q') || ''
  if (listing) {
    if (page > 1) links.push({label: 'Previous gallery page', url: artGalleryUrl(page - 1, query)})
    // Search pagination does not always include next_url. Its total_pages is authoritative.
    if (typeof pagination.total_pages === 'number' && page < pagination.total_pages && page < 833) {
      links.push({label: 'Next gallery page', url: artGalleryUrl(page + 1, query)})
    }
  } else links.push({label: 'Browse public-domain gallery', url: ART_GALLERY_URL})
  const title = listing ? `Art Institute of Chicago — Gallery ${page}` : articles[0]?.headline || 'Artwork unavailable'
  return {
    links,
    source: 'Art Institute of Chicago', title, type: listing ? 'gallery' : 'article',
    sourceUrl: articles.length === 1 && !listing ? articles[0].sourceUrl : 'https://www.artic.edu/collection',
    attribution: 'Art Institute of Chicago. Public-domain artwork images (CC0).',
    ...(listing ? {articles} : {article: articles[0] || {headline: title, story: 'This artwork is unavailable or is not marked public domain.'}}),
    imageUrls: articles.flatMap(item => item.imageUrl ? [item.imageUrl] : []).slice(0, 5),
  }
}

export function processTVmaze(raw: unknown, requestUrl: string) {
  const request = new URL(requestUrl)
  const isSearch = request.pathname === '/search/shows'
  const isSeasons = /^\/shows\/\d+\/seasons$/.test(request.pathname)
  const isEpisodes = /^\/seasons\/\d+\/episodes$/.test(request.pathname)
  const listing = isSearch || isSeasons || isEpisodes
  const allRows = listing ? (Array.isArray(raw) ? raw : []) : [raw]
  const articles = allRows.map(value => record(isSearch ? record(value).show : value)).filter(row => numericId(row.id)).map(row => {
    const headline = isSeasons ? `Season ${row.number ?? '?'}${row.name ? `: ${string(row.name)}` : ''}` : string(row.name)
    const image = record(row.image)
    return {
      apiUrl: `https://api.tvmaze.com/${isSeasons ? 'seasons' : isEpisodes || request.pathname.startsWith('/episodes/') ? 'episodes' : 'shows'}/${row.id}${isSeasons ? '/episodes' : ''}`,
      headline: excerpt(headline, 100),
      description: excerpt([Array.isArray(row.genres) ? row.genres.filter(value => typeof value === 'string').join(', ') : '', row.premiered || row.premiereDate || row.airdate, row.status].filter(value => typeof value === 'string' && value).join(' · '), 100),
      ...(!listing ? {story: excerpt(row.summary), sourceUrl: httpsUrl(row.url)} : {}),
      ...(typeof row.season === 'number' ? {season: row.season} : {}),
      ...(typeof row.number === 'number' ? {number: row.number} : {}),
      ...(typeof record(row.rating).average === 'number' ? {rating: record(row.rating).average} : {}),
      imageUrl: httpsUrl(image.medium) || httpsUrl(image.original),
    }
  })
  const links: Array<{label: string; url: string}> = []
  if (/^\/shows\/\d+$/.test(request.pathname)) links.push({label: 'Browse seasons', url: `https://api.tvmaze.com${request.pathname}/seasons`})
  if (isSeasons) links.push({label: 'Show details', url: `https://api.tvmaze.com${request.pathname.replace('/seasons', '')}`})
  // Episode self responses include the owning show's API link.
  const showLink = httpsUrl(record(record(record(raw)._links).show).href)
  if (showLink && /^https:\/\/api\.tvmaze\.com\/shows\/\d+$/.test(showLink)) links.push({label: 'Show details', url: showLink})
  const title = isSearch ? `TVmaze — ${request.searchParams.get('q') || 'Show search'}` : isSeasons ? 'TVmaze — Seasons' : isEpisodes ? 'TVmaze — Season episodes' : articles[0]?.headline || 'TVmaze'
  return {
    links,
    source: 'TVmaze', title, type: listing ? 'listing' : 'article',
    sourceUrl: !listing && articles[0]?.sourceUrl || 'https://www.tvmaze.com',
    attribution: 'TV data: TVmaze, licensed CC BY-SA. Link back to TVmaze; adaptations are subject to ShareAlike.',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    ...(listing ? {articles} : {article: articles[0] || {headline: 'Unavailable', story: ''}}),
    imageUrls: articles.flatMap(item => item.imageUrl ? [item.imageUrl] : []).slice(0, 5),
  }
}
