import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const githubCache = (options: {
  workspace: string;
  workflow: string;
  revision: string;
  enabled?: boolean;
  namespace?: string;
  keyFiles?: string;
  paths?: string;
}) => {
  if (options.enabled === false) return { enabled: false, paths: "", key: "", restoreKey: "" };
  if (!/^[a-f0-9]{40}$/.test(options.revision)) throw new Error("Cache requires a full revision");
  const workspace = resolve(options.workspace);
  const workflow = resolve(workspace, options.workflow);
  const local = relative(workspace, workflow);
  if (local === ".." || local.startsWith("../") || isAbsolute(local)) {
    throw new Error("Workflow must be inside the checkout");
  }
  const marker = local.indexOf(".cloudflare/ci/");
  const root =
    marker >= 0
      ? resolve(workspace, local.slice(0, marker))
      : statSync(workflow).isDirectory()
        ? workflow
        : dirname(workflow);
  const rootRelative = relative(workspace, root);
  const atRoot = (path: string) => (rootRelative ? `${rootRelative}/${path}` : path);
  const paths =
    options.paths?.trim() ||
    [
      ...new Set([
        atRoot("node_modules/.vite/task-cache"),
        "node_modules/.vite/task-cache",
        atRoot(".effect-ci/cache"),
      ]),
    ].join("\n");
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify([
      "effect-ci-cache-v1",
      local,
      paths,
      options.namespace ?? "",
      process.platform,
      process.arch,
      process.version,
    ]),
  );
  // Include actual project and ancestor manifests/lockfiles. Package managers
  // and task engines still validate their own entries after restoration.
  for (let directory = root; ; directory = dirname(directory)) {
    for (const name of [
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ]) {
      const file = resolve(directory, name);
      hash.update(JSON.stringify([relative(workspace, file), existsSync(file)]));
      if (existsSync(file)) hash.update(readFileSync(file));
    }
    if (directory === workspace) break;
  }
  // Legacy callers may use globbed extra inputs; Actions computes this digest.
  hash.update(options.keyFiles ?? "");
  const restoreKey = `effect-ci-v1-${hash.digest("hex")}-`;
  return { enabled: true, paths, key: restoreKey + options.revision, restoreKey };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = githubCache({
    workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
    workflow: process.env.CACHE_WORKFLOW ?? ".",
    revision: process.env.GITHUB_SHA ?? "",
    enabled: process.env.CACHE_ENABLED !== "false",
    namespace: process.env.CACHE_NAMESPACE ?? "",
    keyFiles: process.env.CACHE_EXTRA_INPUTS ?? "",
    paths: process.env.CACHE_PATHS ?? "",
  });
  const delimiter = `cache_${Array.from(randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  for (const [name, value] of Object.entries({
    enabled: String(policy.enabled),
    paths: policy.paths,
    key: policy.key,
    "restore-key": policy.restoreKey,
  }))
    appendFileSync(process.env.GITHUB_OUTPUT!, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}
