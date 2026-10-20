import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package only the CLI's production dependency closure, never a checkout/env
 * directory. No registry publication or deployment occurs here. */
export function prepareStandaloneRuntime() {
  const app = fileURLToPath(new URL("..", import.meta.url));
  const temporary = mkdtempSync(join(app, ".standalone-runtime-build-"));
  const destination = join(app, ".standalone-runtime");
  try {
    const result = spawnSync("pnpm", ["--filter", "@effect-ci-testbed/cli", "deploy",
      "--prod", "--frozen-lockfile", "--ignore-scripts", "--os=linux", "--cpu=x64", join(temporary, "runtime")], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)), stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error("Standalone CLI packaging failed");
    const runtime = join(temporary, "runtime");
    const root = realpathSync(runtime);
    const inspect = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (name === ".npmrc" || name === ".env" || name.endsWith(".env") || name === ".git")
          throw Error("Private configuration is not allowed in the CLI runtime");
        if (lstatSync(path).isSymbolicLink()) {
          const resolved = realpathSync(path);
          if (resolved !== root && !resolved.startsWith(root + "/"))
            throw Error("CLI runtime dependency escapes its package");
        } else if (lstatSync(path).isDirectory()) inspect(path);
      }
    };
    inspect(runtime);
    // Only this generated, ignored build artifact is replaceable. Keep the old
    // one until packaging and closure validation have both succeeded.
    const previous = join(temporary, "previous");
    if (existsSync(destination)) renameSync(destination, previous);
    try { renameSync(runtime, destination); }
    catch (error) { if (existsSync(previous)) renameSync(previous, destination); throw error; }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
