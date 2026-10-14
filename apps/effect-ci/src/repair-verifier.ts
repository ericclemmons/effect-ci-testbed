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
      const options = { image: "workspace", instance: "standard-1" } as const;
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
  { mode: "verify-retained" }
> {
  async run(event: Readonly<WorkflowEvent<{ mode: "verify-retained" }>>, step: WorkflowStep) {
    if (
      !event.payload ||
      Object.keys(event.payload).length !== 1 ||
      event.payload.mode !== "verify-retained"
    )
      throw new Error("Owned verification mode required");
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
