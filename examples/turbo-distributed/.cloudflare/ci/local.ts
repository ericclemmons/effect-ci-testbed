import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, relative } from "node:path"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const attempt = <A>(operation: () => A) => Effect.try({ try: operation, catch: (error) => error })

export const local = ({ root }: { readonly root: string }): CI.RunConfiguration => {
  const id = randomUUID()
  const provider = "turbo-distributed-files"
  const snapshots = new Map([["source", root]])
  const workspaces = new Map<string, string>()
  const processes = new Set<{ readonly stop: () => void; readonly closed: Promise<void> }>()
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
    cpSync(join(source, "app"), join(target, "app"), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => {
        if (basename(path) === ".git") return false
        if (source === root && ["node_modules", ".turbo", ".effect-ci", "dist", "branch.txt"].includes(basename(path))) return false
        const info = lstatSync(path)
        if (info.isSymbolicLink()) {
          const resolved = relative(realpathSync(join(source, "app")), realpathSync(path))
          if (isAbsolute(resolved) || resolved.split(/[\\/]/).includes("..")) throw Error(`Snapshot symlink escapes the fixture: ${path}`)
          return true
        }
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
    snapshots.set(value, copy(materialize(workspace, stepId)))
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
        try: (signal) => new Promise<CI.CommandExecutionResult>((resolve, reject) => {
          const child = spawn("sh", ["-c", command], {
            cwd: file(workspace, "", stepId), stdio: ["ignore", "pipe", "pipe"], detached: true,
          })
          const stop = () => {
            if (child.pid) {
              try { process.kill(-child.pid, "SIGKILL") } catch {}
            }
          }
          let finish!: () => void
          const running = { stop, closed: new Promise<void>((done) => { finish = done }) }
          processes.add(running)
          signal.addEventListener("abort", stop, { once: true })
          if (signal.aborted) stop()
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
            signal.removeEventListener("abort", stop)
            processes.delete(running)
            finish()
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
      const running = [...processes]
      running.forEach(child => child.stop())
      await Promise.all(running.map(child => child.closed))
      if (directory) rmSync(directory, { recursive: true, force: true })
      workspaces.clear()
      snapshots.clear()
    },
  }
}
