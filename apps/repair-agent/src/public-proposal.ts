import {
  WorkerEntrypoint, WorkflowEntrypoint,
  type WorkflowEvent, type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  assertPublicAdmission, publicBudget, publicProposalFromHistory,
  PUBLIC_REPAIR_POLICY, publicProposalMode, PUBLIC_MODEL_RUN,
} from "@effect-ci-testbed/github/public-proposal";
import { runProposal, type BudgetInspection, type ProposalSteps } from "./proposal.ts";

interface AdmissionReader { readPublicAdmission(instance: string): Promise<unknown> }
interface Environment { REPAIR_AI: BudgetInspection; PUBLIC_ADMISSION: AdmissionReader }
const rejected = () => new Error("Public proposal activation rejected; reconcile the SAME Workflow and model slot");
const options = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;
function instanceId(value: string) {
  if (!/^public-incident-[a-f0-9]{64}$/.test(value)) throw rejected();
  return value;
}
async function readAdmission(reader: AdmissionReader, instance: string) {
  const r = await reader.readPublicAdmission(instanceId(instance)) as {
    instance?: unknown; admission?: Record<string, unknown>;
  };
  const a = r?.admission;
  // Explicit private RPC copy before strict descriptor-safe schema validation.
  return assertPublicAdmission(instance, { instance: r?.instance, admission: {
    policy: a?.policy, issue: a?.issue, correlation: a?.correlation, service: a?.service,
    source: a?.source, version: a?.version, emission: a?.emission,
    fixtureDigest: a?.fixtureDigest, claimedAt: a?.claimedAt, observedAt: a?.observedAt,
  } });
}
export async function runPublicProposal(
  instance: string, payload: unknown, step: ProposalSteps, env: Environment,
) {
  instanceId(instance);
  publicProposalMode(instance, payload);
  const admitted = await step.do("public:verify-immutable-admission", options,
    () => readAdmission(env.PUBLIC_ADMISSION, instance));
  // Same generated Flue agent/provider, same global ledger and HOST_RUN. The
  // new genuine public incident gets ONE durable submission; not an old replay.
  const proposal = await runProposal(instance, { mode: "proposal" }, step,
    env.REPAIR_AI, status => { publicBudget(status, true); });
  const output = { admitted, proposal, activationPolicy: PUBLIC_REPAIR_POLICY,
    githubWritePerformed: false as const, repairVerified: false as const };
  await step.do("public:verify-fresh-proposal", options, async () => {
    const checked = await publicProposalFromHistory(instance,
      { status: "complete", output }, admitted, await env.REPAIR_AI.status());
    return { reservationId: checked.reservationId, instance: checked.instance };
  });
  return output;
}
export class PublicIncidentProposalWorkflow extends WorkflowEntrypoint<Environment, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    try { return await runPublicProposal(event.instanceId, event.payload, step, this.env); }
    catch { throw new NonRetryableError("Public proposal failed; retain this SAME admission/Workflow/model slot and reservation before recovery"); }
  }
}
/** PRIVATE host capability only. No HTTP, caller prompt, model, repo or budget
 * selector. Start validates immutable admission BEFORE even creating a Workflow.
 */
export class PublicProposalDriver extends WorkerEntrypoint<Environment> {
  async publicProposalReadiness() {
    const current = await this.env.REPAIR_AI.status();
    const entries = publicBudget(current, true);
    return { ready: true, run: PUBLIC_MODEL_RUN, reservedCents: entries.size * 10 };
  }
  private workflow() {
    return (this.ctx.exports as unknown as { PublicIncidentProposalWorkflow: Workflow }).PublicIncidentProposalWorkflow;
  }
  async startPublicProposal(instance: string) {
    await readAdmission(this.env.PUBLIC_ADMISSION, instance);
    const created = await this.workflow().create({ id: instance, params: { mode: "proposal" } });
    if (created.id !== instance) throw rejected();
    return { id: created.id };
  }
  async publicProposalStatus(instance: string) {
    await readAdmission(this.env.PUBLIC_ADMISSION, instance);
    const status = await (await this.workflow().get(instance)).status();
    return { status: status.status };
  }
  async readPublicProposal(instance: string) {
    const admitted = await readAdmission(this.env.PUBLIC_ADMISSION, instance);
    const history = await (await this.workflow().get(instance)).status();
    return publicProposalFromHistory(instance, history, admitted, await this.env.REPAIR_AI.status());
  }
  override fetch() { return new Response("Not found", { status: 404 }); }
}
