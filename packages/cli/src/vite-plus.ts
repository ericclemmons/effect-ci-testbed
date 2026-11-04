import { execFileSync } from "node:child_process"

/** Use the project's installed Vite+ loader, including TS and function configs. */
export const vitePlusTasks = (root: string): {
  readonly names: ReadonlyArray<string>
  readonly dependencies: Readonly<Record<string, ReadonlyArray<string>>>
} => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    const { loadConfigFromFile } = await import("vite-plus")
    const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, undefined, process.cwd(), "silent")
    const config = loaded?.config ?? {}
    if (config.tasks) throw new Error("Vite+ tasks belong under run.tasks in vite.config.ts, not top-level tasks")
    const { readFileSync } = await import("node:fs")
    const packageName = JSON.parse(readFileSync("package.json", "utf8")).name
    const tasks = config.run?.tasks ?? {}
    for (const [name, task] of Object.entries(tasks)) {
      if (task && typeof task === "object" && "dependencies" in task)
        throw new Error("Vite+ task " + name + " uses dependencies; use dependsOn instead")
    }
    const dependencies = Object.fromEntries(Object.entries(tasks).map(([name, task]) => [name,
      (task?.dependsOn ?? []).filter(dependency => typeof dependency === "string" &&
        (!dependency.includes("#") || dependency.startsWith(packageName + "#")))
        .map(dependency => dependency.includes("#") ? dependency.slice(packageName.length + 1) : dependency)
    ]))
    console.log("\\nEFFECT_CI_VITE_TASKS=" + JSON.stringify({ names: Object.keys(tasks), dependencies }))
  `], {
    cwd: root,
    encoding: "utf8",
    // Vite+'s metadata flag skips lazy plugin factories only in this child.
    env: { ...process.env, VP_RESOLVING_CONFIG_METADATA: "1" },
    timeout: 30_000,
    maxBuffer: 1_048_576,
  })
  const result = output.split("\n").reverse().find(line => line.startsWith("EFFECT_CI_VITE_TASKS="))
  if (!result) throw new Error("Vite+ did not return task metadata")
  return JSON.parse(result.slice("EFFECT_CI_VITE_TASKS=".length)) as ReturnType<typeof vitePlusTasks>
}
