import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(app)
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("node scripts/build.mjs")
})

export const migrate = CI.action("migrate database", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec("node scripts/migrate.mjs")
})

export const deploy = CI.action("deploy worker", () => function* () {
  const workspace = yield* migrate()

  return yield* workspace.exec("node scripts/deploy.mjs")
}, {
  retries: { limit: 2, delay: "1 second", backoff: "exponential" },
})

export const rollback = CI.action("redeploy previous worker", () => function* () {
  const workspace = yield* migrate()

  return yield* workspace.exec("node scripts/rollback.mjs")
})
