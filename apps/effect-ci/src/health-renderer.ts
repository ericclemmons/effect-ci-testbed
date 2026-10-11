import wasm from "@resvg/resvg-wasm/index_bg.wasm"
import font from "../../../packages/github-cloudflare/assets/ABeeZee-Regular.ttf.bin"
import { createHealthPngRenderer } from "../../../packages/github-cloudflare/src/health-png.ts"
import { WorkerEntrypoint } from "cloudflare:workers"

/** Host-owned renderer: bundled assets only, no container credentials or public image URLs. */
export const renderHealthPng = createHealthPngRenderer(wasm, new Uint8Array(font))

/** RPC only. The public app fetch handler exposes no renderer route. */
export class HealthChartRenderer extends WorkerEntrypoint {
  render(...args: Parameters<typeof renderHealthPng>) {
    return renderHealthPng(...args)
  }
  fetch() {
    return new Response("Not found", { status: 404 })
  }
}
