import { spawnSync } from "node:child_process";
import { prepareStandaloneRuntime } from "./standalone-runtime.ts";

// package scripts load the same public deployment choices for build/dev/deploy.
// Local commands deliberately do not reconcile Access or perform a deployment.
const [command, ...args] = process.argv.slice(2);
if (command !== "build" && command !== "dev") throw Error("Choose build or dev");
prepareStandaloneRuntime();
const result = spawnSync(process.env.CF_BIN ?? "cf", [command, ...args], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
