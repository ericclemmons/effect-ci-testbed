import * as CI from "@effect-ci-testbed/ci"
import {
  makeSourceExecutor,
  workflowEntrypoint,
} from "@effect-ci-testbed/cloudflare-dynamic-worker"
import * as Effect from "effect/Effect"

interface Environment {
  readonly LOADER: WorkerLoader
}

interface FormatRequest extends CI.SourceTransformRequest {}

const format = CI.action<CI.SourceTransformResult, []>(
  "format",
  () => function* () {
    const event = yield* CI.WorkflowEvent

    return yield* CI.transformSources(event.payload as FormatRequest)
  },
  {
    execution: {
      capabilities: ["javascript"],
      preference: "isolate-first",
    },
  },
)

const workflow = CI.workflow("dynamic-worker-format", function* () {
  return yield* format()
})

export const EffectCIWorkflow = workflowEntrypoint(workflow)

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "POST { tool: 'prettier', files: { path: source } }" }, {
        status: 405,
      })
    }

    const input = await request.json<FormatRequest>()
    if (input.tool !== "prettier" || !input.files || typeof input.files !== "object") {
      return Response.json({ error: "POST { tool: 'prettier', files: { path: source } }" }, {
        status: 400,
      })
    }

    const sourceExecutor = makeSourceExecutor({ loader: environment.LOADER })
    const result = await Effect.runPromise(sourceExecutor.execute({
      ...input,
      requirements: {
        capabilities: ["javascript"],
        preference: "isolate-first",
      },
      stepId: "format",
      workflowId: "dynamic-worker-format",
    }))

    return Response.json(result)
  },
} satisfies ExportedHandler<Environment>

// The same executor is wired into CI.runPromise({ sourceExecutor }) by the
// Cloudflare workflow entrypoint. This exported action is the user-land shape.
export { format }
