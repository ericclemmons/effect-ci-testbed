import { decodeSourceManifest } from "./source-manifest.ts"

export const staticAssetsTarget = "effect-ci-static-assets-demo" as const
export const staticAssetsPolicy = "owned-static-assets-v1" as const
const paths = ["site/app.js", "site/index.html", "site/style.css"] as const
const contentTypes = ["application/javascript; charset=utf-8", "text/html; charset=utf-8", "text/css; charset=utf-8"] as const
const encoder = new TextEncoder()
const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("")

export interface PreparedStaticAsset {
  readonly path: string
  readonly base64: string
  readonly size: number
  readonly sha256: string
  readonly uploadHash: string
  readonly contentType: string
}

/** Pure byte preparation, NOT authentication of the claimed Git commit. No API authority. */
export async function prepareStaticAssets(revision: string, input: Uint8Array, manifestDigest: string) {
  if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid static source revision")
  if (!(input instanceof Uint8Array) || input.byteLength > 96 * 1024) throw new Error("Invalid static source bytes")
  const bytes = new Uint8Array(input)
  const files = await decodeSourceManifest(bytes, manifestDigest)
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  if (Object.keys(manifest).sort().join(",") !== "files,version" || files.length !== paths.length ||
    manifest.files.some((entry: Record<string, unknown>) => Object.keys(entry).sort().join(",") !== "base64,executable,path")) {
    throw new Error("Invalid static source manifest")
  }
  const assets: PreparedStaticAsset[] = []
  for (const [index, path] of paths.entries()) {
    const file = files.find(file => file.path === path)
    if (!file || file.executable) throw new Error("Invalid static asset path or mode")
    const data = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0))
    if (data.byteLength > 32 * 1024) throw new Error("Static asset byte limit exceeded")
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data)
    if (text.includes("\0")) throw new Error("Invalid static asset text")
    const extension = path.slice(path.lastIndexOf(".") + 1)
    assets.push({ path: path.slice(5), base64: file.base64, size: data.byteLength,
      sha256: await sha256(data), uploadHash: (await sha256(encoder.encode(file.base64 + extension))).slice(0, 32),
      contentType: contentTypes[index]! })
  }
  const assetDigest = await sha256(encoder.encode(JSON.stringify(assets.map(({ path, size, sha256 }) => ({ path, size, sha256 })))))
  const uploadManifest = Object.fromEntries(assets.map(asset => [`/${asset.path}`, { hash: asset.uploadHash, size: asset.size }]))
  return { revision, manifestDigest, assetDigest, target: staticAssetsTarget, policy: staticAssetsPolicy, assets, uploadManifest }
}
