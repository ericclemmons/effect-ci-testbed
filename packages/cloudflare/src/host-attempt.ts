import type * as CI from "@effect-ci-testbed/ci";
import type { WorkflowStep } from "cloudflare:workers";

export interface HostAttemptContext<Environment, Parameters> {
  readonly environment: Environment;
  readonly exports: unknown;
  readonly instanceId: string;
  readonly parameters: Parameters;
}

/** Trusted deployment-time observer, not a callback loaded from project code. */
export type HostAttemptHandler<Environment, Parameters> = (
  attempt: CI.WorkflowAttempt,
  context: HostAttemptContext<Environment, Parameters>,
) => void | Promise<void>;

/** Stable native identity, never the kernel's replay-local attempt UUID. The
 * handler must journal uncertain writes rather than inventing another identity. */
export const makeHostAttemptHandler =
  <Environment, Parameters>(
    step: WorkflowStep,
    record: HostAttemptHandler<Environment, Parameters>,
    context: HostAttemptContext<Environment, Parameters>,
  ): CI.WorkflowAttemptHandler =>
  async (attempt) => {
    if (attempt.plan.mode !== "execute") return;
    if (!Number.isSafeInteger(attempt.number) || attempt.number < 1)
      throw new Error("Invalid host attempt number");
    await step.do(
      `host-attempt:${attempt.number}`,
      {
        retries: { limit: 0, delay: "1 second" },
        timeout: "1 minute",
      },
      async () => {
        try {
          await record(attempt, context);
        } catch {
          throw new Error("Host attempt recording failed");
        }
      },
    );
  };
