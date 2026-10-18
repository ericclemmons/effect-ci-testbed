import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createAppJwt } from "../../../packages/github/src/app.ts";
import { publishSmallChange, readSmallChange, type SmallChangeHost, type SmallChangeOperation, type SmallChangeStore } from "../../../packages/github/src/small-change-host.ts";
import type { SmallChangeDecision, SmallChangeEvidence } from "../../../packages/github/src/small-change.ts";
import * as CI from "@effect-ci-testbed/ci";
import { makeActionExecutor } from "../../../packages/cloudflare/src/action-step.ts";
import { policyId, pullRequestPolicy, smallChangePolicy } from "./workflows/pull-request.ts";
import { syntaxRepository, syntaxWorkflow } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { testCommand } from "@effect-ci-testbed/cloudflare/demo-test-check";
import { demoBuildIdentity, demoRunnerPolicyDigest } from "./demo-runner-policy.ts";
import type { RunnerCheckReceipt } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import type { HostedCheckIdentity } from "@effect-ci-testbed/cloudflare/check-evidence";
import type { RunnerStepIdentity, RunnerWorkspaceResult } from "@effect-ci-testbed/cloudflare/runner-step-result";

const repository = "ericclemmons/effect-ci-testbed";
const appId = 5089816, botId = 334321206, installation = 165265172;
interface Environment { GITHUB_APP_ID: string; GITHUB_PRIVATE_KEY: string; VERSION_METADATA?: { id: string } }

/** Bounded API responses and redacted errors; redirects never carry App tokens. */
export async function reviewApi(url: string, token: string, method = "GET", body?: unknown, fetcher: typeof fetch = fetch): Promise<any> {
  let response: Response;
  try {
    response = await fetcher(url, { method, redirect: "manual", signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
        "content-type": "application/json", "user-agent": "effect-ci-testbed", "x-github-api-version": "2026-03-10" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw Error("PR review API transport unavailable; reconcile writes before retrying"); }
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw Error(`PR review API rejected (${response.status})`); }
  if (method === "DELETE") { await response.body?.cancel().catch(() => undefined); return; }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty PR review API response");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length; if (size > 2 * 1024 * 1024) throw Error("Oversized PR review API response");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw Error("Invalid PR review API response"); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Fixed repo, same App. Contents stays READ: this capability cannot merge code. */
export async function withSmallChangeToken<T>(env: Environment, operation: (request: SmallChangeHost["request"]) => Promise<T>, fetcher: typeof fetch = fetch) {
  if (env.GITHUB_APP_ID !== String(appId)) throw Error("Small-change App is not enrolled");
  const jwt = await createAppJwt({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY });
  const permissions = { contents: "read", checks: "write", pull_requests: "write" };
  const minted = await reviewApi(`https://api.github.com/app/installations/${installation}/access_tokens`, jwt, "POST",
    { repositories: ["effect-ci-testbed"], permissions }, fetcher);
  if (typeof minted?.token !== "string" || !minted.token || minted.token.length > 1024) throw Error("Small-change token unavailable");
  try {
    if (!minted.permissions || Object.entries(permissions).some(([key, value]) => minted.permissions[key] !== value) ||
      Object.keys(minted.permissions).some(key => ![...Object.keys(permissions), "metadata"].includes(key)) ||
      (minted.permissions.metadata !== undefined && minted.permissions.metadata !== "read")) throw Error("Small-change token permissions rejected");
    return await operation((path, method = "GET", body) => {
      const comparison = /^\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}\?per_page=1$/.test(path);
      if ((!comparison && (!/^\/(?:pulls|commits|check-runs)(?:[/?]|$)/.test(path) || path.includes(".."))) || /[\\\x00-\x20\x7f]/.test(path))
        throw Error("Unenrolled review API path");
      return reviewApi(`https://api.github.com/repos/${repository}${path}`, minted.token, method, body, fetcher);
    });
  } finally { await reviewApi("https://api.github.com/installation/token", minted.token, "DELETE", undefined, fetcher); }
}

interface ReviewAuthority {
  forCommit(head: string): Promise<{ receipts: RunnerCheckReceipt[] }>
  lookup(identity: HostedCheckIdentity): Promise<boolean>
  stepResult(identity: RunnerStepIdentity): Promise<RunnerWorkspaceResult | undefined>
}
export async function verifiedDemoReviewChecks(authority: ReviewAuthority, head: string, version: string | undefined) {
  if (!/^[a-f0-9]{40}$/.test(head)) throw Error("Invalid review revision");
  const evidence = await authority.forCommit(head), checks: Array<{ name: string; head: string; conclusion: string }> = [];
  for (const receipt of evidence.receipts) {
    const identity = receipt.claim?.identity;
    if (identity?.revision === head && identity.repository === syntaxRepository && identity.workflowId === syntaxWorkflow &&
      identity.stepId === "test" && identity.command === testCommand && identity.policyDigest === await demoRunnerPolicyDigest(true) &&
      await authority.lookup(identity)) {
      checks.push({ name: "test", head, conclusion: "success" }); break;
    }
  }
  if (version && await authority.stepResult(await demoBuildIdentity(head, version))) checks.push({ name: "build", head, conclusion: "success" });
  return checks;
}

export class SmallChangeReviews extends DurableObject<Environment> {
  #validate(number: number, policyRevision: string | undefined) {
    if (!Number.isSafeInteger(number) || number < 1) throw Error("Invalid PR number");
    if (!policyRevision || policyRevision !== this.env.VERSION_METADATA?.id)
      throw Error("Org policy revision changed; no approval capability");
  }
  #withHost<T>(operation: (host: SmallChangeHost) => Promise<T>) {
    const authority = (this.ctx.exports as unknown as { TrustedDemoChecks: { getByName(name: string): ReviewAuthority } })
      .TrustedDemoChecks.getByName("demo-trusted-runner-v1");
    return withSmallChangeToken(this.env, request => operation({
      repository, appId, botId, policyId, request,
      policy: smallChangePolicy,
      verifiedChecks: head => verifiedDemoReviewChecks(authority, head, this.env.VERSION_METADATA?.id),
      // No paid reviewer is configured. Non-README code stays on normal review.
    }));
  }
  #store(): SmallChangeStore {
    return {
      read: key => this.ctx.storage.get<SmallChangeOperation>(key),
      claim: (key, value) => this.ctx.storage.transaction(async tx => {
        if (await tx.get(key)) return false; await tx.put(key, value); return true;
      }),
      complete: (key, value) => this.ctx.storage.transaction(async tx => {
        const current = await tx.get<SmallChangeOperation>(key);
        if (!current || current.state !== "pending" || current.marker !== value.marker) throw Error("Review journal changed");
        await tx.put(key, value);
      }),
    };
  }
  async read(number: number, policyRevision: string) {
    this.#validate(number, policyRevision);
    return this.#withHost(host => readSmallChange(host, number));
  }
  async publish(number: number, evidence: SmallChangeEvidence, decision: SmallChangeDecision, policyRevision: string) {
    this.#validate(number, policyRevision);
    return this.#withHost(host => publishSmallChange(host, number, this.#store(), evidence, decision));
  }
  /** Preserve the existing private RPC for pinned/retained callers. */
  async evaluate(number: number) {
    const revision = this.env.VERSION_METADATA?.id;
    this.#validate(number, revision);
    const { value } = await CI.runPromise(pullRequestPolicy({
      read: () => this.read(number, revision!), publish: (evidence, decision) => this.publish(number, evidence, decision, revision!),
    }).workflow, { env: "cloudflare", ci: true, output: "silent" });
    if (!value) throw Error("PR workflow produced no decision");
    return value;
  }
  fetch() { return new Response("Not found", { status: 404 }); }
}

/** PR-only host workflow, independent of execution attestations and deployment. */
export class SmallChangeReviewWorkflow extends WorkflowEntrypoint<Environment, { number: number }> {
  async run(event: Readonly<WorkflowEvent<{ number: number }>>, step: WorkflowStep) {
    if (!event.payload || Object.keys(event.payload).join() !== "number" ||
      !Number.isSafeInteger(event.payload.number) || event.payload.number < 1) throw Error("Invalid review event");
    const owner = (this.ctx.exports as unknown as { SmallChangeReviews: { getByName(name: string): Pick<SmallChangeReviews, "read" | "publish"> } })
      .SmallChangeReviews.getByName(`pr-${event.payload.number}`);
    // An old pinned Workflow cannot publish its verdict through a newer policy
    // owner's capability after a rollout. This value is host metadata, not payload.
    const revision = this.env.VERSION_METADATA?.id;
    if (!revision) throw Error("Org policy version metadata unavailable");
    const { value, plan } = await CI.runPromise(pullRequestPolicy({
      read: () => owner.read(event.payload.number, revision),
      publish: (evidence, decision) => owner.publish(event.payload.number, evidence, decision, revision),
    }).workflow, { env: "cloudflare", ci: true, output: "silent",
      actionExecutor: makeActionExecutor(step, new Set()),
    });
    if (!value) throw Error("PR workflow produced no decision");
    return { ...value, workflowPlan: plan };
  }
}
