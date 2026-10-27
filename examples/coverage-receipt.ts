import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { relative, resolve } from "node:path"

export const sourceIdentity = (root: string, files: string[]) => {
  const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim()
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    files: Object.fromEntries(files.map(file => [relative(repository, resolve(root, file)),
      createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex")])),
  }
}
