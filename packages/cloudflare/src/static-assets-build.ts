import { decodeSourceManifest } from "./source-manifest.ts"
import { prepareStaticAssets } from "./static-assets-source.ts"

const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true })
const paths = ["site/app.ts", "site/index.html", "site/style.css"]
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("")
export interface StaticBuildProvenance {
  readonly version: 1
  readonly tool: "sucrase-3.35.1-typescript"
  readonly sourceManifestDigest: string
  readonly sourceDigest: string
  readonly outputDigest: string
  readonly toolDigest: string
  readonly outputManifestDigest: string
}

/** Fixed minimal fixture source, not arbitrary paths, npm projects or plugin input. */
export async function prepareStaticBuildSource(revision: string, input: Uint8Array, manifestDigest: string) {
  if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid static build revision")
  if (!(input instanceof Uint8Array) || input.length > 96 * 1024) throw Error("Invalid static build bytes")
  const captured = new Uint8Array(input)
  const files = await decodeSourceManifest(captured, manifestDigest)
  const manifest = JSON.parse(decoder.decode(captured))
  if (Object.keys(manifest).sort().join(",") !== "files,version" || files.length !== paths.length ||
      manifest.files.some((entry: Record<string, unknown>) => Object.keys(entry).sort().join(",") !== "base64,executable,path"))
    throw Error("Invalid static build manifest")
  for (const path of paths) {
    const file = files.find(f => f.path === path)
    if (!file || file.executable) throw Error("Invalid static build path or mode")
    const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))
    if (bytes.length > 32 * 1024 || decoder.decode(bytes).includes("\0")) throw Error("Invalid static build file")
  }
  const source = decoder.decode(Uint8Array.from(atob(files.find(f => f.path === "site/app.ts")!.base64), c => c.charCodeAt(0)))
  return { revision, manifestDigest, source, files: files.map(f => ({ ...f })) }
}

/** Independently validate compiler output and construct the COMPLETE fixed asset manifest.
 * Byte identity is not Git authentication; the private source reader establishes that.
 */
export async function prepareBuiltStaticAssets(revision: string, input: Uint8Array, sourceManifestDigest: string, result: unknown) {
  const source = await prepareStaticBuildSource(revision, input, sourceManifestDigest)
  if (!result || typeof result !== "object" || Array.isArray(result)) throw Error("Invalid static build receipt")
  const descriptors = Object.getOwnPropertyDescriptors(result)
  if (Reflect.ownKeys(descriptors).length !== 7 || Object.keys(descriptors).sort().join(",") !== "code,containers,outputDigest,runtime,sourceDigest,tool,toolDigest" ||
      Object.values(descriptors).some(d => !("value" in d))) throw Error("Invalid static build receipt")
  const r = Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, d.value]))
  if (r.runtime !== "dynamic-worker" || r.tool !== "sucrase-3.35.1-typescript" || r.containers !== 0 ||
      typeof r.code !== "string" || r.code.includes("\0") || encoder.encode(r.code).length > 32 * 1024 ||
      typeof r.toolDigest !== "string" || !/^[a-f0-9]{64}$/.test(r.toolDigest) ||
      r.sourceDigest !== await sha256(encoder.encode(source.source)) || r.outputDigest !== await sha256(encoder.encode(r.code)))
    throw Error("Static build byte identity mismatch")
  const codeBytes = encoder.encode(r.code)
  const files = source.files.map(file => file.path === "site/app.ts"
    ? { path: "site/app.js", base64: btoa(Array.from(codeBytes, b => String.fromCharCode(b)).join("")), executable: false }
    : file)
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const bytes = encoder.encode(JSON.stringify({ version: 1, files }))
  const manifestDigest = await sha256(bytes)
  const prepared = await prepareStaticAssets(revision, bytes, manifestDigest)
  const build: StaticBuildProvenance = { version: 1, tool: r.tool, sourceManifestDigest,
    sourceDigest: r.sourceDigest, outputDigest: r.outputDigest, toolDigest: r.toolDigest, outputManifestDigest: manifestDigest }
  return { ...prepared, bytes, build }
}
