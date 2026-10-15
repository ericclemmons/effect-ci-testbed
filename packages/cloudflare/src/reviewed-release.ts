import type { WorkflowStep } from "cloudflare:workers";
import { demoCandidatePolicy, type DemoCandidateReceipt } from "./demo-candidate.ts";
import {
  evaluateHealth,
  type HealthSample,
  type HealthPolicy,
  type HealthDecision,
} from "./health-gate.ts";
import { resolveHealthReview, type ReviewMargins, type HealthRoute } from "./health-review.ts";
import type { VersionAllocation } from "./release-policy.ts";

export interface ReleaseView {
  readonly candidate: string;
  readonly previous: ReadonlyArray<VersionAllocation>;
  readonly status: "active" | "complete" | "rolled-back";
  readonly deployment: { readonly id: string; readonly versions: ReadonlyArray<VersionAllocation> };
}
export interface ReviewedReleaseBroker {
  prepareCandidate(revision: string, digest: string): Promise<DemoCandidateReceipt>;
  begin(owner: string, version: string): Promise<ReleaseView>;
  renew(owner: string): Promise<ReleaseView>;
  promote(owner: string, percentage: number): Promise<ReleaseView>;
  rollback(owner: string): Promise<ReleaseView>;
  complete(owner: string): Promise<ReleaseView>;
}
export interface ReleaseCohort {
  readonly requested: number;
  readonly unknown: number;
  readonly outcomes: ReadonlyArray<{ readonly version: string; readonly healthy: boolean }>;
}
export interface ReviewedObservation {
  readonly owner: string;
  readonly phase: 10 | 25 | 75 | 100;
  readonly baseline: HealthSample;
  readonly candidate: HealthSample;
  readonly policy: HealthPolicy;
  readonly margins: ReviewMargins;
  readonly decision: HealthDecision;
  readonly route: HealthRoute;
  readonly snapshot: string;
  readonly expiresAt: number;
  readonly evidenceSource: "closed-client-http-cohort";
}
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;
const margins = {
  maxErrorRate: 0.1,
  maxIncrease: 0.05,
  errorGuardBand: 0.02,
  increaseGuardBand: 0.01,
};
const uuid = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
function receipt(r: DemoCandidateReceipt) {
  if (
    !r ||
    !/^[a-f0-9]{40}$/.test(r.revision) ||
    !/^[a-f0-9]{64}$/.test(r.digest) ||
    !/^[a-f0-9]{64}$/.test(r.moduleDigest) ||
    !uuid(r.version) ||
    r.script !== "effect-ci-hmd-demo" ||
    r.policy !== demoCandidatePolicy
  )
    throw Error("Invalid prepared candidate");
  return {
    revision: r.revision,
    digest: r.digest,
    moduleDigest: r.moduleDigest,
    version: r.version,
    script: r.script,
    policy: r.policy,
  };
}
function view(r: ReleaseView): ReleaseView {
  const allocation = (values: ReadonlyArray<VersionAllocation>) => {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 32 ||
      new Set(values.map((v) => v.version)).size !== values.length ||
      values.some(
        (v) =>
          !uuid(v.version) ||
          !Number.isFinite(v.percentage) ||
          v.percentage <= 0 ||
          v.percentage > 100,
      ) ||
      Math.abs(values.reduce((n, v) => n + v.percentage, 0) - 100) > 1e-8
    )
      throw Error("Invalid release allocation receipt");
    return values.map((v) => ({ version: v.version, percentage: v.percentage }));
  };
  if (
    !r ||
    !uuid(r.candidate) ||
    !["active", "complete", "rolled-back"].includes(r.status) ||
    !uuid(r.deployment?.id)
  )
    throw Error("Invalid release journal receipt");
  return {
    candidate: r.candidate,
    status: r.status,
    previous: allocation(r.previous),
    deployment: { id: r.deployment.id, versions: allocation(r.deployment.versions) },
  };
}
function sample(
  batch: ReleaseCohort,
  version: string,
  allowed: ReadonlyArray<string>,
  from: number,
  to: number,
): HealthSample {
  if (
    batch.requested !== 100 ||
    batch.unknown !== 0 ||
    batch.outcomes.length !== 100 ||
    batch.outcomes.some((o) => !allowed.includes(o.version) || typeof o.healthy !== "boolean")
  )
    throw Error("Invalid release health attribution");
  const values = batch.outcomes.filter((o) => o.version === version);
  return {
    version,
    from,
    to,
    completeThrough: to,
    trials: values.length,
    failures: values.filter((o) => !o.healthy).length,
    sampling: "unsampled",
  };
}
/** Fixed owned public origin, closed client-observed cohort; not WOBS ingestion evidence. */
export async function probeRelease(
  identity: string,
  allowed: ReadonlyArray<string>,
  transport: typeof fetch = fetch,
): Promise<ReleaseCohort> {
  const outcomes: Array<{ version: string; healthy: boolean }> = [];
  let unknown = 0;
  for (let group = 0; group < 10; group++)
    await Promise.all(
      Array.from({ length: 10 }, async (_, offset) => {
        try {
          const response = await transport(
            `https://effect-ci-hmd-demo.ericclemmons.workers.dev/health?probe=${encodeURIComponent(identity)}-${group * 10 + offset}`,
            {
              redirect: "manual",
              signal: AbortSignal.timeout(10000),
              headers: {
                "cache-control": "no-cache",
                // Each request represents a distinct synthetic client. The
                // platform hashes these fixed keys against the allocation;
                // none names or forces a candidate version. Never select or
                // retry keys based on their observed routing outcome.
                "Cloudflare-Workers-Version-Key": `effect-ci-cohort:${encodeURIComponent(identity)}:${group * 10 + offset}`,
              },
            },
          );
          if (response.status !== 200 && response.status !== 503) {
            await response.body?.cancel();
            throw Error("Unexpected health status");
          }
          const reader = response.body?.getReader();
          if (!reader) throw Error("Missing health body");
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.length;
              if (size > 4096) throw Error("Health response limit");
              chunks.push(chunk.value);
            }
          } finally {
            await reader.cancel();
          }
          const bytes = new Uint8Array(size);
          let byteOffset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, byteOffset);
            byteOffset += chunk.length;
          }
          const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as {
            version?: unknown;
            healthy?: unknown;
          };
          if (
            typeof value.version !== "string" ||
            !allowed.includes(value.version) ||
            typeof value.healthy !== "boolean" ||
            response.status !== (value.healthy ? 200 : 503)
          )
            throw Error("Invalid health identity");
          outcomes.push({ version: value.version, healthy: value.healthy });
        } catch {
          unknown++;
        }
      }),
    );
  return { requested: 100, unknown, outcomes };
}

/** Host-only continuation. review MUST read an authenticated decision from host-owned storage.
 * Payload actor strings or arbitrary Workflow events are not approval authority.
 */
export async function runReviewedRelease(options: {
  owner: string;
  candidate: DemoCandidateReceipt;
  step: WorkflowStep;
  broker: ReviewedReleaseBroker;
  review: (
    observation: ReviewedObservation,
    history: ReadonlyArray<ReviewedObservation>,
  ) => Promise<unknown>;
  settled?: (observation: ReviewedObservation) => Promise<void>;
  probe?: typeof probeRelease;
}) {
  const { owner, step, broker } = options;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner)) throw Error("Invalid release owner");
  const candidate = receipt(options.candidate);
  const trusted = await step.do("vite-release:verify-prepared", once, async () =>
    receipt(await broker.prepareCandidate(candidate.revision, candidate.digest)),
  );
  if (JSON.stringify(trusted) !== JSON.stringify(candidate))
    throw Error("Prepared candidate does not match broker evidence");
  const claimed = await step.do("vite-release:claim", once, async () =>
    view(await broker.begin(owner, candidate.version)),
  );
  let committing = false;
  try {
    if (
      claimed.candidate !== candidate.version ||
      claimed.status !== "active" ||
      claimed.previous.length !== 1 ||
      claimed.previous[0]?.percentage !== 100 ||
      !uuid(claimed.previous[0].version)
    )
      throw Error("Unsupported prior allocation for reviewed health comparison");
    const previous = claimed.previous[0].version;
    const probe = options.probe ?? probeRelease;
    const from = await step.do("vite-release:baseline-start", once, async () => Date.now());
    const batch = await step.do("vite-release:baseline-probe", once, () =>
      probe(`${owner}-baseline`, [previous]),
    );
    const baseline = await step.do("vite-release:baseline-close", once, async () =>
      sample(batch, previous, [previous], from, Math.max(from + 1, Date.now())),
    );
    if (baseline.trials < 20) throw Error("Missing previous-version health evidence");
    const history: ReviewedObservation[] = [];
    for (const phase of [10, 25, 75, 100] as const) {
      await step.do(`vite-release:renew-${phase}`, once, async () => {
        await broker.renew(owner);
        return { renewed: true };
      });
      await step.do(`vite-release:promote-${phase}`, once, async () =>
        view(await broker.promote(owner, phase)),
      );
      // Control-plane readback is not a data-plane readiness signal. Give the
      // allocation a fixed bounded settling interval, then measure ONE cohort.
      // This does not turn missing attribution into approval or retry a write.
      await step.sleep(`vite-release:settle-${phase}`, "10 seconds");
      const start = await step.do(`vite-release:start-${phase}`, once, async () =>
        Math.max(baseline.to + 1, history.at(-1)?.candidate.to ?? 0, Date.now()),
      );
      const allowed = phase === 100 ? [candidate.version] : [previous, candidate.version];
      const cohort = await step.do(`vite-release:probe-${phase}`, once, () =>
        probe(`${owner}-${phase}`, allowed),
      );
      const observation = await step.do(`vite-release:observe-${phase}`, once, async () => {
        const current = sample(
          cohort,
          candidate.version,
          allowed,
          start,
          Math.max(start + 1, Date.now()),
        );
        if (!current.trials)
          throw Error("No candidate observations; Progress cannot replace missing attribution");
        const policy: HealthPolicy = {
          baselineVersion: previous,
          candidateVersion: candidate.version,
          baselineWindow: { from: baseline.from, to: baseline.to },
          phaseStartedAt: start,
          minTrials: 20,
          earlyRegression: true,
          maxErrorRate: margins.maxErrorRate,
          maxIncrease: margins.maxIncrease,
          alpha: 0.05,
          comparisons: 4,
        };
        const decision = evaluateHealth(baseline, current, policy);
        const route: HealthRoute =
          decision.status === "regression"
            ? { status: "rollback", reason: decision.reason }
            : {
                status: "review",
                reason: "Authenticated human Progress required; uncertainty is not a health pass",
              };
        const evidence = {
          owner,
          phase,
          baseline,
          candidate: current,
          policy,
          margins,
          decision,
          route,
          evidenceSource: "closed-client-http-cohort" as const,
          expiresAt: Date.now() + 300000,
        };
        const bytes = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify({ preparedCandidate: candidate, ...evidence })),
        );
        return {
          ...evidence,
          snapshot: Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(
            "",
          ),
        };
      });
      if (observation.route.status === "rollback")
        throw Error("Conclusive regression; Progress is prohibited");
      history.push(observation);
      // Trusted host callback does its own sibling register/presentation/wait/private-record read checkpoints.
      const decision = await options.review(observation, history);
      await step.do(`vite-release:accept-${phase}`, once, async () => {
        const resolved = resolveHealthReview(observation, decision, Date.now());
        if (resolved.status !== "advance") throw Error("Human rejected release");
        return resolved;
      });
      await step.do(`vite-release:renew-approved-${phase}`, once, async () => {
        await broker.renew(owner);
        return { renewed: true };
      });
      await step.do(`vite-release:verify-approved-${phase}`, once, async () =>
        view(await broker.promote(owner, phase)),
      );
      await options.settled?.(observation);
    }
    committing = true;
    const completed = await step.do("vite-release:commit", once, async () =>
      view(await broker.complete(owner)),
    );
    if (
      completed.status !== "complete" ||
      completed.candidate !== candidate.version ||
      completed.deployment.versions.length !== 1 ||
      completed.deployment.versions[0]?.version !== candidate.version ||
      completed.deployment.versions[0].percentage !== 100
    )
      throw Error("Release commit receipt mismatch");
    return {
      releaseCommitted: true,
      candidate,
      previous: claimed.previous,
      deployment: completed.deployment,
      evidenceSource: "closed-client-http-cohort" as const,
    };
  } catch (error) {
    if (committing)
      throw Error(
        "Release completion needs reconciliation; do not retry or roll back a possibly committed release",
      );
    const restored = await step.do("vite-release:restore", once, async () =>
      view(await broker.rollback(owner)),
    );
    if (
      restored.status !== "rolled-back" ||
      restored.deployment.versions.length !== claimed.previous.length ||
      !claimed.previous.every((v) =>
        restored.deployment.versions.some(
          (r) => r.version === v.version && Math.abs(r.percentage - v.percentage) < 1e-8,
        ),
      )
    )
      throw Error("Release restoration needs reconciliation");
    throw Error("Reviewed release failed closed; captured prior allocation restored");
  }
}
