export type Enrollment = {
  enabled: boolean;
  appId: number;
  installationId: number;
  repositoryId: number;
  repository: string;
  runnerGroupId: number;
  lifetimeSeconds: number;
};
export type Job = { id: number; runId: number; attempt: number; sha: string };
export const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;
export const record = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? x as Record<string, unknown> : {};
export const RUNNER_LABEL = "effect-ci-cloudflare";
export const label = (_p: Enrollment): string => RUNNER_LABEL;
export const validEnrollment = (p: Enrollment): boolean =>
  p.enabled === true && positive(p.appId) && positive(p.installationId) &&
  positive(p.repositoryId) && positive(p.runnerGroupId) &&
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.repository) &&
  Number.isInteger(p.lifetimeSeconds) && p.lifetimeSeconds >= 300 && p.lifetimeSeconds <= 1800;

// No generic self-hosted/linux/x64 labels: a runner must not accidentally claim
// unrelated jobs. Labels are routing, NOT a job-level security boundary.
export function eligibleJob(value: unknown, p: Enrollment): Job | undefined {
  const job = record(value);
  if (!positive(job.id) || !positive(job.run_id) || !positive(job.run_attempt) ||
    typeof job.head_sha !== "string" || !/^[a-f0-9]{40}$/.test(job.head_sha) ||
    job.status !== "queued" || job.conclusion !== null ||
    !Array.isArray(job.labels) || job.labels.length !== 1 || job.labels[0] !== label(p)) return;
  return { id: job.id, runId: job.run_id, attempt: job.run_attempt, sha: job.head_sha };
}

export function webhookJob(value: unknown, p: Enrollment): Job | undefined {
  const event = record(value);
  const repo = record(event.repository);
  if (!validEnrollment(p) || event.action !== "queued" ||
    record(event.installation).id !== p.installationId ||
    repo.id !== p.repositoryId || repo.full_name !== p.repository || repo.private !== true) return;
  return eligibleJob(event.workflow_job, p);
}

export function trustedRun(value: unknown, job: Job, p: Enrollment): boolean {
  const run = record(value);
  const repo = record(run.repository);
  const head = record(run.head_repository);
  // First version intentionally accepts only private, same-repository pushes.
  // Neither a valid webhook signature nor a matching runs-on label authorizes
  // executing fork PRs or arbitrary public code on a credentialed runner.
  return run.id === job.runId && run.run_attempt === job.attempt &&
    run.head_sha === job.sha && run.event === "push" &&
    repo.id === p.repositoryId && repo.full_name === p.repository && repo.private === true &&
    head.id === p.repositoryId && head.full_name === p.repository;
}

export const jobKey = (job: Job): string => `${job.id}-${job.attempt}`;
export const sameEnrollment = (a: Enrollment, b: Enrollment): boolean =>
  a.enabled === b.enabled && a.appId === b.appId && a.installationId === b.installationId &&
  a.repositoryId === b.repositoryId && a.repository === b.repository &&
  a.runnerGroupId === b.runnerGroupId && a.lifetimeSeconds === b.lifetimeSeconds;
export const MAX_BODY = 256 * 1024;
export async function boundedBody(request: Request): Promise<string> {
  if (request.headers.has("content-encoding")) throw new Error("encoded-body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing-body");
  let bytes = new Uint8Array();
  const timer = setTimeout(() => { void reader.cancel(); }, 5000);
  let expired = false;
  const deadline = setTimeout(() => { expired = true; }, 4900);
  try {
    for (;;) {
      const part = await reader.read();
      if (expired) throw new Error("body-timeout");
      if (part.done) break;
      if (bytes.length + part.value.length > MAX_BODY) throw new Error("body-limit");
      const next = new Uint8Array(bytes.length + part.value.length);
      next.set(bytes); next.set(part.value, bytes.length); bytes = next;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timer); clearTimeout(deadline); void reader.cancel();
  }
}
