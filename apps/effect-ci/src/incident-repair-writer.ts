import {
  DurableObject,
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { proposeRepair } from "../../../packages/github/src/repair.ts";
import { OWNED_BASE } from "../../../packages/github/src/repair-verifier.ts";
import {
  runIncidentRepair,
  INCIDENT_REPAIR_RUN,
  INCIDENT_REPAIR_OWNER,
  INCIDENT_REPAIR_KEY,
  incidentRepairDigest,
  type IncidentRepairResult,
} from "../../../packages/github/src/incident-repair-operation.ts";
import type { OperationStore } from "../../../packages/github/src/repair-operation.ts";
import {
  assertIncidentRepairEvidence,
} from "../../../packages/github/src/incident-repair-operation.ts";
import type { IncidentProposalEvidence } from "../../../packages/github/src/incident-evidence.ts";
import type { RepairVerifier } from "./repair-verifier.ts";
interface Environment {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  INCIDENT_EVIDENCE: { readIncident(): Promise<IncidentProposalEvidence> };
}
const operationKey = INCIDENT_REPAIR_KEY;
const owner = INCIDENT_REPAIR_OWNER;
const rejected = () => new Error("Owned native writer state rejected; inspect before recovery");
interface OperationInspection {
  state: string;
  runId: string;
  digest?: string;
}
export class OwnedIncidentRepairOperations extends DurableObject<Environment> {
  private store(): OperationStore {
    return {
      read: () => this.ctx.storage.get(operationKey),
      claim: (record) =>
        this.ctx.storage.transaction(async (storage) => {
          if ((await storage.get(operationKey)) !== undefined) return false;
          await storage.put(operationKey, record);
          return true;
        }),
      complete: (digest, result) =>
        this.ctx.storage.transaction(async (storage) => {
          const current: any = await storage.get(operationKey);
          if (current?.version !== 1 || current.state !== "pending" || current.digest !== digest)
            throw rejected();
          await storage.put(operationKey, { ...current, state: "complete", result });
        }),
      fail: (digest) =>
        this.ctx.storage.transaction(async (storage) => {
          const current: any = await storage.get(operationKey);
          if (current?.version !== 1 || current.digest !== digest) throw rejected();
          if (current.state === "pending")
            await storage.put(operationKey, { ...current, state: "failed" });
        }),
    };
  }
  async inspectIncident(): Promise<OperationInspection> {
    const current: any = await this.ctx.storage.get(operationKey);
    if (current === undefined) return { state: "absent", runId: INCIDENT_REPAIR_RUN };
    if (
      current.version !== 1 ||
      !["pending", "failed", "complete"].includes(current.state) ||
      current.digest !== await incidentRepairDigest()
    )
      throw rejected();
    return {
      state: current.state as string,
      runId: INCIDENT_REPAIR_RUN,
      digest: current.digest as string,
    };
  }
  proposeIncident(): Promise<IncidentRepairResult> {
    return runIncidentRepair(
      this.store(),
      () => readIncident(this.env),
      (evidence) => {
        const verifier = (
          this.ctx.exports as unknown as {
            RepairVerifier: (options: {}) => Service<RepairVerifier>;
          }
        ).RepairVerifier({});
        return proposeRepair(
          { appId: this.env.GITHUB_APP_ID, privateKey: this.env.GITHUB_PRIVATE_KEY },
          {
            runId: INCIDENT_REPAIR_RUN,
            baseCommit: OWNED_BASE,
            proposedText: evidence.text,
          },
          async (input) => {
            const result = await verifier.verify(input.commit, INCIDENT_REPAIR_RUN);
            return {
              commit: result.commit,
              sourceDigest: result.sourceDigest,
              passed: result.passed,
              evidenceId: result.evidenceId,
            };
          },
        );
      },
    );
  }
  fetch() {
    return new Response("Not found", { status: 404 });
  }
}
/** Binding-only capability; callers cannot choose repo, patch, run, verifier or command. */
export class IncidentRepairWriter extends WorkerEntrypoint<Environment> {
  private operation() {
    return (
      this.ctx.exports as unknown as {
        OwnedIncidentRepairOperations: DurableObjectNamespace<OwnedIncidentRepairOperations>;
      }
    ).OwnedIncidentRepairOperations.getByName(owner);
  }
  async inspectIncident(): Promise<OperationInspection> {
    const result = await this.operation().inspectIncident();
    return {
      state: result.state,
      runId: result.runId,
      ...(result.digest ? { digest: result.digest } : {}),
    };
  }
  async proposeIncident(): Promise<IncidentRepairResult> {
    return plain(await this.operation().proposeIncident());
  }
  fetch() {
    return new Response("Not found", { status: 404 });
  }
}
function plain(result: IncidentRepairResult): IncidentRepairResult {
  return {
    repository: result.repository,
    commit: result.commit,
    sourceDigest: result.sourceDigest,
    evidenceId: result.evidenceId,
    pullRequest: result.pullRequest,
    url: result.url,
    created: result.created,
    deploymentPerformed: false,
    replay: result.replay,
    modelInstance: result.modelInstance,
    modelReservationId: result.modelReservationId,
    issueId: result.issueId,
    operationId: result.operationId,
    activationPolicy: result.activationPolicy,
    eventActivation: result.eventActivation,
    automaticWebhookActivation: false,
  };
}
/** Authenticated operator continuation of one real admitted Issue, NOT automatic webhook activation. */
export class OwnedIncidentRepairWorkflow extends WorkflowEntrypoint<
  Environment,
  { mode: "inspect" | "inspect-evidence" | "propose-incident" }
> {
  async run(
    event: Readonly<WorkflowEvent<{ mode: "inspect" | "inspect-evidence" | "propose-incident" }>>,
    step: WorkflowStep,
  ) {
    if (
      !event.payload ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(event.payload)) ||
      Reflect.ownKeys(event.payload).length !== 1 ||
      !("value" in (Object.getOwnPropertyDescriptor(event.payload, "mode") ?? {})) ||
      !["inspect", "inspect-evidence", "propose-incident"].includes(event.payload.mode)
    )
      throw rejected();
    const writer = (
      this.ctx.exports as unknown as { IncidentRepairWriter: (options: {}) => Service<IncidentRepairWriter> }
    ).IncidentRepairWriter({});
    const options = { retries: { limit: 0, delay: "1 second" }, timeout: "10 minutes" } as const;
    if (event.payload.mode === "inspect-evidence")
      return step.do("repair:inspect-incident-native-evidence", options, async () =>
        readIncident(this.env),
      );
    if (event.payload.mode === "inspect")
      return step.do("repair:inspect-incident-operation", options, async () => {
        const value = await writer.inspectIncident();
        return {
          state: value.state,
          runId: value.runId,
          ...(value.digest ? { digest: value.digest } : {}),
        };
      });
    return step.do("repair:propose-incident-native-flue", options, async () =>
      plain(await writer.proposeIncident()),
    );
  }
}

/** Trusted service capability; copy RPC wrappers to explicit bounded plain data. */
async function readIncident(env: Environment): Promise<IncidentProposalEvidence> {
  const r = await env.INCIDENT_EVIDENCE.readIncident();
  return assertIncidentRepairEvidence({ instance: r.instance, reservationId: r.reservationId,
    run: r.run, text: r.text, issueId: r.issueId, operationId: r.operationId,
    activationPolicy: r.activationPolicy });
}
