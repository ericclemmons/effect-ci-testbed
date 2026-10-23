import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parseEnv } from "node:util"

/** Repository defaults, followed by overrides closer to the current directory. */
export function projectEnvironment(cwd: string): Record<string, string> {
  const directories: string[] = []
  for (let directory = resolve(cwd); ; directory = dirname(directory)) {
    directories.unshift(directory)
    if (existsSync(join(directory, ".git")) || dirname(directory) === directory) break
  }
  const settings: Record<string, string> = {}
  for (const directory of directories) {
    for (const name of [".env", ".env.local"]) {
      const path = join(directory, name)
      if (existsSync(path)) Object.assign(settings, parseEnv(readFileSync(path, "utf8")))
    }
  }
  if (settings.EFFECT_CI_PUBLIC_URL) settings.EFFECT_CI_REMOTE_URL ??= settings.EFFECT_CI_PUBLIC_URL
  if (settings.EFFECT_CI_API_TOKEN) settings.EFFECT_CI_REMOTE_TOKEN ??= settings.EFFECT_CI_API_TOKEN
  return settings
}
