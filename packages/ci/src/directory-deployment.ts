import { createHash, randomUUID } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join, parse, resolve } from "node:path"
import * as Effect from "effect/Effect"
import { executionMode, type Workspace, type WorkspaceChangeProvider } from "./index.ts"
import { pathGlob, pathPatterns } from "./path-glob.ts"

interface FileIdentity { path: string; size: number; sha256: string; executable: boolean }
interface Manifest { version: 1; paths: ReadonlyArray<string>; configuration: string; files: FileIdentity[] }
export interface DirectoryDeploymentReceipt { readonly version: 1; readonly id: string; readonly digest: string }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")
const hex = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9-]{36}$/
const relativePath = (path: string) => !!path && path.length <= 4096 &&
  !path.startsWith("/") && !/[\\\x00-\x1f]/.test(path) && !path.split("/").some(p => !p || p === "." || p === "..")
const missing = (error: unknown) => (error as { code?: string })?.code === "ENOENT"

function bytes(root: string, path: string): { bytes: Buffer; file: FileIdentity } {
  if (!relativePath(path)) throw Error("Invalid deployment path")
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw Error("Invalid deployment root")
  let current = root
  for (const part of path.split("/")) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) throw Error("Deployment symlinks are unsupported")
  }
  const stat = lstatSync(current)
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error("Invalid deployment file")
  const data = readFileSync(current)
  if (data.length !== stat.size) throw Error("Deployment file changed while reading")
  return { bytes: data, file: { path, size: data.length, sha256: hash(data), executable: !!(stat.mode & 0o111) } }
}

function directoryUnder(root: string, path: string) {
  let current = root
  for (const part of path.split("/")) {
    if (!part || part === "." || part === "..") throw Error("Invalid deployment directory")
    current = join(current, part)
    try {
      const stat = lstatSync(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Invalid deployment directory")
    } catch (error) {
      if (!missing(error)) throw error
      mkdirSync(current, { mode: 0o700 })
    }
  }
}

/** Local filesystem destination. The default comparison scope is supplied by
 * this host adapter, never inferred from a build/snapshot ID. Not a remote
 * deployment adapter, signed attestation or generic external retry protocol.
 */
export function directoryDeployment(options: {
  readonly directory: string
  readonly paths: ReadonlyArray<string>
  /** Non-secret serving/runtime policy identity; a policy change requires publish. */
  readonly configuration?: string
}) {
  const directory = resolve(options.directory), paths = pathPatterns(options.paths), matchers = paths.map(pathGlob)
  if (directory === parse(directory).root) throw Error("A deployment needs its own directory")
  const configuration = hash(options.configuration ?? "directory-deployment-v1")
  const currentPath = join(directory, "current.json")
  const root = () => {
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw Error("Invalid deployment directory")
    return realpathSync(directory)
  }
  const candidate = (workspace: Workspace) => {
    if (workspace.kind !== "local") throw Error("Directory deployment requires a local workspace")
    const cwd = realpathSync(workspace.cwd), found = new Set<string>()
    let visited = 0, size = 0
    const walk = (path: string) => {
      if (++visited > 10_000) throw Error("Deployment traversal limit exceeded")
      let stat
      try { stat = lstatSync(join(cwd, path)) } catch (error) { if (missing(error)) return; throw error }
      if (stat.isSymbolicLink()) throw Error("Deployment symlinks are unsupported")
      if (stat.isDirectory()) for (const name of readdirSync(join(cwd, path)).sort()) walk(path ? `${path}/${name}` : name)
      else if (matchers.some(pattern => pattern.test(path))) {
        if (!stat.isFile()) throw Error("Invalid deployment file")
        found.add(path)
      }
    }
    for (const pattern of paths) {
      const parts = pattern.split("/"), firstGlob = parts.findIndex(part => /[*?]/.test(part))
      const prefix = (firstGlob < 0 ? parts : parts.slice(0, firstGlob)).join("/")
      walk(prefix)
    }
    const data = [...found].sort().map(path => {
      const value = bytes(cwd, path)
      size += value.bytes.length
      if (size > 16 * 1024 * 1024 || found.size > 1000) throw Error("Deployment byte limit exceeded")
      return value
    })
    const manifest: Manifest = { version: 1, paths, configuration, files: data.map(value => value.file) }
    return { manifest, data, digest: hash(JSON.stringify(manifest)) }
  }
  const current = () => {
    let pointer: DirectoryDeploymentReceipt
    try {
      if (!lstatSync(currentPath).isFile() || lstatSync(currentPath).isSymbolicLink() || lstatSync(currentPath).size > 4096)
        throw Error("Invalid deployment pointer")
      pointer = JSON.parse(readFileSync(currentPath, "utf8"))
    } catch (error) { if (missing(error)) return; throw error }
    if (pointer.version !== 1 || !uuid.test(pointer.id) || !hex.test(pointer.digest)) throw Error("Invalid deployment receipt")
    const base = root(), versions = join(base, "versions"), version = join(versions, pointer.id)
    if (lstatSync(versions).isSymbolicLink() || lstatSync(version).isSymbolicLink()) throw Error("Invalid deployment version")
    const raw = bytes(version, "manifest.json").bytes
    if (raw.length > 1024 * 1024 || hash(raw) !== pointer.digest) throw Error("Deployment manifest mismatch")
    const manifest = JSON.parse(raw.toString("utf8")) as Manifest
    if (manifest.version !== 1 || !hex.test(manifest.configuration) || !Array.isArray(manifest.files) || manifest.files.length > 1000 ||
      JSON.stringify(manifest.paths) !== JSON.stringify(pathPatterns(manifest.paths))) throw Error("Invalid deployment manifest")
    let size = 0
    const seen = new Set<string>()
    for (const file of manifest.files) {
      if (!relativePath(file.path) || seen.has(file.path)) throw Error("Invalid deployment manifest path")
      seen.add(file.path)
      const actual = bytes(join(version, "files"), file.path)
      size += actual.bytes.length
      if (size > 16 * 1024 * 1024 || JSON.stringify(actual.file) !== JSON.stringify(file)) throw Error("Deployed bytes mismatch")
    }
    return { pointer, manifest, directory: join(version, "files") }
  }

  const changes: WorkspaceChangeProvider = { changed: request => Effect.try({ try: () => {
    // This first adapter owns one complete deployable scope. A different query
    // is unknown, not evidence that some unowned path never changed.
    if (JSON.stringify(pathPatterns(request.patterns)) !== JSON.stringify(paths)) return undefined
    const deployed = current()
    if (!deployed) return true
    return candidate(request.workspace).digest !== deployed.pointer.digest
  }, catch: error => error }) }

  return {
    changes,
    publish: (workspace: Workspace) => Effect.gen(function* () {
      if ((yield* executionMode) === "plan") return undefined
      return yield* Effect.try({ try: () => {
        const selected = candidate(workspace)
        if (!selected.data.length) throw Error("Refusing an empty directory deployment")
        mkdirSync(directory, { recursive: true, mode: 0o700 })
        const base = root(), lock = join(base, "publication.lock")
        writeFileSync(lock, "active", { flag: "wx", mode: 0o600 })
        try {
          const id = randomUUID(), version = join(base, "versions", id)
          directoryUnder(base, "versions")
          mkdirSync(version, { mode: 0o700 })
          directoryUnder(version, "files")
          for (const item of selected.data) {
            const path = join(version, "files", item.file.path)
            const parent = item.file.path.split("/").slice(0, -1).join("/")
            if (parent) directoryUnder(join(version, "files"), parent)
            writeFileSync(path, item.bytes, { flag: "wx", mode: item.file.executable ? 0o700 : 0o600 })
            if (JSON.stringify(bytes(join(version, "files"), item.file.path).file) !== JSON.stringify(item.file))
              throw Error("Deployment readback mismatch")
          }
          writeFileSync(join(version, "manifest.json"), JSON.stringify(selected.manifest), { flag: "wx", mode: 0o600 })
          const receipt: DirectoryDeploymentReceipt = { version: 1, id, digest: selected.digest }
          const next = join(base, `current-${id}.json`)
          writeFileSync(next, JSON.stringify(receipt), { flag: "wx", mode: 0o600 })
          // This destination's commit point follows actual copied-byte readback.
          // Failed staging cannot replace the previous successful deployment.
          renameSync(next, currentPath)
          return receipt
        } finally { unlinkSync(lock) }
      }, catch: error => error })
    }),
    read: (path: string) => Effect.try({ try: () => {
      const deployed = current()
      if (!deployed || !deployed.manifest.files.some(file => file.path === path)) return undefined
      return bytes(deployed.directory, path).bytes
    }, catch: error => error }),
  }
}
