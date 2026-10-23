// Live, read-only probes. Never print credentials or API response bodies.
import assert from "node:assert/strict";

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId, OIDC_WORKER: worker, OIDC_OTHER_WORKER: other } = process.env;
assert.ok(token && /^[a-f0-9]{32}$/.test(accountId ?? "") && worker && other && worker !== other, "Live scope probe configuration missing");
const root = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const probes = [
  { name: "own-worker-source", path: `/workers/scripts/${encodeURIComponent(worker)}`, expected: 200 },
  { name: "other-worker-source", path: `/workers/scripts/${encodeURIComponent(other)}`, expected: 403 },
  { name: "r2-bucket-list", path: "/r2/buckets", expected: 403 },
];
for (const probe of probes) {
  const response = await fetch(root + probe.path, {
    headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  console.log(JSON.stringify({ probe: probe.name, status: response.status, expected: probe.expected }));
  assert.equal(response.status, probe.expected, `Scope probe failed: ${probe.name}`);
}
