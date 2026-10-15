import { DurableObject, WorkerEntrypoint, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { assertPublicAdmission, PUBLIC_REPAIR_POLICY, PUBLIC_FIXTURE_DIGEST, PUBLIC_MODEL_RUN } from "../../../packages/github/src/public-proposal.ts";
import { runPublicRepair, publicRepairRun, type PublicRepairResult } from "../../../packages/github/src/public-repair.ts";
import { proposeRepair } from "../../../packages/github/src/repair.ts";
import { OWNED_BASE } from "../../../packages/github/src/repair-verifier.ts";
import type { OperationStore } from "../../../packages/github/src/repair-operation.ts";
import type { RepairVerifier } from "./repair-verifier.ts";
import type { PrivateSlackCards } from "./private-cards.ts";

interface Environment {
  GITHUB_APP_ID: string; GITHUB_PRIVATE_KEY: string;
  PUBLIC_ADMISSION: { readPublicAdmission(instance: string): Promise<any>; publicEnrollmentReadiness(version: string): Promise<any> };
  PUBLIC_PROPOSAL: {
    startPublicProposal(instance: string): Promise<{ id: string }>;
    publicProposalStatus(instance: string): Promise<{ status: string }>;
    readPublicProposal(instance: string): Promise<any>;
    publicProposalReadiness(): Promise<{ ready: boolean; run: string; reservedCents: number }>;
  };
}
/** Narrow read-only capability for the source arming Workflow. This is NOT the
 * dispatcher/writer capability: the public source cannot start a paid operation.
 */
export class PublicPipelineReadiness extends WorkerEntrypoint<Environment> {
  async checkPublicPipeline(version: string) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(version) ||
        this.env.GITHUB_APP_ID !== "5089816" || !this.env.GITHUB_PRIVATE_KEY) throw rejected();
    const channels = this.env as unknown as Record<string, unknown>;
    for (const k of ["SLACK_APP_ID", "SLACK_TEAM_ID", "SLACK_CHANNEL_ID", "SLACK_BOT_TOKEN"])
      if (typeof channels[k] !== "string" || !channels[k]) throw rejected();
    const p = await this.env.PUBLIC_ADMISSION.publicEnrollmentReadiness(version);
    if (p.policy !== PUBLIC_REPAIR_POLICY || p.service !== "effect-ci-repair-incident" || p.version !== version ||
        typeof p.source !== "string" || !/^[a-f0-9]{40}$/.test(p.source) || p.emission !== "owned-public-health-500-v1" ||
        p.fixtureDigest !== PUBLIC_FIXTURE_DIGEST) throw rejected();
    const budget = await this.env.PUBLIC_PROPOSAL.publicProposalReadiness();
    if (budget.ready !== true || budget.run !== PUBLIC_MODEL_RUN || !Number.isSafeInteger(budget.reservedCents)) throw rejected();
    return { ready: true, policy: PUBLIC_REPAIR_POLICY, service: "effect-ci-repair-incident", version,
      source: p.source, fixtureDigest: PUBLIC_FIXTURE_DIGEST, budgetGuarded: true, reservedCents: budget.reservedCents };
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
const owner = "owned-public-http-repair-v1", key = "public-native-repair-v1";
const rejected = () => new Error("Public incident repair unavailable; retain the SAME operation before recovery");
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" } as const;
function instanceId(instance: string) { if (!/^public-incident-[a-f0-9]{64}$/.test(instance)) throw rejected(); return instance; }
function admissionCopy(a: any) {
  return { policy: a?.policy, issue: a?.issue, correlation: a?.correlation, service: a?.service,
    source: a?.source, version: a?.version, emission: a?.emission, fixtureDigest: a?.fixtureDigest,
    claimedAt: a?.claimedAt, observedAt: a?.observedAt };
}
async function admitted(env: Environment, instance: string) {
  const r = await env.PUBLIC_ADMISSION.readPublicAdmission(instanceId(instance));
  return assertPublicAdmission(instance, { instance: r?.instance, admission: admissionCopy(r?.admission) });
}
function plain(r: PublicRepairResult): PublicRepairResult {
  return { repository: r.repository, commit: r.commit, sourceDigest: r.sourceDigest, evidenceId: r.evidenceId,
    pullRequest: r.pullRequest, url: r.url, created: r.created, deploymentPerformed: false,
    replay: r.replay, instance: r.instance, issue: r.issue, modelReservationId: r.modelReservationId,
    activationPolicy: r.activationPolicy };
}
/** Separate permanent singleton; never touches the recorded/old incident writer.
 * No caller patch, repo, branch, command, token, verifier or reservation is used.
 */
export class PublicIncidentRepairOperations extends DurableObject<Environment> {
  private store(): OperationStore {
    return {
      read: () => this.ctx.storage.get(key),
      claim: record => this.ctx.storage.transaction(async storage => {
        if (await storage.get(key) !== undefined) return false;
        await storage.put(key, record); return true;
      }),
      complete: (digest, result) => this.ctx.storage.transaction(async storage => {
        const r: any = await storage.get(key);
        if (r?.version !== 1 || r.state !== "pending" || r.digest !== digest) throw rejected();
        await storage.put(key, { ...r, state: "complete", result });
      }),
      fail: digest => this.ctx.storage.transaction(async storage => {
        const r: any = await storage.get(key);
        if (r?.version !== 1 || r.digest !== digest) throw rejected();
        if (r.state === "pending") await storage.put(key, { ...r, state: "failed" });
      }),
    };
  }
  async propose(instance: string) {
    return runPublicRepair(instanceId(instance), this.store(), async () => {
      const r = await this.env.PUBLIC_PROPOSAL.readPublicProposal(instance);
      return { instance: r?.instance, admission: admissionCopy(r?.admission), run: r?.run,
        reservationId: r?.reservationId, text: r?.text, submissionId: r?.submissionId,
        agentUid: r?.agentUid, acceptedAt: r?.acceptedAt };
    }, evidence => {
      const verifier = (this.ctx.exports as unknown as {
        RepairVerifier: (options: {}) => Service<RepairVerifier>;
      }).RepairVerifier({});
      const runId = publicRepairRun(evidence);
      return proposeRepair({ appId: this.env.GITHUB_APP_ID, privateKey: this.env.GITHUB_PRIVATE_KEY },
        { runId, baseCommit: OWNED_BASE, proposedText: evidence.text }, async input => {
          const r = await verifier.verify(input.commit, runId);
          return { commit: r.commit, sourceDigest: r.sourceDigest, passed: r.passed, evidenceId: r.evidenceId };
        });
    });
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
/** Only the authenticated receiver outbox is to be bound to this service. No
 * public route exists; native administration is not event-activation proof.
 */
export class PublicIncidentDispatcher extends WorkerEntrypoint<Environment> {
  async startPublicIncident(instance: string) {
    await admitted(this.env, instance);
    const workflow = (this.ctx.exports as unknown as { PublicIncidentRepairWorkflow: Workflow }).PublicIncidentRepairWorkflow;
    const r = await workflow.create({ id: instance, params: { mode: "repair-public" } });
    if (r.id !== instance) throw rejected();
    return { id: r.id };
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
export class PublicIncidentRepairWorkflow extends WorkflowEntrypoint<Environment, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let cardAcknowledged = false;
    const host = this.ctx.exports as unknown as {
      PrivateSlackCards: DurableObjectNamespace<PrivateSlackCards>;
      PublicIncidentRepairOperations: DurableObjectNamespace<PublicIncidentRepairOperations>;
    };
    const publish = async (sequence: number, text: string) => {
      const receipt = await step.do(`public:card-${sequence}`, once, async () => {
        const r = await host.PrivateSlackCards.getByName(event.instanceId).publish(event.instanceId, sequence,
          { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] });
        if (!r.ok) throw rejected();
        return { ts: r.ts };
      });
      return receipt.ts;
    };
    try {
      instanceId(event.instanceId);
      const p = event.payload;
      if (!p || typeof p !== "object" || Array.isArray(p) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(p)) || Reflect.ownKeys(p).length !== 1)
        throw rejected();
      const mode = Object.getOwnPropertyDescriptor(p, "mode");
      if (!mode || !("value" in mode) || mode.value !== "repair-public") throw rejected();
      const admission = await step.do("public:verify-admission", once, () => admitted(this.env, event.instanceId));
      await publish(0, `Owned public test incident ${admission.admission.issue}: preparing one bounded repair proposal. Nothing will be merged or deployed.`);
      cardAcknowledged = true;
      await step.do("public:start-proposal", once, async () => {
        const r = await this.env.PUBLIC_PROPOSAL.startPublicProposal(event.instanceId);
        if (r.id !== event.instanceId) throw rejected();
        return { id: r.id };
      });
      let complete = false;
      for (let i = 0; i < 30; i++) {
        const state = await step.do(`public:proposal-status-${i}`, once, async () => {
          const r = await this.env.PUBLIC_PROPOSAL.publicProposalStatus(event.instanceId);
          if (!["queued", "running", "waiting", "complete"].includes(r.status)) throw rejected();
          return { status: r.status };
        });
        if (state.status === "complete") { complete = true; break; }
        await step.sleep(`public:proposal-wait-${i}`, "5 seconds");
      }
      if (!complete) throw rejected();
      await publish(1, "Fresh bounded proposal received. Verifying the exact proposed commit with the owned native Node check before opening a PR.");
      const result = await step.do("public:propose-native-verified-pr",
        { retries: { limit: 0, delay: "1 second" }, timeout: "10 minutes" }, async () =>
          plain(await host.PublicIncidentRepairOperations.getByName(owner).propose(event.instanceId)));
      const slackTs = await publish(2, `Proposed repair: <${result.url}|PR #${result.pullRequest}>. Exact-commit native Node verification passed (${result.evidenceId}). *Not merged or deployed.*`);
      return { ...result, slackTs, eventActivation: "authenticated-public-incident-outbox" as const };
    } catch {
      // Only update a definitely acknowledged card; never create a replacement
      // root after ambiguity, retry a paid operation or hide a proposed PR.
      if (cardAcknowledged) await publish(3, "Owned public repair stopped or requires reconciliation. Keep the same incident, Workflow, model reservation and proposed branch. Nothing is merged or deployed.").catch(() => undefined);
      throw new NonRetryableError("Public incident repair stopped; inspect this SAME outbox/proposal/writer/card before recovery");
    }
  }
}
