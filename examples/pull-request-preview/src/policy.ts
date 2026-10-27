export const previewPolicy = Object.freeze({
  authority: "pr-previews-v1:da2f8f3e41d6b5018df12a58b417d918:16-prs:64-builds:24h:same-repo-only",
  accountId: "da2f8f3e41d6b5018df12a58b417d918",
  repository: "ericclemmons/effect-ci-testbed",
  installationId: 165265172,
  appId: "5089816",
  botUserId: 334321206,
  origin: "https://effect-ci-pr-previews.eric-clemmons-da2.workers.dev",
  pullRequests: 16,
  builds: 64,
  lifetimeMs: 24 * 60 * 60 * 1000,
});

export interface PreviewLease {
  number: number;
  generation: number;
  revision: string;
}

export function previewNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw Error("Invalid PR number");
  return Number(value);
}

export function previewLease(value: PreviewLease): PreviewLease {
  if (!value || !/^[a-f0-9]{40}$/.test(value.revision) ||
    !Number.isSafeInteger(value.generation) || value.generation < 1)
    throw Error("Invalid preview lease");
  return { number: previewNumber(value.number), generation: value.generation, revision: value.revision };
}

export function previewInstance(value: PreviewLease): string {
  const lease = previewLease(value);
  return `pr-${lease.number}-${lease.generation}-${lease.revision}`;
}

export function previewUrl(lease: PreviewLease, digest: string): string {
  previewLease(lease);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw Error("Invalid preview digest");
  return `${previewPolicy.origin}/pr/${lease.number}/${lease.generation}/${lease.revision}/${digest}/index.html`;
}
