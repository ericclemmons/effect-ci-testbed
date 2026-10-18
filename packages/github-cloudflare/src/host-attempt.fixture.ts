import * as CI from "@effect-ci-testbed/ci";

/** Typechecked host program used by the local native adapter tests. */
export function hostAttemptProgram(fail = false, workspace = false, onBody = () => {}) {
  const prepare = CI.action<{ prepared: boolean }>(
    "prepare",
    () =>
      function* () {
        onBody();
        return { prepared: true };
      },
  );
  const test = CI.check("test", function* () {
    yield* prepare();
    return function* () {
      onBody();
    };
  });
  const build = CI.action<CI.Workspace | string>("build", function* () {
    yield* test();
    return function* () {
      onBody();
      if (fail) throw Error("Fixture build failure");
      return workspace
        ? CI.Workspace.remote("workspacescenario", "/workspace/repository")
        : "artifact-handle";
    };
  });
  return CI.workflow("attempt-fixture", () => build());
}
