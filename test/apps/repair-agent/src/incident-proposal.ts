import {
  assertAdmittedIncident,
  incidentProposalMode,
  INCIDENT_IDENTITY,
} from "@effect-ci-testbed/github/incident-proposal";
import {
  runProposal,
  type ProposalSteps,
  type BudgetInspection,
} from "./proposal.ts";
export interface IncidentAdmissionReader {
  inspect(): Promise<unknown>;
}
/** Constructor-supplied host capabilities only. No raw event context or actor-paid IDs. */
export async function runIncidentProposal(
  instance: string,
  payload: unknown,
  step: ProposalSteps,
  admission: IncidentAdmissionReader,
  budget: BudgetInspection,
) {
  const mode = incidentProposalMode(instance, payload);
  const admitted = await step.do(
    "incident:verify-admission",
    { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" },
    async () => {
      // Service RPC returns a Disposable wrapper, not an actor object. Copy
      // ONLY pinned schema fields into a plain checkpoint before strict validation;
      // do not enumerate/copy RPC metadata or any event/model fields.
      const rpc = (await admission.inspect()) as {
        state?: unknown;
        admittedAt?: unknown;
        identity?: Record<string, unknown>;
      };
      const identity: Record<string, unknown> = {};
      for (const key of Object.keys(INCIDENT_IDENTITY))
        identity[key] = rpc.identity?.[key];
      return assertAdmittedIncident({
        state: rpc.state,
        identity,
        admittedAt: rpc.admittedAt,
      });
    },
  );
  if (mode === "inspect")
    return { admitted, inferenceCalled: false, repairVerified: false };
  // Same generated agent/provider/SQL call slot, original SSE, fixed prompt/model,
  // same global ledger and SAME four-call HOST_RUN. No new budget/run namespace.
  const proposal = await runProposal(
    admitted.instance,
    { mode: "proposal" },
    step,
    budget,
  );
  return {
    admitted,
    proposal,
    repairVerified: false,
    githubWritePerformed: false,
    eventActivation:
      "authenticated-operator-continuation-of-admitted-issue" as const,
  };
}
