import * as Schema from "effect/Schema"

interface Output {
  readonly exitCode: number
  readonly stdout: ArrayBuffer
  readonly stderr: ArrayBuffer
}
interface Capture {
  readonly exec: (argv: readonly string[]) => Promise<{ output(): Promise<Output> }>
  readonly running: () => boolean
  readonly argv: readonly string[]
  readonly directory: string
  readonly bootIdentity?: string
  /** Retain the boot-bound record until its host has durably saved the result. */
  readonly retain?: boolean
}

// Only a trusted host opts into this envelope. Never use project-owned result
// files as an attestation for an untrusted project. A fresh directory belongs to
// one command in one VM boot; nothing is restored or executed a second time.
const capture = `set -eu
d=$1; boot=$2; shift 2
mkdir -m 700 -- "$d"
cat "$boot" >"$d/boot"
mkfifo "$d/out-pipe" "$d/err-pipe"
cat "$d/out-pipe" >"$d/stdout" & out=$!
cat "$d/err-pipe" >"$d/stderr" & err=$!
if "$@" >"$d/out-pipe" 2>"$d/err-pipe"; then status=0; else status=$?; fi
wait "$out"
wait "$err"
printf '{"version":1,"exitCode":%s}\\n' "$status" >"$d/result.tmp"
mv "$d/result.tmp" "$d/result"
exit "$status"`
const record = `set -eu
d=$1; boot=$2
test -f "$d/boot" || exit 2
test "$(cat "$boot")" = "$(cat "$d/boot")"
test -f "$d/result" || exit 2
cat "$d/result"`
const read = `set -eu
cat "$1/stdout"
cat "$1/stderr" >&2`
const Result = Schema.Struct({ version: Schema.Literal(1),
  exitCode: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 255 })) })

export async function capturedCommand(input: Capture): Promise<Output & { readonly recovered: boolean }> {
  const boot = input.bootIdentity ?? "/proc/sys/kernel/random/boot_id"
  let observed: Output | undefined
  let failure: unknown
  // No retry even if launching the command has an uncertain acknowledgement.
  try {
    const process = await input.exec(["/bin/sh", "-c", capture, "sh", input.directory, boot, ...input.argv])
    observed = await process.output()
  } catch (error) { failure = error }
  if (!input.running()) throw failure ?? Error("Command container stopped before result readback")
  try {
    const result = await readCapturedCommand(input)
    if (!result) throw Error("Command completion record is unavailable")
    if (observed && observed.exitCode !== result.exitCode) throw Error("Command result disagrees with its process exit")
    if (!input.retain) {
      const cleanup = await (await input.exec(["rm", "-r", "--", input.directory])).output()
      if (cleanup.exitCode !== 0) throw Error("Command result cleanup failed")
    }
    return { ...result, recovered: observed === undefined }
  } catch (error) { throw failure ?? error }
}

/** Reattach only to this record in the surviving VM. Never start or restore it. */
export async function readCapturedCommand(input: Pick<Capture, "exec" | "running" | "directory" | "bootIdentity">): Promise<Output | undefined> {
  if (!input.running()) throw Error("Command container stopped before result readback")
  const boot = input.bootIdentity ?? "/proc/sys/kernel/random/boot_id"
  const metadata = await (await input.exec(["/bin/sh", "-c", record, "sh", input.directory, boot])).output()
  if (metadata.exitCode === 2) return undefined
  if (metadata.exitCode !== 0) throw Error("Command completion record is unavailable or belongs to another VM boot")
  const result = Schema.decodeUnknownSync(Schema.fromJsonString(Result))(new TextDecoder().decode(metadata.stdout))
  const output = await (await input.exec(["/bin/sh", "-c", read, "sh", input.directory])).output()
  if (output.exitCode !== 0) throw Error("Command output readback failed")
  return { exitCode: result.exitCode, stdout: output.stdout, stderr: output.stderr }
}
