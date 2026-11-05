import type { WorkflowStep } from "cloudflare:workers"
import type { WorkflowAdmissionReceipt, WorkflowHealthSource } from "./workflow-health-controller.ts"
import { validateWorkflowWindow, type WorkflowInstanceReceipt, type WorkflowWindow } from "./workflow-window.ts"

export interface NativeWorkflowHealthPorts {
  readonly admission: (window: WorkflowWindow) => Promise<WorkflowAdmissionReceipt>
  readonly instance: (target: { readonly accountId: string; readonly workflowName: string; readonly instanceId: string }) => Promise<WorkflowInstanceReceipt>
  readonly query: (input: { readonly query: string; readonly params: Record<string, string>; readonly scope: { readonly accountTag: string } }) => Promise<{ readonly data: ReadonlyArray<unknown>; readonly rows: number }>
  readonly scheduled?: (window: WorkflowWindow) => Promise<{ readonly instances: ReadonlyArray<WorkflowInstanceReceipt>; readonly complete: boolean }>
}

export async function readNativeWorkflowWindow(window: WorkflowWindow, ports: NativeWorkflowHealthPorts): Promise<Awaited<ReturnType<WorkflowHealthSource["read"]>>> {
  validateWorkflowWindow(window)
  const admission = await ports.admission(window)
  const instances: WorkflowInstanceReceipt[] = []
  for (const invocation of window.invocations) {
    if (invocation.instanceId) instances.push(await ports.instance({ accountId: window.accountId, workflowName: window.workflowName, instanceId: invocation.instanceId }))
  }
  const needsDiscovery = window.invocations.some(invocation => !invocation.instanceId)
  const discovered = needsDiscovery && ports.scheduled ? await ports.scheduled(window) : { instances: [], complete: !needsDiscovery }
  instances.push(...discovered.instances)
  if (instances.length > 200 || typeof discovered.complete !== "boolean") throw new Error("Invalid native Workflow discovery budget")
  const params: Record<string, string> = { workflow: window.workflowName, from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() }
  const ids = [...new Set([...window.invocations.flatMap(invocation => invocation.instanceId ? [invocation.instanceId] : []), ...instances.map(instance => instance.id)])]
  if (ids.length > 100) throw new Error("Native Workflow identity query budget exceeded")
  const selectors = ids.map((instanceId, index) => {
    params[`instance${index}`] = instanceId
    return `$instance${index}`
  })
  const result = selectors.length ? await ports.query({
    query: `SELECT timestamp,workflowName,eventType,instanceId,sampleInterval FROM events.workflows WHERE workflowName = $workflow AND instanceId IN (${selectors.join(",")}) AND timestamp >= $from AND timestamp < $to ORDER BY timestamp ASC LIMIT ${window.queryLimit}`,
    params, scope: { accountTag: window.accountId },
  }) : { data: [], rows: 0 }
  if (!Array.isArray(result.data) || result.rows !== result.data.length) throw new Error("Incomplete native Workflow query response")
  return { accountId: window.accountId, workflowName: window.workflowName, windowId: window.windowId, version: window.version,
    from: window.from, to: window.to, queryLimit: window.queryLimit, admission, discoveryComplete: discovered.complete, instances, rows: result.data, observedAt: Date.now() }
}

export function nativeWorkflowHealthSource(step: WorkflowStep, ports: NativeWorkflowHealthPorts): WorkflowHealthSource {
  return {
    read: async (window: WorkflowWindow, sequence: number) => {
      validateWorkflowWindow(window)
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 2) throw new Error("Invalid Workflow health observation sequence")
      const snapshot = await step.do(`workflow-health:source-${window.windowId}-${sequence}`, { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" }, async () => {
        const snapshot = JSON.stringify(await readNativeWorkflowWindow(window, ports))
        if (new TextEncoder().encode(snapshot).byteLength > 512 * 1024) throw new Error("Workflow health snapshot exceeds checkpoint budget")
        return snapshot
      })
      return JSON.parse(snapshot) as Awaited<ReturnType<WorkflowHealthSource["read"]>>
    },
  }
}
