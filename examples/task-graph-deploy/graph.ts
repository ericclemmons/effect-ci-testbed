export interface DeploymentTask {
  readonly id: string
  readonly package: string
  readonly kind: "build" | "deploy"
  readonly buildPrerequisites: readonly string[]
  readonly deploymentPrerequisites: readonly string[]
}

export interface DeploymentGraph {
  readonly schemaVersion: 1
  readonly generator: { readonly name: "turbo"; readonly version: string }
  readonly tasks: readonly DeploymentTask[]
}

const packages = new Set([
  "effect-ci-ordered-deploy-backend",
  "effect-ci-ordered-deploy-frontend",
])

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a task graph object")
  }
  return value as Record<string, unknown>
}

export function importTurboGraph(input: unknown, version: string): DeploymentGraph {
  const { tasks } = record(input)
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("Missing Turbo tasks")
  }

  const nodes = tasks.map((value: unknown) => {
    const task = record(value)
    if (
      typeof task.package !== "string" || !packages.has(task.package) ||
      (task.task !== "build" && task.task !== "deploy") ||
      task.taskId !== `${task.package}#${task.task}` ||
      (task.task === "build" &&
        (typeof task.command !== "string" || !task.command.trim() || task.command === "<NONEXISTENT>")) ||
      !Array.isArray(task.dependencies) ||
      !task.dependencies.every((dependency: unknown) => typeof dependency === "string")
    ) {
      throw new Error("Unsupported Turbo task or dependency")
    }
    return {
      id: task.taskId as string,
      package: task.package,
      kind: task.task,
      dependencies: [...new Set<string>(task.dependencies)].sort(),
    }
  })

  const byId = new Map(nodes.map(task => [task.id, task]))
  if (byId.size !== nodes.length) throw new Error("Duplicate task ID")

  const graph: DeploymentGraph = {
    schemaVersion: 1,
    generator: { name: "turbo", version },
    tasks: nodes.map(task => {
      for (const dependency of task.dependencies) {
        if (!byId.has(dependency)) throw new Error(`Missing dependency: ${dependency}`)
      }
      return {
        id: task.id,
        package: task.package,
        kind: task.kind as DeploymentTask["kind"],
        buildPrerequisites: task.dependencies.filter(id => byId.get(id)?.kind === "build"),
        deploymentPrerequisites: task.dependencies.filter(id => byId.get(id)?.kind === "deploy"),
      }
    }).sort((left, right) => left.id.localeCompare(right.id)),
  }
  orderTasks(graph)
  return graph
}

export function orderTasks(graph: DeploymentGraph): readonly DeploymentTask[] {
  const byId = new Map(graph.tasks.map(task => [task.id, task]))
  if (byId.size !== graph.tasks.length) throw new Error("Duplicate task ID")
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: DeploymentTask[] = []

  function visit(id: string): void {
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${id}`)
    if (visited.has(id)) return
    const task = byId.get(id)
    if (!task) throw new Error(`Missing dependency: ${id}`)
    visiting.add(id)
    for (const dependency of [...task.buildPrerequisites, ...task.deploymentPrerequisites].sort()) {
      const prerequisite = byId.get(dependency)
      if (!prerequisite) throw new Error(`Missing dependency: ${dependency}`)
      if (task.buildPrerequisites.includes(dependency) && prerequisite.kind !== "build") {
        throw new Error(`Invalid build prerequisite: ${dependency}`)
      }
      if (task.deploymentPrerequisites.includes(dependency) && prerequisite.kind !== "deploy") {
        throw new Error(`Invalid deployment prerequisite: ${dependency}`)
      }
      visit(dependency)
    }
    visiting.delete(id)
    visited.add(id)
    ordered.push(task)
  }

  for (const id of [...byId.keys()].sort()) visit(id)
  return ordered
}

export async function executeGraph(
  graph: DeploymentGraph,
  handlers: Readonly<Record<string, (task: DeploymentTask) => Promise<void>>>,
): Promise<readonly string[]> {
  const ordered = orderTasks(graph)
  for (const task of ordered) {
    if (!Object.hasOwn(handlers, task.id) || typeof handlers[task.id] !== "function") {
      throw new Error(`Missing task handler: ${task.id}`)
    }
  }
  const completed: string[] = []
  for (const task of ordered) {
    await handlers[task.id]!(task)
    completed.push(task.id)
  }
  return completed
}
