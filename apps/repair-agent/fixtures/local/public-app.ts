import "./provider.ts";
import type { PublicProposalDriver } from "./public-proposal.ts";
/** LOCAL ONLY native Workflow/RPC driver. Production HTTP remains404. */
export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const service = (ctx.exports as unknown as {
      PublicProposalDriver: (props: {}) => Service<PublicProposalDriver>;
    }).PublicProposalDriver({});
    try {
      if (url.pathname === "/start") {
        const r = await service.startPublicProposal(id); return Response.json({ id: r.id });
      }
      if (url.pathname === "/status") {
        const r = await service.publicProposalStatus(id); return Response.json({ status: r.status });
      }
      const r = await service.readPublicProposal(id), a = r.admission;
      return Response.json({ instance: r.instance, run: r.run, reservationId: r.reservationId,
        text: r.text, submissionId: r.submissionId, agentUid: r.agentUid, acceptedAt: r.acceptedAt,
        admission: { policy: a.policy, issue: a.issue, correlation: a.correlation, service: a.service,
          source: a.source, version: a.version, emission: a.emission, fixtureDigest: a.fixtureDigest,
          claimedAt: a.claimedAt, observedAt: a.observedAt } });
    } catch { return new Response("Local public proposal rejected", { status: 400 }); }
  }
}
