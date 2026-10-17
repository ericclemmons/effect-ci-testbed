import type * as CI from "@effect-ci-testbed/ci";
import type { Runner } from "@effect-ci-testbed/cloudflare";
import { hostedCheckCache } from "@effect-ci-testbed/cloudflare/check-cache";
import {
  syntaxCommand,
  syntaxIdentity,
  syntaxInspectCommand,
  syntaxKeyId,
  syntaxPolicyDigest,
  syntaxPublicKey,
  syntaxRepository,
  syntaxWorkflow,
} from "@effect-ci-testbed/cloudflare/node-syntax-check";
import * as Effect from "effect/Effect";
import {
  testCommand,
  testIdentity,
  testInspectCommand,
  testNotesRef,
  testPolicyDigest,
} from "@effect-ci-testbed/cloudflare/demo-test-check";

// Approved demo-only enrollment. The private key never enters this application.

export const demoCheckCache = (
  runner: Runner,
  readEvidence: (operation: (request: typeof fetch) => Promise<boolean>) => Promise<boolean> = (
    operation,
  ) => operation(fetch),
): CI.CheckCache => ({
  lookup: (request) =>
    Effect.promise(async () => {
      const transport: Array<{ status: number; endpoint: string }> = [];
      let missReason: string | undefined;
      let evidenceFetch: typeof fetch = fetch;
      const suite = request.stepId === "test" && request.command === testCommand;
      if (
        request.workflowId !== syntaxWorkflow ||
        (!suite && (request.stepId !== "syntax" || request.command !== syntaxCommand)) ||
        request.workspace.kind !== "remote" ||
        request.workspace.cwd !== "/workspace/repository/examples/demo"
      )
        return false;
      // Inspect in its own native command checkpoint, before the evidence step.
      // A command checkpoint must never be nested inside another Workflow step.
      let identity;
      try {
        const result = await Effect.runPromise(
          runner.executor.execute({
            workflowId: request.workflowId,
            stepId: request.stepId,
            commandIndex: 0,
            command: suite ? testInspectCommand : syntaxInspectCommand,
            workspace: request.workspace,
            options: {},
            onOutput: () => {},
          }),
        );
        identity = await (suite ? testIdentity : syntaxIdentity)(
          request.event.revision!,
          result.stdout,
        );
      } catch {
        return false;
      }
      const key = await crypto.subtle.importKey("jwk", syntaxPublicKey, "Ed25519", false, [
        "verify",
      ]);
      const cache = hostedCheckCache({
        onMiss: (reason) => {
          missReason = reason;
        },
        reader: {
          repository: "ericclemmons/effect-ci-testbed",
          ...(suite ? { notesRef: testNotesRef } : {}),
          // Public, fixed GET endpoints only. Rate limits are misses, never bypass.
          request: async (url, init) => {
            transport.push({ status: 0, endpoint: "request-start" });
            const response = await evidenceFetch(url, {
              ...init,
              headers: {
                ...Object.fromEntries(new Headers(init.headers)),
                "user-agent": "effect-ci-demo-check-evidence",
              },
            });
            transport.push({
              status: response.status,
              endpoint: new URL(url).pathname.split("/").at(-2) ?? "unknown",
            });
            return response;
          },
        },
        enrollments: [
          {
            keyId: syntaxKeyId,
            publicKey: key,
            repository: syntaxRepository,
            checks: [
              {
                workflowId: syntaxWorkflow,
                stepId: suite ? "test" : "syntax",
                command: suite ? testCommand : syntaxCommand,
                policyDigest: await (suite ? testPolicyDigest : syntaxPolicyDigest)(),
              },
            ],
          },
        ],
        identify: async () => identity,
      });
      // Network reads, their deadline, and cryptographic verification run in one
      // durable step. Persist the verdict so a resumed instance never changes its
      // branch after a mutable notes ref moves. No source text or credentials.
      const observation = runner.actionExecutor.execute({
        stepId: `${request.stepId}:evidence-observation`,
        options: { retries: { limit: 0, delay: 0, backoff: "constant" } },
        run: () =>
          Effect.promise(async () => {
            let verified = false;
            try {
              verified = await readEvidence(async (transport) => {
                evidenceFetch = transport;
                return Effect.runPromise(cache.lookup(request));
              });
            } catch {
              missReason = "credential-unavailable";
            }
            return {
              value: {
                verified,
                identified: true,
                missReason: missReason ?? null,
                transport,
              },
              commands: [],
            };
          }),
      });
      // This runner callback is closed over plain data, with no service requirements.
      const result = await Effect.runPromise(
        observation as Effect.Effect<CI.ActionExecutionResult, unknown>,
      );
      return (result.value as { verified: boolean }).verified === true;
    }),
  record: () => Effect.void,
});
