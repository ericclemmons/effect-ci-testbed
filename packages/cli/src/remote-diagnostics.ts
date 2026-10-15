import { decodeCommandDiagnostics } from "@effect-ci-testbed/ci"

export const remoteErrorMessage = (message: string | undefined) => {
  const d = decodeCommandDiagnostics(message)
  if (!d) return message
  const output = [d.output.stdout ? `stdout:\n${d.output.stdout.trimEnd()}` : "",
    d.output.stderr ? `stderr:\n${d.output.stderr.trimEnd()}` : ""].filter(Boolean).join("\n")
  return `Command failed (${d.exitCode}): ${d.command}${output ? `\n${output}` : ""}${d.output.truncated ? "\n[diagnostics truncated]" : ""}`
}

/** Descriptive output only. Never execute a reported command or treat it as
 * remote proof, an approval, retry instruction or repository authority.
 */
export const remoteCommandDiagnostics = (events: ReadonlyArray<{ error?: { message?: string } }>) => {
  const seen = new Set<string>()
  const out = []
  for (const e of events) {
    const d = decodeCommandDiagnostics(e.error?.message)
    if (!d) continue
    const { version: _, ...details } = d
    const key = JSON.stringify(details)
    if (!seen.has(key)) { seen.add(key); out.push(details) }
    if (out.length === 16) break
  }
  return out
}
