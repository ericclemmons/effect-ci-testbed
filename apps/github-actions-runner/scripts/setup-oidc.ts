import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";

const { values } = parseArgs({ args: process.argv.slice(2).filter(arg => arg !== "--"), options: {
  "host-env": { type: "string", default: "../effect-ci/.env.production" },
  account: { type: "string" }, subdomain: { type: "string" }, name: { type: "string" },
  repository: { type: "string" }, ref: { type: "string", multiple: true }, workflow: { type: "string", multiple: true },
  worker: { type: "string", multiple: true },
} });
const read = (path: string) => existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
const host = read(values["host-env"]);
const previous = read(".env.production");
const account = values.account ?? host.CLOUDFLARE_ACCOUNT_ID ?? previous.CLOUDFLARE_ACCOUNT_ID;
if (!account || !/^[a-f0-9]{32}$/.test(account)) throw Error("Run the native host setup first, or pass --account and --subdomain");
if (previous.CLOUDFLARE_ACCOUNT_ID && previous.CLOUDFLARE_ACCOUNT_ID !== account)
  throw Error("Existing runner configuration belongs to another account; use a separate checkout");
const hostname = host.EFFECT_CI_PUBLIC_URL ? new URL(host.EFFECT_CI_PUBLIC_URL).hostname : "";
const subdomain = values.subdomain ?? hostname.match(/^[^.]+\.([^.]+)\.workers\.dev$/)?.[1];
if (!subdomain || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) throw Error("Pass --subdomain for the selected account");
const name = values.name ?? previous.EFFECT_CI_GITHUB_RUNNER_NAME ?? "effect-ci-github-actions-runner";
if (!/^[a-z][a-z0-9-]{0,48}[a-z0-9]$/.test(name)) throw Error("Invalid runner Worker name");
const repository = values.repository;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error("Pass --repository OWNER/REPO");
const command = (binary: string, args: string[]) => {
  const result = spawnSync(binary, args, { encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account } });
  if (result.error || result.status !== 0) throw Error(`${binary} metadata lookup failed`);
  return JSON.parse(result.stdout);
};
const repo = command(process.env.GH_BIN ?? "gh", ["api", `repos/${repository}`]);
if (!Number.isSafeInteger(repo.id) || !Number.isSafeInteger(repo.owner?.id)) throw Error("GitHub repository identity missing");
const refs = (values.ref ?? [repo.default_branch]).map(branch => {
  if (!branch || /[\s~^:?*\[\\]/.test(branch) || branch.includes("..")) throw Error("Invalid branch ref");
  return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
});
const workflows = values.workflow ?? [".github/workflows/e2e.yml", ".github/workflows/oidc-live-proof.yml"];
for (const workflow of workflows) {
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(workflow)) throw Error("Invalid workflow path");
}
const workers = command(process.env.CF_BIN ?? "cf", ["workers", "list"]);
const groups = command(process.env.CF_BIN ?? "cf", ["accounts", "tokens", "permission-groups", "list", "--name", "Individual Workers Editor"]);
const group = groups.find((item: any) => item.name === "Individual Workers Editor");
if (!group?.id) throw Error("Cloudflare did not return Individual Workers Editor; authorize cf with account_api_tokens:create");
const targets = values.worker ?? ["effect-ci-oidc-wrangler", "effect-ci-oidc-cf"];
const grants = targets.flatMap((target) => {
  const worker = workers.find((item: any) => item.name === target);
  if (!worker || !/^[a-f0-9]{32}$/.test(worker.id)) throw Error(`Bootstrap Worker ${target} in the selected account first`);
  return refs.flatMap(ref => workflows.map(workflow => ({
    repositoryId: String(repo.id), repositoryOwnerId: String(repo.owner.id), ref,
    workflowRef: `${repository}/${workflow}@${ref}`, accountId: account, worker: target,
    scopes: { "workers:edit": [{ effect: "allow", permission_groups: [{ id: group.id }],
      resources: { [`com.cloudflare.api.account.${account}`]: { [`com.cloudflare.edge.worker.script.${worker.id}`]: "*" } },
    }] },
  })));
});
const output = {
  ...previous, CLOUDFLARE_ACCOUNT_ID: account, EFFECT_CI_GITHUB_RUNNER_NAME: name,
  EFFECT_CI_OIDC_ONLY: previous.EFFECT_CI_OIDC_ONLY ?? "true",
  BROKER_AUDIENCE: `https://${name}.${subdomain}.workers.dev`, BROKER_GRANTS: JSON.stringify(grants),
  RECEIPT_SIGNING_KEY: previous.RECEIPT_SIGNING_KEY ?? randomBytes(32).toString("hex"),
  ...(process.env.CLOUDFLARE_TOKEN_ISSUER ? { CLOUDFLARE_TOKEN_ISSUER: process.env.CLOUDFLARE_TOKEN_ISSUER } : {}),
};
const encoded = Object.entries(output).map(([key, value]) => {
  if (value.includes("'")) throw Error(`Unsupported quote in configuration field ${key}`);
  return `${key}='${value}'`;
}).join("\n") + "\n";
writeFileSync(".env.production", encoded, { mode: 0o600 });
chmodSync(".env.production", 0o600);
const variable = spawnSync(process.env.GH_BIN ?? "gh", ["variable", "set", "EFFECT_CI_OIDC_BROKER_URL", "--repo", repository, "--body", output.BROKER_AUDIENCE], { encoding: "utf8", env: process.env });
if (variable.error || variable.status !== 0) throw Error("Settings saved, but GitHub broker URL variable could not be configured");
console.log(`Saved .env.production for ${output.BROKER_AUDIENCE}; ${grants.length} single-Worker grants.`);
console.log(output.CLOUDFLARE_TOKEN_ISSUER ? "Run pnpm run deploy." : "Add CLOUDFLARE_TOKEN_ISSUER to this ignored file, then run pnpm run deploy.");
