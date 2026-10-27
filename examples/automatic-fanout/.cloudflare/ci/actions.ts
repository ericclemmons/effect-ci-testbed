import * as CI from "@effect-ci-testbed/ci"

interface CheckReport {
  readonly name: string
  readonly started: number
  readonly finished: number
  readonly workspace: string
  readonly preparation: { readonly count: number; readonly token: string }
}

const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source
  return function* () {
    return (yield* source.checkout()).directory("app")
  }
})

export const prepare = CI.action("prepare", function* () {
  const workspace = yield* checkout()
  return () => workspace.exec("node prepare.mjs")
})

const isolatedCheck = (name: "left" | "right") => CI.action<CheckReport>(name, function* () {
  const workspace = yield* prepare()
  return function* () {
    const checked = yield* workspace.exec(`node check.mjs ${name}`)
    if ((yield* CI.executionMode) === "plan") {
      return { name, started: 0, finished: 0, workspace: "", preparation: { count: 0, token: "" } }
    }
    const report = yield* checked.readFile("report.json")
    if (report === undefined) throw new Error(`Missing ${name} report`)
    return JSON.parse(report) as CheckReport
  }
})

export const left = isolatedCheck("left")
export const right = isolatedCheck("right")

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"

export const aggregate = CI.action("aggregate", function* () {
  const leftReport = yield* left()
  const rightReport = yield* right()
  const workspace = yield* prepare()
  return () => workspace.exec(
    `node aggregate.mjs ${shellQuote(JSON.stringify(leftReport))} ${shellQuote(JSON.stringify(rightReport))}`,
  )
})
