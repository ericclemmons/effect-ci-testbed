import {
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  verifyOwnedRepair,
  type ExecuteOwnedNode,
} from "../../../packages/github/src/repair-verifier.ts";
import type { WorkspaceContainer } from "../../../packages/cloudflare/src/index.ts";
import type { PublicIncidentRepairOperations } from "./public-incident-repair.ts";
import type { PrivateSlackCards } from "./private-cards.ts";

interface Environment {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
}
/** Private service capability only; no public fetch route or credential forwarding. */
export class RepairVerifier extends WorkerEntrypoint<Environment> {
  async verify(commit: string, runId: string) {
    const namespace = (
      this.ctx.exports as unknown as {
        WorkspaceContainer: DurableObjectNamespace<WorkspaceContainer>;
      }
    ).WorkspaceContainer;
    const execute: ExecuteOwnedNode = async (files, command) => {
      // Commit/run pinning happens before this callback. No repo checkout, token,
      // inherited application secrets, install scripts or model-produced command.
      const container = namespace.getByName(`owned-native-verifier:${commit}`);
      const options = { image: "workspace" } as const;
      await container.materializeSource(files, options);
      return container.execute(
        command,
        "/workspace/repository",
        "owned-repair-node",
        undefined,
        [],
        undefined,
        options,
      );
    };
    return verifyOwnedRepair(
      { appId: this.env.GITHUB_APP_ID, privateKey: this.env.GITHUB_PRIVATE_KEY },
      commit,
      runId,
      execute,
    );
  }
  fetch() {
    return new Response("Not found", { status: 404 });
  }
}

/** Authenticated native API pilot: retained existing owned fix, never code writes. */
export class OwnedRepairVerificationWorkflow extends WorkflowEntrypoint<
  Environment,
  { mode: "verify-retained" | "reconcile-public-pr" }
> {
  async run(event: Readonly<WorkflowEvent<{ mode: "verify-retained" | "reconcile-public-pr" }>>, step: WorkflowStep) {
    if (
      !event.payload ||
      Object.keys(event.payload).length !== 1 ||
      !["verify-retained", "reconcile-public-pr"].includes(event.payload.mode)
    )
      throw new Error("Owned verification mode required");
    if (event.payload.mode === "reconcile-public-pr") {
      const host = this.ctx.exports as unknown as {
        PublicIncidentRepairOperations: DurableObjectNamespace<PublicIncidentRepairOperations>;
        PrivateSlackCards: DurableObjectNamespace<PrivateSlackCards>;
      };
      const options = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;
      const receipt = await step.do("public:reconcile-existing-verified-pr", options, async () => {
        const r = await host.PublicIncidentRepairOperations.getByName("owned-public-http-repair-v1").reconcileExistingPublicPR();
        return { version: r.version, instance: r.instance, originalState: r.originalState, originalDigest: r.originalDigest,
          repository: r.repository, commit: r.commit, sourceDigest: r.sourceDigest, evidenceId: r.evidenceId,
          pullRequest: r.pullRequest, url: r.url, created: r.created, deploymentPerformed: r.deploymentPerformed,
          reconciliationOnly: r.reconciliationOnly, originalWorkflowStatus: r.originalWorkflowStatus };
      });
      const slack = await step.do("public:update-existing-card-after-reconciliation", options, async () => {
        const text = `Proposed repair: <${receipt.url}|PR #${receipt.pullRequest}>. Exact-commit native Node verification passed (${receipt.evidenceId}). *Not merged or deployed.*\nOperator reconciliation confirmed this existing PR after a renamed-bot acknowledgement error. The original automatic Workflow remains errored; no model, Node command, code write or PR creation was repeated.`;
        const r = await host.PrivateSlackCards.getByName(receipt.instance).publishExisting(receipt.instance, 4,
          { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] });
        if (!r.ok) throw new Error("Existing public card unavailable; retain reconciliation receipt");
        return { ts: r.ts };
      });
      return { ...receipt, slackTs: slack.ts, newInferenceCalled: false, commandExecuted: false,
        codeWritten: false, pullRequestCreated: false, deploymentPerformed: false };
    }
    const verifier = (
      this.ctx.exports as unknown as { RepairVerifier: (options: {}) => Service<RepairVerifier> }
    ).RepairVerifier({});
    const result = await step.do(
      "repair:verify-retained-exact-commit",
      { retries: { limit: 0, delay: "1 second" }, timeout: "5 minutes" },
      async () => {
        const original = await verifier.verify(
          "bd9682e5b9ca5f8f696ea8052bd5afd4cd2c0a00",
          "friday-repair-20261013-1",
        );
        return {
          commit: original.commit,
          sourceDigest: original.sourceDigest,
          passed: original.passed,
          evidenceId: original.evidenceId,
        };
      },
    );
    return {
      ...result,
      environment: "native-node-container",
      commandExecuted: true,
      codeWritten: false,
      pullRequestCreated: false,
      deploymentPerformed: false,
    };
  }
}
