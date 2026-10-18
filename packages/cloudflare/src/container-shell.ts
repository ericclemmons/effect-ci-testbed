/** The same host shell policy applies before checkout, at readiness and during
 * project commands. A non-login runner must never source project-writable profiles. */
export const containerShell = (command: string, options: { readonly loginShell?: boolean }): string[] =>
  options.loginShell === false ? ["/bin/sh", "-c", command] : ["sh", "-lc", command]
