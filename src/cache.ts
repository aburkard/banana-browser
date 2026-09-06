// A small LRU cache. Sizes are supplied by callers so image buffers stay bounded.
export class BoundedCache<T> {
  private entries = new Map<string, {value: T; bytes: number; expires: number}>()
  private bytes = 0
  constructor(private maxBytes: number, private maxEntries: number, private ttlMs = Infinity) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return
    this.remove(key)
    if (entry.expires <= Date.now()) return
    this.entries.set(key, entry)
    this.bytes += entry.bytes
    return entry.value
  }
  set(key: string, value: T, bytes: number) {
    this.remove(key)
    if (bytes > this.maxBytes) return
    this.entries.set(key, {value, bytes, expires: Date.now() + this.ttlMs})
    this.bytes += bytes
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      this.remove(this.entries.keys().next().value!)
    }
  }
  private remove(key: string) {
    const entry = this.entries.get(key)
    if (entry) this.bytes -= entry.bytes
    this.entries.delete(key)
  }
}
