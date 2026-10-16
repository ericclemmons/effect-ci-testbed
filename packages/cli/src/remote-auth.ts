import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { remoteOrigin } from "./remote-protocol.ts"

export const remoteProfilePath = () => process.env.EFFECT_CI_REMOTE_PROFILE || join(homedir(), ".config", "effect-ci", "remotes.json")

/** User-owned, private machine configuration, never checked-out project code. */
export const readRemoteProfile = (repository: string, path = remoteProfilePath()): {
  url: string; token: string
} | undefined => {
  if (!existsSync(path)) return undefined
  const file = lstatSync(path)
  if (!file.isFile() || file.isSymbolicLink() || file.size > 65_536 ||
      (process.platform !== "win32" && ((file.mode & 0o077) !== 0 || file.uid !== process.getuid?.()))) {
    throw new Error("Effect CI remote profile must be a private, user-owned file (mode 600)")
  }
  const value = JSON.parse(readFileSync(path, "utf8"))
  if (value.version !== 1 || !Array.isArray(value.remotes) || value.remotes.length > 32) {
    throw new Error("Invalid Effect CI remote profile")
  }
  const normalize = (repo: string) => repo.replace(/\.git$/, "")
  const matches = value.remotes.filter((entry: any) => typeof entry.repository === "string" &&
    normalize(entry.repository) === normalize(repository))
  if (matches.length > 1) throw new Error("Ambiguous Effect CI remote profile")
  const entry = matches[0]
  if (!entry) return undefined
  if (typeof entry.url !== "string" || typeof entry.token !== "string" ||
      !entry.token || entry.token.length > 8192 || /[\r\n]/.test(entry.token)) {
    throw new Error("Invalid Effect CI remote profile")
  }
  return { url: remoteOrigin(entry.url), token: entry.token }
}

/** cloudflared owns login and token storage; this only reads the existing session.
 * Credentials are never printed or forwarded to this subprocess environment.
 */
export const cachedAccessToken = (url: string, read = (origin: string): string => {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]
  const env = Object.fromEntries(allowed.filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]!]))
  return execFileSync("cloudflared", ["access", "token", "--app", origin], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 65_536,
    stdio: ["ignore", "pipe", "pipe"], env,
  })
}): string | undefined => {
  const origin = new URL(remoteOrigin(url))
  if (origin.protocol !== "https:") return undefined
  try {
    const token = read(origin.origin).trim()
    return token.length <= 32_768 && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ? token : undefined
  } catch { return undefined }
}
