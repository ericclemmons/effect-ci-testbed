import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("node scripts/build.mjs")
})

const rollbackMigration = CI.action("rollback database migration", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec("node scripts/rollback-migration.mjs")
})

export const migrate = CI.action("migrate database", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec("node scripts/migrate.mjs")
}, {
  rollback: rollbackMigration,
})

const rollbackDeployment = CI.action("redeploy previous worker", () => function* () {
  const workspace = yield* migrate()

  return yield* workspace.exec("node scripts/rollback.mjs")
})

export const deploy = CI.action("deploy worker", () => function* () {
  const workspace = yield* migrate()

  return yield* workspace.exec("node scripts/deploy.mjs")
}, {
  retries: { limit: 2, delay: "1 second", backoff: "exponential" },
  rollback: rollbackDeployment,
})

export const verifyDeployment = CI.action("verify deployment", () => function* () {
  const workspace = yield* deploy()

  return yield* workspace.exec("node scripts/verify-deployment.mjs")
})
