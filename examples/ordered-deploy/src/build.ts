import { execFileSync } from "node:child_process"

export function sourceRevision() {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error("Build needs a full source revision")
  return revision
}
