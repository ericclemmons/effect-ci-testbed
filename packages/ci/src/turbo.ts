import * as Effect from "effect/Effect"
import * as CI from "./index.ts"
import { turboBridge, type TurboBridgeRequest, type TurboFile, type TurboPlan, type TurboTask } from "./turbo-bridge.ts"

type TurboAction = ReturnType<typeof CI.action<CI.Workspace>>

const shell = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const command = (request: TurboBridgeRequest) =>
  `node --input-type=module -e ${shell(`await (${turboBridge})(${JSON.stringify(request)})`)}`

const parsePlan = (body: string): TurboPlan => {
  const plan = JSON.parse(body) as TurboPlan
  if (plan.version !== "1" || plan.turboVersion !== "2.11.10" || !Array.isArray(plan.tasks) ||
      !plan.tasks.length || plan.tasks.length > 256) throw Error("Turbo adapter requires a 2.11.10 native task plan with at most 256 tasks")
  const tasks = new Map<string, TurboTask>()
  for (const task of plan.tasks) {
    if (typeof task.taskId !== "string" || !task.taskId.includes("#") || task.taskId.startsWith("-") ||
        /[\x00-\x1f]/.test(task.taskId) || tasks.has(task.taskId) || !/^[a-f0-9]{16}$/.test(task.hash) ||
        !Array.isArray(task.dependencies) || typeof task.command !== "string" || !task.command ||
        task.command === "<NONEXISTENT>" || task.resolvedTaskDefinition?.cache !== true ||
        task.resolvedTaskDefinition.persistent !== false || task.resolvedTaskDefinition.interactive !== false ||
        !Array.isArray(task.with) || task.with.length) {
      throw Error(`Unsupported distributed Turbo task: ${task.taskId}`)
    }
    tasks.set(task.taskId, task)
  }
  const active = new Set<string>()
  const complete = new Set<string>()
  const visit = (id: string) => {
    if (complete.has(id)) return
    if (active.has(id)) throw Error(`Cyclic Turbo task graph: ${id}`)
    const task = tasks.get(id)
    if (!task) throw Error(`Missing Turbo task dependency: ${id}`)
    active.add(id)
    task.dependencies.forEach(visit)
    active.delete(id)
    complete.add(id)
  }
  tasks.forEach(task => visit(task.taskId))
  return plan
}

const mergeFiles = (
  inputs: ReadonlyArray<{ readonly task: TurboTask; readonly body: string }>,
  tasks: ReadonlyMap<string, TurboTask>,
): TurboFile[] => {
  const files = new Map<string, TurboFile>()
  for (const { task, body } of inputs) {
    if (new TextEncoder().encode(body).length > 48 * 1024) throw Error("Turbo prototype result exceeds 48 KiB")
    const result = JSON.parse(body)
    if (result.taskId !== task.taskId || result.hash !== task.hash || !Array.isArray(result.files)) throw Error("Invalid Turbo output manifest")
    const owners = new Set<string>()
    const visit = (id: string) => {
      if (owners.has(id)) return
      owners.add(id)
      tasks.get(id)!.dependencies.forEach(visit)
    }
    visit(task.taskId)
    for (const file of result.files as TurboFile[]) {
      if (!file || typeof file.path !== "string" || typeof file.owner !== "string" || !owners.has(file.owner) ||
          typeof file.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data) ||
          !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) throw Error("Invalid Turbo output file")
      const previous = files.get(file.path)
      if (previous && (previous.owner !== file.owner || previous.data !== file.data || previous.mode !== file.mode)) {
        throw Error(`Conflicting Turbo output: ${file.path}`)
      }
      files.set(file.path, file)
    }
  }
  const result = [...files.values()].sort((left, right) => left.path.localeCompare(right.path))
  if (new TextEncoder().encode(JSON.stringify(result)).length > 48 * 1024) throw Error("Turbo prototype join exceeds 48 KiB")
  return result
}

export const makeTurboToolchain = <Environment>(
  workspace: CI.Workspace,
  namespace: string,
  prerequisites: Effect.Effect<void, unknown, Environment>,
) => ({
  workspace,
  tags: (...tags: ReadonlyArray<string>) => Effect.suspend(() => {
    if (!tags.length || tags.some(tag => !tag || tag.startsWith("!") || tag.length > 128)) {
      return Effect.fail(Error("Provide positive Turbo tag names"))
    }
    const prefix = `${namespace}:turbo:${JSON.stringify([...new Set(tags)].sort())}`
    const planFile = ".effect-ci/turbo/plan.json"
    const discover = CI.action(`${prefix}:plan`, function* () {
      yield* prerequisites
      return () => workspace.exec(command({ operation: "plan", file: planFile, tags }))
    })
    return Effect.gen(function* () {
      const planned = yield* discover()
      if ((yield* CI.executionMode) === "plan") return planned
      if (planned.kind !== "remote" || !planned.revision) {
        return yield* Effect.fail(Error("Distributed Turbo requires a snapshot-backed runner; use makeSnapshotRunner or Cloudflare"))
      }
      const body = yield* planned.readFile(planFile)
      if (!body) return yield* Effect.fail(Error("Native Turbo did not produce a task plan"))
      const plan = yield* Effect.try({ try: () => parsePlan(body), catch: error => error })
      const hashes = Object.fromEntries(plan.tasks.map(task => [task.taskId, task.hash]))
      const tasks = new Map(plan.tasks.map(task => [task.taskId, task]))
      const factories = new Map<string, TurboAction>()
      const resultFile = (task: TurboTask) => `.effect-ci/turbo/results/${task.hash}.json`
      const filesFrom = (inputs: ReadonlyArray<{ task: TurboTask; workspace: CI.Workspace }>) => Effect.gen(function* () {
        const bodies: { task: TurboTask; body: string }[] = []
        for (const input of inputs) {
          const manifest = yield* input.workspace.readFile(resultFile(input.task))
          if (!manifest) return yield* Effect.fail(Error(`Missing Turbo output manifest: ${input.task.taskId}`))
          bodies.push({ task: input.task, body: manifest })
        }
        return yield* Effect.try({ try: () => mergeFiles(bodies, tasks), catch: error => error })
      })
      const factory = (id: string): TurboAction => {
        const existing = factories.get(id)
        if (existing) return existing
        const task = tasks.get(id)!
        const parents = task.dependencies.map(dependency => ({ task: tasks.get(dependency)!, run: factory(dependency) }))
        const run = CI.action(`${prefix}:${id}`, function* () {
          if (!parents.length) yield* discover()
          yield* CI.parallel(parents.map(parent => parent.run()))
          const results = yield* Effect.all(parents.map(parent => parent.run()))
          const files = yield* filesFrom(parents.map((parent, index) => ({ task: parent.task, workspace: results[index]! })))
          return () => planned.exec(command({
            operation: "run", file: resultFile(task), task, hashes, files,
          }))
        })
        factories.set(id, run)
        return run
      }
      const dependencies = new Set(plan.tasks.flatMap(task => task.dependencies))
      const sinks = plan.tasks.filter(task => !dependencies.has(task.taskId))
      yield* CI.parallel(sinks.map(task => factory(task.taskId)()))
      const outputs = yield* Effect.all(sinks.map(task => factory(task.taskId)()))
      const files = yield* filesFrom(sinks.map((task, index) => ({ task, workspace: outputs[index]! })))
      return yield* planned.exec(command({ operation: "restore", file: planFile, files }))
    })
  }),
})
