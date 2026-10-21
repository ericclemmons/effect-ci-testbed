import * as CI from "@effect-ci-testbed/ci";
import * as Schema from "effect/Schema";
import { ShowcaseRevision, ShowcaseVersion } from "./showcase-protocol.ts";
import { showcaseRoot } from "./showcase-runner-policy.ts";

const NodeId = Schema.Literals(["checkout", "install", "lint", "test", "build"]);
const Text = Schema.NonEmptyString.check(Schema.isMaxLength(1024));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Snapshot = Schema.Struct({ id: Text, size: Count, name: Schema.optionalKey(Text) });
const Workspace = Schema.Struct({ kind: Schema.Literal("workspace"), snapshot: Snapshot });
const Output = Schema.Union([Workspace, Schema.Struct({ kind: Schema.Literal("void") })]);
const Node = Schema.Struct({
  id: NodeId, after: Schema.Array(NodeId), dependencies: Schema.Array(NodeId),
  commands: Schema.Array(Schema.Struct({ command: Text, cwd: Schema.Literal(showcaseRoot) })),
  artifacts: Schema.Array(Schema.Never), optional: Schema.Literal(false),
  options: Schema.Json, secrets: Schema.Array(Schema.Never),
  status: Schema.Literals(["complete", "reused", "verified"]),
});
const Metadata = Schema.Struct({ revision: ShowcaseRevision, version: ShowcaseVersion, instanceId: ShowcaseVersion });
const Retained = Schema.Struct({
  revision: ShowcaseRevision, version: ShowcaseVersion, instanceId: ShowcaseVersion,
  number: Count.check(Schema.isGreaterThan(0)),
  startedAt: Text, completedAt: Text,
  environment: Text,
  requested: Schema.Array(NodeId), nodes: Schema.Array(Node).check(Schema.isLengthBetween(1, 5)),
  outputs: Schema.Record(NodeId, Output),
});
export type RetainedShowcaseAttempt = typeof Retained.Encoded;
type MetadataInput = typeof Metadata.Encoded;
export const decodeRetainedShowcaseAttempt = (value: unknown): RetainedShowcaseAttempt =>
  Schema.encodeSync(Retained)(Schema.decodeUnknownSync(Retained)(value));

/** Private host storage only. Public execution observations contain hashes,
 * never these snapshot capabilities. No failed or publishing run is resumable.
 */
export function retainShowcaseAttempt(attempt: CI.WorkflowAttempt, metadata: MetadataInput): RetainedShowcaseAttempt | undefined {
  try {
    Schema.decodeUnknownSync(Metadata)(metadata);
    if (attempt.workflowId !== "demo" || attempt.plan.workflowId !== "demo" ||
      attempt.plan.mode !== "execute" || attempt.conclusion !== "success") return;
    const outputs: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(attempt.outputs)) {
      if (value === undefined) outputs[id] = { kind: "void" };
      else if (value instanceof CI.Workspace && value.kind === "remote" && value.id === metadata.instanceId &&
        value.cwd === showcaseRoot && value.revision?.provider === "cloudflare-container") {
        outputs[id] = { kind: "workspace", snapshot: value.revision.value };
      } else return;
    }
    const encoded = Schema.encodeSync(Retained)(Schema.decodeUnknownSync(Retained)({ ...metadata,
      number: attempt.number, startedAt: attempt.startedAt, completedAt: attempt.completedAt,
      environment: attempt.plan.environment, requested: attempt.requested, nodes: attempt.plan.nodes, outputs,
    }));
    if (encoded.nodes.some(node => !Object.hasOwn(encoded.outputs, node.id)) ||
      new Set(encoded.nodes.map(node => node.id)).size !== encoded.nodes.length || JSON.stringify(encoded).length > 65_536) return;
    return encoded;
  } catch { return; }
}

/** Identity validation precedes hydration. The caller must additionally probe
 * snapshot availability before starting a new, explicitly requested computation.
 */
export function restoreShowcaseAttempt(value: unknown, metadata: MetadataInput): CI.WorkflowAttempt {
  try {
    Schema.decodeUnknownSync(Metadata)(metadata);
    const previous = Schema.encodeSync(Retained)(Schema.decodeUnknownSync(Retained)(value));
    if (previous.revision !== metadata.revision || previous.version !== metadata.version ||
      previous.instanceId === metadata.instanceId || previous.nodes.some(node => !Object.hasOwn(previous.outputs, node.id))) throw Error();
    const outputs: Record<string, unknown> = {};
    for (const [id, output] of Object.entries(previous.outputs)) outputs[id] = output.kind === "void" ? undefined :
      CI.Workspace.remote(metadata.instanceId, showcaseRoot, { provider: "cloudflare-container", value: output.snapshot });
    return { id: `${previous.instanceId}:${previous.number}`, number: previous.number, workflowId: "demo",
      requested: previous.requested, conclusion: "success", startedAt: previous.startedAt, completedAt: previous.completedAt,
      plan: { workflowId: "demo", mode: "execute", environment: previous.environment,
        nodes: previous.nodes.map(node => ({ ...node, options: {} })) }, outputs };
  } catch { throw Error("Showcase compute attempt cannot be resumed for these inputs"); }
}
