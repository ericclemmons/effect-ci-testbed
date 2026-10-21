import * as CI from "@effect-ci-testbed/ci";
import type * as Effect from "effect/Effect";

/** The destination is supplied by the local or trusted hosted adapter, never
 * by incoming source. Project commands receive no publication credential. */
export interface DemoDelivery<Receipt> {
  readonly install?: boolean;
  readonly publishStep: string;
  readonly publish: (workspace: CI.Workspace) => Effect.Effect<Receipt, unknown, any>;
  readonly release?: (receipt: Receipt) => Effect.Effect<unknown, unknown, any>;
}

/** One authored graph for local output comparison and the hosted showcase. */
export function createDemoProgram<Receipt>(delivery: DemoDelivery<Receipt>) {
  const checkout = CI.action("checkout", function* () {
    const source = yield* CI.Source;
    return () => source.checkout();
  });
  const install = CI.action("install", function* () {
    const workspace = yield* checkout();
    const manager = yield* CI.PackageManager.JavaScript(workspace);
    return () => manager.install();
  });
  const prepared = () => (delivery.install ? install() : checkout());
  const lint = CI.check(
    "lint",
    function* () {
      const source = yield* CI.Source;
      return function* () {
        if (yield* source.changed(["**/*.ts", "package.json", "pnpm-lock.yaml"])) {
          yield* (yield* prepared()).exec("pnpm lint");
        }
      };
    },
    { reuse: { scope: "commit" } },
  );
  const test = CI.check(
    "test",
    function* () {
      const workspace = yield* prepared();
      return function* () {
        yield* workspace.exec("pnpm test");
      };
    },
    { reuse: { scope: "commit" } },
  );
  const validate = () => CI.parallel([lint(), test()]);
  const build = CI.action("build", function* () {
    yield* validate();
    const workspace = yield* prepared();
    return () => workspace.exec("pnpm build");
  });
  const deploy = CI.action<Receipt>(
    delivery.publishStep,
    function* () {
      const workspace = yield* build();
      return () => delivery.publish(workspace);
    },
    { retries: { limit: 0, delay: "1 second" } },
  );
  const release = CI.action<Receipt>(
    "progressive rollout",
    function* () {
      const receipt = yield* deploy();
      return function* () {
        yield* delivery.release!(receipt);
        return receipt;
      };
    },
    { retries: { limit: 0, delay: "1 second" } },
  );
  return {
    checkout,
    lint,
    test,
    build,
    deploy,
    workflow: CI.workflow("demo", function* () {
      const workspace = yield* build();
      if (!(yield* workspace.changed("dist/**"))) return;
      if (delivery.release) return yield* release();
      return yield* deploy();
    }),
  };
}
