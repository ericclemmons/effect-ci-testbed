import { appendFileSync } from "node:fs";
import { AuthenticationError, exchange } from "./client.mjs";

const escape = (value) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
try {
  const result = await exchange({
    broker: process.env["INPUT_BROKER-URL"], worker: process.env.INPUT_WORKER,
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
