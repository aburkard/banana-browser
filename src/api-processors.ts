/**
 * API Response Processors
 *
 * These functions transform raw API responses into lean, focused data
 * that contains only what's needed for webpage generation.
 */

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
  story: HNStory
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
