import { createAppJwt } from "../../../packages/github/src/app.ts";
import { eligibleJob, label, positive, record, trustedRun, type Enrollment, type Job } from "./policy.ts";

export class GitHub {
  readonly policy: Enrollment;
  readonly privateKey: string;
  readonly request: typeof fetch;
  constructor(policy: Enrollment, privateKey: string, request: typeof fetch = (input, init) => fetch(input, init)) {
    this.policy = policy; this.privateKey = privateKey; this.request = request;
  }

  async api(path: string, token: string, method = "GET", body?: unknown): Promise<Response> {
    // Paths are constructed only from validated host policy and numeric API IDs.
    const response = await this.request(`https://api.github.com${path}`, {
      method, redirect: "manual", signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
        "user-agent": "effect-ci-github-actions-runner", "x-github-api-version": "2026-03-10",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status >= 300 && response.status !== 404)
      throw new Error(`github-${response.status}`);
    return response;
  }

  async token(): Promise<string> {
    const jwt = await createAppJwt({ appId: String(this.policy.appId), privateKey: this.privateKey });
    const response = await this.api(`/app/installations/${this.policy.installationId}/access_tokens`, jwt, "POST", {
      repository_ids: [this.policy.repositoryId],
      permissions: { administration: "write", actions: "read" },
    });
    const data = record(await response.json());
    if (response.status !== 201 || typeof data.token !== "string" || !data.token)
      throw new Error("installation-token-unavailable");
    return data.token;
  }

  get base(): string { return `/repos/${this.policy.repository}`; }

  async authorize(job: Job, token: string): Promise<boolean> {
    const repoResponse = await this.api(this.base, token);
    if (repoResponse.status !== 200) return false;
    const repo = record(await repoResponse.json());
    if (repo.id !== this.policy.repositoryId || repo.full_name !== this.policy.repository || repo.private !== true) return false;
    const response = await this.api(`${this.base}/actions/jobs/${job.id}`, token);
    if (response.status !== 200) return false;
    const current = eligibleJob(await response.json(), this.policy);
    if (!current || JSON.stringify(current) !== JSON.stringify(job)) return false;
    const run = await this.api(`${this.base}/actions/runs/${job.runId}`, token);
    return run.status === 200 && trustedRun(await run.json(), job, this.policy);
  }

  async jit(name: string, token: string): Promise<{ id: number; config: string }> {
    const response = await this.api(`${this.base}/actions/runners/generate-jitconfig`, token, "POST", {
      name, runner_group_id: this.policy.runnerGroupId, labels: [label(this.policy)], work_folder: "_work",
    });
    const data = record(await response.json());
    const runner = record(data.runner);
    if (response.status !== 201 || !positive(runner.id) || runner.name !== name ||
      !Array.isArray(runner.labels) || runner.labels.length !== 1 || record(runner.labels[0]).name !== label(this.policy) ||
      typeof data.encoded_jit_config !== "string" || !data.encoded_jit_config)
      throw new Error("jit-response-uncertain");
    return { id: runner.id, config: data.encoded_jit_config };
  }

  async runner(id: number, name: string, token: string): Promise<boolean> {
    const response = await this.api(`${this.base}/actions/runners/${id}`, token);
    if (response.status === 404) return false;
    const data = record(await response.json());
    if (data.id !== id || data.name !== name) throw new Error("runner-identity-mismatch");
    return true;
  }

  async remove(id: number, name: string, token: string): Promise<void> {
    if (!await this.runner(id, name, token)) return;
    const response = await this.api(`${this.base}/actions/runners/${id}`, token, "DELETE");
    if (response.status !== 204 && response.status !== 404) throw new Error("runner-cleanup-incomplete");
  }

  async find(name: string, token: string): Promise<number | undefined> {
    // Bounded complete enumeration; an incomplete listing is not absence.
    for (let page = 1; page <= 10; page++) {
      const response = await this.api(`${this.base}/actions/runners?per_page=100&page=${page}`, token);
      if (response.status !== 200) throw new Error("runner-list-unavailable");
      const data = record(await response.json());
      if (!Array.isArray(data.runners)) throw new Error("runner-list-invalid");
      const matches = data.runners.map(record).filter((r) => r.name === name);
      if (matches.length > 1) throw new Error("runner-name-ambiguous");
      if (matches.length === 1 && positive(matches[0]!.id)) return matches[0]!.id as number;
      if (data.runners.length < 100) return;
    }
    throw new Error("runner-list-limit");
  }
}
