// Fixed owned-target recovery for a deploy that uploaded but did not enable workers.dev.
// No script/version upload, deployment POST, preview enable, DNS or arbitrary URL input.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { parseEnv } from "node:util";
const endpoint = "https://api.cloudflare.com/client/v4/accounts/0db135ec469e2f216fcea26426f29755/workers/scripts/effect-ci-static-assets-demo";
const origin = "https://effect-ci-static-assets-demo.ericclemmons.workers.dev/";
const secretFile = new URL("../.secrets.env", import.meta.url);
if ((statSync(secretFile).mode & 0o777) !== 0o600) throw Error("Secret file must be mode 600");
const env = parseEnv(readFileSync(secretFile, "utf8"));
if (Object.keys(env).length !== 1 || !/^[\x21-\x7e]{40,1024}$/.test(env.STATIC_ASSETS_DEPLOY_TOKEN ?? "")) throw Error("Expected only the dedicated token assignment");
const bounded = async response => {
  if (!response.body) throw Error("Hostname response body unavailable");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if (size > 128 * 1024) throw Error("Hostname response limit exceeded"); chunks.push(part.value);
  } } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};
const request = async (path, method = "GET", body) => {
  const response = await fetch(endpoint + path, { method, redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${env.STATIC_ASSETS_DEPLOY_TOKEN}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status !== 200 || response.redirected) { await response.body?.cancel(); throw Error(`Hostname API rejected request (HTTP ${response.status})`); }
  const result = JSON.parse(await bounded(response));
  if (result.success !== true) throw Error("Hostname API did not acknowledge request");
  return result.result;
};
const [mode, argument, receiptDirectory] = process.argv.slice(2);
const directory = mode === "enable" ? receiptDirectory : argument;
const save = (name, value) => {
  if (!directory || !isAbsolute(directory) || !statSync(directory).isDirectory() || (statSync(directory).mode & 0o777) !== 0o700) throw Error("Use a private absolute receipt directory (mode 700)");
  writeFileSync(resolve(directory, name + ".json"), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
};
if (mode === "inspect") {
  const settings = await request("/subdomain");
  console.log(JSON.stringify({ enabled: settings.enabled, previews_enabled: settings.previews_enabled }));
} else if (mode === "enable") {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(argument ?? "")) throw Error("Expected the independently read bootstrap version UUID");
  const before = await request("/subdomain"), allocation = await request("/deployments?per_page=1"), version = await request("/versions/" + argument);
  const entries = allocation?.deployments?.[0]?.versions;
  if (before.enabled !== false || before.previews_enabled !== false || version?.id !== argument ||
    (version.resources?.bindings ?? []).length !== 0 || entries?.length !== 1 || entries[0].version_id !== argument || entries[0].percentage !== 100) throw Error("Not the expected unexposed, unbound bootstrap; no mutation");
  save("hostname-intent", { at: new Date().toISOString(), target: "effect-ci-static-assets-demo", expectedVersion: argument, before, allocation,
    request: { enabled: true, previews_enabled: false }, operation: "ONE hostname enable only; keep this intent on uncertain acknowledgement; never repeat blindly" });
  const acknowledged = await request("/subdomain", "POST", { enabled: true, previews_enabled: false });
  save("hostname-acknowledgement", { at: new Date().toISOString(), enabled: acknowledged.enabled, previews_enabled: acknowledged.previews_enabled });
  console.log(JSON.stringify({ acknowledged: true, next: "Run readback, not enable again" }));
} else if (mode === "readback") {
  if (!directory || !isAbsolute(directory)) throw Error("Expected the same private receipt directory");
  const intent = JSON.parse(readFileSync(resolve(directory, "hostname-intent.json"), "utf8"));
  if (intent.target !== "effect-ci-static-assets-demo") throw Error("Foreign hostname intent");
  const settings = await request("/subdomain");
  const response = await fetch(origin, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  const body = await bounded(response);
  if (settings.enabled !== true || settings.previews_enabled !== false || response.status !== 404 || body !== "No static revision published") throw Error("Exact bootstrap not yet verified; preserve intent and use readback later, no new write");
  save("hostname-receipt", { at: new Date().toISOString(), settings, status: response.status, body, verified: true });
  console.log(JSON.stringify({ verified: true, uploadedAgain: false }));
} else throw Error("Use inspect | enable EXPECTED_VERSION PRIVATE_RECEIPT_DIRECTORY | readback PRIVATE_RECEIPT_DIRECTORY");
