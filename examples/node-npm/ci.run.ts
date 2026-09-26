import workflow from "./ci.workflow.ts"
import * as CI from "@effect-ci-testbed/ci"

const dryRun = process.argv.includes("--dry-run")
const envArgument = process.argv.find((argument) => argument.startsWith("--env="))
const env = envArgument?.slice("--env=".length) ?? "development"

await CI.runPromise(workflow, { dryRun, env })
