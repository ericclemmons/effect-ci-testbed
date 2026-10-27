import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { readNativeWorkflowWindow } from "../packages/cloudflare/src/workflow-health-source.ts"
import { reconcileWorkflowWindow, sealWorkflowWindow, workflowWindowDigest, type WorkflowInstanceReceipt, type WorkflowWindow } from "../packages/cloudflare/src/workflow-window.ts"

const [windowPath, outputPath] = process.argv.slice(2)
if (!windowPath || !outputPath) throw new Error("Usage: node scripts/collect-workflow-window.ts ADMISSION.json NEW_RECEIPT.json")
const window = sealWorkflowWindow(JSON.parse(readFileSync(windowPath, "utf8")) as WorkflowWindow)
const receipts: Array<{ readonly kind: string; readonly target: string; readonly readAt: number; readonly response: unknown }> = []
const command = (...args: string[]) => JSON.parse(execFileSync(process.env.HMD_CF_BIN ?? "cf", args, {
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: window.accountId }, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
}))
try {
  const snapshot = await readNativeWorkflowWindow(window, {
    admission: async window => {
      const response = command("workflows", "instances", "get", window.admissionId, "--workflow-name", window.workflowName)
      if (response.params?.intent !== "workflow-window-admission") throw new Error("Native Workflow admission record missing")
      const admission = { id: window.admissionId, createdAt: Date.parse(response.queued), digest: await workflowWindowDigest(response.params.window) }
      receipts.push({ kind: "native-admission", target: `/accounts/${window.accountId}/workflows/${window.workflowName}/instances/${window.admissionId}`,
        readAt: Date.now(), response: admission })
      if (admission.createdAt < window.sealedAt || admission.createdAt > window.from || admission.digest !== await workflowWindowDigest(window)) {
        throw new Error("Native Workflow admission identity mismatch")
      }
      return admission
    },
    instance: async target => {
      const response = command("workflows", "instances", "get", target.instanceId, "--workflow-name", target.workflowName)
      const readAt = Date.now()
      receipts.push({ kind: "native-instance", target: `/accounts/${target.accountId}/workflows/${target.workflowName}/instances/${encodeURIComponent(target.instanceId)}`, readAt,
        response: { versionId: response.versionId, status: response.status, start: response.start, end: response.end, success: response.success,
          trigger: response.trigger, schedule: response.schedule,
          steps: Array.isArray(response.steps) ? response.steps.map((step: Record<string, unknown>) => ({
            name: step.name, type: step.type, success: step.success, start: step.start, end: step.end,
            attempts: Array.isArray(step.attempts) ? step.attempts.map(attempt => ({ start: attempt.start, end: attempt.end, success: attempt.success })) : undefined,
          })) : undefined } })
      return { id: target.instanceId, version: response.versionId, status: response.status, readAt,
        ...(response.trigger?.source ? { trigger: response.trigger.source } : {}),
        ...(response.schedule ? { scheduledAt: response.schedule.scheduledTime, cron: response.schedule.cron } : {}),
        ...(response.start ? { startedAt: Date.parse(response.start) } : {}),
        ...(response.end ? { endedAt: Date.parse(response.end) } : {}),
      } as WorkflowInstanceReceipt
    },
    query: async input => {
      const response = command("sql", "query", input.query, "--body", JSON.stringify(input))
      receipts.push({ kind: "native-sql", target: window.windowId, readAt: Date.now(), response: { data: response.data, rows: response.rows } })
      return response
    },
  })
  const evidence = reconcileWorkflowWindow(window, snapshot.instances, snapshot.rows, snapshot.observedAt, snapshot.discoveryComplete)
  writeFileSync(outputPath, JSON.stringify({ schema: "workflow-window-receipt-v1", window, snapshot, evidence, receipts }, null, 2) + "\n", { flag: "wx", mode: 0o600 })
} catch {
  writeFileSync(outputPath, JSON.stringify({ schema: "workflow-window-receipt-v1", window, unavailable: true, receipts }, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  process.exitCode = 1
}
