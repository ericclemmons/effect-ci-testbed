import * as CI from "@effect-ci-testbed/ci"

// Hosted adapter regression probes, not consumer SDK examples. Every instance
// gets its own cloned workspace; these commands never deploy anything.
const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return () => source.checkout()
})

const retry = CI.action("retry command", () => function* () {
  const workspace = yield* checkout()
  return yield* workspace.exec(`node -e 'const fs = require("node:fs"); const path = ".retry-attempt"; const attempt = fs.existsSync(path) ? Number(fs.readFileSync(path)) + 1 : 1; fs.writeFileSync(path, String(attempt)); console.log("attempt " + attempt); process.exit(attempt < 3 ? 1 : 0)'`)
}, { retries: { limit: 2, delay: 0, backoff: "constant" } })

const fail = CI.action("fail once", () => function* () {
  const workspace = yield* checkout()
  return yield* workspace.exec("echo expected-command-failure >&2; exit 7")
})

export const commandRetryProbe = CI.workflow("command-retry-probe", () => retry())
export const commandFailureProbe = CI.workflow("command-failure-probe", () => fail())
