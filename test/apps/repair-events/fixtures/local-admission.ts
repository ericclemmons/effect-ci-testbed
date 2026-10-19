import Receiver, {
  OwnedIncidentAdmissionWorkflow,
  NotificationCaptures,
} from "../src/worker.ts";
export {
  NotificationCaptures,
  NotificationEvidence,
  NotificationInspectionWorkflow,
  OwnedIncidentAdmission,
  OwnedIncidentAdmissionWorkflow,
} from "../src/worker.ts";
/** LOCAL only: not referenced by production config. Workflow coordinator is mocked. */
export default class extends Receiver {
  override async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname !== "/local-admission") return super.fetch(request);
    try {
      const payload: any = await request.json();
      if (payload.digest) {
        const store = (
          this.ctx.exports as unknown as {
            NotificationCaptures: DurableObjectNamespace<NotificationCaptures>;
          }
        ).NotificationCaptures.getByName("owned-issue-capture-v1");
        return Response.json(await store.admitOwnedCapture(payload.digest));
      }
      const workflow = new OwnedIncidentAdmissionWorkflow(this.ctx, {});
      const result = await workflow.run(
        { payload, instanceId: "local-owned-admission" } as any,
        {
          do: async (
            _name: string,
            options: any,
            action: () => Promise<unknown>,
          ) => {
            if (options.retries.limit !== 0) throw new Error("Retry rejected");
            return JSON.parse(JSON.stringify(await action()));
          },
        } as any,
      );
      return Response.json(result);
    } catch {
      return new Response("Local admission rejected", { status: 400 });
    }
  }
}
