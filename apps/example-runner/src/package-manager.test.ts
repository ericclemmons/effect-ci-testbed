import assert from "node:assert/strict"
import test from "node:test"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"

for (const monorepo of [false, true]) {
  test(`pnpm respects the selected ${monorepo ? "monorepo" : "standalone project"} boundary`, async () => {
    const install = CI.action("install", () => function* () {
      const manager = yield* CI.PackageManager.JavaScript(CI.Workspace.remote("test", "/project"))
      return yield* manager.install()
    })
    const result = await CI.runPromise(CI.workflow("pnpm-boundary", () => install()), {
      ci: true,
      mode: "plan",
      output: "silent",
      workspaceFileSystem: {
        readFile: () => Effect.succeed('{"packageManager":"pnpm@12.8.1"}'),
        exists: (_, path) => Effect.succeed(
          path === "pnpm-lock.yaml" || (monorepo && path === "pnpm-workspace.yaml"),
        ),
      },
    })
    const command = result.plan.nodes[0]!.commands[0]!.command

    assert.equal(command.includes("--ignore-workspace"), !monorepo)
    assert.match(command, /--frozen-lockfile/)
  })
}

for (const location of ["local", "ci", "remote"] as const) {
  for (const frozenLockfile of [false, true]) {
    test(`pnpm ${location} store preserves normal installs (frozen=${frozenLockfile})`, async () => {
      const install = CI.action("install", () => function* () {
        const workspace = location === "remote" ? CI.Workspace.remote("test", "/project") : CI.Workspace.local("/project")
        const manager = yield* CI.PackageManager.JavaScript(workspace)
        return yield* manager.install({ frozenLockfile, offline: true })
      })
      const result = await CI.runPromise(CI.workflow("pnpm-store", () => install()), {
        ci: location === "ci",
        mode: "plan",
        output: "silent",
        workspaceFileSystem: {
          readFile: () => Effect.succeed('{"packageManager":"pnpm@12.8.1"}'),
          exists: (_, path) => Effect.succeed(path === "pnpm-lock.yaml"),
        },
      })
      const command = result.plan.nodes[0]!.commands[0]!.command
      assert.equal(command.includes("--store-dir .effect-ci/cache/pnpm"), location !== "local")
      assert.equal(command.includes("--frozen-lockfile"), frozenLockfile)
      assert.match(command, /--offline$/)
      assert.match(command, /^pnpm --ignore-workspace install/)
    })
  }
}
