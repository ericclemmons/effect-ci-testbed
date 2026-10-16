/** Diagnostic data only: never an executable command, reuse proof or authority. */
export interface CommandDiagnostics {
  readonly version: 1
  readonly stepId: string
  readonly command: string
  readonly cwd: string
  readonly exitCode: number
  readonly output: { readonly stdout: string; readonly stderr: string; readonly truncated: boolean }
}
const marker = "\n[effect-ci-command-error-v1]"
export const commandDiagnosticLimit = 32768
const bytes = (s: string) => new TextEncoder().encode(s).length
const tail = (s: string, n: number) => {
  const value = n === 0 ? "" : s.slice(-n)
  // Do not begin a truncated UTF-16 stream with half a surrogate pair.
  return /^[\uDC00-\uDFFF]/.test(value) ? value.slice(1) : value
}
export const boundedCommandOutput = (stdout: string, stderr: string) => {
  const out = tail(stdout, 8192), err = tail(stderr, 8192)
  return { stdout: out, stderr: err, truncated: out.length !== stdout.length || err.length !== stderr.length }
}
const human = (d: CommandDiagnostics) => `Command failed (${d.exitCode}): ${d.command}${d.output.stderr || d.output.stdout ? `\n${d.output.stderr || d.output.stdout}` : ""}`
function plain(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && actual.every(k => typeof k === "string" && keys.includes(k)) &&
    keys.every(k => { const d = Object.getOwnPropertyDescriptor(value, k); return d && "value" in d })
}
function valid(value: unknown): value is CommandDiagnostics {
  if (!plain(value, ["version", "stepId", "command", "cwd", "exitCode", "output"]) || value.version !== 1 ||
      typeof value.stepId !== "string" || value.stepId.length > 4096 ||
      typeof value.command !== "string" || value.command.length > 16384 ||
      typeof value.cwd !== "string" || value.cwd.length > 8192 ||
      typeof value.exitCode !== "number" || !Number.isSafeInteger(value.exitCode) || value.exitCode === 0 ||
      !plain(value.output, ["stdout", "stderr", "truncated"])) return false
  return typeof value.output.stdout === "string" && value.output.stdout.length <= 8192 &&
    typeof value.output.stderr === "string" && value.output.stderr.length <= 8192 && typeof value.output.truncated === "boolean"
}
/** Native checkpoints retain error messages but may drop custom Error fields.
 * The checkpoint still THROWS; failure is never cached as a successful result.
 */
export function encodeCommandDiagnostics(value: CommandDiagnostics): string | undefined {
  if (!valid(value)) return undefined
  let d = value
  for (;;) {
    const message = human(d) + marker + JSON.stringify(d)
    if (bytes(message) <= commandDiagnosticLimit) return message
    if (!d.output.stdout.length && !d.output.stderr.length) return undefined
    d = { ...d, output: { stdout: tail(d.output.stdout, Math.floor(d.output.stdout.length / 2)),
      stderr: tail(d.output.stderr, Math.floor(d.output.stderr.length / 2)), truncated: true } }
  }
}
export function decodeCommandDiagnostics(message: unknown,
  expected: Partial<Pick<CommandDiagnostics, "stepId" | "command" | "cwd">> = {},
): CommandDiagnostics | undefined {
  if (typeof message !== "string" || message.length > commandDiagnosticLimit || bytes(message) > commandDiagnosticLimit) return undefined
  const at = message.lastIndexOf(marker)
  if (at < 0) return undefined
  let d: unknown
  try { d = JSON.parse(message.slice(at + marker.length)) } catch { return undefined }
  if (!valid(d) || message.slice(0, at) !== human(d)) return undefined
  for (const k of ["stepId", "command", "cwd"] as const) if (expected[k] !== undefined && expected[k] !== d[k]) return undefined
  return d
}
