import { createAppJwt } from "@effect-ci-testbed/github";
import { readBounded } from "../../containerless-site/src/site.ts";
import { previewNumber, previewPolicy } from "./policy.ts";

export interface PreviewEnvironment {
  LOADER: WorkerLoader;
  PREVIEW_AUTHORITY?: string;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  PREVIEW_NOTIFY_PULL_REQUESTS?: string;
}

export function notificationPullRequests(environment: PreviewEnvironment): number[] {
  if (!environment.PREVIEW_NOTIFY_PULL_REQUESTS) return [];
  if (environment.PREVIEW_NOTIFY_PULL_REQUESTS.length > 256) throw Error("Invalid notification authority");
  const numbers = environment.PREVIEW_NOTIFY_PULL_REQUESTS.split(",").map(value => {
    if (!/^[1-9][0-9]*$/.test(value)) throw Error("Invalid notification authority");
    return previewNumber(Number(value));
  });
  if (numbers.length > previewPolicy.pullRequests || new Set(numbers).size !== numbers.length)
    throw Error("Invalid notification authority");
  return numbers;
}

export function assertAuthority(environment: PreviewEnvironment): void {
  if (environment.PREVIEW_AUTHORITY !== previewPolicy.authority ||
    environment.GITHUB_APP_ID !== previewPolicy.appId)
    throw Error("Exact preview authority is not configured");
  notificationPullRequests(environment);
}

async function request(token: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://api.github.com${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(5000),
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
      "content-type": "application/json", "user-agent": "effect-ci-testbed", "x-github-api-version": "2026-03-10" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response;
}

export async function withPreviewToken<Value>(environment: PreviewEnvironment, operation: (token: string) => Promise<Value>): Promise<Value> {
  assertAuthority(environment);
  const jwt = await createAppJwt({ appId: environment.GITHUB_APP_ID, privateKey: environment.GITHUB_PRIVATE_KEY });
  const response = await request(jwt, `/app/installations/${previewPolicy.installationId}/access_tokens`, "POST", {
    repositories: ["effect-ci-testbed"], permissions: { contents: "read", pull_requests: "read",
      ...(notificationPullRequests(environment).length ? { issues: "write" } : {}) },
  });
  if (!response.ok) { await response.body?.cancel(); throw Error("Scoped preview token unavailable"); }
  const value = JSON.parse(await readBounded(response, 16_384));
  if (typeof value.token !== "string" || !value.token) throw Error("Invalid preview token");
  try { return await operation(value.token); }
  finally {
    const revoked = await request(value.token, "/installation/token", "DELETE");
    await revoked.body?.cancel();
    if (revoked.status !== 204) throw Error("Preview token revocation unavailable");
  }
}

export async function currentPullRequest(token: string, raw: number) {
  const number = previewNumber(raw);
  const response = await request(token, `/repos/${previewPolicy.repository}/pulls/${number}`);
  if (!response.ok) { await response.body?.cancel(); throw Error("PR read unavailable"); }
  const value = JSON.parse(await readBounded(response, 131_072));
  if (value.number !== number || value.base?.repo?.full_name !== previewPolicy.repository ||
    !["open", "closed"].includes(value.state) || !/^[a-f0-9]{40}$/.test(value.head?.sha) ||
    typeof value.head?.ref !== "string" || !value.head.ref || value.head.ref.length > 255)
    throw Error("Invalid canonical PR");
  const fork = value.head.repo?.full_name !== previewPolicy.repository || value.head.repo?.fork !== false;
  let deleted = false;
  if (value.state === "open" && !fork) {
    const ref = await request(token, `/repos/${previewPolicy.repository}/git/ref/heads/${value.head.ref.split("/").map(encodeURIComponent).join("/")}`);
    deleted = ref.status === 404;
    if (!ref.ok && !deleted) { await ref.body?.cancel(); throw Error("Branch read unavailable"); }
    if (ref.ok) {
      const branch = JSON.parse(await readBounded(ref, 16_384));
      if (branch.ref !== `refs/heads/${value.head.ref}` || branch.object?.type !== "commit" || branch.object.sha !== value.head.sha)
        throw Error("Canonical PR and branch heads differ");
    } else await ref.body?.cancel();
  }
  return { revision: value.head.sha as string, ref: value.head.ref as string,
    phase: fork ? "fork" as const : value.state === "closed" || deleted ? "closed" as const : "open" as const };
}
