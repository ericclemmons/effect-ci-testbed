import { pathToFileURL } from "node:url"

interface Description {
  readonly status?: string
  readonly steps: ReadonlyArray<{
    readonly name: string
    readonly output?: string | { readonly stdout?: string }
  }>
}

export function assertTaskCacheHit(description: Description): void {
  if (description.status !== "complete") {
    throw new Error(`Expected completed Workflow, received: ${description.status}`)
  }

  const output = description.steps.flatMap((step) => {
    const checkpoint = /^command:(\[.*\])-\d+$/.exec(step.name)
    if (!checkpoint || JSON.parse(checkpoint[1]!)[0] !== "build") return []
    const result = typeof step.output === "string"
      ? JSON.parse(step.output) as { readonly stdout?: string }
      : step.output
    return [result?.stdout ?? ""]
  }).join("\n")

  if (!output.includes("cache hit")) {
    throw new Error(`Expected task cache hit, received: ${output}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertTaskCacheHit(JSON.parse(process.env.DESCRIPTION ?? "{}"))
}
