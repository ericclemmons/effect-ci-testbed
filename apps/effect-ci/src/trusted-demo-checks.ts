import { DurableObject } from "cloudflare:workers";
import type { HostedCheckIdentity } from "@effect-ci-testbed/cloudflare/check-evidence";
import { runnerCheckFingerprint, signRunnerCheckReceipt, verifyRunnerCheckReceipt,
  type RunnerCheckClaim } from "@effect-ci-testbed/cloudflare/runner-check-receipt";
import { syntaxCommand, syntaxRepository, syntaxWorkflow } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { testCommand } from "@effect-ci-testbed/cloudflare/demo-test-check";
import { demoRunnerPolicyDigest } from "./demo-runner-policy.ts";

const keyId = "demo-trusted-runner-v1";
/** Private host capability. Neither HTTP nor project containers can submit claims.
 * Storage owns a dedicated runner key, never the GitHub App or developer key.
 */
export class TrustedDemoChecks extends DurableObject<Record<string, never>> {
  #keys!: CryptoKeyPair;
  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      let stored = await ctx.storage.get<{ privateKey: JsonWebKey; publicKey: JsonWebKey }>("authority");
      if (!stored) {
        const generated = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
        stored = { privateKey: await crypto.subtle.exportKey("jwk", generated.privateKey),
          publicKey: await crypto.subtle.exportKey("jwk", generated.publicKey) };
        await ctx.storage.put("authority", stored);
      }
      this.#keys = {
        privateKey: await crypto.subtle.importKey("jwk", stored.privateKey, "Ed25519", false, ["sign"]),
        publicKey: await crypto.subtle.importKey("jwk", stored.publicKey, "Ed25519", true, ["verify"]),
      };
    });
  }
  async #eligible(identity: HostedCheckIdentity) {
    return identity?.repository === syntaxRepository && identity.workflowId === syntaxWorkflow &&
      ((identity.stepId === "syntax" && identity.command === syntaxCommand && identity.policyDigest === await demoRunnerPolicyDigest(false)) ||
       (identity.stepId === "test" && identity.command === testCommand && identity.policyDigest === await demoRunnerPolicyDigest(true)));
  }
  async publicKey() { return { keyId, publicKey: await crypto.subtle.exportKey("jwk", this.#keys.publicKey) }; }
  async receipt(identity: HostedCheckIdentity): Promise<string | undefined> {
    if (!await this.#eligible(identity)) return;
    return this.ctx.storage.get<string>(`receipt:${identity.revision}:${await runnerCheckFingerprint(identity)}`);
  }
  async lookup(identity: HostedCheckIdentity) {
    return verifyRunnerCheckReceipt(await this.receipt(identity), identity, new Map([[keyId, this.#keys.publicKey]]));
  }
  async record(claim: RunnerCheckClaim): Promise<void> {
    if (!await this.#eligible(claim.identity)) throw Error("Unenrolled runner check");
    const key = `receipt:${claim.identity.revision}:${await runnerCheckFingerprint(claim.identity)}`;
    const receipt = JSON.stringify(await signRunnerCheckReceipt(keyId, this.#keys.privateKey, claim));
    // First successful execution wins; retries never replace its origin/output.
    await this.ctx.storage.transaction(async tx => {
      if (!await tx.get(key)) await tx.put(key, receipt);
    });
  }
  async forCommit(revision: string) {
    if (!/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid receipt revision");
    const values = await this.ctx.storage.list<string>({ prefix: `receipt:${revision}:`, limit: 32 });
    return { ...(await this.publicKey()), receipts: Array.from(values.values(), value => JSON.parse(value)) };
  }
  fetch() { return new Response("Not found", { status: 404 }); }
}
