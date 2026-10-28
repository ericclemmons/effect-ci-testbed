import { basename } from "node:path"

export const commandName = basename(process.argv[1] ?? "", ".ts") === "effect-ci" ? "effect-ci" : "cf-ci"
