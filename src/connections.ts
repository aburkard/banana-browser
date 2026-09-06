export type ConnectionMode = 'chatgpt' | 'api'
export const CONNECTION_KEY = 'banana_connection_mode'

export function readPreferredConnection(storage: Pick<Storage, 'getItem'>): ConnectionMode | null {
  const value = storage.getItem(CONNECTION_KEY)
  return value === 'chatgpt' || value === 'api' ? value : null
}

// Never change billing sources just because the chosen connection is missing.
export function resolveStartupConnection(preferred: ConnectionMode | null, available: {chatgpt: boolean; api: boolean}): ConnectionMode | null {
  if (preferred) return available[preferred] ? preferred : null
  if (available.chatgpt === available.api) return null
  return available.chatgpt ? 'chatgpt' : 'api'
}
