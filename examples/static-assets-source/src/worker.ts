import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { StaticAssets, staticAssetHostError } from "@effect-ci-testbed/cloudflare/static-assets-service";
import { StaticAssetRevisions } from "@effect-ci-testbed/cloudflare/static-assets-journal";
import { prepareStaticAssets } from "@effect-ci-testbed/cloudflare/static-assets-source";
import { prepareStaticBuildSource } from "@effect-ci-testbed/cloudflare/static-assets-build";
import { buildStaticTypeScript, verifyStaticBuildIsolation } from "@effect-ci-testbed/cloudflare-dynamic-worker/static-build";
import { readFileSync } from "node:fs";
import { publishStaticAssets, verifyStaticAssets, reconcileStaticAssets } from "@effect-ci-testbed/cloudflare/static-assets-publish";
import workflow from "../.cloudflare/ci/workflow.ts";
import { parameters } from "./parameters.ts";
export { StaticAssetRevisions };
interface Environment {
  STATIC_ASSETS_DEPLOY_TOKEN: string;
  LOADER: WorkerLoader;
  SOURCE_READER: {
    read(revision: string): Promise<{ revision: string; manifestDigest: string; bytes: Uint8Array }>;
    readBuild(revision: string): Promise<{ revision: string; manifestDigest: string; bytes: Uint8Array }>;
  };
}
const policy = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;
export class StaticAssetsWorkflow extends WorkflowEntrypoint<Environment, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let input; try { input = parameters(event.payload); } catch { throw new NonRetryableError("Exact fixed-target static publication parameters required"); }
    const storage = (this.ctx.exports as unknown as { StaticAssetRevisions: DurableObjectNamespace<StaticAssetRevisions> }).StaticAssetRevisions.getByName("owned-static-assets");
    const credential = () => this.env.STATIC_ASSETS_DEPLOY_TOKEN;
    if (input.mode === "build-checks") {
      return step.do("build:verify-owned-isolation", policy, async () => {
        // A known parent-only VFS file gives the child denial a real denominator.
        // Read only code already deployed here; never return its text or any env.
        const parent = new Uint8Array(readFileSync("/bundle/index.js"));
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", parent)), b => b.toString(16).padStart(2, "0")).join("");
        return { claimedRevision: input.revision, ...await verifyStaticBuildIsolation(this.env.LOADER,
          { path: "/bundle/index.js", bytes: parent.length, sha256 }) };
      });
    }
    if (input.mode === "reconcile") {
      return step.do("assets:reconcile-known", policy, async () => {
        const r = await reconcileStaticAssets(storage, input.revision, credential);
        return { revision: r.revision, manifestDigest: r.manifestDigest, assetDigest: r.assetDigest,
            version: r.version, deployment: r.deployment, target: r.target, policy: r.policy, externalWrites: 0,
            ...(r.build ? { build: r.build } : {}) };
      });
    }
    const result = await CI.runPromise({ ...workflow, effect: workflow.effect.pipe(Effect.provideService(StaticAssets, {
      capture: () => Effect.tryPromise({ try: async () => {
        if (input.mode === "build") {
          // Authenticated raw source is durably checkpointed BEFORE compilation.
          // This is bounded public fixture data, never a token or an executable host module.
          const captured = await step.do("source:capture-build-input", policy, async () => {
            const source = await this.env.SOURCE_READER.readBuild(input.revision);
            if (source.revision !== input.revision) throw Error("Static build reader identity mismatch");
            await prepareStaticBuildSource(input.revision, source.bytes, source.manifestDigest);
            return { revision: source.revision, manifestDigest: source.manifestDigest,
              base64: btoa(Array.from(source.bytes, b => String.fromCharCode(b)).join("")) };
          });
          return step.do("source:build-bounded", policy, async () => {
            if (captured.revision !== input.revision || captured.base64.length > 128 * 1024) throw Error("Invalid captured static build source");
            const bytes = Uint8Array.from(atob(captured.base64), c => c.charCodeAt(0));
            const source = await prepareStaticBuildSource(input.revision, bytes, captured.manifestDigest);
            const compiler = await buildStaticTypeScript(this.env.LOADER, source.source);
            const stored = await storage.putBuild(input.revision, captured.manifestDigest, bytes, compiler);
            if (stored.revision !== input.revision || stored.build.sourceManifestDigest !== captured.manifestDigest ||
                stored.build.toolDigest !== compiler.toolDigest) throw Error("Static build journal identity mismatch");
            return input.revision;
          });
        }
        return step.do("source:capture-immutable", policy, async () => {
          const source = await this.env.SOURCE_READER.read(input.revision);
          if (source.revision !== input.revision) throw Error("Static source reader identity mismatch");
          await prepareStaticAssets(input.revision, source.bytes, source.manifestDigest);
          const r = await storage.put(input.revision, source.manifestDigest, source.bytes);
          if (r.revision !== input.revision || r.manifestDigest !== source.manifestDigest) throw Error("Static source journal identity mismatch");
          return input.revision;
        });
      }, catch: staticAssetHostError }),
      publish: revision => Effect.tryPromise({ try: () => step.do("assets:upload-and-deploy", policy, async () => {
        const r = await publishStaticAssets(storage, revision, credential);
        if (r.revision !== revision || r.target !== "effect-ci-static-assets-demo") throw Error("Static publication receipt mismatch");
        return revision;
      }), catch: staticAssetHostError }),
      verify: revision => Effect.tryPromise({ try: async () => {
        // One fixed convergence interval, not probe-until-green or an API retry.
        await step.sleep("assets:fixed-convergence", "30 seconds");
        return step.do("assets:verify-served-bytes", policy, async () => {
          const r = await verifyStaticAssets(storage, revision, credential);
          return { revision: r.revision, manifestDigest: r.manifestDigest, assetDigest: r.assetDigest,
            version: r.version, deployment: r.deployment, target: r.target, policy: r.policy,
            ...(r.build ? { build: r.build } : {}) };
        });
      }, catch: staticAssetHostError }),
    })) }, { ci: true, env: "cloudflare", output: "silent",
      executor: { execute: () => Effect.die(new Error("Static publication has no Container capability")) } });
    return { plan: result.plan, receipt: result.value, containers: 0 };
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
