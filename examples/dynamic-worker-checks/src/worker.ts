import * as CI from "@effect-ci-testbed/ci";
import * as Dynamic from "@effect-ci-testbed/cloudflare-dynamic-worker";
import * as Tools from "@effect-ci-testbed/source-tools";
import * as Effect from "effect/Effect";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import workflow from "../.cloudflare/ci/workflow.ts";
import formatted from "../app/src/index.ts?raw";
import unformatted from "../fixtures/unformatted.txt?raw";
import { fixtureMode } from "./mode.ts";
export { AssertionWorkflow } from "./vitest-worker.ts";
const policy = { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" } as const;

export class FormatterWorkflow extends WorkflowEntrypoint<{ LOADER: WorkerLoader }, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let mode; try { mode = fixtureMode(event.payload); } catch { throw new NonRetryableError("Exact owned formatter fixture mode required"); }
    const tools = Dynamic.makeSourceTools(this.env.LOADER), text = mode === "formatted" ? formatted : unformatted;
    const result = await CI.runPromise({ ...workflow, effect: workflow.effect.pipe(Effect.provideService(Tools.SourceTools, {
      format: request => Effect.tryPromise(() => step.do("isolated:format", policy, async () => {
        const r = await Effect.runPromise(tools.format(request));
        if (r.runtime !== "dynamic-worker") throw new NonRetryableError("WorkerLoader formatting required");
        return { files: { ...r.files }, runtime: r.runtime };
      })),
    })) }, { ci: true, env: "cloudflare-dynamic-worker", output: "silent",
      source: { checkout: () => Effect.succeed(CI.Workspace.remote("owned-formatter-fixture", "/")) },
      workspaceFileSystem: { exists: () => Effect.die(new Error("No filesystem capability")),
        readFile: (_, path) => Effect.tryPromise(() => step.do("fixture:read-source", policy, async () => {
          if (path !== "app/src/index.ts") throw new NonRetryableError("Unknown fixture source path");
          return text;
        })) },
      executor: { execute: () => Effect.die(new Error("Formatter cannot execute container commands")) },
    });
    return { plan: result.plan, mode, containers: 0 };
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
