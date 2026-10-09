import { createWorker } from "@cloudflare/worker-bundler"
import type * as Tools from "@effect-ci-testbed/source-tools"
import * as Effect from "effect/Effect"

const formatterSource = String.raw`
import { WorkerEntrypoint } from "cloudflare:workers";
import prettier from "prettier/standalone";
import estree from "prettier/plugins/estree";
import typescript from "prettier/plugins/typescript";
export class Formatter extends WorkerEntrypoint {
  async format({files, options}) {
    const output = {};
    for (const [filepath, source] of Object.entries(files)) {
      output[filepath] = await prettier.format(source, {
        ...options, filepath, plugins: [estree, typescript],
      });
    }
    return {files: output, runtime: "dynamic-worker"};
  }
}
`

/** No shell, source filesystem, secrets, or outbound network is granted to the tool. */
export const makeSourceTools = (loader: WorkerLoader): Tools.SourceToolsService => ({
  format: (request) => Effect.tryPromise(async () => {
    const worker = loader.get("effect-ci-prettier-3.6.2-source-tools-v1", async () => {
      const { mainModule, modules } = await createWorker({
        entryPoint: "src/formatter.ts",
        files: {
          "package.json": JSON.stringify({ dependencies: { prettier: "3.6.2" } }),
          "src/formatter.ts": formatterSource,
        },
        minify: true,
      })
      return {
        compatibilityDate: "2026-10-07",
        globalOutbound: null,
        limits: { cpuMs: 1_000, subRequests: 0 },
        mainModule,
        modules,
      }
    })
    using formatter = worker.getEntrypoint("Formatter") as unknown as Disposable & {
      format(request: Tools.FormatRequest): Promise<Tools.FormatResult>
    }
    return await formatter.format(request)
  }),
})
