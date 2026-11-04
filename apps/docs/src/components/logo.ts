import icon from "../../../effect-ci/assets/bolt-stack.svg?raw"

// Reuse the editable source for the GitHub App and Slack icon.
export const logo = `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`
