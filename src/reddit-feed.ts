const ENDPOINT = 'https://aburkard--banana-browser-relay-web.modal.run/reddit';
const ATOM = 'http://www.w3.org/2005/Atom';

export function parseRedditFeed(xml: string, sourceUrl: string) {
  if (xml.length > 2 * 1024 * 1024 || /<!DOCTYPE/i.test(xml)) throw new Error('Reddit returned invalid feed data.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName !== 'feed' || root.namespaceURI !== ATOM) throw new Error('Reddit returned invalid feed data.');
  const child = (node: Element, name: string) => Array.from(node.children).find(e => e.localName === name && e.namespaceURI === ATOM);
  const value = (node: Element, name: string) => child(node, name)?.textContent?.trim() || '';
  const safeUrl = (raw: string, base = sourceUrl) => {
    if (!raw.trim()) return '';
    try { const u = new URL(raw, base); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  };
  const subreddit = child(root, 'category')?.getAttribute('term') || new URL(sourceUrl).pathname.split('/')[2] || '';
  const entries = Array.from(root.children).filter(e => e.localName === 'entry' && e.namespaceURI === ATOM).slice(0, 26).map(entry => {
    // A detached template is inert: feed HTML is never attached to the page.
    const template = document.createElement('template');
    template.innerHTML = value(entry, 'content');
    template.content.querySelectorAll('script,style,iframe,object,embed').forEach(e => e.remove());
    const prose = template.content.querySelector('.md');
    function text(node: Node): string {
      if (node.nodeType === 3) return node.textContent || '';
      const body = Array.from(node.childNodes).map(text).join('');
      return body + (node instanceof Element && ['P', 'DIV', 'LI', 'BR', 'BLOCKQUOTE'].includes(node.tagName) ? '\n' : '');
    }
    const link = safeUrl(child(entry, 'link')?.getAttribute('href') || '');
    let permalink = '';
    if (link) { const u = new URL(link); if (u.hostname === 'www.reddit.com' && u.pathname.startsWith('/r/')) permalink = u.pathname; }
    const links = Array.from((prose || template.content).querySelectorAll('a')).map(a => ({title:a.textContent?.trim() || '',url:safeUrl(a.getAttribute('href') || '',link || sourceUrl)})).filter(a => a.url);
    const external = Array.from(template.content.querySelectorAll('a')).find(a => a.textContent?.trim() === '[link]');
    return {id:value(entry,'id'), title:value(entry,'title'), author:value(child(entry,'author') || entry,'name').replace(/^\/u\//,''),
      permalink, url:safeUrl(external?.getAttribute('href') || '',link || sourceUrl) || link,
      body:prose ? text(prose).trim() : '', links};
  });
  const post = (e: typeof entries[number]) => ({title:e.title,author:e.author,permalink:e.permalink,url:e.url,selftext:e.body,subreddit, ...(e.body && e.links.length ? {links:e.links} : {})});
  const posts = entries.filter(e => e.id.startsWith('t3_') && e.permalink);
  const feedInfo = 'Public feed. Scores and total comment counts are unavailable; comments may be incomplete.';
  if (new URL(sourceUrl).pathname.includes('/comments/')) {
    const requestedId = new URL(sourceUrl).pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1];
    const requestedPost = posts.find(e => e.id === `t3_${requestedId}`);
    if (!requestedPost) throw new Error('Reddit did not return the requested post.');
    return {source:'Reddit',type:'post_with_comments',feedInfo,post:post(requestedPost),comments:entries.filter(e => e.id.startsWith('t1_')).map(e => ({author:e.author,body:e.body,permalink:e.permalink,...(e.links.length ? {links:e.links} : {})}))};
  }
  return {source:'Reddit',subreddit,feedInfo,posts:posts.map(post)};
}

export async function fetchRedditFeed(url: string) {
  let response: Response;
  try { response = await fetch(`${ENDPOINT}?url=${encodeURIComponent(url)}`, {signal:AbortSignal.timeout(20_000),credentials:'omit'}); }
  catch { throw new Error('Reddit could not be reached. Try again shortly.'); }
  if (response.status === 429) throw new Error('Reddit is rate limiting requests. Try again shortly.');
  if (!response.ok) throw new Error('Reddit is unavailable. Try again shortly.');
  return parseRedditFeed(await response.text(), url);
}
