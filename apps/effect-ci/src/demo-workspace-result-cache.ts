import * as CI from "@effect-ci-testbed/ci";
import type { Runner } from "@effect-ci-testbed/cloudflare";
import * as Effect from "effect/Effect";
import { runnerWorkspaceResultCache, type RunnerStepAuthority, type RunnerStepIdentity } from "@effect-ci-testbed/cloudflare/runner-step-result";
import { syntaxWorkflow } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { demoBuildIdentity } from "./demo-runner-policy.ts";

export function demoWorkspaceResultCache(runner: Runner, runId: string, authority: RunnerStepAuthority, hostVersion?: string,
  enrollment = { workflowId: syntaxWorkflow, cwd: "/workspace/repository/test/fixtures/demo", identity: demoBuildIdentity as (revision: string, version: string) => Promise<RunnerStepIdentity> }): CI.StepResultCache {
  const checkpoint = async <A>(stepId: string, operation: () => Promise<A>): Promise<A> => {
    const result = await Effect.runPromise(runner.actionExecutor.execute({ stepId,
      options: { retries: { limit: 0, delay: 0, backoff: "constant" } },
      run: () => Effect.tryPromise({ try: async () => ({ value: await operation(), commands: [] }), catch: error => error }),
    }) as Effect.Effect<CI.ActionExecutionResult, unknown>);
    return result.value as A;
  };
  return runnerWorkspaceResultCache({ runId,
    identify: async request => hostVersion && request.workflowId === enrollment.workflowId && request.stepId === "build" && request.event.revision
      ? enrollment.identity(request.event.revision, hostVersion) : undefined,
    authority: {
      stepResult: identity => checkpoint("build:workspace-result-lookup", async () => await authority.stepResult(identity) ?? null).then(value => value ?? undefined),
      recordStepResult: claim => checkpoint("build:workspace-result-record", async () => {
        await authority.recordStepResult(claim); return true;
      }).then(() => undefined),
    },
    capture: async value => {
      if (!(value instanceof CI.Workspace) || value.kind !== "remote" || value.id !== runId ||
          value.cwd !== enrollment.cwd || value.revision?.provider !== "cloudflare-container") return;
      return { kind: "workspace", provider: "cloudflare-container", cwd: value.cwd,
        snapshot: value.revision.value as { id: string; size: number; name?: string } };
    },
    restore: async (result, request) => {
      if (result.cwd !== enrollment.cwd) return;
      // Do not transplant the producing run's Workspace identity. This run gets
      // a fresh owner with the same immutable, host-authorized snapshot handle.
      const workspace = CI.Workspace.remote(runId, result.cwd, { provider: result.provider, value: result.snapshot });
      const stepId = `${request.stepId}:workspace-result-restore`;
      const available = await checkpoint(stepId, async () => {
        try { return await Effect.runPromise(runner.fileSystem.exists(workspace, "dist/index.html", stepId)); }
        catch { return false; }
      });
      if (!available) return;
      return workspace;
    },
  });
}
