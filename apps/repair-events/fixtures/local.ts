import Receiver, { NotificationInspectionWorkflow } from "../src/worker.ts";
export {
  NotificationCaptures,
  NotificationEvidence,
  NotificationInspectionWorkflow,
} from "../src/worker.ts";
/** LOCAL-only adapter; never built by the production config. */
export default class LocalReceiver extends Receiver {
  override async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/local-inspection")
      return super.fetch(request);
    try {
      const payload = await request.json();
      const steps: string[] = [];
      const reader = new NotificationInspectionWorkflow(this.ctx,
        this.env.PUBLIC_SOURCE ? { PUBLIC_SOURCE: this.env.PUBLIC_SOURCE } : {});
      const result = await reader.run(
        { instanceId: "local-read", payload } as any,
        {
          do: async (
            name: string,
            options: { retries: { limit: number } },
            fn: () => Promise<unknown>,
          ) => {
            if (options.retries.limit !== 0)
              throw new Error("Retries must be disabled");
            steps.push(name);
            return JSON.parse(JSON.stringify(await fn()));
          },
        } as any,
      );
      return Response.json({ result, steps, localOnly: true });
    } catch {
      return new Response("Local inspection rejected", { status: 400 });
    }
  }
}
