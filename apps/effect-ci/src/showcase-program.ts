import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createDemoProgram } from "../../../examples/demo/tutorial/program.ts";
import { demoAssetNames, demoAssets, demoSite, demoSiteUrl, type DemoAssets } from "@effect-ci-testbed/cloudflare/demo-site";
import { readPublishedDemo } from "@effect-ci-testbed/cloudflare/demo-candidate";
import { demoPublicationError } from "./demo-release-error.ts";
import { ShowcaseRevision, decodeShowcasePublication } from "./showcase-protocol.ts";
import { showcaseTestCommand, showcaseSourceInspectCommand } from "./showcase-check-policy.ts";
export type { ShowcaseSiteReceipt } from "./showcase-protocol.ts";

/** Closed host capability. No destination, credential or arbitrary module enters
 * project execution. This imports our deployed authored graph, never pushed JS. */
export function showcaseProgram(options: {
  readonly revision: string;
  readonly publish: (revision: string, assets: DemoAssets) => Promise<unknown>;
  readonly transport?: typeof fetch;
}) {
  try { Schema.decodeUnknownSync(ShowcaseRevision)(options.revision); }
  catch { throw Error("Full showcase revision required"); }
  return createDemoProgram({
    install: true,
    beforeInstall: workspace => workspace.exec(showcaseSourceInspectCommand).pipe(Effect.asVoid),
    testCommand: showcaseTestCommand,
    publishStep: "publish preview",
    publish: workspace => Effect.gen(function* () {
      // Verify the complete output set, not just the three files we read.
      // A fourth shared chunk must fail before any host publication request.
      yield* workspace.exec("/usr/local/bin/node /opt/effect-ci-showcase/verify-build.cjs");
      const assets = {} as DemoAssets;
      for (const name of demoAssetNames) {
        const value = yield* workspace.readFile(`dist/${name}`);
        if (value === undefined) return yield* Effect.fail(Error("Missing checked build asset"));
        assets[name] = value;
      }
      const bounded = demoAssets(assets);
      const expected = yield* Effect.tryPromise(() => demoSite(options.revision, bounded));
      const untrusted = yield* Effect.tryPromise({
        try: () => options.publish(options.revision, bounded), catch: demoPublicationError,
      });
      const receipt = yield* decodeShowcasePublication(untrusted);
      if (receipt.revision !== expected.revision || receipt.digest !== expected.digest || receipt.url !== demoSiteUrl(expected))
        return yield* Effect.fail(Error("Showcase publication identity mismatch"));
      const served = yield* Effect.tryPromise({
        try: () => readPublishedDemo(expected.revision, expected.digest, options.transport), catch: demoPublicationError,
      });
      if (served.digest !== expected.digest) return yield* Effect.fail(Error("Showcase served build identity mismatch"));
      return receipt;
    }),
  });
}
