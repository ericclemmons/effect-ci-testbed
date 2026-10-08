import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const build = CI.action("build", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("npx cf build --mode production")
})

const rollbackMigration = CI.action("rollback database migration", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec(
    "npx cf d1 raw 11111111-1111-4111-8111-111111111111 --sql \"DROP TABLE IF EXISTS users; DELETE FROM d1_migrations WHERE name = '0001_create_users.sql'\" --local --persist-to .effect-ci-state",
  )
})

export const migrate = CI.action("migrate database", () => function* () {
  const workspace = yield* build()

  return yield* workspace.exec(
    "npx cf d1 migrations apply 11111111-1111-4111-8111-111111111111 --dir migrations --local --persist-to .effect-ci-state < /dev/null",
  )
}, {
  rollback: rollbackMigration,
})

export const deploy = CI.action("deploy worker", () => function* () {
  const workspace = yield* migrate()

  return yield* workspace.exec(
    "npx cf deploy --prebuilt --mode production --dry-run",
  )
}, {
  retries: { limit: 2, delay: "1 second", backoff: "exponential" },
})
