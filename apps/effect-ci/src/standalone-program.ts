import * as CI from "@effect-ci-testbed/ci";

export const standaloneContainerOptions = {
  image: "workspace",
  instance: "standard-2",
  loginShell: false,
  readyCommand: "/usr/local/bin/node -e 'if(process.getuid()!==1000)process.exit(1)'",
} as const;

/** Host chooses checkout/root; authored workflow discovery and execution happen
 * only in the unprivileged workspace through the same CLI used locally. */
export function standaloneProgram(root: string, targets: ReadonlyArray<string> = [], workflow?: string) {
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
        let installation = workspace;
        const manifest = JSON.parse(packageJson);
        let hasPackageManager = Boolean(manifest.packageManager);
        for (const lockfile of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) {
          hasPackageManager ||= yield* workspace.exists(lockfile);
        }
        if (!hasPackageManager && root !== ".") {
          const segments = root.split("/");
          while (segments.length > 0) {
            segments.pop();
            const ancestor = segments.length ? repository.directory(segments.join("/")) : repository;
            const ancestorManifest = JSON.parse((yield* ancestor.readFile("package.json")) ?? "{}");
            if ((yield* ancestor.exists("pnpm-workspace.yaml")) || ancestorManifest.workspaces) {
              installation = ancestor;
              break;
            }
          }
        }
        const pm = yield* CI.PackageManager.JavaScript(installation);
        yield* pm.install();
        return workspace;
      },
  );
  const run = CI.action("project workflow", () => function* () {
    const workspace = yield* install();
    // Explicit local execution cannot recurse into the host's remote endpoint.
    return yield* workspace.exec(["node /opt/effect-ci/src/hosted.ts run", ...targets,
      ...(workflow ? [`--workflow=${workflow}`] : []),
      "--local --format=json"].join(" "));
  });
  return {
    workflow: CI.workflow("hosted-ci", () => run()),
  };
}
