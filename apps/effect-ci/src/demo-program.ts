import * as CI from "@effect-ci-testbed/ci";
import manifest from "../../../examples/demo/package.json" with { type: "json" };
import { syntaxCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import * as Effect from "effect/Effect";
import { demoReleaseError, demoPublicationError } from "./demo-release-error.ts";
import {
  demoCandidatePolicy,
  type DemoCandidateReceipt,
} from "@effect-ci-testbed/cloudflare/demo-candidate";
import {
  demoAssetNames,
  demoAssets,
  demoSite,
  demoSiteUrl,
  type DemoAssets,
} from "@effect-ci-testbed/cloudflare/demo-site";

/** Host-selected manifest data; no project module executes inside the host. */
const inferred = CI.fromPackageJson(manifest);
const syntax = CI.check(
  "syntax",
  () =>
    function* () {
      const workspace = yield* inferred.checkout();
      yield* workspace.exec(syntaxCommand);
    },
  { reuse: { scope: "commit" } },
);
const verifyBuild = CI.action(
  "verify build",
  () =>
    function* () {
      const workspace = yield* inferred.actions.build!();
      return yield* workspace.exec("node .cloudflare/ci/verify-build.ts");
    },
);
export function makeDemoProgram(publisher?: {
  revision: string;
  publish: (assets: DemoAssets) => Promise<{ revision: string; digest: string; url: string }>;
  prepare?: (revision: string, digest: string) => Promise<DemoCandidateReceipt>;
}) {
  const publish = CI.action<{ revision: string; digest: string; url: string }>(
    "publish site",
    function* () {
      const workspace = yield* verifyBuild();
      return function* () {
        const assets = {} as DemoAssets;
        for (const name of demoAssetNames) {
          const value = yield* workspace.readFile(`dist/${name}`);
          if (value === undefined) return yield* Effect.fail(Error("Missing built asset"));
          assets[name] = value;
        }
        const bounded = demoAssets(assets);
        return yield* Effect.tryPromise({ try: async () => {
          const expected = await demoSite(publisher!.revision, bounded);
          const receipt = await publisher!.publish(bounded);
          if (
            receipt.revision !== expected.revision ||
            receipt.digest !== expected.digest ||
            receipt.url !== demoSiteUrl(expected)
          )
            throw Error("Publication identity mismatch");
          return { revision: receipt.revision, digest: receipt.digest, url: receipt.url };
        }, catch: demoPublicationError });
      };
    },
    { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
  );
  const prepare = CI.action<DemoCandidateReceipt>(
    "prepare release",
    function* () {
      const published = yield* publish();
      return () =>
        Effect.tryPromise({ try: async () => {
          const receipt = await publisher!.prepare!(published.revision, published.digest);
          if (
            receipt.revision !== published.revision ||
            receipt.digest !== published.digest ||
            receipt.policy !== demoCandidatePolicy ||
            receipt.script !== "effect-ci-hmd-demo" ||
            !/^[a-f0-9]{64}$/.test(receipt.moduleDigest) ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(receipt.version)
          )
            throw Error("Prepared release identity mismatch");
          return {
            revision: receipt.revision,
            digest: receipt.digest,
            moduleDigest: receipt.moduleDigest,
            policy: receipt.policy,
            script: receipt.script,
            version: receipt.version,
          };
        }, catch: demoReleaseError });
    },
    { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" },
  );
  return {
    ...inferred,
    workflow: CI.workflow(manifest.name, function* () {
      yield* syntax();
      yield* inferred.workflow.effect;
      return publisher?.prepare
        ? yield* prepare()
        : publisher
          ? yield* publish()
          : yield* verifyBuild();
    }),
  };
}
export const demoProgram = makeDemoProgram();
