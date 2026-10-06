import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return function* () {
    const workspace = yield* source.checkout()

    return workspace.directory("app")
  }
})

export const prepare = CI.action("prepare", () => function* () {
  const workspace = yield* checkout()

  return yield* workspace.exec("printf prepared > prepared.txt")
})

const isolatedCheck = (name: "left" | "right") => CI.action(
  name,
  () => function* () {
    const workspace = yield* prepare()

    return yield* workspace.exec(
      `test "$(cat prepared.txt)" = prepared && printf ${name} > branch.txt && sleep 2 && test "$(cat branch.txt)" = ${name}`,
    )
  },
)

export const left = isolatedCheck("left")
export const right = isolatedCheck("right")
