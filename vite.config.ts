import { defineConfig } from 'vite'
import { subscriptionPlugin } from './server/subscription.mjs'
import { readFileSync } from 'node:fs'

// Serve the same pinned TLS assets in development and on GitHub Pages.
const tlsAssets = {
  'libcurl.js': 'text/javascript',
  'libcurl.wasm': 'application/wasm',
  'LICENSE': 'text/plain',
}
const browserTLS = {
  name: 'browser-tls-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const name = req.url?.split('?')[0]?.replace(/^\/banana-browser\/chatgpt\//, '')
      if (!Object.hasOwn(tlsAssets, name || '')) return next()
      res.setHeader('Content-Type', tlsAssets[name])
      res.end(readFileSync(new URL(`./node_modules/libcurl.js/${name}`, import.meta.url)))
    })
  },
  generateBundle() {
    for (const name of Object.keys(tlsAssets)) {
      this.emitFile({ type: 'asset', fileName: `chatgpt/${name}`, source: readFileSync(new URL(`./node_modules/libcurl.js/${name}`, import.meta.url)) })
    }
  },
}

export default defineConfig({
  base: '/banana-browser/',
  plugins: [browserTLS, ...(process.env.BANANA_SUBSCRIPTION === '1' ? [subscriptionPlugin()] : [])],
})
