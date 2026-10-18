import * as CI from "@effect-ci-testbed/ci";

/** Host-computed identities. A signature does not prove their input closure. */
export interface ExecutionIdentity {
  readonly issuer: string;
  readonly repository: string;
  readonly revision: string;
  readonly workflowId: string;
  readonly policyDigest: string;
  readonly runtimeDigest: string;
  readonly inputsDigest: string;
  readonly eventDigest: string;
}

export interface ExecutionOutput {
  readonly kind: "void" | "json" | "workspace" | "checkpoint" | "artifact" | "uncommitted";
  /** Commitment only: private values and snapshot capabilities stay in host storage. */
  readonly digest?: string;
}

export interface ExecutionClaim {
  readonly identity: ExecutionIdentity;
  readonly instanceId: string;
  readonly attempt: number;
  readonly conclusion: "success" | "failure";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly planDigest: string;
  readonly steps: ReadonlyArray<{
    readonly id: string;
    readonly status: CI.PlanNode["status"];
    readonly output?: ExecutionOutput;
  }>;
}

/** Verifying an observation does not itself invoke a cache, review or deploy. */
export interface ExecutionReceipt {
  readonly purpose: "execution-observation";
  readonly version: 1;
  readonly keyId: string;
  readonly claim: ExecutionClaim;
  readonly signature: string;
}

const encoder = new TextEncoder();
const hex = /^[a-f0-9]{64}$/;
const bounded = (value: unknown, max = 256): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const exact = (value: object, keys: string) => Object.keys(value).sort().join() === keys;
const digest = async (text: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))), b => b.toString(16).padStart(2, "0")).join("");
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Own data only. Never invoke a project's getters/toJSON or hash a lossy value. */
const canonical = (value: unknown): string => {
  let count = 0, bytes = 0;
  const emit = (text: string) => {
    bytes += encoder.encode(text).length;
    if (bytes > 65_536) throw Error("Execution value exceeds limits");
    return text;
  };
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): string => {
    if (++count > 4096 || depth > 32) throw Error("Execution value exceeds limits");
    if (value === null || typeof value === "boolean") return emit(JSON.stringify(value));
    if (typeof value === "string" && value.length <= 65_536) return emit(JSON.stringify(value));
    if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return emit(JSON.stringify(value));
    if (typeof value !== "object" || !value || active.has(value) || Object.getOwnPropertySymbols(value).length) throw Error("Unsupported execution value");
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error("Unsupported execution prototype");
    active.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Object.keys(descriptors);
      if (keys.length > 4097) throw Error("Execution value exceeds limits");
      if (Object.values(descriptors).some(d => !("value" in d))) throw Error("Execution accessors are not data");
      if (array) {
        if (value.length > 4096 || keys.length !== value.length + 1) throw Error("Unsupported execution array");
        emit("[]" + ",".repeat(Math.max(0, value.length - 1)));
        return `[${Array.from({ length: value.length }, (_, i) => {
          if (!descriptors[i]) throw Error("Sparse execution array");
          return visit(descriptors[i].value, depth + 1);
        }).join(",")}]`;
      }
      emit("{}" + ",".repeat(Math.max(0, keys.length - 1)));
      return `{${keys.sort().map(key => {
        if (key.length > 65_536) throw Error("Execution key exceeds limits");
        return `${emit(JSON.stringify(key) + ":")}${visit(descriptors[key]!.value, depth + 1)}`;
      }).join(",")}}`;
    } finally { active.delete(value); }
  };
  return visit(value, 0);
};

const sourceUrl = (value: string, origin = false): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      (origin ? value === url.origin : value === url.href);
  } catch { return false; }
};
const identityTuple = (identity: ExecutionIdentity): ReadonlyArray<string> => {
  if (!identity || !exact(identity, "eventDigest,inputsDigest,issuer,policyDigest,repository,revision,runtimeDigest,workflowId") ||
      !bounded(identity.issuer, 1024) || !sourceUrl(identity.issuer, true) ||
      !bounded(identity.repository, 2048) || !sourceUrl(identity.repository) || !/^[a-f0-9]{40}$/.test(identity.revision) ||
      !bounded(identity.workflowId) || ![identity.policyDigest, identity.runtimeDigest, identity.inputsDigest, identity.eventDigest].every(x => hex.test(x)))
    throw Error("Invalid execution identity");
  return [identity.issuer, identity.repository, identity.revision, identity.workflowId,
    identity.policyDigest, identity.runtimeDigest, identity.inputsDigest, identity.eventDigest];
};
const timestamp = (value: string) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const statuses = new Set(["planned", "queued", "running", "complete", "reused", "verified", "warning", "failed", "skipped"]);
const completed = new Set(["complete", "reused", "verified"]);
const claimBytes = (keyId: string, claim: ExecutionClaim): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId) || !claim ||
      !exact(claim, "attempt,completedAt,conclusion,identity,instanceId,planDigest,startedAt,steps") ||
      !bounded(claim.instanceId, 256) || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1 ||
      !["success", "failure"].includes(claim.conclusion) || !timestamp(claim.startedAt) || !timestamp(claim.completedAt) ||
      claim.startedAt > claim.completedAt || !hex.test(claim.planDigest) || !Array.isArray(claim.steps) || claim.steps.length > 256)
    throw Error("Invalid execution claim");
  identityTuple(claim.identity);
  const ids = new Set<string>();
  for (const node of claim.steps) {
    if (!node || !["id,output,status", "id,status"].includes(Object.keys(node).sort().join()) ||
        !bounded(node.id) || ids.has(node.id) || !statuses.has(node.status)) throw Error("Invalid execution step");
    ids.add(node.id);
    const output = node.output;
    if (output) {
      if (!completed.has(node.status) || !["kind", "digest,kind"].includes(Object.keys(output).sort().join()) ||
          !["void", "json", "workspace", "checkpoint", "artifact", "uncommitted"].includes(output.kind) ||
          (output.kind === "void" || output.kind === "uncommitted" ? output.digest !== undefined : !hex.test(output.digest ?? "")))
        throw Error("Invalid execution output");
    }
  }
  return encoder.encode(canonical(["effect-ci-execution-observation", 1, keyId, claim]));
};

const commitOutput = async (value: unknown): Promise<ExecutionOutput> => {
  if (value === undefined) return { kind: "void" };
  try {
    const kind = value instanceof CI.Workspace ? "workspace" : value instanceof CI.WorkspaceCheckpoint ? "checkpoint" :
      value instanceof CI.WorkspaceArtifact ? "artifact" : "json";
    const field = (object: object, name: string) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, name);
      if (!descriptor || !("value" in descriptor)) throw Error("Execution accessors are not data");
      return descriptor.value;
    };
    const handle = (value: CI.WorkspaceCheckpointHandle | undefined): unknown => {
      if (!value) return null;
      const provider = field(value, "provider"), data = field(value, "value");
      if (provider !== "cloudflare-container") return [provider, data];
      // RPC snapshot objects carry runtime-only symbols. Commit the provider's
      // explicit immutable descriptor, never its transport capabilities.
      const id = field(data, "id"), size = field(data, "size");
      const name = Object.getOwnPropertyDescriptor(data, "name");
      if (!bounded(id, 1024) || !Number.isSafeInteger(size) || size < 0 ||
          (name && (!("value" in name) || (name.value !== undefined && !bounded(name.value))))) throw Error("Invalid execution snapshot");
      return [provider, id, size, name?.value ?? null];
    };
    const sdk = (value: unknown): unknown => value instanceof CI.Workspace
      ? ["workspace", field(value, "id") ?? null, field(value, "cwd"), field(value, "kind"), handle(field(value, "revision"))]
      : value instanceof CI.WorkspaceCheckpoint
        ? ["checkpoint", field(value, "name"), sdk(field(value, "workspace")), handle(field(value, "handle"))]
        : value instanceof CI.WorkspaceArtifact
          ? ["artifact", field(value, "name"), field(value, "paths"), sdk(field(value, "checkpoint"))]
          : value;
    const data = sdk(value);
    return { kind, digest: await digest(canonical(data)) };
  } catch { return { kind: "uncommitted" }; }
};

/** Call inside trusted onAttempt, using independently prepared host identities.
 * This signs observed outcomes, not a claim that it is safe to skip the work. */
export async function signExecutionReceipt(options: {
  readonly keyId: string;
  readonly key: CryptoKey;
  readonly identity: ExecutionIdentity;
  readonly instanceId: string;
  readonly attempt: CI.WorkflowAttempt;
}): Promise<ExecutionReceipt> {
  if (options.key.type !== "private" || options.key.algorithm.name !== "Ed25519" || !options.key.usages.includes("sign")) throw Error("Invalid execution signing key");
  // Capture before the first await; mutable caller objects cannot change signed fields.
  const identity = JSON.parse(canonical(options.identity)) as ExecutionIdentity;
  identityTuple(identity);
  const attempt = options.attempt;
  if (attempt.plan.mode !== "execute" || attempt.workflowId !== identity.workflowId || attempt.plan.workflowId !== identity.workflowId)
    throw Error("Execution attempt does not match identity");
  const startedAt = attempt.startedAt, completedAt = attempt.completedAt, number = attempt.number, conclusion = attempt.conclusion;
  const instanceId = options.instanceId, keyId = options.keyId, key = options.key;
  // Project command text is hashed, never published. Functions in host step
  // options are policy, not portable output data; policyDigest binds that code.
  const plan = canonical({ workflowId: attempt.plan.workflowId, environment: attempt.plan.environment,
    nodes: attempt.plan.nodes.map(node => ({ id: node.id, status: node.status,
      dependencies: node.dependencies, after: node.after, commands: node.commands,
      artifacts: node.artifacts, optional: node.optional, secrets: node.secrets })) });
  const nodes = attempt.plan.nodes.map(({ id, status }) => ({ id, status,
    output: Object.hasOwn(attempt.outputs, id) ? commitOutput(attempt.outputs[id]) : undefined }));
  const claim: ExecutionClaim = {
    identity, instanceId, attempt: number, conclusion, startedAt, completedAt, planDigest: await digest(plan),
    steps: await Promise.all(nodes.map(async node => ({ id: node.id, status: node.status,
      ...(node.output ? { output: await node.output } : {}) }))),
  };
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("Ed25519", key, claimBytes(keyId, claim))));
  return { purpose: "execution-observation", version: 1, keyId, claim, signature };
}

/** Caller pins the expected issuer/inputs and its enrolled key. No embedded key
 * discovery, cache hit, PR approval or deployment effect is performed here. */
export async function verifyExecutionReceipt(serialized: string | undefined, expected: ExecutionIdentity,
  keys: ReadonlyMap<string, CryptoKey>): Promise<ExecutionClaim | undefined> {
  try {
    if (!serialized || serialized.length > 131_072) return;
    const receipt = JSON.parse(serialized) as ExecutionReceipt;
    if (!receipt || !exact(receipt, "claim,keyId,purpose,signature,version") || receipt.purpose !== "execution-observation" || receipt.version !== 1 ||
        !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) return;
    if (JSON.stringify(identityTuple(expected)) !== JSON.stringify(identityTuple(receipt.claim.identity))) return;
    const key = keys.get(receipt.keyId);
    if (!key || key.type !== "public" || key.algorithm.name !== "Ed25519" || !key.usages.includes("verify")) return;
    const signature = Uint8Array.from(atob(receipt.signature.replace(/-/g, "+").replace(/_/g, "/") + "=="), c => c.charCodeAt(0));
    if (base64url(signature) !== receipt.signature || !await crypto.subtle.verify("Ed25519", key, signature, claimBytes(receipt.keyId, receipt.claim))) return;
    return receipt.claim;
  } catch { return; }
}
