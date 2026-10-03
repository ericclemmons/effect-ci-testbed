import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(app)
})

export const installToolchain = CI.action("install toolchain", () => function* () {
  const workspace = yield* checkout()
  const mise = yield* CI.Toolchain.Mise(workspace)

  return yield* mise.install()
})

export const verifyNode = CI.action("verify node", () => function* () {
  const workspace = yield* installToolchain()
  const mise = yield* CI.Toolchain.Mise(workspace)

  return yield* mise.exec('node -e "if (process.version !== \'v22.20.0\') process.exit(1)"')
})

export const verifyPython = CI.action("verify python", () => function* () {
  const workspace = yield* installToolchain()
  const mise = yield* CI.Toolchain.Mise(workspace)

  return yield* mise.exec(
    'python -c "import platform; assert platform.python_version() == \'3.13.7\'"',
  )
})
