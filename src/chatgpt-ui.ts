import {deviceLogin, disconnectSubscription, finishBrowserLogin, hasSubscription, RELAY_URL, SOURCE_URL, startBrowserLogin, type BrowserLogin} from './subscription'

export function mountChatGPTPanel(root: HTMLElement, connected: () => void) {
  let pending: BrowserLogin | undefined
  let active = true
  let controller = new AbortController()
  root.innerHTML = `
    <div class="connection-heading"><h2>Use your ChatGPT plan</h2><span class="experimental-tag">Experimental</span></div>
    <p class="connection-intro">Make pages. Click around. Use your plan’s limits.</p>
    <div id="chatgpt-entry">
      <label class="remember-choice"><input type="checkbox" id="remember-chatgpt"> Keep me signed in</label>
      <button id="connect-chatgpt">Connect ChatGPT</button>
      <details class="alternate-login"><summary>Try another way</summary><button class="quiet-button" id="device-chatgpt">Use a device code</button></details>
    </div>
    <div id="chatgpt-browser-step" hidden>
      <div class="login-step"><span class="step-number">1</span><a id="chatgpt-openai" class="primary-link" target="_blank" rel="noopener noreferrer">Sign in on OpenAI <span aria-hidden="true">↗</span></a></div>
      <p class="step-caption">New tab · OpenAI calls it “Codex”</p>
      <div class="login-step"><span class="step-number">2</span><h3>Copy that tab’s full URL</h3></div>
      <div class="address-example" role="img" aria-label="Copy the entire address starting with localhost:1455 from the other tab, even if the page says it cannot connect.">
        <div class="example-bar"><span aria-hidden="true">←</span><span class="selected-address">localhost:1455/auth/callback?code=…</span></div>
        <div class="example-page"><span>“Can’t connect” is expected.</span></div>
      </div>
      <form id="chatgpt-return-form"><div class="login-step paste-step"><span class="step-number" aria-hidden="true">3</span><label for="chatgpt-return">Paste it here</label></div><input id="chatgpt-return" type="password" autocomplete="off" spellcheck="false" placeholder="http://localhost:1455/auth/callback?…" required><button id="finish-chatgpt">Finish connecting</button></form>
    </div>
    <div id="chatgpt-device-step" hidden><h3>Enter this code on OpenAI</h3><output id="chatgpt-code"></output><a class="primary-link" href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">Open OpenAI</a><p class="step-caption">OpenAI shows a Codex security warning. This is the login you just started. Device login must be enabled in ChatGPT settings.</p></div>
    <p id="chatgpt-status" class="connection-status" role="status" aria-live="polite"></p>
    <button id="cancel-chatgpt" class="quiet-button" hidden>Cancel</button>
    <div id="chatgpt-connected" hidden><p class="connected-label">✓ ChatGPT connected</p><button id="resume-chatgpt">Use ChatGPT plan</button><button class="quiet-button" id="disconnect-chatgpt">Disconnect ChatGPT</button></div>
    <details class="connection-trust"><summary>How it works</summary><div class="trust-route" aria-label="Your browser, encrypted relay, OpenAI"><span>Your browser</span><span aria-hidden="true">↔ 🔒 ↔</span><span>OpenAI</span></div><p>Choose “Keep me signed in” to save your login in this browser. Our server can’t read your login, prompts, or images.</p><p>This uses Codex sign-in. It isn’t an official OpenAI integration.</p><p><a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">View on GitHub</a> · <a href="${RELAY_URL}/source/relay.mjs" target="_blank" rel="noopener noreferrer">Running relay source</a></p></details>
  `
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const status = (text: string) => { el('chatgpt-status').textContent = text }
  const remember = () => el<HTMLInputElement>('remember-chatgpt').checked
  const showEntry = () => {
    controller.abort(); controller = new AbortController(); pending = undefined
    el('chatgpt-browser-step').hidden = el('chatgpt-device-step').hidden = el('cancel-chatgpt').hidden = true
    el<HTMLInputElement>('chatgpt-return').value = ''
    el('chatgpt-code').textContent = ''
    el('chatgpt-connected').hidden = !hasSubscription()
    el('chatgpt-entry').hidden = hasSubscription()
    el<HTMLButtonElement>('connect-chatgpt').disabled = false
    el<HTMLButtonElement>('device-chatgpt').disabled = false
    status('')
  }
  const busy = (message: string) => {
    el<HTMLButtonElement>('connect-chatgpt').disabled = true
    el<HTMLButtonElement>('device-chatgpt').disabled = true
    el('cancel-chatgpt').hidden = false
    status(message)
  }
  const fail = (error: unknown) => {
    if (!active || controller.signal.aborted) return
    showEntry()
    status(error instanceof Error ? error.message : 'Could not connect. Try again.')
  }
  el('connect-chatgpt').onclick = async () => {
    busy('Opening the connection…')
    const signal = controller.signal
    try {
      const login = await startBrowserLogin()
      if (!active || signal.aborted) return
      pending = login
      el<HTMLAnchorElement>('chatgpt-openai').href = login.url
      el('chatgpt-entry').hidden = true
      el('chatgpt-browser-step').hidden = false
      status('')
      el('chatgpt-openai').focus()
    } catch (error) { if (!signal.aborted) fail(error) }
  }
  el('chatgpt-return-form').onsubmit = async event => {
    event.preventDefault()
    if (!pending) return
    const input = el<HTMLInputElement>('chatgpt-return')
    let raw = input.value
    input.value = ''
    const login = pending; pending = undefined
    const signal = controller.signal
    el<HTMLButtonElement>('finish-chatgpt').disabled = true
    status('Connecting…')
    try {
      await finishBrowserLogin(raw, login, remember(), signal)
      raw = ''
      if (active && !signal.aborted) connected()
    } catch (error) { if (!signal.aborted) fail(error) }
    finally { raw = ''; el<HTMLButtonElement>('finish-chatgpt').disabled = false }
  }
  el('device-chatgpt').onclick = async () => {
    busy('Getting a code…')
    const signal = controller.signal
    try {
      await deviceLogin(code => {
        if (!active || signal.aborted) return
        el('chatgpt-entry').hidden = true
        el('chatgpt-device-step').hidden = false
        el('chatgpt-code').textContent = code
        status('Waiting for sign-in…')
      }, remember(), signal)
      if (active && !signal.aborted) connected()
    } catch (error) { if (!signal.aborted) fail(error) }
  }
  el('cancel-chatgpt').onclick = () => { showEntry(); el('connect-chatgpt').focus() }
  el('disconnect-chatgpt').onclick = () => { disconnectSubscription(); showEntry(); status('Disconnected.') }
  el('resume-chatgpt').onclick = connected
  showEntry()
  return () => { active = false; controller.abort(); pending = undefined }
}
