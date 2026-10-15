import { createAppJwt, type GitHubAppCredentials } from "../../../packages/github/src/app.ts";

const base = "https://api.github.com/repos/ericclemmons/effect-ci-testbed/git/";
const unavailable = () => new Error("Demo evidence read unavailable");

/** Host-only GET capability. No token is returned to the adapter or project. */
export const withDemoEvidenceRead = async (
  credentials: GitHubAppCredentials,
  operation: (request: typeof fetch) => Promise<boolean>,
  transport: typeof fetch = fetch,
): Promise<boolean> => {
  if (credentials.appId !== "5089816") throw unavailable();
  const jwt = await createAppJwt(credentials);
  const headers = (token: string) => ({
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "effect-ci-demo-check-evidence",
    "x-github-api-version": "2026-03-10",
    "content-type": "application/json",
  });
  const response = await transport(
    "https://api.github.com/app/installations/165265172/access_tokens",
    {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: headers(jwt),
      body: JSON.stringify({
        repositories: ["effect-ci-testbed"],
        permissions: { contents: "read" },
      }),
    },
  );
  if (!response.ok || response.redirected || !response.body) {
    await response.body?.cancel();
    throw unavailable();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 65_536) throw unavailable();
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  // Installation tokens are opaque, not necessarily legacy ghs_ alphanumerics.
  // Bound size and reject header controls/whitespace, not valid punctuation.
  if (typeof result.token !== "string" || !/^[\x21-\x7e]{1,1024}$/.test(result.token))
    throw unavailable();
  const token = result.token;
  try {
    if (
      !result.permissions ||
      result.permissions.contents !== "read" ||
      Object.keys(result.permissions).some((key) => !["contents", "metadata"].includes(key)) ||
      (result.permissions.metadata !== undefined && result.permissions.metadata !== "read")
    )
      throw unavailable();
    return await operation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (
        !url.startsWith(base) ||
        !/^(?:ref\/notes\/effect-ci-hosted-checks-v1|commits\/[a-f0-9]{40}|trees\/[a-f0-9]{40}\?recursive=1|blobs\/[a-f0-9]{40})$/.test(
          url.slice(base.length),
        ) ||
        (init?.method ?? "GET") !== "GET"
      )
        throw unavailable();
      return transport(url, {
        ...init,
        method: "GET",
        redirect: "manual",
        headers: { ...headers(token) },
      });
    });
  } finally {
    const revoked = await transport("https://api.github.com/installation/token", {
      method: "DELETE",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: headers(token),
    });
    await revoked.body?.cancel();
    if (revoked.status !== 204 || revoked.redirected) throw unavailable();
  }
};
