import type { GitHubAppCredentials } from "./app.ts";
import {
  FIXED_SOURCE,
  REPAIR_BASE,
  REPAIR_COMMAND,
  REPAIR_PATH,
  REPAIR_REPOSITORY,
  repairBlobHash,
  repairTreeHash,
  type GitTreeEntry,
  withRepairCheckToken,
  type RepairVerification,
} from "./repair.ts";

// Trusted host fixtures. A repository cannot change the verifier's test or runner.
export const OWNED_TEST =
  'import assert from "node:assert/strict"\nimport test from "node:test"\nimport { healthStatus } from "./health.js"\ntest("owned demo health status is healthy", () => assert.equal(healthStatus(), 200))\n';
export const OWNED_PACKAGE =
  '{\n  "name": "effect-ci-owned-repair-fixture",\n  "private": true,\n  "type": "module"\n}\n';
export const OWNED_BASE = "352327387f610d84282a567bf9a40ceee3978950";
export const OWNED_NODE_COMMAND = `env -i PATH=/usr/local/bin:/usr/bin:/bin ${REPAIR_COMMAND}`;
export const HOST_CHECK_NAME = "Effect CI repair / owned health check (native Node)";
type File = { path: string; base64: string; executable: false };
export interface OwnedExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
}
/** This callback is host implementation, never project/model/RPC-supplied. */
export type ExecuteOwnedNode = (
  files: readonly File[],
  command: typeof OWNED_NODE_COMMAND,
) => Promise<OwnedExecution>;
const root = `https://api.github.com/repos/${REPAIR_REPOSITORY}`;
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const reject = () => new Error("Owned native verification rejected; reconcile before retrying");
const hash = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function api(
  fetcher: typeof fetch,
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  try {
    const response = await fetcher(root + path, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "effect-ci-owned-native-verifier",
        "x-github-api-version": "2026-03-10",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const reader = response.body?.getReader();
    if (!reader) throw reject();
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      if (!response.ok) throw reject();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 64 * 1024) throw reject();
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch {
    throw reject();
  }
}

/** Exact-commit fetch -> pinned byte validation -> actual host Node -> owned check.
 * No project token, code, callback, command, repository or test is a parameter.
 */
export async function verifyOwnedRepair(
  credentials: GitHubAppCredentials,
  commit: string,
  runId: string,
  execute: ExecuteOwnedNode,
  fetcher: typeof fetch = fetch,
): Promise<RepairVerification> {
  if (!sha(commit) || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(runId)) throw reject();
  const sourceDigest = await hash(FIXED_SOURCE);
  return withRepairCheckToken(
    credentials,
    async (token) => {
      const read = (path: string) => api(fetcher, token, path);
      const base = await read(`/git/ref/heads/${REPAIR_BASE}`);
      const ref = await read(`/git/ref/heads/codex/repair-${runId}`);
      const data = await read(`/git/commits/${commit}`);
      const message = `Repair owned demo health status\n\nEffect-CI-Repair: ${runId}\nEffect-CI-Base: ${OWNED_BASE}\nEffect-CI-Patch-SHA256: ${sourceDigest}`;
      if (
        base.ref !== `refs/heads/${REPAIR_BASE}` ||
        base.object?.sha !== OWNED_BASE ||
        base.object?.type !== "commit" ||
        ref.ref !== `refs/heads/codex/repair-${runId}` ||
        ref.object?.sha !== commit ||
        ref.object?.type !== "commit" ||
        data.sha !== commit ||
        !sha(data.tree?.sha) ||
        data.message !== message ||
        !Array.isArray(data.parents) ||
        data.parents.length !== 1 ||
        data.parents[0]?.sha !== OWNED_BASE
      )
        throw reject();
      const getTree = async (id: string): Promise<GitTreeEntry[]> => {
        const value = await read(`/git/trees/${id}`);
        if (
          value?.sha !== id ||
          value.truncated ||
          !Array.isArray(value.tree) ||
          value.tree.length > 128
        )
          throw reject();
        const names = new Set<string>();
        for (const entry of value.tree) {
          if (
            !entry ||
            typeof entry.path !== "string" ||
            !/^[A-Za-z0-9._-]{1,100}$/.test(entry.path) ||
            [".", ".."].includes(entry.path) ||
            names.has(entry.path) ||
            !sha(entry.sha) ||
            !(
              (entry.type === "tree" && entry.mode === "040000") ||
              (entry.type === "blob" && ["100644", "100755"].includes(entry.mode))
            )
          )
            throw reject();
          names.add(entry.path);
        }
        const entries = value.tree.map(({ path, mode, type, sha }: GitTreeEntry) => ({
          path,
          mode,
          type,
          sha,
        }));
        if ((await repairTreeHash(entries)) !== id) throw reject();
        return entries;
      };
      const rootTree = await getTree(data.tree.sha);
      const directory = rootTree.find(
        (entry) => entry.path === "repair-demo" && entry.type === "tree" && entry.mode === "040000",
      );
      if (!directory) throw reject();
      const directoryTree = await getTree(directory.sha);
      const files: File[] = [];
      for (const [path, text] of [
        [REPAIR_PATH, FIXED_SOURCE],
        ["repair-demo/health.test.mjs", OWNED_TEST],
        ["repair-demo/package.json", OWNED_PACKAGE],
      ] as const) {
        const blobSha = await repairBlobHash(text);
        const entry = directoryTree.find(
          (entry) => entry.path === path.slice("repair-demo/".length),
        );
        if (entry?.type !== "blob" || entry.mode !== "100644" || entry.sha !== blobSha)
          throw reject();
        const value = await read(`/contents/${path}?ref=${commit}`);
        if (
          value.type !== "file" ||
          value.path !== path ||
          value.encoding !== "base64" ||
          typeof value.content !== "string" ||
          value.content.length > 4096 ||
          value.sha !== blobSha ||
          value.content.replace(/\s/g, "") !== btoa(text)
        )
          throw reject();
        files.push({ path, base64: btoa(text), executable: false });
      }
      let result: OwnedExecution;
      try {
        result = await execute(files, OWNED_NODE_COMMAND);
      } catch {
        throw reject();
      }
      if (
        result.exitCode !== 0 ||
        typeof result.stdout !== "string" ||
        typeof result.stderr !== "string" ||
        new TextEncoder().encode(result.stdout + result.stderr).length > 64 * 1024
      )
        throw reject();
      // Only host-produced identity/summary is published, never raw container or API bodies.
      const externalId = `owned-native-repair:${runId}:${commit}:${sourceDigest}`;
      const inventory = await read(
        `/commits/${commit}/check-runs?check_name=${encodeURIComponent(HOST_CHECK_NAME)}&filter=all&per_page=100`,
      );
      if (
        !Array.isArray(inventory.check_runs) ||
        !Number.isSafeInteger(inventory.total_count) ||
        inventory.total_count > 100 ||
        inventory.total_count !== inventory.check_runs.length
      )
        throw reject();
      const matches = inventory.check_runs.filter((check: any) => check.external_id === externalId);
      if (matches.length > 1) throw reject();
      const summary = `Exact commit: ${commit}\nSource SHA-256: ${sourceDigest}\nCommand: ${OWNED_NODE_COMMAND}\nThree pinned files fetched from this commit and materialized without credentials. Actual native Node exit code: 0.\nNo merge or deployment.`;
      let check = matches[0];
      if (!check)
        check = await api(fetcher, token, "/check-runs", "POST", {
          name: HOST_CHECK_NAME,
          head_sha: commit,
          status: "completed",
          conclusion: "success",
          external_id: externalId,
          output: { title: "Owned exact-commit Node check passed natively", summary },
        });
      if (
        !Number.isSafeInteger(check?.id) ||
        check.id < 1 ||
        check.app?.id !== 5089816 ||
        check.head_sha !== commit ||
        check.name !== HOST_CHECK_NAME ||
        check.external_id !== externalId ||
        check.status !== "completed" ||
        check.conclusion !== "success" ||
        check.output?.summary !== summary
      )
        throw reject();
      // Re-read refs after the command/check. A drifted base/candidate cannot authorize a PR.
      if (
        (await read(`/git/ref/heads/${REPAIR_BASE}`)).object?.sha !== OWNED_BASE ||
        (await read(`/git/ref/heads/codex/repair-${runId}`)).object?.sha !== commit
      )
        throw reject();
      return { commit, sourceDigest, passed: true, evidenceId: `github_check_${check.id}` };
    },
    fetcher,
  );
}
