import type { WorkflowStep } from "cloudflare:workers";
import { demoCandidatePolicy } from "@effect-ci-testbed/cloudflare/demo-candidate";
import { probeRelease, type ReviewedReleaseBroker, type ReleaseView } from "@effect-ci-testbed/cloudflare/reviewed-release";

// ONE already-completed candidate from the retained failed cedd7e6 build.
// No caller-selected candidate, build, upload, target or approval capability.
export const routingDiagnosticCandidate = Object.freeze({
  revision: "cedd7e628d7d89f5a39d9267c8fb2f24adfdd4f6",
  digest: "e9fad7f0e6117c0a33f76d9d9891ebefb2c34519364179e464857a2780efcb23",
  version: "454d68b9-f3cb-4ffd-9dd7-6d8d8a6cca58",
  moduleDigest: "40e1e24d964cca90a9c1619ba8939db65d0cc6d38a36962d1ab393441215f9f1",
  policy: demoCandidatePolicy,
  script: "effect-ci-hmd-demo",
});
const baseline = "f8526596-f9b8-4068-87c0-c517844488a8";
const once = { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" } as const;
export function assertRoutingDiagnosticPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object" || Object.getPrototypeOf(payload) !== Object.prototype || Reflect.ownKeys(payload).length !== 1)
    throw Error("Invalid routing diagnostic payload");
  const mode = Object.getOwnPropertyDescriptor(payload, "mode");
  if (!mode || !("value" in mode) || mode.value !== "observe-fixed-candidate") throw Error("Invalid routing diagnostic mode");
}
const plainView = (r: ReleaseView): ReleaseView => ({
  candidate: r.candidate, status: r.status,
  previous: r.previous.map(v => ({ version: v.version, percentage: v.percentage })),
  deployment: { id: r.deployment.id, versions: r.deployment.versions.map(v => ({ version: v.version, percentage: v.percentage })) },
});
export async function runRoutingDiagnostic(owner: string, step: WorkflowStep, broker: ReviewedReleaseBroker, transport: typeof fetch = fetch) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner)) throw Error("Invalid routing diagnostic owner");
  const expected = routingDiagnosticCandidate;
  await step.do("routing:verify-prepared", once, async () => {
    const r = await broker.prepareCandidate(expected.revision, expected.digest);
    for (const key of ["revision", "digest", "version", "moduleDigest", "policy", "script"] as const)
      if (r[key] !== expected[key]) throw Error("Routing diagnostic prepared receipt mismatch");
    return { ...expected, uploadPerformed: false };
  });
  const claimed = await step.do("routing:claim", once, async () => plainView(await broker.begin(owner, expected.version)));
  let restored: ReleaseView | undefined;
  const observations: Array<{ scheduledSeconds: number; unkeyed: Awaited<ReturnType<typeof observe>>; keyed: Awaited<ReturnType<typeof observe>> }> = [];
  async function observe(identity: string, keyed: boolean, allowed: ReadonlyArray<string>) {
    const start = Date.now();
    const cohort = await probeRelease(identity, allowed, (input, init) => {
      const headers = new Headers(init?.headers);
      if (!keyed) headers.delete("Cloudflare-Workers-Version-Key");
      return transport(input, { ...init, headers });
    });
    const counts = allowed.map(version => ({ version, trials: cohort.outcomes.filter(o => o.version === version).length, failures: cohort.outcomes.filter(o => o.version === version && !o.healthy).length }));
    return { start, end: Date.now(), requested: cohort.requested, unknown: cohort.unknown, counts };
  }
  try {
    if (claimed.candidate !== expected.version || claimed.status !== "active" || claimed.previous.length !== 1 || claimed.previous[0]?.version !== baseline || claimed.previous[0]?.percentage !== 100)
      throw Error("Unsupported diagnostic baseline");
    const before = await step.do("routing:baseline", once, () => observe(`${owner}-baseline`, true, [baseline]));
    if (before.unknown || before.counts[0]?.trials !== 100 || before.counts[0]?.failures) throw Error("Invalid diagnostic baseline health");
    for (const [scheduledSeconds, sleep] of [[0, 0], [30, 30], [120, 90]] as const) {
      if (sleep) await step.sleep(`routing:wait-${scheduledSeconds}`, `${sleep} seconds`);
      await step.do(`routing:allocation-${scheduledSeconds}`, once, async () => {
        await broker.renew(owner);
        const r = plainView(await broker.promote(owner, 10));
        if (r.status !== "active" || r.candidate !== expected.version || r.deployment.versions.length !== 2 || !r.deployment.versions.some(v => v.version === baseline && v.percentage === 90) || !r.deployment.versions.some(v => v.version === expected.version && v.percentage === 10)) throw Error("Diagnostic allocation drift");
        return r;
      });
      const unkeyed = await step.do(`routing:probe-unkeyed-${scheduledSeconds}`, once, () => observe(`${owner}-${scheduledSeconds}-unkeyed`, false, [baseline, expected.version]));
      const keyed = await step.do(`routing:probe-keyed-${scheduledSeconds}`, once, () => observe(`${owner}-${scheduledSeconds}-keyed`, true, [baseline, expected.version]));
      observations.push({ scheduledSeconds, unkeyed, keyed });
    }
  } finally {
    restored = await step.do("routing:restore", once, async () => plainView(await broker.rollback(owner)));
    if (restored.status !== "rolled-back" || JSON.stringify(restored.deployment.versions) !== JSON.stringify(claimed.previous)) throw Error("Routing diagnostic recovery needs reconciliation");
  }
  return { diagnosticComplete: true, releaseCommitted: false, uploadPerformed: false, candidate: expected, previous: claimed.previous, observations, restored: restored.deployment };
}
