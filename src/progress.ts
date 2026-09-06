// Measures one operation across its existing status phases; it does not estimate completion.
export function createProgress(render: (text: string) => void) {
  let started: number | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let status = ''
  let disposed = false

  function draw() {
    const elapsed = started === undefined ? '' : ` · ${Math.floor((performance.now() - started) / 1000)}s elapsed`
    render(status + elapsed)
  }

  function stop() {
    clearInterval(timer)
    timer = undefined
    started = undefined
  }

  return {
    update(loading: boolean, nextStatus: string) {
      if (disposed) return
      status = nextStatus
      if (loading && started === undefined) {
        started = performance.now()
        timer = setInterval(draw, 1000)
      } else if (!loading) stop()
      draw()
    },
    dispose() {
      disposed = true
      stop()
    },
  }
}
