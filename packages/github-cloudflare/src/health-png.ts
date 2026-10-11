import { initWasm, Resvg } from "@resvg/resvg-wasm"
import { healthChart, type HealthPoint } from "../../cloudflare/src/health-chart.ts"

let initialization: Promise<void> | undefined
let initializedModule: WebAssembly.Module | undefined

/** Bundle a compiled module and a licensed font; never compile or fetch at runtime. */
export function createHealthPngRenderer(module: WebAssembly.Module, font: Uint8Array) {
  if (!(module instanceof WebAssembly.Module) || font.length < 1 || font.length > 128_000) {
    throw new Error("Invalid chart renderer assets")
  }
  const ownedFont = new Uint8Array(font)
  return async (points: ReadonlyArray<HealthPoint>, options: {
    baseline: string; candidate: string; maxErrorRate: number
  }): Promise<Uint8Array> => {
    // Generate only our own bounded template, synchronously before any await.
    // No API accepts raw SVG, URLs, external images, logs, or arbitrary fonts.
    if (typeof options.baseline !== "string" || typeof options.candidate !== "string" ||
      options.baseline.length > 256 || options.candidate.length > 256) throw new Error("Invalid chart labels")
    const svg = healthChart(points, options)
    if (new TextEncoder().encode(svg).length > 100_000) throw new Error("Chart is too large")
    if (initializedModule && initializedModule !== module) throw new Error("Chart module already selected")
    if (!initialization) {
      initializedModule = module
      // Keep a rejected initialization too: retrying a partially initialized singleton is unsafe.
      initialization = initWasm(module)
    }
    await initialization
    const renderer = new Resvg(svg, {
      font: { fontBuffers: [ownedFont], defaultFontFamily: "ABeeZee", sansSerifFamily: "ABeeZee" },
      fitTo: { mode: "original" },
    })
    try {
      if (renderer.width !== 760 || renderer.height !== 460 || renderer.imagesToResolve().length) {
        throw new Error("Unexpected chart resource")
      }
      const image = renderer.render()
      try {
        const png = image.asPng()
        if (image.width !== 760 || image.height !== 460 || png.length > 1_000_000) {
          throw new Error("Unexpected chart output")
        }
        // Own bytes independently of WASM memory before freeing both allocations.
        return new Uint8Array(png)
      } finally {
        image.free()
      }
    } finally {
      renderer.free()
    }
  }
}
