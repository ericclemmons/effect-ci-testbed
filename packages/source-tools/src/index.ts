import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as ServiceMap from "effect/ServiceMap"
import * as prettier from "prettier/standalone"
import estree from "prettier/plugins/estree"
import typescript from "prettier/plugins/typescript"

export interface FormatRequest {
  readonly files: Readonly<Record<string, string>>
  readonly options?: Readonly<Record<string, unknown>>
}
export interface FormatResult {
  readonly files: Readonly<Record<string, string>>
  readonly runtime: "local" | "dynamic-worker"
}
export interface SourceToolsService {
  readonly format: (request: FormatRequest) => Effect.Effect<FormatResult, unknown>
}
export class SourceTools extends ServiceMap.Service<SourceTools, SourceToolsService>()(
  "@effect-ci-testbed/SourceTools",
) {}

export const local: SourceToolsService = {
  format: (request) => Effect.tryPromise(async () => {
    const files: Record<string, string> = {}
    for (const [filepath, source] of Object.entries(request.files)) {
      files[filepath] = await prettier.format(source, {
        ...request.options, filepath, plugins: [estree, typescript],
      })
    }
    return { files, runtime: "local" as const }
  }),
}

/** Source-in/result-out work; a runner can provide a different execution layer. */
export const format = (request: FormatRequest) => Effect.gen(function* () {
  const service = yield* Effect.serviceOption(SourceTools)
  return yield* Option.getOrElse(service, () => local).format(request)
})
