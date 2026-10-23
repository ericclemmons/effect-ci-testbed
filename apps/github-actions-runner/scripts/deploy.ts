import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Match native self-hosting: operator credentials select the account, never Worker bindings.
const secretNames = ["RUNNER_APP_PRIVATE_KEY", "RUNNER_WEBHOOK_SECRET", "BROKER_AUDIENCE", "BROKER_GRANTS", "CLOUDFLARE_TOKEN_ISSUER", "RECEIPT_SIGNING_KEY"];
const args = process.argv.slice(2).filter(arg => arg !== "--");
const directory = mkdtempSync(join(tmpdir(), "effect-ci-github-secrets-"));
try {
  const secrets = Object.fromEntries(secretNames.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  if (!args.some(arg => arg === "--secrets-file" || arg.startsWith("--secrets-file=")) && Object.keys(secrets).length) {
    const path = join(directory, "secrets.json");
    writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 });
    args.push("--secrets-file", path);
  }
  const result = spawnSync(process.env.CF_BIN ?? "cf", ["deploy", ...args], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
