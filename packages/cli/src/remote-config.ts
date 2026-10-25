import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseEnv } from "node:util"
import { remoteOrigin } from "./remote-protocol.ts"

/** Endpoint discovery only; startup loads ignored local credentials separately. */
export const readProjectRemote = (root: string): { url?: string } => {
  const read = (name: string) => {
    const path = join(root, name)
    if (!existsSync(path)) return {}
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65_536)
      throw new Error("Invalid remote configuration file")
    const values = parseEnv(readFileSync(path, "utf8"))
    return values
  }
  const shared = read(".env"), local = read(".env.local")
  const oidcPath = join(root, ".cloudflare/ci/oidc.json")
  let oidc: { issuer?: unknown } = {}
  if (existsSync(oidcPath)) {
    const file = lstatSync(oidcPath)
    if (!file.isFile() || file.isSymbolicLink() || file.size > 8192) throw new Error("Invalid OIDC configuration file")
    oidc = JSON.parse(readFileSync(oidcPath, "utf8"))
  }
  const url = local.EFFECT_CI_REMOTE_URL || shared.EFFECT_CI_REMOTE_URL ||
    (typeof oidc.issuer === "string" ? oidc.issuer : undefined)
  return { ...(url ? { url: remoteOrigin(url) } : {}) }
}

export const resolveRemote = (
  environment: { EFFECT_CI_REMOTE_URL?: string; EFFECT_CI_REMOTE_TOKEN?: string },
  profile?: { url: string; token: string },
  project?: { url?: string },
) => {
  const configured = environment.EFFECT_CI_REMOTE_URL || profile?.url || project?.url
  const url = configured ? remoteOrigin(configured) : undefined
  // A different URL must never inherit a machine/project credential.
  const token = environment.EFFECT_CI_REMOTE_TOKEN ||
    (url && profile && remoteOrigin(profile.url) === url ? profile.token : undefined)
  return { url, token }
}
