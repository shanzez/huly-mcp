/**
 * Network patch for running huly-mcp from inside a container on the Huly Docker network.
 *
 * Problem: Huly's /config.json returns internal URLs like http://localhost:8087/_accounts.
 * From the host, localhost:8087 maps to the nginx container. From a sibling container on
 * the same Docker network, localhost:8087 is unreachable — but `nginx` (the service name)
 * resolves correctly.
 *
 * This CJS preload script patches globalThis.fetch and the `ws` module to rewrite
 * localhost:8087 → nginx before any network call.
 *
 * Prerequisites:
 *   1. This container must be on the Huly Docker network:
 *      docker network connect <huly_network_name> <this_container_id>
 *   2. HULY_URL in .env.local stays as http://localhost:8087 (same as host usage).
 *
 * Usage:
 *   NODE_OPTIONS="-r ./scripts/container-patch.cjs" bash scripts/integration_test_full.sh
 */

const REWRITE_FROM = /localhost:8087/g
const REWRITE_TO = 'nginx'

// --- Patch fetch ---
const origFetch = globalThis.fetch
globalThis.fetch = function (url, ...args) {
  if (typeof url === 'string') url = url.replace(REWRITE_FROM, REWRITE_TO)
  else if (url instanceof URL) url = new URL(url.href.replace(REWRITE_FROM, REWRITE_TO))
  else if (url instanceof Request) url = new Request(url.url.replace(REWRITE_FROM, REWRITE_TO), url)
  return origFetch.call(this, url, ...args)
}

// --- Patch ws ---
const wsPath = require.resolve('ws', { paths: [process.cwd()] })
const OrigWS = require(wsPath)
const PatchedWS = function (url, ...args) {
  if (typeof url === 'string') url = url.replace(REWRITE_FROM, REWRITE_TO)
  return new OrigWS(url, ...args)
}
PatchedWS.prototype = OrigWS.prototype
Object.setPrototypeOf(PatchedWS, OrigWS)
for (const key of Object.getOwnPropertyNames(OrigWS)) {
  if (!['prototype', 'length', 'name', 'caller', 'arguments'].includes(key)) {
    try { PatchedWS[key] = OrigWS[key] } catch {}
  }
}
PatchedWS.WebSocket = PatchedWS
PatchedWS.default = PatchedWS
require.cache[wsPath] = { id: wsPath, filename: wsPath, loaded: true, exports: PatchedWS }
