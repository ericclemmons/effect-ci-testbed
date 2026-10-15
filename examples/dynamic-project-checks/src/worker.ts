import * as CI from "@effect-ci-testbed/ci";
import * as Dynamic from "@effect-ci-testbed/cloudflare-dynamic-worker/project";
import * as Effect from "effect/Effect";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import workflow from "../.cloudflare/ci/workflow.ts";
import index from "../app/index.js?raw";
import lib from "../app/lib.js?raw";
import { fixedMode } from "./mode.ts";
export { ProjectBoundaryWorkflow } from "./boundaries.ts";
const policy = { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" } as const;

export class ProjectWorkflow extends WorkflowEntrypoint<{ LOADER: WorkerLoader }, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    try { fixedMode(event.payload, "fixture"); } catch { throw new NonRetryableError("Exact owned project fixture mode required"); }
    const tools = Dynamic.makeProjectChecks(this.env.LOADER);
    const result = await CI.runPromise({ ...workflow, effect: workflow.effect.pipe(Effect.provideService(Dynamic.ProjectChecks, {
      run: request => Effect.tryPromise(() => step.do("isolated:project-checks", policy, async () => {
        const r = await Effect.runPromise(tools.run(request));
        return { runtime: r.runtime, passed: [...r.passed], containers: r.containers };
      })),
    })) }, { ci: true, env: "cloudflare-dynamic-worker", output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.remote("owned-project-fixture", "/")) },
      workspaceFileSystem: { exists: () => Effect.die(new Error("No filesystem capability")),
        readFile: (_, path) => Effect.tryPromise(() => step.do(`fixture:read:${path}`, policy, async () => {
          if (path === "app/index.js") return index;
          if (path === "app/lib.js") return lib;
          throw new NonRetryableError("Unknown project source path");
        })) }, executor: { execute: () => Effect.die(new Error("Project checks cannot execute container commands")) },
    });
    return { plan: result.plan, proof: result.value, containers: 0 };
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
