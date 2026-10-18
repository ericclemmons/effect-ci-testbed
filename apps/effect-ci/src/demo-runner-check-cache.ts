import type * as CI from "@effect-ci-testbed/ci";
import type { Runner } from "@effect-ci-testbed/cloudflare";
import { runnerCheckCache, type RunnerCheckAuthority } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { syntaxCommand, syntaxIdentity, syntaxRepository, syntaxWorkflow } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { testCommand, testIdentity } from "@effect-ci-testbed/cloudflare/demo-test-check";
import * as Effect from "effect/Effect";
import { demoRunnerPolicyDigest, demoRunnerInspectCommand } from "./demo-runner-policy.ts";

/** One implementation for remote CLI and SCM execution. No developer notes or keys. */
export function demoRunnerCheckCache(runner: Runner, runId: string, authority: RunnerCheckAuthority): CI.CheckCache {
  const checkpoint = async <A>(stepId: string, operation: () => Promise<A>): Promise<A> => {
    const result = await Effect.runPromise(runner.actionExecutor.execute({
      stepId, options: { retries: { limit: 0, delay: 0, backoff: "constant" } },
      run: () => Effect.promise(async () => ({ value: await operation(), commands: [] })),
    }) as Effect.Effect<CI.ActionExecutionResult, unknown>);
    return result.value as A;
  };
  return runnerCheckCache({ runId, repository: syntaxRepository,
    identify: async (request, phase) => {
      const suite = request.stepId === "test" && request.command === testCommand;
      if (request.workflowId !== syntaxWorkflow ||
          (!suite && (request.stepId !== "syntax" || request.command !== syntaxCommand)) ||
          request.workspace.kind !== "remote" || request.workspace.cwd !== "/workspace/repository/examples/demo") return;
      const result = await Effect.runPromise(runner.executor.execute({
        workflowId: request.workflowId, stepId: request.stepId,
        // Check command itself occupies index 1. Distinct native checkpoints
        // preserve both before/after observations across Workflow replay.
        commandIndex: phase === "before" ? 0 : 2,
        command: demoRunnerInspectCommand(suite),
        workspace: request.workspace, options: {}, onOutput: () => {},
      }));
      const identity = await (suite ? testIdentity : syntaxIdentity)(request.event.revision!, result.stdout);
      return { ...identity, policyDigest: await demoRunnerPolicyDigest(suite) };
    },
    authority: {
      lookup: identity => checkpoint(`${identity.stepId}:runner-receipt-lookup`, () => authority.lookup(identity)),
      record: claim => checkpoint(`${claim.identity.stepId}:runner-receipt-record`, async () => {
        await authority.record(claim);
        return true;
      }).then(() => undefined),
    },
  });
}
