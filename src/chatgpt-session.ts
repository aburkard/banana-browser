export const SESSION_KEY = 'banana_chatgpt_v1'
export interface ChatGPTSession {
  accessToken: string
  refreshToken: string
  accountId: string
  expiresAt: number
}

export function readSession(storage: Pick<Storage, 'getItem'>): ChatGPTSession | null {
  try {
    const value = JSON.parse(storage.getItem(SESSION_KEY) || 'null')
    if (!value || !['accessToken', 'refreshToken', 'accountId'].every(k => typeof value[k] === 'string' && value[k].length > 0) || !Number.isFinite(value.expiresAt)) return null
    return value
  } catch { return null }
}

// The same lock is shared by tabs so a rotating refresh token is only used once.
export class SessionStore {
  constructor(private persistent: Storage, private tab: Storage,
    private lock: <T>(work: () => Promise<T>) => Promise<T>) {}

  read() { return readSession(this.tab) || readSession(this.persistent) }

  async save(session: ChatGPTSession, remember: boolean, signal?: AbortSignal) {
    await this.lock(async () => {
      signal?.throwIfAborted()
      const target = remember ? this.persistent : this.tab
      target.setItem(SESSION_KEY, JSON.stringify(session))
      ;(remember ? this.tab : this.persistent).removeItem(SESSION_KEY)
    })
  }

  clear() {
    this.tab.removeItem(SESSION_KEY)
    this.persistent.removeItem(SESSION_KEY)
  }

  async token(renew: (session: ChatGPTSession) => Promise<ChatGPTSession>, force = false) {
    const observed = this.read()
    if (!observed) throw new Error('Reconnect ChatGPT to continue.')
    return this.lock(async () => {
      const before = this.read()
      if (!before) throw new Error('Reconnect ChatGPT to continue.')
      // Another tab may have refreshed while this request waited for the lock.
      if (before.expiresAt > Date.now() + 60_000 && (!force || before.accessToken !== observed.accessToken)) return before
      const target = readSession(this.tab) ? this.tab : this.persistent
      // Duplicate Tab copies sessionStorage. A shared lock alone cannot update
      // that copy, so remember consumed token fingerprints across all tabs.
      // These one-way hashes cannot be used to authenticate.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(before.refreshToken))
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      const marker = `banana_chatgpt_used_refresh_${fingerprint}`
      if (readSession(target)?.refreshToken !== before.refreshToken) throw new Error('Your ChatGPT connection changed. Try again.')
      if (this.persistent.getItem(marker)) {
        target.removeItem(SESSION_KEY)
        throw new Error('This tab’s sign-in needs renewing. Reconnect ChatGPT.')
      }
      // Mark before sending: a timeout can happen after OpenAI rotates the token.
      // Retrying an uncertain result could invalidate the working login elsewhere.
      this.persistent.setItem(marker, 'used')
      let after: ChatGPTSession
      try { after = await renew(before) }
      catch {
        if (readSession(target)?.refreshToken === before.refreshToken) target.removeItem(SESSION_KEY)
        throw new Error('Could not renew your sign-in. Reconnect ChatGPT.')
      }
      // Disconnect or a replacement login must win over an in-flight refresh.
      if (readSession(target)?.refreshToken !== before.refreshToken) throw new Error('Your ChatGPT connection changed. Try again.')
      target.setItem(SESSION_KEY, JSON.stringify(after))
      if (after.refreshToken === before.refreshToken) this.persistent.removeItem(marker)
      return after
    })
  }
}
