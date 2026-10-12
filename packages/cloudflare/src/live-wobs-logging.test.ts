import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

const retry = process.env.WOBS_LOG_RETRY_INSTANCE
const terminal = process.env.WOBS_LOG_TERMINAL_INSTANCE
const account = process.env.WOBS_LOG_ACCOUNT
const command = (...args: string[]) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))

/** Read-only recorded-run proof: no dispatch, mutation, notification, or arbitrary log output. */
test("real persisted Effect logs retain severity and native attempt context without changing terminal outcomes",
  { skip: !retry || !terminal || !account, timeout: 60_000 }, () => {
    assert.match(account!, /^[a-f0-9]{32}$/)
    for (const id of [retry!, terminal!]) assert.match(id, /^[a-zA-Z0-9_-]{1,128}$/)
    const runs = [retry!, terminal!].map((id, index) => command("workflows", "instances", "get", id,
      "--workflow-name", index ? "effect-ci-probe-observability-terminal" : "effect-ci-probe-observability"))
    assert.deepEqual(runs.map(run => run.status), ["complete", "errored"])
    const action = runs[0].steps.find((s: any) => s.name === 'action:"structured-logs"-1')
    assert.equal(action.attempts.length, 2)
    assert.deepEqual(action.attempts.map((a: any) => a.success), [false, true])
    assert.ok(Date.parse(action.attempts[1].start) - Date.parse(action.attempts[0].end) >= 1000)
    const failed = runs[1].steps.find((s: any) => s.name === 'action:"terminal-error"-1')
    assert.equal(failed.attempts.length, 1, "nonretryable means one attempt despite limit10")
    assert.match(failed.attempts[0].error.message, /NonRetryableError: effect-wobs-terminal/)
    const from = new Date(Math.min(...runs.map(run => Date.parse(run.start))) - 1000).toISOString()
    const to = new Date(Math.max(...runs.map(run => Date.parse(run.end))) + 1000).toISOString()
    const query = "SELECT timestamp,logType,level,attributes FROM logs.workersLogs WHERE scriptName = $script AND timestamp >= $from AND timestamp < $to ORDER BY timestamp ASC LIMIT 200"
    const result = command("sql", "query", query, "--body", JSON.stringify({ query,
      params: { script: "effect-ci-examples", from, to }, scope: { accountTag: account } }))
    assert.ok(result.rows < 200, "saturated reads are not proof")
    const rows = result.data.filter((row: any) => row.attributes?.source === "effect-ci")
    const find = (instance: string, level: string, step: string, attempt: number, marker: string) =>
      rows.find((row: any) => row.level === level && row.attributes.instance === instance && row.attributes.step === step &&
        row.attributes.attempt === attempt && Object.values(row.attributes).some(value => typeof value === "string" && value.includes(marker)))
    assert.ok(find(retry!, "Info", "structured-logs", 1, "effect-wobs-probe"))
    assert.ok(find(retry!, "Info", "structured-logs", 2, "effect-wobs-probe"))
    assert.ok(find(retry!, "Warn", "structured-logs", 1, "Action attempt failed"))
    assert.ok(find(retry!, "Error", "structured-logs", 2, "effect-wobs-handled-error"))
    assert.ok(find(retry!, "Info", "$workflow", 1, "Workflow completed"))
    assert.ok(find(terminal!, "Error", "$workflow", 1, "effect-wobs-terminal"))
    assert.ok(!find(terminal!, "Info", "$workflow", 1, "Workflow completed"))
    // A handled error record in a successful run is not a failed health trial.
    assert.equal(runs[0].status, "complete")
  })
