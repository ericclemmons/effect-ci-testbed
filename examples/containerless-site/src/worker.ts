import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import workflow, { SiteHost } from "../.cloudflare/ci/workflow.ts";
import {
  LIMITS,
  revisionFor,
  filesFor,
  digest,
  readBounded,
  checkoutSource,
  buildSite,
  serveSite,
  type Files,
  type Site,
} from "./site.ts";
const SITE_ORIGIN = "https://effect-ci-containerless-site.ericclemmons.workers.dev";
const REVISIONS = "containerless-site-v1";
export class SiteRevisions extends DurableObject {
  async checkout(raw: string): Promise<Files> {
    const revision = revisionFor(raw);
    const stored = await this.ctx.storage.get<Files>(`source:${revision}`);
    if (stored) return stored;
    const source = await checkoutSource(revision);
    await this.ctx.storage.transaction(async (storage) => {
      const existing = await storage.get<Files>(`source:${revision}`);
      if (existing && (await digest(existing)) !== (await digest(source)))
        throw new Error("Immutable source conflict");
      const revisions = (await storage.get<string[]>("sources")) ?? [];
      if (!existing && revisions.length >= 16) throw new Error("Source revision capacity reached");
      if (!existing) {
        await storage.put(`source:${revision}`, source);
        await storage.put("sources", [...revisions, revision]);
      }
    });
    return source;
  }
  async publish(raw: string, assetsRaw: Files, expectedSourceDigest: string): Promise<Site> {
    const revision = revisionFor(raw);
    const assets = filesFor(assetsRaw);
    if (Object.keys(assets).sort().join() !== "client.js,index.html,style.css")
      throw new Error("Unexpected site assets");
    const source = await this.ctx.storage.get<Files>(`source:${revision}`);
    if (!source || (await digest(source)) !== expectedSourceDigest)
      throw new Error("Source identity mismatch");
    const site: Site = {
      revision,
      sourceDigest: expectedSourceDigest,
      assetDigest: await digest(assets),
      assets,
    };
    return this.ctx.storage.transaction(async (storage) => {
      const previous = await storage.get<Site>(`site:${revision}`);
      if (
        previous &&
        (previous.assetDigest !== site.assetDigest || previous.sourceDigest !== site.sourceDigest)
      )
        throw new Error("Immutable site conflict");
      if (!previous) await storage.put(`site:${revision}`, site);
      return previous ?? site;
    });
  }
  async read(raw: string): Promise<Site | undefined> {
    const revision = revisionFor(raw);
    const site = await this.ctx.storage.get<Site>(`site:${revision}`);
    if (!site) return undefined;
    const assets = filesFor(site.assets);
    if (
      site.revision !== revision ||
      !/^[a-f0-9]{64}$/.test(site.sourceDigest) ||
      (await digest(assets)) !== site.assetDigest
    )
      throw new Error("Stored site identity mismatch");
    return { ...site, assets };
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
function revisions(ctx: ExecutionContext) {
  return (
    ctx.exports as unknown as { SiteRevisions: DurableObjectNamespace<SiteRevisions> }
  ).SiteRevisions.getByName(REVISIONS);
}
export class ContainerlessSiteWorkflow extends WorkflowEntrypoint<
  { LOADER: WorkerLoader },
  { revision: string }
> {
  override async run(event: Readonly<WorkflowEvent<{ revision: string }>>, step: WorkflowStep) {
    const revision = revisionFor(event.payload?.revision);
    const store = revisions(this.ctx);
    const recorded = <T>(name: string, operation: () => Promise<T>) =>
      Effect.tryPromise({
        try: () =>
          step.do(name, { retries: { limit: 0, delay: "1 second" } }, async () => {
            try {
              return JSON.parse(JSON.stringify(await operation())) as Rpc.Serializable<T>;
            } catch {
              throw new NonRetryableError(`Containerless site step failed: ${name}`);
            }
          }),
        catch: () => new Error(`Containerless site step failed: ${name}`),
      }).pipe(Effect.map((value) => value as T));
    const result = await CI.runPromise(
      {
        ...workflow,
        effect: workflow.effect.pipe(
          Effect.provideService(SiteHost, {
            checkout: () => recorded("source", () => store.checkout(revision)),
            build: (source) => recorded("build", () => buildSite(this.env.LOADER, source)),
            publish: (source, assets) =>
              recorded("publish", async () =>
                store.publish(revision, assets, await digest(source)),
              ),
            verify: (site) =>
              recorded("verify", async () => {
                for (const [path, expected] of Object.entries(site.assets)) {
                  const response = await fetch(`${SITE_ORIGIN}/r/${revision}/${path}`, {
                    redirect: "manual",
                    signal: AbortSignal.timeout(10_000),
                  });
                  if (
                    response.status !== 200 ||
                    response.headers.get("x-site-digest") !== site.assetDigest ||
                    (await readBounded(response, LIMITS.outputBytes)) !== expected
                  )
                    throw new Error("Served bytes mismatch");
                }
                return `${SITE_ORIGIN}/r/${revision}/index.html`;
              }),
          }),
        ),
      },
      {
        ci: true,
        env: "cloudflare",
        output: "silent",
        executor: { execute: () => Effect.die(new Error("No container execution capability")) },
      },
    );
    return {
      revision,
      siteUrl: `${SITE_ORIGIN}/r/${revision}/index.html`,
      containers: 0,
      plan: result.plan,
    };
  }
}
export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", { status: 405 });
    const match = /^\/r\/([a-f0-9]{40})\/([a-z][a-z0-9-]*\.(?:html|css|js))$/.exec(
      new URL(request.url).pathname,
    );
    if (!match) return new Response("Not found", { status: 404 });
    try {
      const site = await revisions(ctx).read(match[1]!);
      if (!site) return new Response("Not found", { status: 404 });
      const response = await serveSite((_env as { LOADER: WorkerLoader }).LOADER, site, match[2]!);
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch {
      return new Response("Site unavailable", { status: 503 });
    }
  },
};
