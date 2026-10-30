import * as CI from "@effect-ci-testbed/ci";

export const standaloneContainerOptions = {
  image: "workspace",
  instance: "standard-1",
  loginShell: false,
  readyCommand: "/usr/local/bin/node -e 'if(process.getuid()!==1000)process.exit(1)'",
} as const;

/** Host chooses checkout/root; authored workflow discovery and execution happen
 * only in the unprivileged workspace through the same CLI used locally. */
export function standaloneProgram(root: string, targets: ReadonlyArray<string> = []) {
  // Validate even for direct workflow-binding callers, before touching a workspace.
  if (targets.length > 16 || new Set(targets).size !== targets.length ||
      targets.some(target => !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,63}$/.test(target))) {
    throw new Error("Invalid project goals");
  }
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
  const run = CI.action("project workflow", () => function* () {
    const workspace = yield* install();
    // Explicit local execution cannot recurse into the host's remote endpoint.
    return yield* workspace.exec(["node /opt/effect-ci/src/hosted.ts run", ...targets,
      "--local --format=text"].join(" "));
  });
  return {
    workflow: CI.workflow("hosted-ci", () => run()),
  };
}
