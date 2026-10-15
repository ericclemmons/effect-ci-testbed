import * as CI from "@effect-ci-testbed/ci";
import { StaticAssets } from "@effect-ci-testbed/cloudflare/static-assets-service";
import type { StaticAssetReceipt } from "@effect-ci-testbed/cloudflare/static-assets-journal";
const capture = CI.action<string>("capture pinned static source", () => function* () {
  if ((yield* CI.executionMode) === "plan") return "";
  return yield* (yield* StaticAssets).capture();
});
const publish = CI.action<string>("upload and deploy static assets", () => function* () {
  const revision = yield* capture();
  if ((yield* CI.executionMode) === "plan") return revision;
  const host = yield* StaticAssets;
  return yield* host.publish(revision);
});
const verify = CI.action<StaticAssetReceipt>("verify served static assets", () => function* () {
  const revision = yield* publish();
  if ((yield* CI.executionMode) === "plan") return { revision: "", manifestDigest: "", assetDigest: "", version: "", deployment: "", target: "effect-ci-static-assets-demo", policy: "owned-static-assets-v1" };
  const host = yield* StaticAssets;
  return yield* host.verify(revision);
});
export default CI.workflow("static-assets-source", () => verify());
