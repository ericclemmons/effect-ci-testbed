import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
})

export const installNode = CI.action("install node", () => function* () {
  const workspace = yield* checkout()
  const node = yield* CI.Toolchain.Node(workspace)

  return yield* node.install()
})

export const verifyNode = CI.action("verify node", () => function* () {
  const workspace = yield* installNode()
  const node = yield* CI.Toolchain.Node(workspace)

  return yield* node.exec(
    `node -e "if (process.version !== 'v${node.version}') process.exit(1)"`,
  )
})
