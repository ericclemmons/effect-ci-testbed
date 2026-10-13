import * as CI from "@effect-ci-testbed/ci";
import * as Effect from "effect/Effect";
import * as Context from "effect/ServiceMap";
import type { Files, Site } from "../../src/site.ts";
export class SiteHost extends Context.Service<
  SiteHost,
  {
    checkout: () => Effect.Effect<Files, Error>;
    build: (source: Files) => Effect.Effect<Files, Error>;
    publish: (source: Files, assets: Files) => Effect.Effect<Site, Error>;
    verify: (site: Site) => Effect.Effect<string, Error>;
  }
>()("containerless-site/SiteHost") {}
const checkout = CI.action<Files>(
  "checkout from GitHub",
  () =>
    function* () {
      if ((yield* CI.executionMode) === "plan") return {};
      return yield* (yield* SiteHost).checkout();
    },
);
const build = CI.action<Files>(
  "build in Dynamic Worker",
  () =>
    function* () {
      const source = yield* checkout();
      if ((yield* CI.executionMode) === "plan") return {};
      return yield* (yield* SiteHost).build(source);
    },
);
const publish = CI.action<Site>(
  "publish immutable site",
  () =>
    function* () {
      const source = yield* checkout();
      const assets = yield* build();
      if ((yield* CI.executionMode) === "plan")
        return { revision: "", sourceDigest: "", assetDigest: "", assets: {} };
      return yield* (yield* SiteHost).publish(source, assets);
    },
);
const verify = CI.action<string>(
  "verify served site",
  () =>
    function* () {
      const site = yield* publish();
      if ((yield* CI.executionMode) === "plan") return "";
      return yield* (yield* SiteHost).verify(site);
    },
);
export default CI.workflow("containerless-site", function* () {
  return yield* verify();
});
