import { WorkerEntrypoint } from "cloudflare:workers";
import type { PublicFailureClaim } from "../src/worker.ts";
import { PUBLIC_EMISSION_ID, publicFaultFetch } from "../src/public-fault.ts";
export * from "../src/worker.ts";

/** LOCAL TEST ONLY: production keeps both the source gate and workers.dev off. */
export default class extends WorkerEntrypoint {
  override fetch(request: Request) {
    const namespace = (
      this.ctx.exports as unknown as {
        PublicFailureClaim: DurableObjectNamespace<PublicFailureClaim>;
      }
    ).PublicFailureClaim;
    return publicFaultFetch(request, namespace.getByName(PUBLIC_EMISSION_ID));
  }
}
