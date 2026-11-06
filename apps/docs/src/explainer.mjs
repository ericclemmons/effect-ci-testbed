// Behavior and output lines come from the walkthrough (examples/demo/README.md).
export const runners = {
  local: { label: "Your machine", command: "$ effect-ci run --local" },
  github: { label: "GitHub Actions", command: "$ effect-ci run   # checks.yml step" },
  cloudflare: { label: "Cloudflare host", command: "$ effect-ci run" },
}

export const changes = {
  none: { label: "Nothing" },
  docs: { label: "README.md" },
  source: { label: "worker/index.ts" },
}

export const approvals = {
  pending: { label: "Waiting" },
  approved: { label: "Approve" },
  rejected: { label: "Reject" },
}

export const steps = [
  { id: "checkout", label: "checkout" },
  { id: "install", label: "install" },
  { id: "build", label: "build" },
  { id: "publish", label: "publish" },
]

export const defaults = { runner: "local", change: "source", approval: "pending" }

const node = (state, note) => ({ state, note })

export function scenario({ runner = defaults.runner, change = defaults.change, approval = defaults.approval } = {}) {
  const remote = runner !== "local"
  const command = runners[runner].command
  if (change === "docs") return {
    nodes: Object.fromEntries(steps.map(({ id }) => [id, node("skipped", "not needed")])),
    lines: [command, "CI execution summary: walkthrough", "Environment: development", "$ echo $?", "0"],
    summary: remote ? "Markdown-only commit: zero actions and no remote dispatch." : "Markdown-only commit: zero actions, exit 0.",
    check: "skipped",
    gate: false,
  }
  const changed = change === "source"
  // The walkthrough's approval gate and publication baseline run locally only.
  const gate = changed && !remote
  const publish = remote ? node("skipped", "local-only for now")
    : !changed ? node("skipped", "identical output")
    : approval === "approved" ? node("passed", "approved · published")
    : approval === "rejected" ? node("failed", "rejected · receipt kept")
    : node("waiting", "awaiting approval")
  const nodes = {
    checkout: node("passed", remote ? "pushed commit" : "working tree"),
    install: node("passed", "pnpm install --frozen-lockfile"),
    build: changed ? node("passed", "cache miss · rebuilt") : node("cached", "cache hit · replayed"),
    publish,
  }
  const lines = [
    command,
    ...(remote ? ["Remote Workflow <run-id>"] : []),
    ...(changed
      ? ["$ tsc -b", "$ vp build ○ cache miss: 'worker/index.ts' modified, executing"]
      : ["$ tsc -b ◉ cache hit, replaying", "$ vp build ◉ cache hit, replaying"]),
    "CI execution summary: walkthrough",
    "✓ checkout",
    "✓ install depends on checkout",
    ...(publish.state === "failed" ? [] : ["✓ build depends on install"]),
    ...(publish.state === "waiting" ? ["⏸ Publish the walkthrough? The build passed and its output changed."] : []),
    ...(publish.state === "passed" ? ["✓ publish local site depends on build"] : []),
    ...(publish.state === "failed" ? ["Error [CI_APPROVAL_REJECTED]: publish local site was rejected", "$ echo $?", "4"] : []),
    ...(remote ? ["✓ Workflow completed"] : []),
  ]
  const summary = remote
    ? changed ? "Same graph, remote host. Source edits rebuild; the check reports the result." : "Same graph, remote host. A warm cache replays the build; a cold host can miss."
    : !changed ? "Unchanged inputs replay the build; identical output skips publication."
    : approval === "approved" ? "Changed output publishes once, then the baseline advances."
    : approval === "rejected" ? "Rejection blocks publication. Exit 4; the old receipt stays."
    : "The build output changed, so publication waits for a person."
  const check = publish.state === "failed" ? "failed" : publish.state === "waiting" ? "waiting" : "passed"
  return { nodes, lines, summary, check, gate }
}
