import { createWorker } from "@cloudflare/worker-bundler"
import * as CI from "@effect-ci-testbed/ci"
import { WorkflowEntrypoint, type WorkflowEvent } from "cloudflare:workers"
import * as Effect from "effect/Effect"

import { selectExecutionTier, type ExecutionTierOptions } from "./policy.ts"

export * from "./policy.ts"

export interface SourceExecutorOptions extends ExecutionTierOptions {
  readonly container?: CI.SourceExecutor
  readonly cpuMs?: number
  readonly loader: WorkerLoader
}

interface FormatterEntrypoint {
  readonly format: (request: {
    readonly files: Readonly<Record<string, string>>
    readonly options?: Readonly<Record<string, unknown>>
  }) => Promise<CI.SourceTransformResult>
}

const formatterSource = String.raw`
  import { WorkerEntrypoint } from "cloudflare:workers";
  import prettier from "prettier/standalone";
  import babel from "prettier/plugins/babel";
  import estree from "prettier/plugins/estree";
  import typescript from "prettier/plugins/typescript";

  export class Formatter extends WorkerEntrypoint {
    async format({ files, options }) {
      const output = {};
      let changed = false;

      for (const [filepath, source] of Object.entries(files)) {
        const formatted = await prettier.format(source, {
          ...options,
          filepath,
          plugins: [babel, estree, typescript],
        });
        output[filepath] = formatted;
        changed ||= formatted !== source;
      }

      return { changed, files: output, tier: "dynamic-worker" };
    }
  }
`

const makeFormatter = (loader: WorkerLoader, options: SourceExecutorOptions) => loader.get(
  "effect-ci-prettier-3.6.2-v1",
  async () => {
    const { mainModule, modules } = await createWorker({
      entryPoint: "src/formatter.ts",
      files: {
        "package.json": JSON.stringify({
          dependencies: { prettier: "3.6.2" },
        }),
        "src/formatter.ts": formatterSource,
      },
      minify: true,
    })

    return {
      compatibilityDate: "2026-09-30",
      ...(options.allowNetwork ? {} : { globalOutbound: null }),
      limits: {
        cpuMs: options.cpuMs ?? 1_000,
        subRequests: options.allowNetwork ? 50 : 0,
      },
      mainModule,
      modules,
    }
  },
)

/**
 * Routes source operations from their declared requirements. The isolate path
 * is intentionally narrow; unsupported tools and capabilities use the supplied
 * container executor instead of silently gaining authority.
 */
export const makeSourceExecutor = (options: SourceExecutorOptions): CI.SourceExecutor => ({
  execute: (request) => Effect.tryPromise({
    try: async () => {
      const decision = selectExecutionTier(request.requirements, options)
      const canRunInIsolate = decision.tier === "dynamic-worker" && request.tool === "prettier"

      if (!canRunInIsolate) {
        if (!options.container) {
          const reason = request.tool === "prettier"
            ? decision.reason
            : `the Dynamic Worker executor does not implement ${request.tool}`
          throw new Error(`Container execution required: ${reason}`)
        }

        return Effect.runPromise(options.container.execute(request))
      }

      const formatter = makeFormatter(options.loader, options)
        .getEntrypoint("Formatter") as unknown as FormatterEntrypoint

      return formatter.format({
        files: request.files,
        ...(request.options ? { options: request.options } : {}),
      })
    },
    catch: (error) => error,
  }),
})

export interface DynamicWorkerEnvironment {
  readonly LOADER: WorkerLoader
}

export interface DynamicWorkflowParameters {
  readonly event?: CI.WorkflowEventName
  readonly payload?: unknown
  readonly revision?: string
}

export interface DynamicWorkflowOptions<
  Environment extends DynamicWorkerEnvironment = DynamicWorkerEnvironment,
> extends ExecutionTierOptions {
  readonly sourceExecutor?: (environment: Environment) => CI.SourceExecutor
}

/** Cloudflare Workflow entrypoint for source-only actions; no Container binding is required. */
export const workflowEntrypoint = <
  A,
  Environment extends DynamicWorkerEnvironment = DynamicWorkerEnvironment,
>(
  workflow: CI.Workflow<A>,
  options: DynamicWorkflowOptions<Environment> = {},
) => class EffectCIDynamicWorkerWorkflow extends WorkflowEntrypoint<
  Environment,
  DynamicWorkflowParameters
> {
  override async run(event: Readonly<WorkflowEvent<DynamicWorkflowParameters>>) {
    const parameters = event.payload
    const result = await CI.runPromise(workflow, {
      ci: true,
      env: "cloudflare-dynamic-worker",
      event: {
        type: parameters.event ?? "workflow_dispatch",
        ...(parameters.payload === undefined ? {} : { payload: parameters.payload }),
        ...(parameters.revision === undefined ? {} : { revision: parameters.revision }),
      },
      output: "silent",
      sourceExecutor: options.sourceExecutor?.(this.env) ?? makeSourceExecutor({
        loader: this.env.LOADER,
        ...(options.allowNetwork === undefined ? {} : { allowNetwork: options.allowNetwork }),
      }),
    })

    return result.plan
  }
}
