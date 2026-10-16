import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseEnv } from "node:util"
import { remoteOrigin } from "./remote-protocol.ts"

/** Public endpoint defaults belong in .env; credentials only in private .env.local.
 * Read only these two CLI settings, never inject project variables into process.env.
 */
export const readProjectRemote = (root: string): { url?: string; token?: string } => {
  const read = (name: string) => {
    const path = join(root, name)
    if (!existsSync(path)) return {}
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65_536)
      throw new Error("Invalid remote configuration file")
    const values = parseEnv(readFileSync(path, "utf8"))
    if (values.EFFECT_CI_REMOTE_TOKEN && (name !== ".env.local" ||
        (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))))
      throw new Error("Remote API tokens belong only in a private, user-owned .env.local (mode 600)")
    return values
  }
  const shared = read(".env"), local = read(".env.local")
  const url = local.EFFECT_CI_REMOTE_URL || shared.EFFECT_CI_REMOTE_URL
  const token = local.EFFECT_CI_REMOTE_TOKEN
  if (token && (token.length > 8192 || /[\r\n]/.test(token)))
    throw new Error("Invalid remote API token")
  return { ...(url ? { url: remoteOrigin(url) } : {}), ...(token ? { token } : {}) }
}

export const resolveRemote = (
  environment: { EFFECT_CI_REMOTE_URL?: string; EFFECT_CI_REMOTE_TOKEN?: string },
  profile?: { url: string; token: string },
  project?: { url?: string; token?: string },
) => {
  const configured = environment.EFFECT_CI_REMOTE_URL || profile?.url || project?.url
  const url = configured ? remoteOrigin(configured) : undefined
  // A different URL must never inherit a machine/project credential.
  const token = environment.EFFECT_CI_REMOTE_TOKEN ||
    (url && profile && remoteOrigin(profile.url) === url ? profile.token : undefined) ||
    (url && project?.url && remoteOrigin(project.url) === url ? project.token : undefined)
  return { url, token }
}
