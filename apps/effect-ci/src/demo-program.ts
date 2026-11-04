import * as CI from "@effect-ci-testbed/ci";
import manifest from "../../../test/fixtures/demo/package.json" with { type: "json" };
import { syntaxCommand } from "@effect-ci-testbed/cloudflare/node-syntax-check";
import { testCommand } from "@effect-ci-testbed/cloudflare/demo-test-check";
import * as Effect from "effect/Effect";
import { demoRemoteSelection } from "./demo-policy.ts";
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
const testSuite = CI.check(
  "test",
  function* () {
    // Own the prerequisite even for `run test build`; a suite note never skips it.
    const workspace = yield* inferred.actions.typecheck!();
    return function* () {
      yield* workspace.exec(testCommand);
    };
  },
  { reuse: { scope: "commit" } },
);
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
export function makeDemoProgram(
  publisher?: {
    revision: string;
    publish: (assets: DemoAssets) => Promise<{ revision: string; digest: string; url: string }>;
    prepare?: (revision: string, digest: string) => Promise<DemoCandidateReceipt>;
  },
  targets?: ReadonlyArray<string>,
) {
  const selection = targets === undefined ? undefined : demoRemoteSelection({ targets });
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
        return yield* Effect.tryPromise({
          try: async () => {
            const expected = await demoSite(publisher!.revision, bounded);
            const receipt = await publisher!.publish(bounded);
            if (
              receipt.revision !== expected.revision ||
              receipt.digest !== expected.digest ||
              receipt.url !== demoSiteUrl(expected)
            )
              throw Error("Publication identity mismatch");
            return { revision: receipt.revision, digest: receipt.digest, url: receipt.url };
          },
          catch: demoPublicationError,
        });
      };
    },
    { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
  );
  const prepare = CI.action<DemoCandidateReceipt>(
    "prepare release",
    function* () {
      const published = yield* publish();
      return () =>
        Effect.tryPromise({
          try: async () => {
            const receipt = await publisher!.prepare!(published.revision, published.digest);
            if (
              receipt.revision !== published.revision ||
              receipt.digest !== published.digest ||
              receipt.policy !== demoCandidatePolicy ||
              receipt.script !== "effect-ci-hmd-demo" ||
              !/^[a-f0-9]{64}$/.test(receipt.moduleDigest) ||
              !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
                receipt.version,
              )
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
          },
          catch: demoReleaseError,
        });
    },
    { retries: { limit: 0, delay: "1 second" }, timeout: "2 minutes" },
  );
  return {
    ...inferred,
    workflow: CI.workflow(manifest.name, function* () {
      if (selection) {
        // Explicit goals are computation-only. Do not reach the default suite,
        // syntax policy, publisher, candidate creation or release finalizer.
        return yield* CI.parallel(
          selection.map((target) =>
            target === "test" ? testSuite() : inferred.actions[target]!(),
          ),
        );
      }
      yield* syntax();
      for (const name of ["lint", "check", "typecheck", "test", "build"]) {
        if (name === "test") yield* testSuite();
        else yield* inferred.actions[name]!();
      }
      return publisher?.prepare
        ? yield* prepare()
        : publisher
          ? yield* publish()
          : yield* verifyBuild();
    }),
  };
}
export const demoProgram = makeDemoProgram();
