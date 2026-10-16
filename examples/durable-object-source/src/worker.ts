import * as Cloudflare from "@effect-ci-testbed/cloudflare";
import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { SourceRevisions, readDurableSource } from "@effect-ci-testbed/cloudflare/durable-source";
import workflow from "../.cloudflare/ci/standalone.ts";
import { digest, manifest, parameters, sourceId } from "./fixture.ts";
export { SourceRevisions };
export { WorkspaceContainer } from "@effect-ci-testbed/cloudflare";

const policy = { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" } as const;
type Host = { WorkspaceContainer: DurableObjectNamespace; SourceRevisions: DurableObjectNamespace<SourceRevisions>;
  SourceIntegrityFixture: DurableObjectNamespace<SourceIntegrityFixture> };

export class DurableSourceWorkflow extends WorkflowEntrypoint<{}, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let input; try { input = parameters(event.payload); } catch { throw new NonRetryableError("Fixed immutable source parameters required"); }
    const bytes = manifest(), revision = await digest(bytes);
    if (input.revision !== revision) throw new NonRetryableError("Fixed immutable source revision required");
    const host = this.ctx.exports as unknown as Host, storage = host.SourceRevisions.getByName(sourceId);
    const seed = await step.do("source:seed-owned", policy, async () => {
      const r = await storage.put(revision, bytes); return { revision: r.revision, created: r.created };
    });
    const container = { image: "workspace", instance: "standard-1" } as const;
    const runner = Cloudflare.makeRunner({ binding: host.WorkspaceContainer, step, workspaceId: event.instanceId,
      repository: sourceId, revision, container, reuseWorkspace: false });
    const source: CI.SourceService = { reference: { kind: "durable_object", id: sourceId, revision },
      checkout: () => Effect.tryPromise({ try: async () => {
        await step.do("source:durable-object", policy, async () => {
          const files = await readDurableSource(storage, revision);
          await (host.WorkspaceContainer.getByName(event.instanceId) as unknown as Cloudflare.WorkspaceContainer).materializeSource(files, container);
          return { revision, files: files.length };
        });
        return CI.Workspace.remote(event.instanceId, "/workspace/repository");
      }, catch: error => error }) };
    const result = await CI.runPromise(workflow, { ci: true, env: "cloudflare", output: "silent", source,
      actionExecutor: runner.actionExecutor, executor: runner.executor, workspaceFileSystem: runner.fileSystem, workspacePersistence: runner.persistence });
    return { revision, seed, plan: result.plan, verified: true };
  }
}

// A SEPARATE private, fixed-purpose corruption fixture. It cannot select any
// production object/revision/content and has no reset/overwrite API for callers.
// Only this fixture's own SQLite record is deliberately damaged once.
export class SourceIntegrityFixture extends SourceRevisions {
  async verifyOwnedCorruption() {
    if (arguments.length !== 0) throw Error("No fixture input allowed");
    const bytes = manifest(), revision = await digest(bytes);
    if (!(await this.ctx.storage.get("corruption-fixture-created"))) {
      await super.put(revision, bytes);
      await this.ctx.storage.transaction(async tx => {
        await tx.put("revision:" + revision, manifest("different.txt"));
        await tx.put("corruption-fixture-created", true);
      });
    }
    try { await super.get(revision); } catch (error) {
      if (error instanceof Error && error.message === "Source digest mismatch") return { rejected: true, reason: error.message };
      throw error;
    }
    throw Error("Corruption was not rejected");
  }
}

export class SourceBoundaryWorkflow extends WorkflowEntrypoint<{}, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    const p = event.payload;
    if (!p || typeof p !== "object" || Object.getPrototypeOf(p) !== Object.prototype || Reflect.ownKeys(p).length !== 1 ||
      Object.getOwnPropertyDescriptor(p, "mode")?.value !== "verify-owned-boundaries") throw new NonRetryableError("Exact boundary verification mode required");
    const host = this.ctx.exports as unknown as Host;
    const bounds = await step.do("source:verify-owned-bounds", policy, async () => {
      const storage = host.SourceRevisions.getByName("owned-capacity-fixture");
      const first = manifest(), revision = await digest(first);
      const initial = await storage.put(revision, first);
      const replay = await storage.put(revision, first); if (replay.created) throw Error("Replay was not idempotent");
      let conflict = false; try { await storage.put(revision, manifest("conflict.txt")); }
      catch (e) { if (e instanceof Error && e.message === "Source digest mismatch") conflict = true; else throw e; }
      if (!conflict) throw Error("Conflicting content accepted");
      for (let i = 1; i < 32; i++) { const bytes = manifest(`file-${i}.txt`); await storage.put(await digest(bytes), bytes); }
      let overflow = false; const extra = manifest("overflow.txt");
      try { await storage.put(await digest(extra), extra); }
      catch (e) { if (e instanceof Error && e.message === "Durable source revision limit exceeded") overflow = true; else throw e; }
      if (!overflow) throw Error("Revision overflow accepted");
      const fullReplay = await storage.put(revision, first); if (fullReplay.created) throw Error("Full-store replay changed");
      const files = await readDurableSource(storage, revision); if (files.length !== 1) throw Error("Stored source changed");
      return { initialCreated: initial.created, replayCreated: replay.created, conflictRejected: conflict,
        revisions: 32, overflowRejected: overflow, fullStoreReplayCreated: fullReplay.created, originalReadable: true };
    });
    const corruption = await step.do("source:verify-owned-corruption", policy, async () => {
      const r = await host.SourceIntegrityFixture.getByName("owned-corruption-fixture").verifyOwnedCorruption();
      return { rejected: r.rejected, reason: r.reason };
    });
    return { bounds, corruption, materializationPerformed: false };
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
