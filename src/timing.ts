let sequence = 0

// Local diagnostics only: no prompts, URLs, images, credentials, or remote telemetry.
export function startTiming(scope: string) {
  const id = ++sequence
  const start = performance.now()
  const seen = new Set<string>()
  return (phase: string) => {
    if (seen.has(phase)) return
    seen.add(phase)
    console.info('[BananaBrowser timing]', { id, scope, phase, elapsedMs: Math.round(performance.now() - start) })
  }
}

export async function timed<T>(scope: string, work: () => Promise<T>): Promise<T> {
  const mark = startTiming(scope)
  try {
    const result = await work()
    mark('complete')
    return result
  } catch (error) {
    mark('failed')
    throw error
  }
}
