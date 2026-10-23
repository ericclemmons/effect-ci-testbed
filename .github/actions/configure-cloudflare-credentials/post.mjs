import { revoke } from "./client.mjs";
if (process.env.STATE_receipt) {
  try {
    await revoke(process.env.STATE_broker, process.env.STATE_receipt);
    console.log("Temporary Cloudflare token revoked.");
  } catch {
    console.error("Token revocation failed; the token expires automatically within 15 minutes of issuance.");
    process.exitCode = 1;
  }
}
