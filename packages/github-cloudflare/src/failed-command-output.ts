import { encodeCommandDiagnostics, type CommandDiagnostics } from "@effect-ci-testbed/ci/command-diagnostics"

/** Presentation only. Never consumes host exception text or changes a run result. */
export function failedCommandOutput(diagnostics: CommandDiagnostics, redactValues: ReadonlyArray<string>) {
  if (!encodeCommandDiagnostics(diagnostics)) return undefined
  const clean = (text: string) => {
    let value = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    for (const secret of [...redactValues].filter(v => v.length >= 4).sort((a, b) => b.length - a.length))
      value = value.replaceAll(secret, "[redacted]")
    return value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted private key]")
      .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b/g, "[redacted]")
      .replace(/\b[\w-]*(?:token|secret|password|api[_-]?key)[\w-]*\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s&]+)/gi, "[redacted credential]")
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[redacted JWT]")
      .replace(/<[!@][^>]*>/g, "[mention suppressed]")
  }
  const stdout = clean(diagnostics.output.stdout), stderr = clean(diagnostics.output.stderr)
  const truncated = diagnostics.output.truncated || stdout.length > 2200 || stderr.length > 2200
  const header = `${clean(diagnostics.command).slice(0, 300)} · exit ${diagnostics.exitCode}`
  const streams = [header,
    ...(stdout ? [`stdout${truncated ? " (tail; output truncated)" : ""}\n${stdout.slice(-2200)}`] : []),
    ...(stderr ? [`stderr${truncated ? " (tail; output truncated)" : ""}\n${stderr.slice(-2200)}`] : []),
    ...(!stdout && !stderr ? ["No stdout or stderr was captured."] : []),
  ]
  return { text: streams.join("\n"), blocks: streams.map(text => ({ type: "section", text: { type: "plain_text", text, emoji: false } })) }
}
