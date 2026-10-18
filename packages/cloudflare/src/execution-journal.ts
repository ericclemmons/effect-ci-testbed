import { DurableObject } from "cloudflare:workers";
import { verifyExecutionReceipt, type ExecutionIdentity, type ExecutionReceipt } from "./execution-receipt.ts";

export type ExecutionSubject = Pick<ExecutionIdentity, "issuer" | "repository" | "revision">;
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, "0")).join("");

/** One private Durable Object per issuer/repository/commit, not a mutable branch. */
export async function executionCommitName(subject: ExecutionSubject): Promise<string> {
  try {
    if (!subject || typeof subject.issuer !== "string" || subject.issuer.length > 1024 ||
        typeof subject.repository !== "string" || subject.repository.length > 2048 || !/^[a-f0-9]{40}$/.test(subject.revision)) throw Error();
    const issuer = new URL(subject.issuer), repository = new URL(subject.repository);
    if (issuer.protocol !== "https:" || issuer.origin !== subject.issuer ||
        repository.protocol !== "https:" || repository.href !== subject.repository || repository.username || repository.password ||
        repository.search || repository.hash) throw Error();
    return `execution-commit:v1:${await hash([subject.issuer, subject.repository, subject.revision])}`;
  } catch { throw Error("Invalid execution subject"); }
}
const recordKey = async (instanceId: string, attempt: number) => {
  if (typeof instanceId !== "string" || !instanceId || instanceId.length > 256 || /[\x00-\x1f\x7f]/.test(instanceId) ||
      !Number.isSafeInteger(attempt) || attempt < 1) throw Error("Invalid execution record identity");
  return `execution:${await hash([instanceId, attempt])}`;
};

/** Private RPC only. The operator supplies current trust; project code receives
 * neither this binding nor a signing key. No receipt can enroll its own key. */
export function executionJournal<Environment>(options: {
  readonly keys: (environment: Environment) => ReadonlyMap<string, CryptoKey> | Promise<ReadonlyMap<string, CryptoKey>>;
}) {
  return class ExecutionJournal extends DurableObject<Environment> {
    async #keys() {
      try { return await options.keys(this.env); }
      catch { throw Error("Execution trust unavailable"); }
    }

    async record(expected: ExecutionIdentity, serialized: string): Promise<{ created: boolean }> {
      const claim = await verifyExecutionReceipt(serialized, expected, await this.#keys());
      if (!claim) throw Error("Execution receipt rejected");
      const owner = await executionCommitName(claim.identity);
      const key = await recordKey(claim.instanceId, claim.attempt);
      return this.ctx.storage.transaction(async storage => {
        const current = await storage.get<string>("owner");
        if (current !== undefined && current !== owner) throw Error("Execution journal belongs to another commit");
        const existing = await storage.get<string>(key);
        if (existing !== undefined) {
          if (existing !== serialized) throw Error("Immutable execution record conflict");
          return { created: false };
        }
        await storage.put({ owner, [key]: serialized });
        return { created: true };
      });
    }

    async get(expected: ExecutionIdentity, instanceId: string, attempt: number): Promise<string | undefined> {
      if (await this.ctx.storage.get("owner") !== await executionCommitName(expected)) return;
      const serialized = await this.ctx.storage.get<string>(await recordKey(instanceId, attempt));
      const claim = await verifyExecutionReceipt(serialized, expected, await this.#keys());
      return claim?.instanceId === instanceId && claim.attempt === attempt ? serialized : undefined;
    }

    /** Bounded history. Withdrawn/unverifiable keys do not erase stored records;
     * report their count, but do not present them as trusted execution evidence. */
    async history(subject: ExecutionSubject, after?: string): Promise<{
      receipts: string[]; unverified: number; next?: string;
    }> {
      const owner = await executionCommitName(subject);
      if (await this.ctx.storage.get("owner") !== owner) return { receipts: [], unverified: 0 };
      if (after !== undefined && !/^[a-f0-9]{64}$/.test(after)) throw Error("Invalid execution history cursor");
      const entries = await this.ctx.storage.list<string>({ prefix: "execution:", limit: 26,
        ...(after ? { startAfter: `execution:${after}` } : {}) });
      const keys = await this.#keys(), receipts: string[] = [];
      let unverified = 0;
      const page = [...entries].slice(0, 25);
      for (const [key, serialized] of page) {
        try {
          if (typeof serialized !== "string" || serialized.length > 131_072) throw Error();
          const receipt = JSON.parse(serialized) as ExecutionReceipt;
          const claim = await verifyExecutionReceipt(serialized, receipt.claim.identity, keys);
          if (!claim || await executionCommitName(claim.identity) !== owner || await recordKey(claim.instanceId, claim.attempt) !== key) throw Error();
          receipts.push(serialized);
        } catch { unverified++; }
      }
      return { receipts, unverified, ...(entries.size > 25 ? { next: page.at(-1)![0].slice("execution:".length) } : {}) };
    }

    fetch() { return new Response("Not found", { status: 404 }); }
  };
}
