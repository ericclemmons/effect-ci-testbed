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
