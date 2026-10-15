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

// Approved demo-only enrollment. The private key never enters this application.

export const demoCheckCache = (runner: Runner): CI.CheckCache => ({
  lookup: (request) =>
    Effect.promise(async () => {
      const transport: Array<{ status: number; endpoint: string }> = [];
      let identified = false;
      const key = await crypto.subtle.importKey("jwk", syntaxPublicKey, "Ed25519", false, [
        "verify",
      ]);
      const cache = hostedCheckCache({
        reader: {
          repository: "ericclemmons/effect-ci-testbed",
          // Public, fixed GET endpoints only. Rate limits are misses, never bypass.
          request: async (url, init) => {
            const response = await fetch(url, {
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
                stepId: "syntax",
                command: syntaxCommand,
                policyDigest: await syntaxPolicyDigest(),
              },
            ],
          },
        ],
        identify: async (input) => {
          if (
            input.workflowId !== syntaxWorkflow ||
            input.stepId !== "syntax" ||
            input.command !== syntaxCommand ||
            input.workspace.kind !== "remote" ||
            input.workspace.cwd !== "/workspace/repository/examples/demo"
          )
            return undefined;
          const result = await Effect.runPromise(
            runner.executor.execute({
              workflowId: input.workflowId,
              stepId: input.stepId,
              commandIndex: 0,
              command: syntaxInspectCommand,
              workspace: input.workspace,
              options: {},
              onOutput: () => {},
            }),
          );
          const identity = await syntaxIdentity(input.event.revision!, result.stdout);
          identified = true;
          return identity;
        },
      });
      const verified = await Effect.runPromise(cache.lookup(request));
      // Bounded host-owned observation only, never source text or credentials.
      // This receipt cannot grant reuse; the verifier result above remains authority.
      const observation = runner.actionExecutor.execute({
        stepId: "syntax:evidence-observation",
        options: { retries: { limit: 0, delay: 0, backoff: "constant" } },
        run: () => Effect.succeed({ value: { verified, identified, transport }, commands: [] }),
      });
      // This runner callback is closed over plain data, with no service requirements.
      await Effect.runPromise(observation as Effect.Effect<CI.ActionExecutionResult, unknown>);
      return verified;
    }),
  record: () => Effect.void,
});
