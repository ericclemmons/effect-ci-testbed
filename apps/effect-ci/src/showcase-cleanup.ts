import type { WorkflowStep } from "cloudflare:workers";

/** Stop only this run's compute. Immutable provider snapshots remain reusable.
 * One durable checkpoint is shared by normal finalization and the failure path.
 */
export async function cleanupShowcase(step: WorkflowStep, exports: unknown, instanceId: string) {
  const namespace = (exports as { WorkspaceContainer: { getByName(name: string): { stop(): Promise<void> } } }).WorkspaceContainer;
  await step.do("showcase:cleanup", { timeout: "30 seconds", retries: { limit: 0, delay: "1 second" } }, async () => {
    const names = [instanceId, ...["checkout", "install", "lint", "test", "build", "publish preview"].map(id => `${instanceId}:step=${id}`)];
    const results = await Promise.allSettled(names.map(name => namespace.getByName(name).stop()));
    if (results.some(result => result.status === "rejected")) throw Error("Showcase compute cleanup failed");
  });
}
