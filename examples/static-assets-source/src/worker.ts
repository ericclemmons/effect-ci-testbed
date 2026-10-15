import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { StaticAssets } from "@effect-ci-testbed/cloudflare/static-assets-service";
import { StaticAssetRevisions } from "@effect-ci-testbed/cloudflare/static-assets-journal";
import { prepareStaticAssets } from "@effect-ci-testbed/cloudflare/static-assets-source";
import { publishStaticAssets, verifyStaticAssets, reconcileStaticAssets } from "@effect-ci-testbed/cloudflare/static-assets-publish";
import workflow from "../.cloudflare/ci/workflow.ts";
import { parameters } from "./parameters.ts";
export { StaticAssetRevisions };
interface Environment {
  STATIC_ASSETS_DEPLOY_TOKEN: string;
  SOURCE_READER: { read(revision: string): Promise<{ revision: string; manifestDigest: string; bytes: Uint8Array }> };
}
const policy = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;
export class StaticAssetsWorkflow extends WorkflowEntrypoint<Environment, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let input; try { input = parameters(event.payload); } catch { throw new NonRetryableError("Exact fixed-target static publication parameters required"); }
    const storage = (this.ctx.exports as unknown as { StaticAssetRevisions: DurableObjectNamespace<StaticAssetRevisions> }).StaticAssetRevisions.getByName("owned-static-assets");
    const credential = () => this.env.STATIC_ASSETS_DEPLOY_TOKEN;
    if (input.mode === "reconcile") {
      return step.do("assets:reconcile-known", policy, async () => {
        const r = await reconcileStaticAssets(storage, input.revision, credential);
        return { revision: r.revision, manifestDigest: r.manifestDigest, assetDigest: r.assetDigest,
          version: r.version, deployment: r.deployment, target: r.target, policy: r.policy, externalWrites: 0 };
      });
    }
    const result = await CI.runPromise({ ...workflow, effect: workflow.effect.pipe(Effect.provideService(StaticAssets, {
      capture: () => Effect.tryPromise(() => step.do("source:capture-immutable", policy, async () => {
        const source = await this.env.SOURCE_READER.read(input.revision);
        if (source.revision !== input.revision) throw Error("Static source reader identity mismatch");
        await prepareStaticAssets(input.revision, source.bytes, source.manifestDigest);
        const r = await storage.put(input.revision, source.manifestDigest, source.bytes);
        if (r.revision !== input.revision || r.manifestDigest !== source.manifestDigest) throw Error("Static source journal identity mismatch");
        return input.revision;
      })),
      publish: revision => Effect.tryPromise(() => step.do("assets:upload-and-deploy", policy, async () => {
        const r = await publishStaticAssets(storage, revision, credential);
        if (r.revision !== revision || r.target !== "effect-ci-static-assets-demo") throw Error("Static publication receipt mismatch");
        return revision;
      })),
      verify: revision => Effect.tryPromise(async () => {
        // One fixed convergence interval, not probe-until-green or an API retry.
        await step.sleep("assets:fixed-convergence", "30 seconds");
        return step.do("assets:verify-served-bytes", policy, async () => {
          const r = await verifyStaticAssets(storage, revision, credential);
          return { revision: r.revision, manifestDigest: r.manifestDigest, assetDigest: r.assetDigest,
            version: r.version, deployment: r.deployment, target: r.target, policy: r.policy };
        });
      }),
    })) }, { ci: true, env: "cloudflare", output: "silent",
      executor: { execute: () => Effect.die(new Error("Static publication has no Container capability")) } });
    return { plan: result.plan, receipt: result.value, containers: 0 };
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
