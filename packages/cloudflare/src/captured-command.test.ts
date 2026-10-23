import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { capturedCommand } from "./captured-command.ts"

async function shell(argv: readonly string[]) {
  return new Promise<{ exitCode: number; stdout: ArrayBuffer; stderr: ArrayBuffer }>((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    child.stdout.on("data", bytes => stdout.push(bytes))
    child.stderr.on("data", bytes => stderr.push(bytes))
    child.on("error", reject)
    child.on("close", exitCode => resolve({ exitCode: exitCode!,
      stdout: Uint8Array.from(Buffer.concat(stdout)).buffer, stderr: Uint8Array.from(Buffer.concat(stderr)).buffer }))
  })
}

test("a lost exec result recovers the original completed command without executing it twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-ci-capture-test-"))
  const counter = join(root, "business-effects")
  const bootIdentity = join(root, "boot")
  await writeFile(bootIdentity, "fixture-boot")
  let launches = 0
  const exec = async (argv: readonly string[]) => {
    const command = launches++ === 0
    const output = await shell(argv)
    return { output: async () => { if (command) throw Error("exec transport lost"); return output } }
  }
  try {
    const result = await capturedCommand({ exec, running: () => true, directory: join(root, "capture"), bootIdentity,
      argv: ["sh", "-c", 'printf x >> "$1"; printf "actual stdout"; printf "actual stderr" >&2; exit 7', "sh", counter] })
    assert.equal(result.exitCode, 7)
    assert.equal(result.recovered, true)
    assert.equal(new TextDecoder().decode(result.stdout), "actual stdout")
    assert.equal(new TextDecoder().decode(result.stderr), "actual stderr")
    assert.equal(await readFile(counter, "utf8"), "x")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("completion waits for inherited descendant output and retains binary bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-ci-capture-test-"))
  const bootIdentity = join(root, "boot")
  await writeFile(bootIdentity, "fixture-boot")
  try {
    const result = await capturedCommand({ running: () => true, directory: join(root, "capture"), bootIdentity,
      exec: async argv => ({ output: () => shell(argv) }),
      argv: ["sh", "-c", '(sleep 0.05; printf "\\000\\377"; printf late >&2) & exit 3'] })
    assert.equal(result.exitCode, 3)
    assert.equal(result.recovered, false)
    assert.deepEqual([...new Uint8Array(result.stdout)], [0, 255])
    assert.equal(new TextDecoder().decode(result.stderr), "late")
    await assert.rejects(readFile(join(root, "capture", "result")), { code: "ENOENT" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("lost launch acknowledgement reads the original completion without launching again", async () => {
  const root = await mkdtemp(join(tmpdir(), "effect-ci-launch-ack-"))
  const bootIdentity = join(root, "boot"), effects = join(root, "effects")
  await writeFile(bootIdentity, "same-boot")
  let launched = false
  try {
    const result = await capturedCommand({ running: () => true, bootIdentity, directory: join(root, "capture"),
      argv: ["sh", "-c", 'printf x >> "$1"; printf original; exit 7', "sh", effects],
      exec: async argv => {
        const output = await shell(argv)
        if (!launched) { launched = true; throw Error("launch acknowledgement lost") }
        return { output: async () => output }
      },
    })
    assert.equal(result.exitCode, 7)
    assert.equal(result.recovered, true)
    assert.equal(await readFile(effects, "utf8"), "x")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("missing or foreign-boot completion never becomes success or replays the command", async () => {
  for (const mode of ["missing", "foreign-boot", "stopped", "mismatch", "invalid-record"] as const) {
    const root = await mkdtemp(join(tmpdir(), "effect-ci-capture-test-"))
    const bootIdentity = join(root, "boot"), directory = join(root, "capture"), counter = join(root, "effects")
    await writeFile(bootIdentity, "fixture-boot")
    let calls = 0
    try {
      const failure = Error("exec transport lost")
      await assert.rejects(capturedCommand({ running: () => mode !== "stopped", directory, bootIdentity,
        argv: ["sh", "-c", 'printf x >> "$1"; exit 0', "sh", counter],
        exec: async argv => {
          const first = calls++ === 0
          const output = await shell(argv)
          if (first) {
            if (mode === "missing") await rm(join(directory, "result"))
            if (mode === "foreign-boot") await writeFile(bootIdentity, "replacement-boot")
            if (mode === "invalid-record") await writeFile(join(directory, "result"), '{"version":1,"exitCode":null}')
          }
          return { output: async () => {
            if (first && mode !== "mismatch") throw failure
            return first ? { ...output, exitCode: 9 } : output
          } }
        },
      }), mode === "mismatch" ? /disagrees/ : failure)
      assert.equal(await readFile(counter, "utf8"), "x", mode)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})
