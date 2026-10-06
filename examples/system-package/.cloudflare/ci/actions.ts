import * as CI from "@effect-ci-testbed/ci"

export const checkout = CI.action("checkout", function* () {
  const source = yield* CI.Source

  return () => source.checkout()
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
