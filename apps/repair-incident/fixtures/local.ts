import { WorkerEntrypoint } from "cloudflare:workers";
import { OwnedIncidentWorkflow } from "../src/worker.ts";
export {
  OwnedFaultSource,
  OwnedFaultOnce,
  OwnedIncidentWorkflow,
} from "../src/worker.ts";
/** LOCAL test adapter only. Production HTTP remains 404. */
export default class LocalIncidentAdapter extends WorkerEntrypoint {
  override async fetch(request: Request) {
    try {
      const payload = await request.json();
      const steps: string[] = [];
      const workflow = new OwnedIncidentWorkflow(this.ctx, {});
      const result = await workflow.run(
        { instanceId: "local-owned", payload } as any,
        {
          do: async (
            name: string,
            config: { retries: { limit: number } },
            fn: () => Promise<unknown>,
          ) => {
            if (config.retries.limit !== 0)
              throw new Error("Retries must be zero");
            steps.push(name);
            return JSON.parse(JSON.stringify(await fn()));
          },
        } as any,
      );
      return Response.json({ result, steps, localOnly: true });
    } catch {
      return new Response("Owned local mode rejected", { status: 400 });
    }
  }
}
