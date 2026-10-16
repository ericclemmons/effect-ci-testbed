import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import * as Dynamic from "@effect-ci-testbed/cloudflare-dynamic-worker/tests";
import * as Effect from "effect/Effect";
import { assertionMode, assertionFixture } from "./vitest-fixture.ts";

const once = { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" } as const;
export class AssertionWorkflow extends WorkflowEntrypoint<{ LOADER: WorkerLoader }, unknown> {
  async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep) {
    let mode;
    try { mode = assertionMode(event.payload); }
    catch { throw new NonRetryableError("Exact owned assertion fixture mode required"); }
    const report = await step.do("isolated:vitest-subset", once, async () => {
      const r = await Effect.runPromise(Dynamic.makeProjectTests(this.env.LOADER).run(assertionFixture(mode)));
      return { runtime: r.runtime, tool: r.tool, containers: r.containers,
        toolModuleCount: r.toolModuleCount, toolBytes: r.toolBytes, tests: r.tests.map(t => ({ ...t })) };
    });
    await step.do("fixture:verify-report", once, async () => {
      if (report.runtime !== "dynamic-worker" || report.tool !== "vitest-expect-5.0.3-subset" || report.containers !== 0 ||
          report.tests.length !== (mode === "state-isolation" ? 2 : 1)) throw new NonRetryableError("Invalid assertion fixture result");
      if (mode === "passing" && (!report.tests[0]?.passed || report.tests[0]?.assertions !== 3))
        throw new NonRetryableError("Positive assertion fixture failed");
      if (mode === "state-isolation" && !report.tests.every(t => t.passed && t.assertions === 1))
        throw new NonRetryableError("Fresh assertion isolation failed");
      if (mode === "assertion-failure" && (report.tests[0]?.passed || report.tests[0]?.failure !== "assertion" || report.tests[0]?.assertions !== 1))
        throw new NonRetryableError("Genuine assertion failure required");
      if (["cpu-loop", "forbidden-import", "host-filesystem"].includes(mode) &&
          (report.tests[0]?.passed || report.tests[0]?.failure !== "execution" || report.tests[0]?.assertions !== 0))
        throw new NonRetryableError("Execution boundary must reject");
      return { mode, validated: true };
    });
    // Retain the redacted report first; failing tests must not make a green CI run.
    if (report.tests.some(t => !t.passed)) throw new NonRetryableError("Owned isolated project test failed");
    return { mode, report, containers: 0 };
  }
}
