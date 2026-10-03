import { fileURLToPath } from "node:url"
import * as CI from "@effect-ci-testbed/ci"

const app = fileURLToPath(new URL("../../", import.meta.url))

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout(app)
})

export const installImageMagick = CI.action("install imagemagick", () => function* () {
  const workspace = yield* checkout()
  const apt = yield* CI.PackageManager.Apt(workspace)

  return yield* apt.install(["imagemagick"])
})

export const verifyImageMagick = CI.action("verify imagemagick", () => function* () {
  const workspace = yield* installImageMagick()

  return yield* workspace.exec("convert -version | grep --fixed-strings ImageMagick")
})
