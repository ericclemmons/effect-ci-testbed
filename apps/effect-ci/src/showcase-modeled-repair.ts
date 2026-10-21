import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { HostFailure } from "@effect-ci-testbed/github-cloudflare";
import { prepareExecutionClaim } from "@effect-ci-testbed/cloudflare/execution-receipt";
import { showcaseInspectCommand, showcaseTestCommand } from "./showcase-check-policy.ts";
import { showcaseAuthorityName, showcaseRoot } from "./showcase-runner-policy.ts";
import { ShowcaseDigest, ShowcaseRevision } from "./showcase-protocol.ts";
import { showcaseExecutionContext, showcaseExecutionIdentity, showcaseExecutionVersion, type ShowcaseExecutionAuthority } from "./showcase-execution.ts";

const path = "packages/greeting/message.ts";
const before = Schema.Literals(['export const greeting = "";', 'export const greeting = "";\n']);
const after = Schema.Literal('export const greeting = "Hello from a shared package.";\n');
const command = "env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp /usr/local/bin/node /opt/effect-ci-showcase/modeled-repair.cjs";
const once = { retries: { limit: 0, delay: "1 second" } } as const;
const Summary = Schema.Struct({ mode: Schema.Literal("modeled-off"), originalCi: Schema.Literal("failed"),
  sourceRevision: ShowcaseRevision, path: Schema.Literal(path), beforeDigest: ShowcaseDigest, afterDigest: ShowcaseDigest,
  verification: Schema.Literal("independent-lint-and-direct-vitest"),
  modelCalled: Schema.Literal(false), pullRequestCreated: Schema.Literal(false), deploymentPerformed: Schema.Literal(false),
});
const digest = (text: string) => Effect.tryPromise({ try: async () => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join(""), catch: () => Error("Modeled candidate digest unavailable") });
const decodeSource = <S extends Schema.Top>(schema: S, input: unknown) => Schema.decodeUnknownEffect(schema)(input).pipe(
  Effect.mapError(() => Error("Modeled candidate source is not enrolled")),
);

/** A distinct verification purpose, never recovery of primary CI. Unknown
 * process outcomes, other failures and arbitrary repair inputs do nothing.
 */
export async function followUpShowcaseFailure(context: HostFailure): Promise<void> {
  const error = context.error;
  if (!(error instanceof CI.CommandError) || error.stepId !== "test" || error.command !== showcaseTestCommand ||
    error.exitCode === 0 || !Number.isSafeInteger(error.exitCode)) return;
  const prepared = context.attempt.outputs.install;
  if (!(prepared instanceof CI.Workspace) || prepared.kind !== "remote" || prepared.id !== context.instanceId ||
    prepared.cwd !== showcaseRoot || prepared.revision?.provider !== "cloudflare-container") return;

  const proposal = CI.action("repair proposal", () => () => Effect.gen(function* () {
    yield* decodeSource(before, yield* prepared.readFile(path));
    yield* prepared.exec(showcaseInspectCommand);
    return yield* prepared.exec(command);
  }), once);
  const verification = CI.action("verify repair", function* () {
    const candidate = yield* proposal();
    return function* () {
      yield* candidate.exec(showcaseInspectCommand);
      yield* candidate.exec(command + " --verify");
      yield* candidate.exec("pnpm lint");
      yield* candidate.exec(showcaseTestCommand);
      yield* candidate.exec(command + " --verify");
      return yield* candidate.exec(showcaseInspectCommand);
    };
  }, once);
  const modeled = CI.action<typeof Summary.Encoded>("modeled PR proposal", function* () {
    const candidate = yield* verification();
    return function* () {
      const original = yield* decodeSource(before, yield* prepared.readFile(path));
      const fixed = yield* decodeSource(after, yield* candidate.readFile(path));
      const value = { mode: "modeled-off", originalCi: "failed", sourceRevision: context.parameters.revision, path,
        beforeDigest: yield* digest(original), afterDigest: yield* digest(fixed), verification: "independent-lint-and-direct-vitest",
        modelCalled: false, pullRequestCreated: false, deploymentPerformed: false };
      return Schema.encodeSync(Summary)(yield* Schema.decodeUnknownEffect(Summary)(value));
    };
  }, once);
  let presentation = 0;
  await CI.runPromise(CI.workflow("demo-repair", () => modeled()), {
    output: "silent", ci: true, env: "cloudflare", executor: context.runner.executor,
    actionExecutor: context.runner.actionExecutor, workspaceFileSystem: context.runner.fileSystem,
    workspacePersistence: context.runner.persistence,
    onAttempt: async attempt => {
      const subject = showcaseExecutionContext(context.parameters, "modeled-repair");
      const identity = await showcaseExecutionIdentity(subject, showcaseExecutionVersion(context.environment));
      const claim = await prepareExecutionClaim({ identity, instanceId: `${context.instanceId}:modeled-repair`, attempt });
      const authority = (context.exports as { TrustedDemoChecks: { getByName(name: string): ShowcaseExecutionAuthority } }).TrustedDemoChecks;
      await context.step.do("showcase:modeled-repair-observation", { ...once, timeout: "1 minute" },
        () => authority.getByName(showcaseAuthorityName).recordExecution(subject, claim));
    },
    onEvent: async event => {
      await context.report(event);
      // Keep primary CI red; the follow-up cannot reset its workflow phase.
      if (event.type === "workflow.started" || event.type === "workflow.completed") return;
      if (context.card.update({ ...event, workflowId: "demo" }))
        await context.observe?.(`modeled-repair:event-${presentation++}`);
    },
  });
  const text = "Model OFF. The blank greeting candidate passed independent lint and direct Vitest in a separate workspace. PR not created; original CI remains failed. Nothing merged or deployed.";
  await context.observe?.("modeled-repair:proposal", { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }, "Modeled repair");
}
