import {
  readPublishedDemo,
  demoCandidateModule,
  demoCandidatePolicy,
  type DemoCandidateReceipt,
} from "@effect-ci-testbed/cloudflare/demo-candidate";
import { siteRevision } from "@effect-ci-testbed/cloudflare/demo-site";
import { RELEASE_ACCOUNT, RELEASE_SCRIPT, deploymentAPI } from "./release-manager.ts";

export const CANDIDATE_POLICY = demoCandidatePolicy;
export interface CandidateIdentity {
  revision: string;
  digest: string;
  moduleDigest: string;
  policy: typeof CANDIDATE_POLICY;
}
export type CandidateReceipt = DemoCandidateReceipt;
export interface CandidateRecord extends CandidateIdentity {
  status: "pending" | "complete";
  receipt?: CandidateReceipt;
}
export interface CandidateStore {
  read(revision: string): Promise<CandidateRecord | undefined>;
  claim(record: CandidateRecord): Promise<void>;
  complete(record: CandidateRecord): Promise<void>;
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);

export async function prepareCandidate(
  store: CandidateStore,
  revision: string,
  digest: string,
  token: () => string,
  transport: typeof fetch = fetch,
): Promise<CandidateReceipt> {
  siteRevision(revision);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw Error("Invalid candidate digest");
  const previous = await store.read(revision);
  if (previous) {
    const r = previous.receipt;
    if (
      previous.revision !== revision ||
      previous.digest !== digest ||
      previous.policy !== CANDIDATE_POLICY ||
      !/^([a-f0-9]{64})$/.test(previous.moduleDigest) ||
      previous.status !== "complete" ||
      !r ||
      r.revision !== revision ||
      r.digest !== digest ||
      r.moduleDigest !== previous.moduleDigest ||
      r.policy !== CANDIDATE_POLICY ||
      r.script !== RELEASE_SCRIPT ||
      !uuid(r.version)
    )
      throw Error("Candidate needs reconciliation; no automatic upload retry");
    return { ...r };
  }
  const site = await readPublishedDemo(revision, digest, transport);
  const built = await demoCandidateModule(site);
  const pending: CandidateRecord = {
    revision,
    digest,
    moduleDigest: built.moduleDigest,
    policy: CANDIDATE_POLICY,
    status: "pending",
  };
  await store.claim(pending); // Durable before any version-upload POST.
  const version = await uploadCandidate(pending, built.module, token, transport);
  const receipt: CandidateReceipt = {
    revision,
    digest,
    moduleDigest: built.moduleDigest,
    policy: CANDIDATE_POLICY,
    version,
    script: RELEASE_SCRIPT,
  };
  await store.complete({ ...pending, status: "complete", receipt });
  return receipt;
}

async function boundedJson(response: Response): Promise<any> {
  if (response.status !== 200) {
    await response.body?.cancel();
    throw Error(`Candidate API rejected (HTTP ${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Missing candidate response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 128 * 1024) throw Error("Candidate response limit");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (result.success !== true) throw Error("Candidate API rejected");
  return result.result;
}
/** Same existing account/script/credential boundary. No deployment, arbitrary module or URL input. */
export async function uploadCandidate(
  identity: CandidateIdentity,
  module: string,
  token: () => string,
  transport: typeof fetch,
): Promise<string> {
  const api = deploymentAPI(token, transport);
  const before = await api.latest();
  const message = `effect-ci-vite:${identity.digest}:${identity.moduleDigest}`;
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2026-10-07",
    bindings: [
      { name: "WORKER_METADATA", type: "version_metadata" },
      { name: "FAILURE_RATE", type: "plain_text", text: "0" },
    ],
    observability: { enabled: true, head_sampling_rate: 1 },
    annotations: {
      "workers/commit_sha": identity.revision,
      "workers/repository_url": "https://github.com/ericclemmons/effect-ci-testbed",
      "workers/message": message,
    },
  };
  const form = new FormData();
  form.set(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    "metadata.json",
  );
  form.set("index.js", new Blob([module], { type: "application/javascript+module" }), "index.js");
  const credential = token();
  if (!/^[A-Za-z0-9_-]+$/.test(credential)) throw Error("Invalid candidate credential");
  const base = `https://api.cloudflare.com/client/v4/accounts/${RELEASE_ACCOUNT}/workers/scripts/${RELEASE_SCRIPT}/versions`;
  let stage = "upload",
    status: number | undefined,
    knownVersion: string | undefined;
  try {
    const uploadResponse = await transport(base, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}` },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    status = uploadResponse.status;
    const uploaded = await boundedJson(uploadResponse);
    if (!uuid(uploaded?.id)) throw Error("Invalid candidate version");
    knownVersion = uploaded.id;
    stage = "readback";
    const checkedResponse = await transport(`${base}/${uploaded.id}`, {
      headers: { authorization: `Bearer ${credential}` },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    status = checkedResponse.status;
    const checked = await boundedJson(checkedResponse);
    stage = "identity";
    if (
      checked.id !== uploaded.id ||
      checked.metadata?.annotations?.["workers/commit_sha"] !== identity.revision ||
      checked.metadata?.annotations?.["workers/message"] !== message
    )
      throw Error("Candidate readback identity mismatch");
    const bindings = checked.resources?.bindings;
    if (
      !Array.isArray(bindings) ||
      bindings.length !== 2 ||
      !bindings.some((b: any) => b.name === "WORKER_METADATA" && b.type === "version_metadata") ||
      !bindings.some(
        (b: any) => b.name === "FAILURE_RATE" && b.type === "plain_text" && b.text === "0",
      )
    )
      throw Error("Candidate binding mismatch");
    stage = "allocation";
    const after = await api.latest();
    if (JSON.stringify(after) !== JSON.stringify(before))
      throw Error("Allocation changed during candidate preparation");
    return uploaded.id;
  } catch {
    throw Error(
      `Candidate upload uncertain or rejected (${stage}${status === undefined ? "" : `, HTTP ${status}`}${knownVersion ? `, version ${knownVersion}` : ""}); reconcile the pending identity, never retry automatically`,
    );
  }
}
