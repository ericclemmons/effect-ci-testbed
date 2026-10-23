import oidc, { type OidcEnvironment } from "./oidc/worker.ts";
export { TokenLease } from "./oidc/worker.ts";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { verifyWebhookSignature } from "../../../packages/github/src/app.ts";
import { enrollment } from "./enrollment.ts";
import { GitHub } from "./github.ts";
import { RunnerLifecycle, type Lease } from "./lifecycle.ts";
import { boundedBody, jobKey, sameEnrollment, validEnrollment, webhookJob, type Enrollment, type Job } from "./policy.ts";

type LocalExports = {
  RunnerPool: DurableObjectNamespace<RunnerPool>;
  ActionsRunner: DurableObjectNamespace<ActionsRunner>;
};
type Environment = Partial<OidcEnvironment> & {
  RUNNER_APP_PRIVATE_KEY?: string;
  RUNNER_WEBHOOK_SECRET?: string;
};
type Pending = { job: Job; policy: Enrollment };
type Pool = { queue: Pending[]; active?: Pending & { key: string; name: string }; seen: string[] };
const POOL_KEY = "selected-repository-v1";

export class ActionsRunner extends DurableObject<Environment> {
  private lifecycle() {
    return new RunnerLifecycle({
      read: () => this.ctx.storage.get<Lease>("lease"),
      claim: (lease) => this.ctx.storage.transaction(async (storage) => {
        if (await storage.get("lease")) return false;
        await storage.put("lease", lease); return true;
      }),
      write: (lease) => this.ctx.storage.put("lease", lease),
      alarm: (at) => this.ctx.storage.setAlarm(at),
      now: Date.now,
      github: (p) => new GitHub(p, this.env.RUNNER_APP_PRIVATE_KEY ?? ""),
      start: async (config, lifetimeSeconds) => {
        const container = this.ctx.container;
        if (!container || container.running) throw new Error("container-unavailable");
        // Existing native Containers approach; no imported runner control plane.
        // No image, command, credentials or instance size from the event.
        container.start({ image: container.images.runner!, enableInternet: true, instance: "standard-2",
          env: { ACTIONS_RUNNER_INPUT_JITCONFIG: config, RUNNER_LIFETIME_SECONDS: String(lifetimeSeconds) } });
      },
      destroy: async () => { await this.ctx.container?.destroy(); },
    });
  }
  async launch(job: Job, policy: Enrollment, name: string) {
    if (!validEnrollment(enrollment) || !sameEnrollment(policy, enrollment)) {
      await this.ctx.storage.transaction(async (storage) => {
        if (!await storage.get("lease")) await storage.put("lease", {
          policy, job, name, deadline: Date.now(), phase: "done", reason: "enrollment-changed",
        } satisfies Lease);
      });
      return;
    }
    await this.lifecycle().launch(job, policy, name);
  }
  async status() { return this.lifecycle().reconcile(); }
  async alarm() { await this.lifecycle().reconcile(); }
}

export class RunnerPool extends DurableObject<Environment> {
  async enqueue(job: Job) {
    const key = jobKey(job);
    return this.ctx.storage.transaction(async (storage) => {
      const pool = await storage.get<Pool>(POOL_KEY) ?? { queue: [], seen: [] };
      if (pool.seen.includes(key)) return "duplicate";
      // Bound queued work AND permanent tombstones. No eviction that could turn
      // a replayed old webhook into another JIT mint. Explicit maintenance after
      // 1,000 jobs is required for this initial single-repository deployment.
      if (pool.queue.length >= 20 || pool.seen.length >= 1000) return "capacity";
      pool.seen.push(key); pool.queue.push({ job, policy: { ...enrollment } });
      await storage.put(POOL_KEY, pool);
      await storage.setAlarm(Date.now() + 1);
      return "queued";
    });
  }
  async alarm() {
    await this.ctx.storage.setAlarm(Date.now() + 30000);
    const pool = await this.ctx.storage.get<Pool>(POOL_KEY);
    if (!pool) return;
    if (pool.active) {
      const runner = (this.ctx.exports as unknown as LocalExports).ActionsRunner.getByName(pool.active.name);
      const phase = await runner.status();
      // Pool claim may have committed immediately before a process restart.
      // Relaunch is safe only through the runner's durable claim, not a fresh ID.
      if (phase === "absent") {
        await runner.launch(pool.active.job, pool.active.policy, pool.active.name);
        return;
      }
      if (phase !== "done") return;
      // Re-read: webhook requests can append while the status RPC yields.
      await this.ctx.storage.transaction(async (storage) => {
        const latest = (await storage.get<Pool>(POOL_KEY))!;
        if (latest.active?.name === pool!.active!.name) delete latest.active;
        await storage.put(POOL_KEY, latest);
      });
    }
    const next = await this.ctx.storage.transaction(async (storage) => {
      const latest = (await storage.get<Pool>(POOL_KEY))!;
      if (latest.active || !latest.queue.length) return;
      const item = latest.queue.shift()!;
      const name = `effect-ci-${crypto.randomUUID()}`;
      latest.active = { ...item, key: jobKey(item.job), name };
      await storage.put(POOL_KEY, latest);
      return { ...item, name };
    });
    if (next) await (this.ctx.exports as unknown as LocalExports).ActionsRunner.getByName(next.name).launch(next.job, next.policy, next.name);
    await this.ctx.storage.transaction(async (storage) => {
      const latest = await storage.get<Pool>(POOL_KEY);
      if (!latest?.active && !latest?.queue.length) await storage.deleteAlarm();
    });
  }
}

export default class extends WorkerEntrypoint<Environment> {
  async fetch(request: Request): Promise<Response> {
    const env = this.env;
    const url = new URL(request.url);
    if (["/token", "/revoke"].includes(url.pathname)) {
      if (![env.BROKER_AUDIENCE, env.BROKER_GRANTS, env.CLOUDFLARE_TOKEN_ISSUER, env.RECEIPT_SIGNING_KEY].every(value => typeof value === "string" && value.length > 0))
        return new Response("OIDC not configured", { status: 503, headers: { "cache-control": "no-store" } });
      return oidc.fetch(request, env as OidcEnvironment, this.ctx);
    }
    if (url.pathname === "/health" && request.method === "GET")
      return Response.json({ enabled: validEnrollment(enrollment), backend: "containers" });
    if (url.pathname !== "/github/webhook" || request.method !== "POST") return new Response("Not found", { status: 404 });
    if (!validEnrollment(enrollment) || !env.RUNNER_APP_PRIVATE_KEY || !env.RUNNER_WEBHOOK_SECRET || env.RUNNER_WEBHOOK_SECRET.length < 32)
      return new Response("Runner not enrolled", { status: 503 });
    try {
      const body = await boundedBody(request);
      if (!await verifyWebhookSignature(env.RUNNER_WEBHOOK_SECRET, body, request.headers.get("x-hub-signature-256")))
        return new Response("Invalid signature", { status: 401 });
      if (request.headers.get("x-github-event") === "ping") return new Response("pong");
      if (request.headers.get("x-github-event") !== "workflow_job") return new Response("Ignored", { status: 202 });
      const job = webhookJob(JSON.parse(body), enrollment);
      if (!job) return new Response("Ignored", { status: 202 });
      const result = await (this.ctx.exports as unknown as LocalExports).RunnerPool.getByName(POOL_KEY).enqueue(job);
      return Response.json({ state: result }, { status: result === "capacity" ? 503 : 202 });
    } catch {
      return new Response("Webhook unavailable", { status: 503 });
    }
  }
}
