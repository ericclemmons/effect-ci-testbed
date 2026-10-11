import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { reconcileWorkflowTelemetry, type WorkflowTerminalManifest } from "./workflow-telemetry.ts"

const ids: string[] | undefined = process.env.WORKFLOW_TELEMETRY_INSTANCES?.split(",")
const account = process.env.WORKFLOW_TELEMETRY_ACCOUNT
const command = (...args: string[]) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", args,
  { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }))

/** Read-only native API metadata + bounded SQL proof, not a hosted adapter or rollout. */
test("native SQL reconciles two known logical outcomes, not their retry/lifecycle rows", {skip:!ids||!account,timeout:60_000},()=>{
  assert.equal(ids!.length,2)
  assert.ok(ids!.every(id=>/^[A-Za-z0-9_-]{1,128}$/.test(id)))
  assert.match(account!,/^[a-f0-9]{32}$/)
  const runs=ids!.map(id=>command("workflows","instances","get",id,"--workflow-name","effect-ci-hmd-review"))
  assert.deepEqual(runs.map(r=>r.status),["complete","errored"])
  assert.equal(new Set(runs.map(r=>r.versionId)).size,1,"this is one Workflow version, not an A/B release comparison")
  assert.ok(runs.every(r=>typeof r.versionId==="string" && r.versionId.length>0))
  const from=Math.min(...runs.map(r=>Date.parse(r.start)))-1000
  const to=Math.max(...runs.map(r=>Date.parse(r.end)))+1000
  const query="SELECT timestamp,workflowName,eventType,instanceId,sampleInterval FROM events.workflows WHERE workflowName = $workflow AND instanceId IN ($first,$second) AND timestamp >= $from AND timestamp < $to ORDER BY timestamp ASC LIMIT 100"
  const result=command("sql","query",query,"--body",JSON.stringify({query,params:{workflow:"effect-ci-hmd-review",first:ids![0],second:ids![1],
    from:new Date(from).toISOString(),to:new Date(to).toISOString()},scope:{accountTag:account}}))
  assert.ok(Array.isArray(result.data))
  assert.equal(result.rows,result.data.length)
  const manifest:WorkflowTerminalManifest={workflowName:"effect-ci-hmd-review",version:runs[0].versionId,from,to,ids:ids!,queryLimit:100,
    instances:runs.map((run,index)=>({id:ids![index]!,version:run.versionId,status:run.status,endedAt:Date.parse(run.end)}))}
  const evidence=reconcileWorkflowTelemetry(manifest,result.data)
  assert.equal(evidence.saturated,false)
  assert.equal(evidence.sample.completeThrough,to,"every expected terminal must match independent native metadata")
  assert.equal(evidence.sample.trials,2)
  assert.equal(evidence.sample.failures,1)
  assert.equal(evidence.rejected,0)
  assert.ok(evidence.lifecycleRows>2,"real lifecycle updates are not additional trials or errors")
})
