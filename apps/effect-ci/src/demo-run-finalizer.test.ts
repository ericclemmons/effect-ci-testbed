import assert from "node:assert/strict";
import test from "node:test";
import type { HostFinalization } from "@effect-ci-testbed/github-cloudflare";
import { RunCard } from "../../../packages/github-cloudflare/src/run-card.ts";
import { demoSiteUrl } from "@effect-ci-testbed/cloudflare/demo-site";
import { finalizeDemoRun } from "./demo-run-finalizer.ts";

test("preview publication keeps a link on the same card without accessing release capabilities", async () => {
  const revision = "a".repeat(40), digest = "b".repeat(64);
  const url = demoSiteUrl({ revision, digest });
  const card = new RunCard({ instanceId: "preview-test", repository: "ericclemmons/effect-ci-testbed", revision });
  const published: string[] = [];
  const context = {
    parameters: { trigger: "github", repository: "https://github.com/ericclemmons/effect-ci-testbed", repositoryName: "ericclemmons/effect-ci-testbed",
      installationId: 165265172, ref: "refs/heads/demo/rehearsal", revision },
    value: { revision, digest, url }, card,
    get environment() { throw Error("Preview must not request a production binding"); },
    get step() { throw Error("Preview must not request a release checkpoint"); },
    get exports() { throw Error("Preview must not request approvals"); },
    publish: async (key: string) => { published.push(key); },
  } as unknown as HostFinalization<unknown>;
  await finalizeDemoRun(context);
  assert.deepEqual(published, ["preview-published"]);
  assert.ok(JSON.stringify(card.render({ statusOnly: true }).blocks).includes(url));
  const foreign = Object.create(context);
  Object.defineProperty(foreign, "value", { value: { revision, digest, url: "https://foreign.example/" } });
  await assert.rejects(finalizeDemoRun(foreign));
});
