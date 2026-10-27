import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import * as Effect from "effect/Effect";
import { githubCommentProvider } from "@effect-ci-testbed/github-cloudflare/github-comment";
import type { NotificationReceipt, RunSnapshot } from "@effect-ci-testbed/github-cloudflare/notifications";
import { verifyWebhookSignature } from "@effect-ci-testbed/github";
import { boundedBody } from "../../../packages/github/src/webhook-body.ts";
import { buildSite, checkoutSource, digest, filesFor, serveSite, type Files, type Site } from "../../containerless-site/src/site.ts";
import { assertAuthority, currentPullRequest, notificationPullRequests, withPreviewToken, type PreviewEnvironment } from "./github.ts";
import { previewInstance, previewLease, previewNumber, previewPolicy, previewUrl, type PreviewLease } from "./policy.ts";

interface PreviewState extends PreviewLease {
  ref: string;
  phase: "building" | "ready" | "failed" | "closed" | "fork" | "expired";
  expiresAt: number;
  dispatch: "pending" | "started";
  site?: Site | undefined;
}

interface NotificationIntent {
  run: RunSnapshot;
  previous?: NotificationReceipt;
}

function registry(context: { exports: unknown }) {
  return (context.exports as { PreviewRegistry: DurableObjectNamespace<PreviewRegistry> })
    .PreviewRegistry.getByName("pr-previews-v1");
}

function workflow(context: { exports: unknown }) {
  return (context.exports as { PreviewBuildWorkflow: Workflow<PreviewLease> }).PreviewBuildWorkflow;
}

export class PreviewRegistry extends DurableObject<PreviewEnvironment> {
  private async numbers(): Promise<number[]> {
    return (await this.ctx.storage.get<number[]>("pull-requests")) ?? [];
  }

  private async schedule() {
    const deadlines: number[] = [];
    for (const number of await this.numbers()) {
      const state = await this.ctx.storage.get<PreviewState>(`pr:${number}`);
      if (state && ["building", "ready", "failed"].includes(state.phase)) deadlines.push(state.expiresAt);
    }
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...deadlines)));
    else await this.ctx.storage.deleteAlarm();
  }

  private async notify(token: string, state: PreviewState) {
    if (!notificationPullRequests(this.env).includes(state.number)) return "not-approved" as const;
    const options = { repository: previewPolicy.repository, pullRequest: state.number,
      botUserId: previewPolicy.botUserId, token: async () => token, lifecycle: "pr-previews-v1" };
    const pendingKey = `notification-pending:${state.number}`;
    const receiptKey = `notification-receipt:${state.number}`;
    const acknowledge = async (receipt: NotificationReceipt) => {
      await this.ctx.storage.transaction(async storage => {
        await storage.put(receiptKey, receipt);
        await storage.delete(pendingKey);
      });
    };
    try {
      const pending = await this.ctx.storage.get<NotificationIntent>(pendingKey);
      if (pending) {
        const receipt = await Effect.runPromise(githubCommentProvider({ ...options, reconcileOnly: true })
          .deliver(pending.run, pending.previous));
        await acknowledge(receipt);
      }
      const phase = ["building", "ready", "failed"].includes(state.phase) && state.expiresAt <= Date.now()
        ? "expired" : state.phase;
      const ready = phase === "ready" && state.site !== undefined;
      const run: RunSnapshot = {
        identity: { repository: previewPolicy.repository, revision: state.revision,
          instanceId: `${previewInstance(state)}-${phase}`,
          detailsUrl: ready ? previewUrl(state, state.site!.assetDigest) : `https://github.com/${previewPolicy.repository}/pull/${state.number}` },
        workflowId: `PR preview ${phase}`,
        phase: phase === "building" ? "running" : phase === "failed" ? "failure" : "success",
        checks: [],
      };
      const previous = await this.ctx.storage.get<NotificationReceipt>(receiptKey);
      await this.ctx.storage.put(pendingKey, { run, ...(previous ? { previous } : {}) } satisfies NotificationIntent);
      const receipt = await Effect.runPromise(githubCommentProvider(options).deliver(run, previous));
      await acknowledge(receipt);
      return "delivered" as const;
    } catch {
      return "reconciliation-required" as const;
    }
  }

  async refresh(raw: number) {
    return this.ctx.blockConcurrencyWhile(() => withPreviewToken(this.env, async token => {
      const number = previewNumber(raw);
      const current = await currentPullRequest(token, number);
      const previous = await this.ctx.storage.get<PreviewState>(`pr:${number}`);
      if (!previous && current.phase !== "open") return { phase: current.phase, skipped: true };
      let state: PreviewState;
      if (current.phase !== "open") {
        state = { ...previous!, phase: current.phase, site: undefined };
        await this.ctx.storage.put(`pr:${number}`, state);
      } else if (previous && previous.revision === current.revision &&
        !["closed", "fork"].includes(previous.phase)) {
        state = previous;
        if (state.expiresAt <= Date.now()) {
          state = { ...state, phase: "expired", site: undefined };
          await this.ctx.storage.put(`pr:${number}`, state);
        }
      } else {
        const numbers = await this.numbers();
        const builds = (await this.ctx.storage.get<number>("builds")) ?? 0;
        if ((!previous && numbers.length >= previewPolicy.pullRequests) || builds >= previewPolicy.builds)
          throw Error("Preview namespace budget exhausted");
        state = { number, generation: (previous?.generation ?? 0) + 1,
          revision: current.revision, ref: current.ref, phase: "building", dispatch: "pending",
          expiresAt: Date.now() + previewPolicy.lifetimeMs };
        await this.ctx.storage.transaction(async storage => {
          await storage.setAlarm(Math.min(state.expiresAt, (await storage.getAlarm()) ?? state.expiresAt));
          await storage.put(`pr:${number}`, state);
          await storage.put("builds", builds + 1);
          if (!previous) await storage.put("pull-requests", [...numbers, number]);
        });
        try {
          await workflow(this.ctx).create({ id: previewInstance(state), params: previewLease(state) });
          state = { ...state, dispatch: "started" };
          await this.ctx.storage.put(`pr:${number}`, state);
        } catch {
          await this.schedule();
          return { ...previewLease(state), phase: state.phase, dispatch: "reconciliation-required" };
        }
      }
      if (state.phase === "building" && state.dispatch === "pending") {
        try {
          await (await workflow(this.ctx).get(previewInstance(state))).status();
          state = { ...state, dispatch: "started" };
          await this.ctx.storage.put(`pr:${number}`, state);
        } catch {
          return { ...previewLease(state), phase: state.phase, dispatch: "reconciliation-required" };
        }
      }
      await this.schedule();
      const notification = await this.notify(token, state);
      return { ...previewLease(state), phase: state.phase, notification };
    }));
  }

  async refreshDeletedBranch(ref: string) {
    assertAuthority(this.env);
    const results = [];
    for (const number of await this.numbers()) {
      const state = await this.ctx.storage.get<PreviewState>(`pr:${number}`);
      if (state?.ref === ref) results.push(await this.refresh(number));
    }
    return results;
  }

  async inspectLease(raw: PreviewLease): Promise<boolean> {
    assertAuthority(this.env);
    const lease = previewLease(raw);
    const state = await this.ctx.storage.get<PreviewState>(`pr:${lease.number}`);
    return state?.generation === lease.generation && state.revision === lease.revision &&
      state.phase === "building" && state.expiresAt > Date.now();
  }

  async publish(raw: PreviewLease, sourceDigest: string, input: Files) {
    const lease = previewLease(raw);
    const assets = filesFor(input);
    if (Object.keys(assets).sort().join() !== "client.js,index.html,style.css" || !/^[a-f0-9]{64}$/.test(sourceDigest))
      throw Error("Invalid preview build");
    const assetDigest = await digest(assets);
    return this.ctx.blockConcurrencyWhile(() => withPreviewToken(this.env, async token => {
      const current = await currentPullRequest(token, lease.number);
      const state = await this.ctx.storage.get<PreviewState>(`pr:${lease.number}`);
      if (!state || state.generation !== lease.generation || state.revision !== lease.revision ||
        !["building", "ready"].includes(state.phase) || state.expiresAt <= Date.now() ||
        current.phase !== "open" || current.revision !== lease.revision)
        throw Error("Stale or unauthorized preview publication");
      if (state.site && (state.site.assetDigest !== assetDigest || state.site.sourceDigest !== sourceDigest))
        throw Error("Immutable preview conflict");
      const site: Site = { revision: lease.revision, sourceDigest, assetDigest, assets };
      const ready: PreviewState = { ...state, phase: "ready", site };
      await this.ctx.storage.put(`pr:${lease.number}`, ready);
      const notification = await this.notify(token, ready);
      return { ...lease, digest: assetDigest, url: previewUrl(lease, assetDigest), notification };
    }));
  }

  async fail(raw: PreviewLease) {
    const lease = previewLease(raw);
    return this.ctx.blockConcurrencyWhile(() => withPreviewToken(this.env, async token => {
      const state = await this.ctx.storage.get<PreviewState>(`pr:${lease.number}`);
      if (!state || state.generation !== lease.generation || state.revision !== lease.revision || state.phase !== "building")
        return { stale: true };
      const failed: PreviewState = { ...state, phase: "failed", site: undefined };
      await this.ctx.storage.put(`pr:${lease.number}`, failed);
      return { notification: await this.notify(token, failed) };
    }));
  }

  async read(raw: PreviewLease, assetDigest: string): Promise<Site | undefined> {
    assertAuthority(this.env);
    const lease = previewLease(raw);
    const state = await this.ctx.storage.get<PreviewState>(`pr:${lease.number}`);
    if (state?.phase !== "ready" || state.expiresAt <= Date.now() || state.generation !== lease.generation ||
      state.revision !== lease.revision || state.site?.assetDigest !== assetDigest) return;
    if (await digest(state.site.assets) !== assetDigest) throw Error("Stored preview corrupt");
    return state.site;
  }

  override async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      assertAuthority(this.env);
      const expired: PreviewState[] = [];
      for (const number of await this.numbers()) {
        const state = await this.ctx.storage.get<PreviewState>(`pr:${number}`);
        if (state && ["building", "ready", "failed"].includes(state.phase) && state.expiresAt <= Date.now()) {
          const next: PreviewState = { ...state, phase: "expired", site: undefined };
          await this.ctx.storage.put(`pr:${number}`, next);
          expired.push(next);
        }
      }
      await this.schedule();
      if (expired.length) await withPreviewToken(this.env, async token => {
        for (const state of expired) await this.notify(token, state);
      });
    });
  }

  override fetch() { return new Response("Not found", { status: 404 }); }
}

export class PreviewBuildWorkflow extends WorkflowEntrypoint<PreviewEnvironment, PreviewLease> {
  override async run(event: Readonly<WorkflowEvent<PreviewLease>>, step: WorkflowStep) {
    assertAuthority(this.env);
    const lease = previewLease(event.payload);
    if (event.instanceId !== previewInstance(lease)) throw new NonRetryableError("Preview Workflow identity mismatch");
    const store = registry(this.ctx);
    const recorded = <Value>(name: string, operation: () => Promise<Value>) =>
      step.do(name, { retries: { limit: 0, delay: "1 second" }, timeout: "30 seconds" }, async () => {
        try { return JSON.parse(JSON.stringify(await operation())) as Rpc.Serializable<Value>; }
        catch { throw new NonRetryableError(`Preview ${name} unavailable; reconcile the same identity`); }
      });
    try {
      if (!await store.inspectLease(lease)) return { stale: true };
      const source = await recorded("source", () => checkoutSource(lease.revision)) as Files;
      const assets = await recorded("build", () => buildSite(this.env.LOADER, source)) as Files;
      const sourceDigest = await digest(source);
      return await recorded("publish", () => store.publish(lease, sourceDigest, assets));
    } catch (error) {
      await store.fail(lease).catch(() => undefined);
      throw error;
    }
  }
}

export default {
  async fetch(request: Request, environment: PreviewEnvironment, context: ExecutionContext): Promise<Response> {
    try {
      assertAuthority(environment);
      const url = new URL(request.url);
      if (url.origin !== previewPolicy.origin || url.search) return new Response("Not found", { status: 404 });
      if (request.method === "POST" && url.pathname === "/webhooks/github") {
        const body = await boundedBody(request);
        if (!environment.GITHUB_WEBHOOK_SECRET || !await verifyWebhookSignature(environment.GITHUB_WEBHOOK_SECRET,
          body, request.headers.get("x-hub-signature-256"))) return new Response("Invalid signature", { status: 401 });
        const value = JSON.parse(body);
        if (value.repository?.full_name !== previewPolicy.repository ||
          (value.installation !== undefined && value.installation?.id !== previewPolicy.installationId))
          return Response.json({ accepted: false }, { status: 202 });
        const delivery = request.headers.get("x-github-delivery");
        if (!delivery || !/^[a-f0-9-]{36}$/.test(delivery)) return new Response("Invalid delivery", { status: 400 });
        const event = request.headers.get("x-github-event");
        if (event === "pull_request" && ["opened", "reopened", "synchronize", "closed"].includes(value.action)) {
          return Response.json(await registry(context).refresh(previewNumber(value.number)), { status: 202 });
        }
        if (event === "delete" && value.ref_type === "branch" && typeof value.ref === "string" && value.ref.length <= 255) {
          return Response.json(await registry(context).refreshDeletedBranch(value.ref), { status: 202 });
        }
        return Response.json({ accepted: false }, { status: 202 });
      }
      if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
      const match = /^\/pr\/([1-9][0-9]*)\/([1-9][0-9]*)\/([a-f0-9]{40})\/([a-f0-9]{64})\/(index\.html|client\.js|style\.css)$/.exec(url.pathname);
      if (!match) return new Response("Not found", { status: 404 });
      const [, number, generation, revision, assetDigest, path] = match;
      const site = await registry(context).read({ number: Number(number), generation: Number(generation), revision: revision! }, assetDigest!);
      if (!site) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
      const served = await serveSite(environment.LOADER, site, path!);
      const response = new Response(request.method === "HEAD" ? null : served.body, served);
      response.headers.set("cache-control", "no-store");
      return response;
    } catch {
      return new Response("Preview unavailable; reconcile the same operation", { status: 503, headers: { "cache-control": "no-store" } });
    }
  },
};
