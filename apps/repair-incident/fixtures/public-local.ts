import { WorkerEntrypoint } from "cloudflare:workers";
import type { PublicFailureClaim, PublicIncidentEvidence } from "../src/worker.ts";
import { PUBLIC_EMISSION_ID, publicFaultFetch } from "../src/public-fault.ts";
export * from "../src/worker.ts";

/** LOCAL TEST ONLY: production keeps both the source gate and workers.dev off. */
export default class extends WorkerEntrypoint {
  override async fetch(request: Request) {
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
