import * as CI from "@effect-ci-testbed/ci"
import * as Cloudflare from "@effect-ci-testbed/cloudflare"
import * as Redacted from "effect/Redacted"
import workflow from "../../../examples/secure-secrets/.cloudflare/ci/workflow.ts"
import { demoSecretResolver } from "./demo-secret-resolver.ts"

type Environment = Cloudflare.WorkflowEnvironment & { readonly CI_DEMO_SECRET?: string }
const missing = CI.action<Redacted.Redacted<string>>("require unknown secret", () => () => CI.Secret("UNKNOWN"))
const missingWorkflow = CI.workflow("missing-secret", () => missing())

// The supplied value stays in trusted Worker memory. Neither variant starts a container.
export const SecureSecretsWorkflow = Cloudflare.workflowEntrypoint<Redacted.Redacted<string>, Environment>(
  parameters => Promise.resolve(parameters.event?.payload && typeof parameters.event.payload === "object" &&
    "scenario" in parameters.event.payload && parameters.event.payload.scenario === "missing" ? missingWorkflow : workflow),
  { secrets: environment => demoSecretResolver(environment.CI_DEMO_SECRET) },
)
