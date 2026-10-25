import { DurableObject } from "cloudflare:workers";
import { SignJWT, jwtVerify } from "jose";
import { authorize, cloudflareTokenRequest, verifyIdentity, type Grant, type Policy } from "./auth.ts";

export interface Env {
  BROKER_AUDIENCE: string;
  BROKER_GRANTS: string;
  CLOUDFLARE_TOKEN_ISSUER: string;
  RECEIPT_SIGNING_KEY: string;
}
interface LeaseRequest { accountId: string; policies: Policy[]; name: string }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const receiptKey = (env: Env) => {
  if (!env.RECEIPT_SIGNING_KEY || env.RECEIPT_SIGNING_KEY.length < 32) throw new Error("Receipt key missing");
  return new TextEncoder().encode(env.RECEIPT_SIGNING_KEY);
};

export class TokenLease extends DurableObject<Env> {
  async issue(input: LeaseRequest) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get("used")) throw new Error("Identity already exchanged");
      // Cloudflare's token API rejects fractional seconds in this field.
      const expiresOn = new Date(Date.now() + 15 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
      // Consume before the external call; ambiguous issuance is never retried.
      await this.ctx.storage.put("used", true);
      await this.ctx.storage.setAlarm(Date.now() + 20 * 60_000);
      const token = await cloudflareTokenRequest(input.accountId, this.env.CLOUDFLARE_TOKEN_ISSUER, "POST", {
        name: input.name, policies: input.policies, expires_on: expiresOn,
      });
      if (!token?.id || !/^[a-f0-9]{32}$/.test(token.id) || !token.value || /[\r\n]/.test(token.value)) throw new Error("Invalid token response");
      await this.ctx.storage.put("token", { accountId: input.accountId, id: token.id });
      return { token: token.value, accountId: input.accountId, expiresOn };
    });
  }

  async revoke() {
    return this.ctx.blockConcurrencyWhile(async () => {
      const token = await this.ctx.storage.get<{ accountId: string; id: string }>("token");
      if (token) {
        await cloudflareTokenRequest(token.accountId, this.env.CLOUDFLARE_TOKEN_ISSUER, "DELETE", token.id);
        await this.ctx.storage.delete("token");
      }
    });
  }

  async alarm() {
    // Tokens have already expired. Remove bookkeeping after the OIDC JWT's lifetime.
    await this.ctx.storage.deleteAll();
  }
}

export type GrantResolver = (claims: Awaited<ReturnType<typeof verifyIdentity>>, input: { worker: string; scopes: string[] }, env: Env, ctx: ExecutionContext) => Promise<{ accountId: string; policies: Policy[] }>;

export const credentialBroker = (resolveGrant?: GrantResolver, verify = verifyIdentity) => ({
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/token", "/revoke"].includes(path)) return json({ error: "Not found" }, 404);
    let stage = "configuration";
    try {
      const key = receiptKey(env);
      const leases = (ctx.exports as unknown as { TokenLease: DurableObjectNamespace<TokenLease> }).TokenLease;
      const bearer = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!bearer || bearer.length > 20_000) return json({ error: "Unauthorized" }, 401);
      if (path === "/revoke") {
        const { payload } = await jwtVerify(bearer, key, { algorithms: ["HS256"], issuer: "effect-ci", audience: env.BROKER_AUDIENCE, requiredClaims: ["jti", "exp"] });
        const lease = leases.getByName(payload.jti!);
        await lease.revoke();
        return json({ revoked: true });
      }
      stage = "identity";
      const claims = await verify(bearer, env.BROKER_AUDIENCE);
      const text = await request.text();
      if (text.length > 4096) return json({ error: "Request too large" }, 413);
      stage = "grant";
      const requestScope = JSON.parse(text);
      const input = resolveGrant
        ? await resolveGrant(claims, requestScope, env, ctx)
        : authorize(claims, requestScope, JSON.parse(env.BROKER_GRANTS) as Grant[]);
      const receipt = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer("effect-ci")
        .setAudience(env.BROKER_AUDIENCE).setJti(claims.jti!).setIssuedAt().setExpirationTime("1h").sign(key);
      const lease = leases.getByName(claims.jti!);
      stage = "issuance";
      const result = await lease.issue({ ...input, name: `effect-ci-${claims.run_id}-${claims.run_attempt}`.slice(0, 120) });
      return json({ ...result, receipt });
    } catch (error) {
      // Includes validation, replay and upstream failures without reflecting secret data.
      const message = error instanceof Error ? error.message : "";
      const upstream = message.match(/Cloudflare token operation failed \((\d{3})\)/)?.[1];
      const reason = upstream ? `cloudflare-http-${upstream}`
        : message.includes("Identity already exchanged") ? "identity-already-exchanged"
        : message.includes("Invalid token response") ? "invalid-token-response"
        : error instanceof TypeError ? "runtime-type-error" : "runtime-error";
      return json({ error: "Credential exchange rejected", stage, reason }, 403);
    }
  },
});

export default credentialBroker();
