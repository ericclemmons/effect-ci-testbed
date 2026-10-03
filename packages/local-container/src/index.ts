import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

const containerRoot = "/workspace"

export interface RunnerOptions {
  readonly engine?: string
  readonly image: string
}

export interface Runner extends CI.RunOptions {
  readonly dispose: () => Promise<void>
}

interface ProcessResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

const run = (
  executable: string,
  args: ReadonlyArray<string>,
  onOutput?: (stream: "stdout" | "stderr", text: string) => void,
): Promise<ProcessResult> => new Promise((resolve, reject) => {
  const stdout: Array<string> = []
  const stderr: Array<string> = []
  const child = spawn(executable, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
  })

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    stdout.push(text)
    onOutput?.("stdout", text)
  })
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    stderr.push(text)
    onOutput?.("stderr", text)
  })
  child.once("error", reject)
  child.once("close", (code) => resolve({
    exitCode: code ?? 1,
    stderr: stderr.join(""),
    stdout: stdout.join(""),
  }))
})

const workspacePath = (root: string, path: string): string => {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`Workspace path must be relative: ${path}`)
  }

  return `${root}/${path}`
}

export const makeRunner = (options: RunnerOptions): Runner => {
  const engine = options.engine ?? "docker"
  const name = `effect-ci-${process.pid}-${randomUUID().slice(0, 8)}`
  let hostRoot: string | undefined
  let started = false

  const ensureWorkspace = (workspace: CI.Workspace): void => {
    if (workspace.kind !== "remote" || workspace.id !== name) {
      throw new Error(`Workspace ${workspace.cwd} does not belong to ${name}`)
    }
  }

  const ensureStarted = async (): Promise<void> => {
    if (started) return
    if (!hostRoot) throw new Error("CI.Source.checkout must run before container commands")

    const result = await run(engine, [
      "run",
      "--detach",
      "--name",
      name,
      "--volume",
      `${hostRoot}:${containerRoot}`,
      "--workdir",
      containerRoot,
      options.image,
      "sh",
      "-lc",
      "trap : TERM INT; sleep infinity & wait",
    ])

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `Could not start ${name}`)
    }

    started = true
  }

  const executeArgs = async (
    workspace: CI.Workspace,
    args: ReadonlyArray<string>,
    onOutput?: (stream: "stdout" | "stderr", text: string) => void,
  ): Promise<ProcessResult> => {
    ensureWorkspace(workspace)
    await ensureStarted()

    return run(engine, [
      "exec",
      "--workdir",
      workspace.cwd,
      name,
      ...args,
    ], onOutput)
  }

  const execute = (
    workspace: CI.Workspace,
    command: string,
    onOutput?: (stream: "stdout" | "stderr", text: string) => void,
  ): Promise<ProcessResult> => executeArgs(workspace, [
    "sh",
    "-lc",
    command,
  ], onOutput)

  return {
    env: "local-container",
    source: {
      checkout: (root) => Effect.sync(() => {
        if (hostRoot && hostRoot !== root) {
          throw new Error(`This runner already mounted ${hostRoot}; cannot also mount ${root}`)
        }

        hostRoot = root

        return CI.Workspace.remote(name, containerRoot)
      }),
    },
    executor: {
      execute: ({ command, onOutput, stepId, workspace }) => Effect.tryPromise({
        try: async () => {
          const result = await execute(workspace, command, onOutput)

          if (result.exitCode !== 0) {
            throw new CI.CommandError(
              stepId,
              command,
              workspace.cwd,
              result.exitCode,
            )
          }

          return result
        },
        catch: (error) => error instanceof CI.CommandError
          ? error
          : new CI.CommandError(stepId, command, workspace.cwd, 1),
      }),
    },
    workspaceFileSystem: {
      exists: (workspace, path) => Effect.tryPromise({
        try: async () => {
          const result = await executeArgs(
            workspace,
            ["test", "-e", workspacePath(workspace.cwd, path)],
          )

          return result.exitCode === 0
        },
        catch: (error) => error,
      }),
      readFile: (workspace, path) => Effect.tryPromise({
        try: async () => {
          const result = await executeArgs(
            workspace,
            ["cat", workspacePath(workspace.cwd, path)],
          )

          return result.exitCode === 0 ? result.stdout : undefined
        },
        catch: (error) => error,
      }),
    },
    dispose: async () => {
      if (!started) return

      await run(engine, ["rm", "--force", name])
      started = false
    },
  }
}
