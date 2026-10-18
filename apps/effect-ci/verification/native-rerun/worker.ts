import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import * as CI from "@effect-ci-testbed/ci";
import { makeRunner, WorkspaceContainer as PlatformWorkspace } from "@effect-ci-testbed/cloudflare";
import * as Effect from "effect/Effect";
import { repository, sourceRoot as root, original, changed, programChanged, publicSource } from "./source.ts";
import { emptyParameters, once, cleanupOnce } from "./control.ts";

// Owned public fixture only, never caller-selected source or project commands.
const names = ["left", "right", "bundle"] as const;
type Name = typeof names[number];
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join("");
const requireValue = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw Error(message);
  return value;
};
type Lineage = { producer: string; checkpointDigest: string; outputDigest: string };
type Previous = {
  attempt: CI.WorkflowAttempt; inputs: Record<string, string>; program: string; runtime: string;
  lineage: Record<Name, Lineage>; output: string;
};

// Private binding only. Controller cleanup never touches another Worker/VM.
export class WorkspaceContainer extends PlatformWorkspace {
  async stopFixture() { if (this.ctx.container?.running) await this.ctx.container.destroy(); }
}

export class RerunProof extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Record<string, never>>, step: WorkflowStep) {
    emptyParameters(event.payload);
    const namespace = (this.ctx.exports as unknown as { WorkspaceContainer: DurableObjectNamespace<WorkspaceContainer> }).WorkspaceContainer;
    const traces: unknown[] = [];

    const run = async (label: string, revision: string, previous?: Previous): Promise<Previous> => {
      const workspaceId = `${event.instanceId}:${label}`, used = new Set<string>();
      const scoped = { do: (name: string, ...args: unknown[]) => (step.do as Function).call(step, `${label}:${name}`, once, args.at(-1)) } as WorkflowStep;
      const runner = makeRunner({
        binding: { getByName(name: string) { used.add(name); return namespace.getByName(name); } } as unknown as DurableObjectNamespace,
        repository, revision, root, workspaceId, step: scoped, reuseWorkspace: false,
        container: { image: "workspace", instance: "lite" },
      });
      const rebind = (value: unknown) => {
        if (!(value instanceof CI.Workspace) || value.revision?.provider !== "cloudflare-container") throw Error("Missing private native workspace output");
        return CI.Workspace.remote(workspaceId, value.cwd, value.revision);
      };
      const read = async (workspace: CI.Workspace, path: string, id: string) => requireValue(await Effect.runPromise(runner.fileSystem.readFile(workspace, path, id)), "Missing fixture input/output");
      try {
        const files = await scoped.do("source:public-blobs", () => publicSource(revision));
        await scoped.do("source:materialize", () => namespace.getByName(workspaceId).materializeSource(files, { image: "workspace", instance: "lite" }));
        const source = CI.Workspace.remote(workspaceId, `/workspace/repository/${root}`);
        const base = await Effect.runPromise(runner.persistence.commit({ workflowId: "native-source-reruns", stepId: "prepared-source", workspace: source }));
        const inputs: Record<string, string> = {};
        for (const name of ["left", "right"]) inputs[name] = await hash(await read(base, `${name}.txt`, "inspect-source"));
        const program = await hash(await read(base, "task.mjs", "inspect-source"));
        for (const file of files) {
          const name = file.path.split("/").at(-1)!;
          const text = new TextDecoder().decode(Uint8Array.from(atob(file.base64), character => character.charCodeAt(0)));
          const actual = name === "task.mjs" ? program : inputs[name.replace(".txt", "")];
          if (actual !== await hash(text)) throw Error("Prepared workspace does not match pinned public Git bytes");
        }
        const image = await namespace.getByName(workspaceId).getImageIdentity({ image: "workspace" });
        if (!image || !/sha256:[a-f0-9]{64}$/.test(image)) throw Error("Unresolved immutable native runtime image");
        const binary = await Effect.runPromise(runner.executor.execute({
          workflowId: "native-source-reruns", stepId: "inspect-runtime", commandIndex: 1,
          workspace: base, command: "sha256sum /usr/local/bin/node", options: {}, onOutput() {},
        }));
        if (!/^[a-f0-9]{64}\s/.test(binary.stdout)) throw Error("Missing independently inspected Node binary digest");
        const runtime = await hash(JSON.stringify([image, binary.stdout.trim()]));
        const reasons: Record<string, string> = {}, selected: string[] = [];
        const available = async (name: Name) => {
          try { return await hash(await read(rebind(previous!.attempt.outputs[name]), "output.txt", `validate-${name}`)) === previous!.lineage[name].outputDigest; }
          catch { return false; }
        };
        if (previous) {
          for (const name of ["left", "right"] as const) {
            reasons[name] = previous.program !== program ? "program changed" : previous.runtime !== runtime ? "runtime changed"
              : previous.inputs[name] !== inputs[name] ? "input changed" : !await available(name) ? "checkpoint unavailable or changed" : "same inputs and available checkpoint";
            if (reasons[name] !== "same inputs and available checkpoint") selected.push(name);
          }
          reasons.bundle = selected.length ? "dependency affected" : !await available("bundle") ? "checkpoint unavailable or changed" : "same inputs and available checkpoint";
          if (!selected.length && reasons.bundle !== "same inputs and available checkpoint") selected.push("bundle");
        } else for (const name of names) reasons[name] = "first execution";
        const leaf = (name: "left" | "right") => CI.action(name, () => function* () {
          return yield* base.exec(`cp ${name}.txt input.txt && node task.mjs leaf`);
        });
        const left = leaf("left"), right = leaf("right");
        const bundle = CI.action("bundle", function* () {
          const a = yield* left(), b = yield* right();
          return function* () {
            const x = requireValue(yield* a.readFile("output.txt"), "Missing left output"), y = requireValue(yield* b.readFile("output.txt"), "Missing right output");
            return yield* base.exec(`node -e 'const f=require("node:fs");f.writeFileSync("left.txt",Buffer.from("${btoa(x)}","base64"));f.writeFileSync("right.txt",Buffer.from("${btoa(y)}","base64"))' && node task.mjs bundle`);
          };
        });
        const retained = previous && JSON.stringify(previous.attempt);
        const result = await CI.runPromise(CI.workflow("native-source-reruns", () => bundle()), {
          output: "silent", ci: true, executor: runner.executor, actionExecutor: runner.actionExecutor,
          workspacePersistence: runner.persistence, workspaceFileSystem: runner.fileSystem,
          event: { type: "push", revision, source: { kind: "git", repository, revision } },
          ...(previous ? { rerun: { steps: selected, previous: { ...previous.attempt,
            outputs: Object.fromEntries(Object.entries(previous.attempt.outputs).map(([name, value]) => [name, rebind(value)])) } } } : {}),
        });
        if (previous && JSON.stringify(previous.attempt) !== retained) throw Error("Prior attempt changed");
        const lineage = {} as Record<Name, Lineage>;
        for (const name of names) {
          const workspace = result.attempt.outputs[name] as CI.Workspace;
          const reused = result.plan.nodes.find(node => node.id === name)?.status === "reused";
          lineage[name] = { producer: reused ? previous!.lineage[name].producer : label,
            checkpointDigest: await hash(JSON.stringify(workspace.revision)), outputDigest: await hash(await read(workspace, "output.txt", `verify-${name}`)) };
          if (reused && JSON.stringify(lineage[name]) !== JSON.stringify(previous!.lineage[name])) throw Error("Reused checkpoint lineage changed");
        }
        const output = await read(result.value, "output.txt", "verify-bundle");
        const reused = result.plan.nodes.filter(node => node.status === "reused").map(node => node.id).sort();
        const executed = names.filter(name => !reused.includes(name));
        traces.push({ label, revision, reasons, executed, reused, lineage, output, program, runtime });
        return { attempt: result.attempt, inputs, program, runtime, lineage, output };
      } finally {
        await step.do(`${label}:cleanup`, cleanupOnce, async () => {
          const stopped = await Promise.allSettled([...used].map(name => namespace.getByName(name).stopFixture()));
          if (stopped.some(result => result.status === "rejected")) throw Error("Fixture VM cleanup incomplete; inspect this run before doing anything else");
        });
      }
    };
    const first = await run("original", original);
    const second = await run("changed-input", changed, first);
    if (second.output !== "CHARLIE / BRAVO\n" || second.lineage.right.producer !== "original" || second.lineage.left.producer !== "changed-input") throw Error("Changed-input selection failed");
    const third = await run("unchanged-inputs", changed, second);
    if (JSON.stringify(third.lineage) !== JSON.stringify(second.lineage)) throw Error("Unchanged inputs did not preserve all checkpoints");
    const fresh = await run("fresh-comparison", changed);
    if (fresh.output !== second.output) throw Error("Selective/fresh outputs differ");
    const program = await run("changed-program", programChanged, third);
    if (program.output !== "CHARLIE! / BRAVO!\n" || names.some(name => program.lineage[name].producer !== "changed-program")) throw Error("Changed program reused stale output");
    return { proof: "native-source-reruns", traces,
      boundary: "Owned fixed-public-source input contract and native workspace snapshots; no generic input closure, signature enrollment, production release, or repair claim" };
  }
}

// No HTTP dispatch or project-selected execution interface.
export default { fetch() { return new Response("Not found", { status: 404 }); } };
