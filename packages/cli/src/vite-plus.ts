import { execFileSync } from "node:child_process"

/** Use the project's installed Vite+ loader, including TS and function configs. */
export const vitePlusTasks = (root: string): ReadonlyArray<string> => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    const { loadConfigFromFile } = await import("vite-plus")
    const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, undefined, process.cwd(), "silent")
    const config = loaded?.config ?? {}
    if (config.tasks) throw new Error("Vite+ tasks belong under run.tasks in vite.config.ts, not top-level tasks")
    console.log("\\nEFFECT_CI_VITE_TASKS=" + JSON.stringify(Object.keys(config.run?.tasks ?? {})))
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
  return JSON.parse(result.slice("EFFECT_CI_VITE_TASKS=".length)) as string[]
}
