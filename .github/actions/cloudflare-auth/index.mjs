import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { AuthenticationError, exchange } from "./client.mjs";

const escape = (value) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
try {
  if (process.env.INPUT_ENROLL === "true" && !process.env.GITHUB_REPOSITORY) {
    throw new AuthenticationError("Shared-host enrollment requires GITHUB_REPOSITORY");
  }
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const environment = existsSync(join(root, ".env"))
    ? parseEnv(readFileSync(join(root, ".env"), "utf8")) : {};
  const configuration = existsSync(join(root, ".cloudflare/ci/oidc.json"))
    ? JSON.parse(readFileSync(join(root, ".cloudflare/ci/oidc.json"), "utf8")) : {};
  const result = await exchange({
    broker: process.env["INPUT_BROKER-URL"] || process.env.EFFECT_CI_REMOTE_URL
      || environment.EFFECT_CI_REMOTE_URL || configuration.issuer,
    repository: process.env.INPUT_ENROLL === "true" ? process.env.GITHUB_REPOSITORY : undefined,
    worker: process.env.INPUT_WORKER,
    scopes: process.env.INPUT_SCOPES ?? "workers:edit",
    requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  });
  console.log(`::add-mask::${escape(result.token)}`);
  console.log(`::add-mask::${escape(result.receipt)}`);
  appendFileSync(process.env.GITHUB_STATE, `broker=${result.broker}\nreceipt=${result.receipt}\n`);
  appendFileSync(process.env.GITHUB_ENV, `CLOUDFLARE_API_TOKEN=${result.token}\nCLOUDFLARE_ACCOUNT_ID=${result.accountId}\n`);
  console.log("Temporary Cloudflare credentials are available to subsequent steps.");
} catch (error) {
  console.error(error instanceof AuthenticationError ? error.message : "Cloudflare authentication failed. Check the job's OIDC permission, broker grant, Worker and scopes.");
  process.exitCode = 1;
}
