import { WorkerEntrypoint } from "cloudflare:workers";
import type { PublicFailureClaim, PublicIncidentEvidence } from "../src/worker.ts";
import { PUBLIC_EMISSION_ID, publicFaultFetch } from "../src/public-fault.ts";
export * from "../src/worker.ts";

/** LOCAL TEST ONLY: production keeps both the source gate and workers.dev off. */
export default class extends WorkerEntrypoint {
  override async fetch(request: Request) {
    if (["/__local-arm-start", "/__local-arm-status"].includes(new URL(request.url).pathname)) {
      const workflow = (this.ctx.exports as unknown as { PublicIncidentArmWorkflow: Workflow }).PublicIncidentArmWorkflow;
      if (new URL(request.url).pathname === "/__local-arm-start") {
        await workflow.create({ id: "local-public-arm", params: { mode: "arm-public-once" } });
        return Response.json({ started: true });
      }
      return Response.json(await (await workflow.get("local-public-arm")).status());
    }
    if (new URL(request.url).pathname === "/__local-arm") {
      try {
        const ns = (this.ctx.exports as unknown as { PublicFailureClaim: DurableObjectNamespace<PublicFailureClaim> }).PublicFailureClaim;
        const r = await ns.getByName(PUBLIC_EMISSION_ID).arm();
        return Response.json({ version: r.version, producerVersion: r.producerVersion, source: r.source, policy: r.policy, armedAt: r.armedAt });
      } catch { return new Response("Local readiness rejected", { status: 409 }); }
    }
    if (new URL(request.url).pathname === "/__local-evidence") {
      const service = (this.ctx.exports as unknown as {
        PublicIncidentEvidence: (props: {}) => Service<PublicIncidentEvidence>;
      }).PublicIncidentEvidence({});
      const r = await service.readPublicClaim();
      if ("state" in r) return Response.json({ state: r.state });
      return Response.json({ emission: r.emission, version: r.version,
        currentVersion: r.currentVersion, fixtureDigest: r.fixtureDigest, claimedAt: r.claimedAt });
    }
    const namespace = (
      this.ctx.exports as unknown as {
        PublicFailureClaim: DurableObjectNamespace<PublicFailureClaim>;
      }
    ).PublicFailureClaim;
    return publicFaultFetch(request, namespace.getByName(PUBLIC_EMISSION_ID));
  }
}
