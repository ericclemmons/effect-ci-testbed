import assert from "node:assert/strict";
const url = new URL(process.env.OIDC_BROKER_URL);
assert.match(url.hostname, /^[^.]+\.[^.]+\.workers\.dev$/);
url.hostname = url.hostname.replace(/^[^.]+/, "effect-ci-oidc-wrangler");
const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
assert.equal(await response.text(), "Deployed with wrangler and temporary Effect CI credentials.\n");
console.log(`Verified ${url.origin}`);
