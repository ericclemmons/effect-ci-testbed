import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  demoSite,
  demoSiteUrl,
  siteRevision,
  siteResponse,
  type DemoSite,
} from "@effect-ci-testbed/cloudflare/demo-site";

export class DemoSiteRevisions extends DurableObject {
  async publish(
    revision: string,
    assets: unknown,
  ): Promise<{ revision: string; digest: string; url: string }> {
    const candidate = await demoSite(revision, assets);
    const selected = await this.ctx.storage.transaction(async (storage) => {
      const previous = await storage.get<DemoSite>(`site:${candidate.revision}`);
      if (previous) {
        const checked = await demoSite(previous.revision, previous.assets);
        if (previous.digest !== checked.digest || checked.digest !== candidate.digest)
          throw Error("Immutable site conflict");
        return checked;
      }
      const revisions = (await storage.get<string[]>("revisions")) ?? [];
      if (revisions.length >= 32) throw Error("Site revision capacity reached");
      await storage.put(`site:${candidate.revision}`, candidate);
      await storage.put("revisions", [...revisions, candidate.revision]);
      return candidate;
    });
    return { revision: selected.revision, digest: selected.digest, url: demoSiteUrl(selected) };
  }
  async read(revision: string): Promise<DemoSite | undefined> {
    const value = await this.ctx.storage.get<DemoSite>(`site:${siteRevision(revision)}`);
    if (!value) return undefined;
    const checked = await demoSite(value.revision, value.assets);
    if (checked.revision !== revision || checked.digest !== value.digest)
      throw Error("Stored site corrupt");
    return checked;
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
const registry = (ctx: ExecutionContext) =>
  (
    ctx.exports as unknown as { DemoSiteRevisions: DurableObjectNamespace<DemoSiteRevisions> }
  ).DemoSiteRevisions.getByName("demo-site-revisions-v1");
// Only a named private service capability can publish. The public handler is read-only.
export class DemoSitePublisher extends WorkerEntrypoint {
  async publish(
    revision: string,
    assets: unknown,
  ): Promise<{ revision: string; digest: string; url: string }> {
    const result = await registry(this.ctx).publish(revision, assets);
    return { revision: result.revision, digest: result.digest, url: result.url };
  }
  override fetch() {
    return new Response("Not found", { status: 404 });
  }
}
export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", { status: 405 });
    const url = new URL(request.url);
    const match = /^\/r\/([a-f0-9]{40})\/([a-f0-9]{64})\/(index\.html|app\.js|message\.js)$/.exec(
      url.pathname,
    );
    if (!match || url.search) return new Response("Not found", { status: 404 });
    try {
      const site = await registry(ctx).read(match[1]!);
      if (!site || site.digest !== match[2]) return new Response("Not found", { status: 404 });
      return siteResponse(site, match[3]!, request.method === "HEAD");
    } catch {
      return new Response("Site unavailable", { status: 503 });
    }
  },
};
