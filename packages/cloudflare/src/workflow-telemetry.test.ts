import assert from "node:assert/strict"
import test from "node:test"
import { reconcileWorkflowTelemetry, type WorkflowTerminalManifest } from "./workflow-telemetry.ts"

const end = Date.parse("2026-10-11T22:02:23.733Z")
const manifest: WorkflowTerminalManifest = { workflowName:"demo", version:"native-workflow-version", from:end-60_000,to:end+1000,
  ids:["one"],instances:[{id:"one",version:"native-workflow-version",status:"complete",endedAt:end}],queryLimit:100 }
const row = {workflowName:"demo",instanceId:"one",timestamp:"2026-10-11 22:02:23",sampleInterval:1,eventType:"WORKFLOW_SUCCESS"}

test("native terminal metadata joins version while lifecycle/reset updates never become trials",()=>{
  const result=reconcileWorkflowTelemetry(manifest,[{...row,eventType:"WORKFLOW_START"},...Array(20).fill({...row,eventType:"WORKFLOW_RUNNING"}),row,row])
  assert.equal(result.lifecycleRows,21)
  assert.equal(result.sample.trials,1)
  assert.equal(result.sample.failures,0)
  assert.equal(result.sample.version,manifest.version)
  assert.equal(result.sample.completeThrough,manifest.to)
})
test("native terminal failure counts exactly one logical invocation",()=>{
  const failed={...manifest,instances:[{...manifest.instances[0]!,status:"errored" as const}]}
  const result=reconcileWorkflowTelemetry(failed,[{...row,eventType:"WORKFLOW_FAILURE"}])
  assert.equal(result.sample.trials,1);assert.equal(result.sample.failures,1)
})
for (const [name,changes] of Object.entries({weighted:{sampleInterval:10},unknown:{eventType:"WORKFLOW_RESET"},
  conflicting:{eventType:"WORKFLOW_FAILURE"},wrongWorkflow:{workflowName:"other"},wrongIdentity:{instanceId:"other"},
  ambiguousTimezone:{timestamp:"2026-10-11T22:02:23"},wrongEnding:{timestamp:"2026-10-11 22:02:24"}})) {
  test(`${name} evidence cannot establish completeness`,()=>{
    const result=reconcileWorkflowTelemetry(manifest,[row,{...row,...changes}])
    assert.equal(result.sample.completeThrough,manifest.from)
    assert.equal(result.rejected,1)
  })
}
test("missing daily cron outcomes and saturated query limits remain incomplete",()=>{
  assert.equal(reconcileWorkflowTelemetry(manifest,[]).sample.completeThrough,manifest.from)
  assert.equal(reconcileWorkflowTelemetry(manifest,[{...row,eventType:"WORKFLOW_RUNNING"}]).sample.trials,0)
  const saturated=reconcileWorkflowTelemetry({...manifest,queryLimit:1},[row])
  assert.equal(saturated.saturated,true);assert.equal(saturated.sample.completeThrough,manifest.from)
})
test("version/status metadata must be independently bound to the closed identities",()=>{
  assert.throws(()=>reconcileWorkflowTelemetry({...manifest,instances:[{...manifest.instances[0]!,version:"worker-script-version"}]},[row]),/manifest/)
  assert.throws(()=>reconcileWorkflowTelemetry({...manifest,instances:[]},[row]),/manifest/)
})
