import * as CI from "@effect-ci-testbed/ci";

export const standaloneContainerOptions = {
  image: "workspace",
  instance: "standard-1",
  loginShell: false,
  readyCommand: "/usr/local/bin/node -e 'if(process.getuid()!==1000)process.exit(1)'",
} as const;

/** Host-authored example policy, not uploaded project code. Customize the
 * default goals here; package scripts still run inside the checked-out workspace. */
export function standaloneProgram(root: string, goals: ReadonlyArray<string> = ["build"]) {
  if (
    !goals.length ||
    goals.some((goal) => goal !== "test" && goal !== "build") ||
    new Set(goals).size !== goals.length
  )
    throw Error("Standalone goals are test and build");
  const checkout = CI.action(
    "checkout",
    () =>
      function* () {
        const source = yield* CI.Source;
        const workspace = yield* source.checkout();
        return root === "." ? workspace : workspace.directory(root);
      },
  );
  const install = CI.action(
    "install",
    () =>
      function* () {
        const workspace = yield* checkout();
        const pm = yield* CI.PackageManager.JavaScript(workspace);
        return yield* pm.install();
      },
  );
  const script = (name: string) =>
    CI.action(
      name,
      () =>
        function* () {
          const workspace = yield* install();
          const pm = yield* CI.PackageManager.JavaScript(workspace);
          return yield* pm.run(name);
        },
    );
  const actions = { test: script("test"), build: script("build") };
  return {
    ...actions,
    workflow: CI.workflow("hosted-ci", () =>
      CI.parallel(goals.map((goal) => actions[goal as keyof typeof actions]())),
    ),
  };
}
