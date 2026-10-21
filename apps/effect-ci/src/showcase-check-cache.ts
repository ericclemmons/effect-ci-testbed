import type * as CI from "@effect-ci-testbed/ci";
import type { Runner } from "@effect-ci-testbed/cloudflare";
import { runnerCheckCache, type RunnerCheckAuthority } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import * as Effect from "effect/Effect";
import { showcaseCheckIdentity, showcaseInspectCommand, showcaseTestCommand } from "./showcase-check-policy.ts";
import { showcaseRepository, showcaseRoot } from "./showcase-runner-policy.ts";

/** Remote CLI and push use one closed authority, never a project-supplied key. */
export function showcaseCheckCache(runner: Runner, runId: string, authority: RunnerCheckAuthority, hostVersion?: string): CI.CheckCache {
  const checkpoint = async <A>(stepId: string, operation: () => Promise<A>): Promise<A> => {
    const result = await Effect.runPromise(runner.actionExecutor.execute({ stepId,
      options: { retries: { limit: 0, delay: 0, backoff: "constant" } },
      run: () => Effect.tryPromise({ try: async () => ({ value: await operation(), commands: [] }),
        catch: () => Error("Showcase receipt store unavailable") }),
    }) as Effect.Effect<CI.ActionExecutionResult, unknown>);
    return result.value as A;
  };
  return runnerCheckCache({ runId, repository: showcaseRepository,
    identify: async (request, phase) => {
      if (!hostVersion || request.workflowId !== "demo" || request.stepId !== "test" || request.command !== showcaseTestCommand ||
        request.workspace.kind !== "remote" || request.workspace.cwd !== showcaseRoot || !request.event.revision) return;
      const result = await Effect.runPromise(runner.executor.execute({ workflowId: request.workflowId, stepId: request.stepId,
        commandIndex: phase === "before" ? 0 : 2, command: showcaseInspectCommand,
        workspace: request.workspace, options: {}, onOutput: () => {},
      }));
      return showcaseCheckIdentity(request.event.revision, hostVersion, result.stdout);
    },
    authority: {
      lookup: identity => checkpoint("test:runner-receipt-lookup", () => authority.lookup(identity)),
      record: claim => checkpoint("test:runner-receipt-record", async () => { await authority.record(claim); return true; }).then(() => undefined),
    },
  });
}
