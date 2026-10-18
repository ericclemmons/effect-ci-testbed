import * as CI from "@effect-ci-testbed/ci";
import { DurableObject } from "cloudflare:workers";
import { workflowEntrypoint, type WorkflowEnvironment } from "./index.ts";
import { executionCommitName, executionJournal } from "./execution-journal.ts";
import { signExecutionReceipt, type ExecutionIdentity } from "./execution-receipt.ts";
import { hostAttemptProgram } from "../../github-cloudflare/src/host-attempt.fixture.ts";

/** Typechecked test host. All identities/keys are fixtures, not input closure. */
interface FixtureEnvironment extends WorkflowEnvironment {
  readonly PUBLIC_KEYS: string;
  readonly PRIVATE_KEY: string;
}
export const fixtureIdentity: ExecutionIdentity = {
  issuer: "https://ci.acme.example", repository: "https://github.com/acme/project.git", revision: "a".repeat(40),
  workflowId: "attempt-fixture", policyDigest: "b".repeat(64), runtimeDigest: "c".repeat(64), inputsDigest: "d".repeat(64), eventDigest: "e".repeat(64),
};
export class Journal extends executionJournal<FixtureEnvironment>({
  keys: async environment => new Map(await Promise.all(
    Object.entries(JSON.parse(environment.PUBLIC_KEYS) as Record<string, JsonWebKey>).map(async ([id, key]) =>
      [id, await crypto.subtle.importKey("jwk", key, "Ed25519", false, ["verify"])] as const),
  )),
}) {}
export class WorkspaceContainer extends DurableObject {}
export const getFixtureJournal = async (exports: unknown) => {
  const namespace = (exports as { Journal: DurableObjectNamespace<Journal> }).Journal;
  return namespace.getByName(await executionCommitName(fixtureIdentity));
};
let bodies = 0;
export const fixtureBodies = () => bodies;
export const Native = workflowEntrypoint<CI.Workspace | string, FixtureEnvironment>(
  hostAttemptProgram(false, false, () => { bodies++; }),
  {
    cache: false,
    onAttempt: async (attempt, context) => {
      if (context.parameters.repository !== fixtureIdentity.repository || context.parameters.revision !== fixtureIdentity.revision)
        throw Error("Unenrolled fixture source");
      const key = await crypto.subtle.importKey("jwk", JSON.parse(context.environment.PRIVATE_KEY), "Ed25519", false, ["sign"]);
      const receipt = await signExecutionReceipt({ keyId: "acme", key, identity: fixtureIdentity, instanceId: context.instanceId, attempt });
      await (await getFixtureJournal(context.exports)).record(fixtureIdentity, JSON.stringify(receipt));
    },
  },
);
