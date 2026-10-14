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
  runRecordedRepair,
  NATIVE_REPAIR_RUN,
  type OperationStore,
  type PilotResult,
} from "../../../packages/github/src/repair-operation.ts";
import {
  assertRecordedProposal,
  type RecordedProposal,
} from "../../../packages/github/src/recorded-proposal.ts";
import type { RepairVerifier } from "./repair-verifier.ts";
interface Environment {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  REPAIR_EVIDENCE: { readRecorded(): Promise<RecordedProposal> };
}
const operationKey = "recorded-native-repair-v1";
const owner = "retained-flue-repair-v1";
const rejected = () => new Error("Owned native writer state rejected; inspect before recovery");
interface OperationInspection {
  state: string;
  runId: string;
  digest?: string;
}
export class OwnedRepairOperations extends DurableObject<Environment> {
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
  async inspectRecorded(): Promise<OperationInspection> {
    const current: any = await this.ctx.storage.get(operationKey);
    if (current === undefined) return { state: "absent", runId: NATIVE_REPAIR_RUN };
    if (
      current.version !== 1 ||
      !["pending", "failed", "complete"].includes(current.state) ||
      !/^[a-f0-9]{64}$/.test(current.digest)
    )
      throw rejected();
    return {
      state: current.state as string,
      runId: NATIVE_REPAIR_RUN,
      digest: current.digest as string,
    };
  }
  proposeRecorded(): Promise<PilotResult> {
    return runRecordedRepair(
      this.store(),
      () => this.env.REPAIR_EVIDENCE.readRecorded(),
      (evidence) => {
        const verifier = (
          this.ctx.exports as unknown as {
            RepairVerifier: (options: {}) => Service<RepairVerifier>;
          }
        ).RepairVerifier({});
        return proposeRepair(
          { appId: this.env.GITHUB_APP_ID, privateKey: this.env.GITHUB_PRIVATE_KEY },
          {
            runId: NATIVE_REPAIR_RUN,
            baseCommit: OWNED_BASE,
            proposedText: evidence.text,
          },
          async (input) => {
            const result = await verifier.verify(input.commit, NATIVE_REPAIR_RUN);
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
export class RepairWriter extends WorkerEntrypoint<Environment> {
  private operation() {
    return (
      this.ctx.exports as unknown as {
        OwnedRepairOperations: DurableObjectNamespace<OwnedRepairOperations>;
      }
    ).OwnedRepairOperations.getByName(owner);
  }
  async inspectRecorded(): Promise<OperationInspection> {
    const result = await this.operation().inspectRecorded();
    return {
      state: result.state,
      runId: result.runId,
      ...(result.digest ? { digest: result.digest } : {}),
    };
  }
  async proposeRecorded(): Promise<PilotResult> {
    return plain(await this.operation().proposeRecorded());
  }
  fetch() {
    return new Response("Not found", { status: 404 });
  }
}
function plain(result: PilotResult): PilotResult {
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
    workersIssuesVerified: false,
  };
}
/** Native administrative composition of retained REAL evidence, not an Issues trigger. */
export class OwnedRepairProposalWorkflow extends WorkflowEntrypoint<
  Environment,
  { mode: "inspect" | "inspect-evidence" | "propose-retained" }
> {
  async run(
    event: Readonly<WorkflowEvent<{ mode: "inspect" | "inspect-evidence" | "propose-retained" }>>,
    step: WorkflowStep,
  ) {
    if (
      !event.payload ||
      Object.keys(event.payload).length !== 1 ||
      !["inspect", "inspect-evidence", "propose-retained"].includes(event.payload.mode)
    )
      throw rejected();
    const writer = (
      this.ctx.exports as unknown as { RepairWriter: (options: {}) => Service<RepairWriter> }
    ).RepairWriter({});
    const options = { retries: { limit: 0, delay: "1 second" }, timeout: "10 minutes" } as const;
    if (event.payload.mode === "inspect-evidence")
      return step.do("repair:inspect-recorded-native-evidence", options, async () =>
        assertRecordedProposal(await this.env.REPAIR_EVIDENCE.readRecorded()),
      );
    if (event.payload.mode === "inspect")
      return step.do("repair:inspect-retained-operation", options, async () => {
        const value = await writer.inspectRecorded();
        return {
          state: value.state,
          runId: value.runId,
          ...(value.digest ? { digest: value.digest } : {}),
        };
      });
    return step.do("repair:propose-retained-native-flue", options, async () =>
      plain(await writer.proposeRecorded()),
    );
  }
}
