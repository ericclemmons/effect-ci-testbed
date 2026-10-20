import * as CI from "@effect-ci-testbed/ci";
import type * as Effect from "effect/Effect";

/** The trusted host supplies actions; incoming PR code gets no approval capability. */
export function pullRequestWorkflow<A, R>(approve: () => Effect.Effect<A, unknown, R>, review: () => Effect.Effect<A, unknown, R>) {
  return CI.workflow("org-pull-request", function* () {
    const source = yield* CI.Source;
    if (!(yield* source.changed("**/*.(ts|tsx|json)"))) return yield* approve();
    return yield* review();
  });
}

// CLI inspection is safe; execution requires the host's scoped capabilities.
const unavailable = (name: string) => CI.action<void>(name, () => function* () {
  if ((yield* CI.executionMode) !== "plan") throw Error("Org PR policy requires its trusted host capabilities");
});
export const approve = unavailable("approve PR");
export const review = unavailable("normal review");
export default pullRequestWorkflow(approve, review);
