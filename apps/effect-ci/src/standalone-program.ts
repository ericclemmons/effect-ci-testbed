import * as CI from "@effect-ci-testbed/ci";

export const standaloneContainerOptions = {
  image: "workspace",
  loginShell: false,
  readyCommand: "/usr/local/bin/node -e 'if(process.getuid()!==1000)process.exit(1)'",
} as const;

/** Host chooses checkout/root; authored workflow discovery and execution happen
 * only in the unprivileged workspace through the same CLI used locally. */
export function standaloneProgram(root: string, targets: ReadonlyArray<string> = [], workflow?: string, verbose?: 1 | 2, force?: true) {
  const relativePath = (value: string) => value.length <= 1024 && /^[a-zA-Z0-9_@./-]+$/.test(value) &&
    value.split("/").every(part => part !== "" && part !== "." && part !== "..");
  if ((root !== "." && !relativePath(root)) || (workflow !== undefined && workflow !== "." && !relativePath(workflow))) {
    throw new Error("Invalid project path");
  }
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
        return workspace;
      },
  );
  const install = CI.action(
    "install",
    () =>
      function* () {
        const repository = yield* checkout();
        const workspace = root === "." ? repository : repository.directory(root);
        const packageJson = yield* workspace.readFile("package.json");
        if (packageJson === undefined) return workspace;
        const pm = yield* CI.PackageManager.JavaScript(workspace);
        yield* pm.install();
        return workspace;
      },
  );
  const run = CI.action("project workflow", () => function* () {
    const workspace = yield* install();
    // Explicit local execution cannot recurse into the host's remote endpoint.
    return yield* workspace.exec(["node /opt/effect-ci/src/hosted.ts run", ...targets,
      ...(workflow ? [`--workflow=${workflow}`] : []),
      // Its stderr logs return in this step's output, in order, on the remote event stream.
      ...(verbose === 2 ? ["-vv"] : verbose === 1 ? ["-v"] : []),
      ...(force ? ["--force"] : []),
      "--local --format=text"].join(" "));
  });
  return {
    workflow: CI.workflow("hosted-ci", () => run()),
  };
}
