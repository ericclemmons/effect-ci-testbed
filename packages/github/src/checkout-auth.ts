import { createAppJwt, type GitHubAppCredentials } from "./app.ts";

type Request = typeof fetch;
const headers = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "user-agent": "effect-ci",
  "x-github-api-version": "2026-03-10",
});
const failure = (operation: string, status?: number) =>
  Error(`GitHub checkout ${operation} failed${status === undefined ? "" : ` (${status})`}`);

async function body(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw failure("response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 65_536) throw failure("response");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw failure("response");
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Host-only scoped checkout. Installation identity comes from GitHub, never
 * remote request parameters. No token is returned, journaled or put in files.
 * Public repositories without an installation retain anonymous checkout.
 */
export async function withRepositoryCheckoutToken<A>(
  credentials: GitHubAppCredentials,
  repository: string,
  operation: (token: string | undefined) => Promise<A>,
  request: Request = fetch,
): Promise<A> {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
    repository,
  );
  if (!match || match.slice(1).some((part) => part === "." || part === "..")) {
    // Other public Git providers do not receive a GitHub credential.
    if (new URL(repository).hostname !== "github.com") return operation(undefined);
    throw failure("repository");
  }
  const call = async (path: string, init: RequestInit) => {
    try {
      return await request(`https://api.github.com${path}`, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw failure("transport");
    }
  };
  const jwt = await createAppJwt(credentials);
  const installation = await call(`/repos/${match[1]}/${match[2]}/installation`, {
    headers: headers(jwt),
  });
  if (installation.status === 404) {
    await installation.body?.cancel();
    return operation(undefined);
  }
  if (installation.status !== 200) {
    await installation.body?.cancel();
    throw failure("installation", installation.status);
  }
  const installed = await body(installation);
  if (
    !Number.isSafeInteger(installed.id) ||
    installed.id <= 0 ||
    String(installed.app_id) !== credentials.appId
  )
    throw failure("installation identity");
  const response = await call(`/app/installations/${installed.id}/access_tokens`, {
    method: "POST",
    headers: { ...headers(jwt), "content-type": "application/json" },
    body: JSON.stringify({ repositories: [match[2]], permissions: { contents: "read" } }),
  });
  if (response.status !== 201) {
    await response.body?.cancel();
    throw failure("token", response.status);
  }
  const result = await body(response);
  if (typeof result.token !== "string" || !/^[A-Za-z0-9_]{1,255}$/.test(result.token))
    throw failure("token response");
  const token = result.token;
  try {
    const permissions = result.permissions;
    if (
      !permissions ||
      permissions.contents !== "read" ||
      Object.entries(permissions).some(
        ([key, value]) => key !== "contents" && !(key === "metadata" && value === "read"),
      )
    )
      throw failure("token scope");
    return await operation(token);
  } finally {
    const revoked = await call("/installation/token", {
      method: "DELETE",
      headers: headers(token),
    });
    await revoked.body?.cancel();
    if (revoked.status !== 204 && revoked.status !== 401)
      throw failure("revocation", revoked.status);
  }
}
