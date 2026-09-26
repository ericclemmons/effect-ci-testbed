import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isMap, isSeq, parseDocument, stringify } from "yaml"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(await readFile(path.join(root, ".github/examples.json"), "utf8"))
const jobs = {}

for (const [example, runners] of Object.entries(manifest.examples)) {
  if (!/^[a-z0-9-]+$/.test(example) || !Array.isArray(runners)) {
    throw new Error(`Invalid example entry: ${example}`)
  }

  for (const runner of runners) {
    if (!/^[a-z0-9-]+$/.test(runner)) {
      throw new Error(`Invalid runner: ${runner}`)
    }

    const exampleDir = `examples/${example}`
    const source = `${exampleDir}/.github/workflows/${runner}.yml`
    const target = `.github/workflows/generated-${example}-${runner}.yml`
    const document = parseDocument(await readFile(path.join(root, source), "utf8"), {
      uniqueKeys: true,
    })

    if (document.errors.length > 0) {
      throw new Error(`${source}: ${document.errors.join(", ")}`)
    }

    const workflowJobs = document.get("jobs", true)
    if (!isMap(workflowJobs)) {
      throw new Error(`${source}: expected jobs`)
    }

    document.set("name", source)
    document.set("on", { workflow_call: {} })

    for (const pair of workflowJobs.items) {
      const job = pair.value
      if (!isMap(job)) {
        throw new Error(`${source}: expected a job mapping`)
      }

      if (job.has("uses")) {
        const workflow = job.getIn(["with", "workflow"])
        if (typeof workflow === "string") {
          job.setIn(["with", "workflow"], path.posix.join(exampleDir, workflow))
        }
        continue
      }

      const steps = job.get("steps", true)
      if (!isSeq(steps)) {
        throw new Error(`${source}: expected steps or a reusable workflow call`)
      }

      const workingDirectory = job.getIn(["defaults", "run", "working-directory"])
      job.setIn(
        ["defaults", "run", "working-directory"],
        path.posix.join(exampleDir, workingDirectory ?? "."),
      )

      for (const step of steps.items) {
        if (!isMap(step)) continue

        const stepDirectory = step.get("working-directory")
        if (typeof stepDirectory === "string") {
          step.set("working-directory", path.posix.join(exampleDir, stepDirectory))
        }

        const uses = step.get("uses")
        if (typeof uses === "string" && uses.startsWith("./")) {
          step.set("uses", `./${path.posix.join(exampleDir, uses)}`)
        }
      }
    }

    await writeFile(
      path.join(root, target),
      `# Generated from ${source} by scripts/sync-example-workflows.mjs.\n# Edit the example workflow, then run pnpm workflows:sync.\n${document.toString()}`,
    )

    const jobId = `${example}_${runner}`.replaceAll("-", "_")
    jobs[jobId] = {
      name: `${example} / ${runner}`,
      uses: `./${target}`,
    }
  }
}

await writeFile(
  path.join(root, ".github/workflows/e2e.yml"),
  `# Generated from .github/examples.json by scripts/sync-example-workflows.mjs.\n# Edit the manifest or an example workflow, then run pnpm workflows:sync.\n${stringify({
    name: "examples / e2e",
    on: { pull_request: null, push: { branches: ["main"] } },
    permissions: { contents: "read" },
    jobs,
  })}`,
)
