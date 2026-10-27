import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { sourceIdentity } from "../../../coverage-receipt.ts"

const attempt = <A>(operation: () => A) => Effect.try({ try: operation, catch: (error) => error })

/** Trusted recipe commands, isolated filesystem copies. Not a security sandbox. */
export const local = ({ root }: { readonly root: string }): CI.RunConfiguration => {
  const id = randomUUID()
  const provider = "snapshot-fanout-files"
  const snapshots = new Map([["source", root]])
  const workspaces = new Map<string, string>()
  const captures: Array<{ stepId: string; directory: string; digest: string }> = []
  const commands: Array<{ stepId: string; started: number; finished: number; exitCode: number }> = []
  const digest = (directory: string): string => {
    const hash = createHash("sha256")
    const visit = (path: string) => {
      for (const name of readdirSync(path).sort()) {
        const target = join(path, name)
        const info = lstatSync(target)
        hash.update(JSON.stringify([relative(directory, target), info.mode & 0o777, info.isDirectory()]))
        if (info.isDirectory()) visit(target)
        else if (info.isFile()) hash.update(readFileSync(target))
        else throw Error("Snapshot contains a non-regular entry")
      }
    }
    visit(directory)
    return hash.digest("hex")
  }
  const originalDigest = digest(join(root, "app"))
  let directory: string | undefined
  const allocate = () => {
    directory ??= mkdtempSync(join(tmpdir(), "effect-ci-file-snapshots-"))
    return join(directory, randomUUID())
  }
  const snapshot = (workspace: CI.Workspace) => {
    if (workspace.id !== id || workspace.kind !== "remote" ||
      workspace.revision?.provider !== provider || typeof workspace.revision.value !== "string")
      throw Error("Workspace does not belong to this snapshot runner")
    const source = snapshots.get(workspace.revision.value)
    if (!source) throw Error("Unknown workspace snapshot")
    return source
  }
  const inside = (cwd: string, path = "") => {
    const suffix = relative("/workspace", cwd)
    if (isAbsolute(suffix) || suffix.split(/[\\/]/).includes("..") ||
      isAbsolute(path) || path.split(/[\\/]/).includes(".."))
      throw Error("Path must stay inside the workspace")
    return join(suffix, path)
  }
  const copy = (source: string) => {
    const target = allocate()
    // Only this recipe's public fixture; never copy .git, credentials or dependencies.
    cpSync(join(source, "app"), join(target, "app"), {
      recursive: true,
      filter: (path) => {
        const info = lstatSync(path)
        if (!info.isDirectory() && !info.isFile())
          throw Error("Snapshot fixtures require regular files and directories")
        return true
      },
    })
    return target
  }
  const materialize = (workspace: CI.Workspace, stepId: string) => {
    const source = snapshot(workspace)
    const key = JSON.stringify([stepId, workspace.revision!.value])
    let target = workspaces.get(key)
    if (!target) {
      target = copy(source)
      workspaces.set(key, target)
    }
    return target
  }
  const capture = (workspace: CI.Workspace, stepId: string): CI.WorkspaceCheckpointHandle => {
    const value = randomUUID()
    const directory = copy(materialize(workspace, stepId))
    snapshots.set(value, directory)
    captures.push({ stepId, directory, digest: digest(join(directory, "app")) })
    return { provider, value }
  }
  const file = (workspace: CI.Workspace, path: string, stepId: string) => {
    const suffix = inside(workspace.cwd, path)
    return join(materialize(workspace, stepId), suffix)
  }

  return {
    env: "file-snapshots",
    source: {
      checkout: () => Effect.succeed(CI.Workspace.remote(id, "/workspace", { provider, value: "source" })),
      reference: { kind: "local", path: root },
    },
    executor: {
      execute: ({ workspace, stepId, command, onOutput }) => Effect.tryPromise({
        try: () => new Promise<CI.CommandExecutionResult>((resolve, reject) => {
          const started = Date.now()
          const child = spawn("sh", ["-c", command], {
            cwd: file(workspace, "", stepId), stdio: ["ignore", "pipe", "pipe"],
          })
          let stdout = "", stderr = ""
          child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString()
            onOutput("stdout", chunk.toString())
          })
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString()
            onOutput("stderr", chunk.toString())
          })
          child.once("error", reject)
          child.once("close", (code) => {
            commands.push({ stepId, started, finished: Date.now(), exitCode: code ?? 1 })
            resolve({ exitCode: code ?? 1, stdout, stderr })
          })
        }),
        catch: (error) => new CI.CommandError(stepId, command, workspace.cwd, 1, String(error)),
      }),
    },
    workspacePersistence: {
      commit: ({ workspace, stepId }) => attempt(() => workspace.withRevision(capture(workspace, stepId))),
      checkpoint: ({ workspace, stepId }) => attempt(() => capture(workspace, stepId)),
      restore: ({ checkpoint }) => attempt(() => {
        const restored = checkpoint.workspace.withRevision(checkpoint.handle)
        snapshot(restored)
        return restored
      }),
    },
    workspaceFileSystem: {
      exists: (workspace, path, stepId) => attempt(() => existsSync(file(workspace, path, stepId))),
      readFile: (workspace, path, stepId) => attempt(() => {
        const target = file(workspace, path, stepId)
        return existsSync(target) ? readFileSync(target, "utf8") : undefined
      }),
    },
    dispose: async () => {
      try {
        if (!commands.length) return
        const [prepared] = captures.filter(capture => capture.stepId === "prepare")
        const [left] = commands.filter(command => command.stepId === "left")
        const [right] = commands.filter(command => command.stepId === "right")
        const preparedUnchanged = !!prepared && digest(join(prepared.directory, "app")) === prepared.digest &&
          readFileSync(join(prepared.directory, "app/prepared.txt"), "utf8") === "prepared" &&
          !existsSync(join(prepared.directory, "app/branch.txt"))
        const branches = ["left", "right"].map(stepId => {
          const [capture] = captures.filter(capture => capture.stepId === stepId)
          return { stepId, isolated: !!capture && capture.directory !== prepared?.directory,
            contents: capture ? readFileSync(join(capture.directory, "app/branch.txt"), "utf8") : undefined }
        })
        const receipt = {
          schemaVersion: 1, recordedAt: new Date().toISOString(),
          recipe: "snapshot-fanout", environment: process.env.GITHUB_ACTIONS === "true" ? "effect-on-github" : "effect-local",
          source: sourceIdentity(root, [".cloudflare/ci/local.ts", ".cloudflare/ci/actions.ts", ".cloudflare/ci/workflow.ts", "../coverage-receipt.ts"]),
          github: process.env.GITHUB_RUN_ID ? { runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT } : null,
          runtime: { node: process.version, platform: process.platform, arch: process.arch },
          originalDigest, sourceUnchanged: digest(join(root, "app")) === originalDigest,
          preparedDigest: prepared?.digest, preparedUnchanged,
          prepareExecutions: commands.filter(command => command.stepId === "prepare").length,
          allSnapshotsUnchanged: captures.every(capture => digest(join(capture.directory, "app")) === capture.digest),
          branches, overlapping: !!left && !!right && Math.max(left.started, right.started) < Math.min(left.finished, right.finished),
          commands, boundary: "Trusted shell commands in separate filesystem copies; not a VM security boundary or signed reusable evidence",
        }
        if (process.env.EFFECT_CI_SNAPSHOT_RECEIPT) writeFileSync(process.env.EFFECT_CI_SNAPSHOT_RECEIPT, JSON.stringify(receipt, null, 2) + "\n")
        if (!receipt.sourceUnchanged || !preparedUnchanged || !receipt.allSnapshotsUnchanged || receipt.prepareExecutions !== 1 ||
          !receipt.overlapping || commands.length !== 3 || commands.some(command => command.exitCode !== 0) ||
          branches.some(branch => !branch.isolated || branch.contents !== branch.stepId)) throw Error("Snapshot fanout invariants failed")
      } finally {
        if (directory) rmSync(directory, { recursive: true, force: true })
        workspaces.clear()
        snapshots.clear()
      }
    },
  }
}
