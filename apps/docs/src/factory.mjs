// A deterministic simulation of Effect CI as a software factory, rendered on the
// homepage. Output lines follow the walkthrough (examples/demo/README.md). Signed
// check reuse, the error → agent loop and the Workers/Containers split are
// illustrative.
export const view = { width: 1000, height: 860 }

export const team = { x: 10, y: 8, w: 300, h: 842 }

export const humans = {
  me: { label: "You", x: 30, y: 30, w: 260, h: 55 },
  teammate: { label: "Teammate", x: 30, y: 95, w: 260, h: 55 },
}

export const agents = {
  a1: { label: "Agent 1", owner: "me", tag: "You", x: 40, y: 230, w: 250, h: 140 },
  a2: { label: "Agent 2", owner: "teammate", tag: "Teammate", x: 40, y: 400, w: 250, h: 140 },
  a3: { label: "Agent 3", owner: "me", tag: "on call", x: 40, y: 570, w: 250, h: 140 },
}

export const github = { label: "GitHub", x: 360, y: 50, w: 280, h: 100 }
export const runner = { label: "Hosted runner", role: "Cloudflare", x: 360, y: 230, w: 620, h: 620, workers: 8, containers: 18 }
export const app = { label: "dash.cloudflare.com", role: "production", x: 700, y: 20, w: 280, h: 165 }

const agentWires = Object.fromEntries(Object.entries(agents).flatMap(([id, agent]) => {
  const push = agent.y + 35, check = agent.y + 105, mid = agent.y + 70
  return [
    [`${id}-github`, { d: `M290 ${push} H315 Q325 ${push} 325 ${push - 10} V150 Q325 140 335 140 H360`, length: push - 60, label: id === "a1" ? "PR" : "", lx: 298, ly: push - 6 }],
    [`${id}-runner`, { d: `M290 ${check} H360`, length: 70, label: "check", lx: 300, ly: check - 6 }],
    [`runner-${id}`, { d: `M360 800 H37 Q22 800 22 785 V${mid + 15} Q22 ${mid} 37 ${mid} H40`, length: 1110 - mid, label: id === "a3" ? "dispatch" : "", lx: 150, ly: 792, tone: "agent" }],
  ]
}))

// `length` is approximate path length in view units; packets travel at a speed per kind.
export const wires = {
  "review-me": { d: "M290 57 H360", length: 70, label: "review", lx: 298, ly: 51 },
  "review-teammate": { d: "M290 122 H360", length: 70, label: "review", lx: 298, ly: 116 },
  ...agentWires,
  "github-runner": { d: "M500 150 V230", length: 80, label: "webhook", lx: 508, ly: 195 },
  "runner-app": { d: "M770 230 V185", length: 45, label: "deploy", lx: 712, ly: 212 },
  "app-runner": { d: "M920 185 V230", length: 45, label: "event", lx: 928, ly: 212, tone: "danger" },
}

const speed = { source: 70, docs: 220, pr: 160, review: 120, merge: 120, pass: 150, fail: 150, skip: 220, deploy: 80, error: 90, dispatch: 420 }

const routes = ["/zones", "/zones/overview", "/dns/records", "/workers/routes", "/analytics/traffic", "/ssl-tls", "/r2/buckets"]

// What each person asks their agent to do, in order.
const scripts = {
  me: [
    { kind: "source", file: "src/zones/filters.tsx", msg: "feat: filter zones by plan", prompt: "add a plan filter to the zones list" },
    { kind: "docs", file: "README.md", msg: "docs: explain zone filters", prompt: "document the zone filters" },
    { kind: "source", file: "src/dns/records.tsx", msg: "feat: bulk edit DNS records", prompt: "let me bulk edit DNS records",
      breaks: { route: "/dns/records", file: "src/dns/records.tsx", error: "TypeError: Cannot read properties of undefined (reading 'ttl')", fix: "fix: default missing record TTL" } },
    { kind: "source", file: "src/analytics/chart.tsx", msg: "perf: memoize traffic chart", prompt: "the traffic chart re-renders too often" },
  ],
  teammate: [
    { kind: "source", file: "src/workers/routes.ts", msg: "feat: route editor", prompt: "build a route editor", fail: "test 3/4" },
    { kind: "source", file: "src/workers/deployed-at.ts", msg: "feat: show last deploy time", prompt: "show when each route last deployed",
      breaks: { route: "/workers/routes", file: "src/workers/deployed-at.ts", error: "RangeError: Invalid time value at formatDeployedAt", fix: "fix: guard undeployed routes" } },
    { kind: "docs", file: "docs/routes.md", msg: "docs: route editor", prompt: "write docs for the route editor" },
    { kind: "source", file: "src/ssl/certificates.tsx", msg: "feat: certificate expiry badges", prompt: "flag certificates that expire soon" },
  ],
}

// Workers start in milliseconds; containers boot, then stay warm.
const tasks = {
  lint: { pool: "worker", duration: 260, command: () => "pnpm exec vp lint" },
  format: { pool: "worker", duration: 160, command: () => "pnpm exec vp fmt --check" },
  verify: { pool: "worker", duration: 90, command: sha => `effect-ci verify ${sha}` },
  sign: { pool: "worker", duration: 80, command: sha => `effect-ci sign ${sha}` },
  triage: { pool: "worker", duration: 320, command: () => "effect-ci run   # event app.error" },
  install: { pool: "container", duration: 900, command: () => "pnpm install --frozen-lockfile" },
  build: { pool: "container", duration: 2200, command: () => "tsc -b && vp build" },
  test: { pool: "container", duration: 2000, command: (_, shard) => `pnpm exec vp test --shard ${shard}` },
  deploy: { pool: "container", duration: 1400, command: () => "cf run deploy" },
}

export const githubText = gh => gh.pr ? `#${gh.pr} · ${gh.ref}` : `${gh.ref} · ${gh.sha}`
export const checkMark = check => ({ passed: "✓", failed: "×", skipped: "–", pending: "●" })[check] ?? ""
export const runnerStats = state => {
  return `${state.runner.runs} runs · ${state.runner.reused} checks reused`
}
export const poolStats = (state, pool) => `${state.slots.filter(slot => slot.pool === pool && slot.busy).length}/${state.slots.filter(slot => slot.pool === pool).length} busy`
export const runText = run => run.status === "running" ? `${run.done}/${run.total}` : run.status
export const appHealth = app => app.incidents.length ? `${app.rate.toFixed(1)}% 5xx · ${app.incidents[0].route}` : "healthy · 0.0% 5xx"
export const slotIds = () => Array.from({ length: runner.workers + runner.containers }, (_, index) => `slot-${index}`)
export const slotName = (state, id) => {
  const index = Number(id.slice(5))
  const slot = state.slots[index]
  const n = state.slots.slice(0, index + 1).filter(other => other.pool === slot.pool).length
  return `${slot.pool === "worker" ? "w" : "c"}${String(n).padStart(2, "0")}`
}

// Split a terminal line into [kind, text] tokens for lightweight shell coloring.
const tokens = [
  ["prompt", /^\$(?= )/y],
  ["comment", /#.*$/y],
  ["string", /"[^"]*"|'[^']*'/y],
  ["flag", /(?<=\s)--?[a-z][\w-]*/y],
  ["error", /×|Error \[[A-Z_]+\]|\w*Error\b|(?<= )5\d\d\b/y],
  ["ok", /✓|(?<= )2\d\d\b/y],
  ["cache", /◉/y],
  ["miss", /○/y],
  ["sha", /\b[0-9a-f]{7}\b/y],
]
export function tokenize(line) {
  const out = []
  let plain = ""
  let command = line.startsWith("$ ")
  for (let i = 0; i < line.length;) {
    let hit = null
    for (const [kind, pattern] of tokens) {
      pattern.lastIndex = i
      const match = pattern.exec(line)
      if (match) { hit = [kind, match[0]]; break }
    }
    if (!hit && command && i === 2) {
      const word = /\S+/y
      word.lastIndex = i
      hit = ["command", word.exec(line)[0]]
      command = false
    }
    if (hit) {
      if (plain) out.push(["", plain]), plain = ""
      out.push(hit)
      i += hit[1].length
    } else plain += line[i++]
  }
  if (plain) out.push(["", plain])
  return out
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createFactory({ seed = 468, onLog } = {}) {
  const random = mulberry32(seed)
  const between = (min, max) => min + random() * (max - min)
  const pick = list => list[Math.floor(random() * list.length)]
  const hex = n => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("")

  const state = {
    now: 0,
    humans: Object.fromEntries(Object.keys(humans).map(id => [id, { status: "idle", tone: "idle" }])),
    agents: Object.fromEntries(Object.keys(agents).map(id => [id, { status: id === "a3" ? "on call · watching events" : "idle", tone: "idle", sha: "", progress: null, busy: false }])),
    github: { ref: "main", sha: "9c41e0a", pr: 0, check: "passed" },
    runner: { runs: 0, tasks: 0, cached: 0, reused: 0 },
    slots: [
      ...Array.from({ length: runner.workers }, () => ({ pool: "worker" })),
      ...Array.from({ length: runner.containers }, () => ({ pool: "container" })),
    ].map(slot => ({ ...slot, state: "idle", task: "", sha: "", warm: slot.pool === "worker", busy: false, start: 0, duration: 0 })),
    runs: [],
    app: { version: 127, sha: "9c41e0a", incidents: [], rate: 0, bars: Array.from({ length: 24 }, () => ({ h: 0.3, error: false })) },
    logs: {},
    packets: [],
  }
  const dirty = new Set()
  const timers = []
  const waiters = { worker: [], container: [] }
  const cursor = { me: 0, teammate: 0 }
  const reviews = { me: [], teammate: [] }
  const incidents = []
  let packetId = 0
  let prs = 40

  const later = (delay, fn) => timers.push({ at: state.now + delay, fn })
  const touch = id => dirty.add(id)
  const log = (id, line) => {
    const lines = (state.logs[id] ??= [])
    lines.push(line)
    if (lines.length > 14) lines.shift()
    touch(id)
    onLog?.(id, line)
  }
  const setHuman = (id, patch) => { Object.assign(state.humans[id], patch); touch(id) }
  const setAgent = (id, patch) => { Object.assign(state.agents[id], patch); touch(id) }
  const setGithub = patch => { Object.assign(state.github, patch); touch("github") }
  const setSlot = (index, patch) => { Object.assign(state.slots[index], patch); touch(`slot-${index}`); touch("runner") }

  function send(wire, kind, label, onArrive, reverse = false) {
    const duration = Math.min(2600, Math.max(350, (wires[wire].length / speed[kind]) * 1000))
    const packet = { id: ++packetId, wire, kind, label, reverse, start: state.now, duration }
    state.packets.push(packet)
    touch("packets")
    later(duration, () => {
      state.packets.splice(state.packets.indexOf(packet), 1)
      touch("packets")
      onArrive()
    })
  }

  // People ask their agent for a change, then review the agent's pull request.
  function assign(human) {
    const agent = human === "me" ? "a1" : "a2"
    if (state.agents[agent].busy) return later(1200, () => assign(human))
    const item = scripts[human][cursor[human]++ % scripts[human].length]
    log(human, `→ ${agents[agent].label}: ${item.prompt}`)
    setHuman(human, { status: `prompting ${agents[agent].label}`, tone: "edit" })
    later(900, () => {
      setHuman(human, { status: "waiting for a PR", tone: "idle" })
      work(agent, { ...item, reviewer: human, owner: human })
    })
  }

  // Agents iterate with `--local`, then get the commit checked and signed on the
  // hosted runner before they push and open a pull request.
  function work(id, item, attempt = 1) {
    setAgent(id, { busy: true })
    const branch = `agent/${item.msg.split(": ")[1].toLowerCase().replace(/\W+/g, "-").slice(0, 22)}`
    const commit = { ...item, agent: id, branch, attempt }
    const edit = () => {
      setAgent(id, { status: `editing ${item.file}`, tone: item.incident ? "fix" : "edit", progress: null })
      log(id, `edit ${item.file}`)
      later(between(1200, 2200), local)
    }
    const local = () => {
      const lines = item.kind === "docs"
        ? ["$ effect-ci run --local", "CI execution summary: 0 actions"]
        : ["$ effect-ci run --local", "$ tsc -b ◉ cache hit, replaying", `$ vp build ○ cache miss: '${item.file}' modified, executing`, "✓ lint depends on install", "✓ test depends on install"]
      const duration = item.kind === "docs" ? 500 : between(1200, 1800)
      setAgent(id, { status: "effect-ci run --local", tone: "run", progress: { start: state.now, duration } })
      lines.forEach((line, index) => later((duration * index) / lines.length, () => log(id, line)))
      later(duration, check)
    }
    const check = () => {
      commit.sha = hex(7)
      log(id, `$ git commit -m "${item.msg}"`)
      log(id, "$ effect-ci run check")
      setAgent(id, { status: "effect-ci run check", tone: "push", sha: commit.sha, progress: null })
      send(`${id}-runner`, item.kind, commit.sha, () => startRun(commit, "check"))
    }
    commit.checked = result => {
      if (result === "failed") {
        log(id, `Error [CI_COMMAND_FAILED]: Command failed (1): pnpm exec vp test --shard ${item.fail.split(" ")[1]}`)
        setAgent(id, { status: "check failed · fixing", tone: "fail" })
        return later(1400, () => work(id, { ...item, fail: undefined, msg: item.msg }, attempt + 1))
      }
      log(id, `✓ signed checks for ${commit.sha}`)
      commit.pr = ++prs
      log(id, `$ git push origin ${branch}`)
      log(id, `$ gh pr create --fill   # #${commit.pr}`)
      setAgent(id, { status: `opened PR #${commit.pr}`, tone: "pass" })
      send(`${id}-github`, "pr", `#${commit.pr}`, () => opened(commit))
      later(1200, () => {
        setAgent(id, { busy: false, status: id === "a3" ? "on call · watching events" : "idle", tone: "idle" })
        nextIncident()
      })
    }
    if (item.incident && attempt === 1) {
      log(id, `event app.error · ${item.incident.route}`)
      log(id, item.incident.error)
      setAgent(id, { status: "reading the stack trace", tone: "fix", progress: null })
      later(1400, edit)
    } else edit()
  }

  function opened(commit) {
    log("github", `PR #${commit.pr} ${commit.msg} · ${agents[commit.agent].label}`)
    setGithub({ ref: commit.branch, sha: commit.sha, pr: commit.pr, check: "pending" })
    send("github-runner", "pr", commit.sha, () => startRun(commit, "pr"))
  }

  function review(human) {
    const commit = reviews[human][0]
    if (!commit || state.humans[human].tone === "review") return
    log(human, `review #${commit.pr} · ${commit.msg}`)
    log(human, `✓ Cloudflare / ci  signed for ${commit.sha}`)
    setHuman(human, { status: `reviewing PR #${commit.pr}`, tone: "review" })
    later(between(2200, 3200), () => {
      reviews[human].shift()
      log(human, `$ gh pr merge ${commit.pr} --rebase`)
      setHuman(human, { status: `merged PR #${commit.pr}`, tone: "pass" })
      send(`review-${human}`, "merge", "merge", () => merged(commit))
      later(800, () => {
        setHuman(human, { tone: "idle", status: "idle" })
        if (reviews[human].length) review(human)
        else if (commit.owner === human) later(between(600, 1400), () => assign(human))
      })
    })
  }

  function merged(commit) {
    log("github", `merge #${commit.pr} → main ${commit.sha}`)
    setGithub({ ref: "main", sha: commit.sha, pr: 0, check: "pending" })
    send("github-runner", commit.kind === "docs" ? "docs" : "pr", commit.sha, () => startRun(commit, "main"))
  }

  // Hosted runner: Workers take quick checks, Containers take builds and tests.
  function acquire(pool, fn) {
    const free = state.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.pool === pool && !slot.busy)
    if (!free.length) return waiters[pool].push(fn)
    const warm = free.filter(({ slot }) => slot.warm)
    const { index } = pick(warm.length >= 2 ? warm : free)
    state.slots[index].busy = true
    fn(index)
  }
  function release(index) {
    const next = waiters[state.slots[index].pool].shift()
    if (next) next(index)
    else state.slots[index].busy = false
  }

  function execute(index, task, sha, done) {
    const slot = state.slots[index]
    const spec = tasks[task.base]
    const id = `slot-${index}`
    const worker = slot.pool === "worker"
    const boot = worker ? 10 : task.cached ? 80 : slot.warm ? 160 : 700
    log(id, worker ? "isolate · ready in 4ms" : `container · ${slot.warm ? "warm" : "cold start"}`)
    setSlot(index, { state: "boot", task: task.name, sha, start: state.now, duration: boot, busy: true })
    later(boot, () => {
      const duration = task.cached ? between(200, 320) : spec.duration * between(0.8, 1.25)
      log(id, `$ ${spec.command(sha, task.shard)}`)
      setSlot(index, { state: "run", start: state.now, duration })
      later(duration, () => {
        const result = task.fail ? "failed" : task.cached ? "cached" : "passed"
        log(id, task.fail ? `Error [CI_COMMAND_FAILED]: Command failed (1): ${spec.command(sha, task.shard)}`
          : task.cached ? "◉ cache hit, replaying"
          : task.base === "test" ? `✓ ${Math.floor(between(160, 240))} tests passed`
          : `✓ ${task.name} (${duration < 1000 ? `${Math.round(duration)}ms` : `${(duration / 1000).toFixed(1)}s`})`)
        state.runner.tasks++
        if (task.cached) state.runner.cached++
        setSlot(index, { state: result, warm: true })
        later(worker ? 350 : 800, () => { setSlot(index, { state: "idle", task: "", sha: "" }); release(index) })
        done(!task.fail)
      })
    })
  }

  function startRun(commit, origin) {
    const ref = origin === "check" ? `check · ${agents[commit.agent].label}` : origin === "pr" ? `PR #${commit.pr}` : "main"
    const run = { id: `run-${hex(4)}`, sha: commit.sha, ref, done: 0, total: 0, status: "running" }
    state.runs.unshift(run)
    state.runs.length = Math.min(state.runs.length, 3)
    state.runner.runs++
    touch("runner")
    const task = (name, extra = {}) => ({ name, base: name.split(" ")[0], shard: name.split(" ")[1], ...extra })
    const docs = commit.kind === "docs"
    let phases
    log("runner", `Remote Workflow ${run.id} · ${ref} ${commit.sha}`)
    if (origin === "check") {
      phases = docs
        ? [[task("format")], [task("sign")]]
        : [
            [task("lint"), task("format"), task("install", { cached: true })],
            [task("build")],
            [1, 2, 3, 4].map(n => task(`test ${n}/4`, { fail: commit.fail === `test ${n}/4` })),
            [task("sign")],
          ]
      log("runner", docs ? "Markdown-only commit: format in a Worker, no containers" : `$ vp build ○ cache miss: '${commit.file}' modified, executing`)
    } else {
      phases = [[task("verify")], ...(origin === "main" && !docs ? [[task("deploy")]] : [])]
      state.runner.reused += docs ? 1 : 7
      log("runner", `◉ signed checks for ${commit.sha}: skip lint, format, build, test`)
      if (origin === "main" && docs) log("runner", "– deploy  nothing to ship")
    }
    run.total = phases.flat().length
    const phase = index => {
      if (index === phases.length) return finish(run, commit, origin, "passed")
      let pending = phases[index].length
      let failed = false
      for (const t of phases[index]) acquire(tasks[t.base].pool, slot => execute(slot, t, commit.sha, ok => {
        run.done++
        touch("runner")
        if (!ok) failed = true
        if (t.base === "deploy") send("runner-app", "deploy", `v${state.app.version + 1}`, () => deployed(commit))
        if (--pending === 0) failed ? finish(run, commit, origin, "failed") : phase(index + 1)
      }))
    }
    phase(0)
  }

  function finish(run, commit, origin, result) {
    run.status = result
    touch("runner")
    log("runner", result === "passed" ? `✓ Workflow completed · ${run.id}` : `× Workflow failed · ${run.id}`)
    const kind = result === "passed" ? "pass" : "fail"
    const mark = result === "passed" ? "✓" : "×"
    if (origin === "check") return send(`${commit.agent}-runner`, kind, mark, () => {
      log(commit.agent, `Remote Workflow ${run.id}`)
      commit.checked(result)
    }, true)
    send("github-runner", kind, mark, () => {
      log("github", `${mark} Cloudflare / ci  ${origin === "main" ? "main" : `#${commit.pr}`} ${commit.sha}`)
      setGithub({ check: result })
      if (origin === "pr") send(`review-${commit.reviewer}`, "review", `#${commit.pr}`, () => {
        reviews[commit.reviewer].push(commit)
        review(commit.reviewer)
      }, true)
    }, true)
  }

  // Production: deploys land, traffic flows, and errors raise events.
  function deployed(commit) {
    const app = state.app
    app.version++
    app.sha = commit.sha
    log("app", `deploy ${commit.sha} → v${app.version}`)
    if (commit.fixes) {
      app.incidents = app.incidents.filter(incident => incident.route !== commit.fixes)
      if (!app.incidents.length) log("app", "✓ 5xx rate back to 0.0%")
    }
    touch("app")
    if (commit.breaks) later(1600, () => incident(commit.breaks))
  }

  function incident(breaks) {
    const app = state.app
    if (app.incidents.some(incident => incident.route === breaks.route)) return
    app.incidents.push(breaks)
    touch("app")
    log("app", `GET ${breaks.route} 500`)
    log("app", breaks.error)
    send("app-runner", "error", "500", () => {
      log("runner", `event app.error · ${breaks.route}`)
      acquire("worker", slot => execute(slot, { name: "triage", base: "triage" }, "event", () => {
        incidents.push(breaks)
        nextIncident()
      }))
    })
  }

  function nextIncident() {
    if (!incidents.length) return
    const agent = ["a3", "a1", "a2"].find(id => !state.agents[id].busy)
    if (!agent) return
    const breaks = incidents.shift()
    setAgent(agent, { busy: true, status: "dispatched", tone: "fix" })
    log("runner", `→ dispatch ${agents[agent].label}`)
    send(`runner-${agent}`, "dispatch", "fix", () => work(agent, {
      kind: "source", file: breaks.file, msg: breaks.fix, fixes: breaks.route, incident: breaks, reviewer: agents[agent].owner,
    }))
  }

  function traffic() {
    const app = state.app
    const failing = app.incidents.length && random() < 0.45
    const route = failing ? pick(app.incidents).route : pick(routes)
    const ms = Math.floor(between(18, failing ? 260 : 90))
    log("app", `GET ${route} ${failing ? 500 : 200} ${ms}ms`)
    app.rate = app.incidents.length ? between(1.8, 4.6) : 0
    app.bars.push({ h: Math.min(1, ms / 120 + 0.15), error: !!failing })
    app.bars.shift()
    touch("app")
    later(between(450, 850), traffic)
  }

  log("app", `v${state.app.version} · ${state.app.sha} serving`)
  log("github", "main · 9c41e0a")
  log("runner", "fleet ready · 8 Workers · 18 Containers")
  log("a3", "on call: subscribed to app.error events")
  later(200, traffic)
  later(300, () => assign("me"))
  later(1500, () => assign("teammate"))

  function tick(dt) {
    const end = state.now + dt
    for (;;) {
      let next = -1
      for (let i = 0; i < timers.length; i++) if (timers[i].at <= end && (next < 0 || timers[i].at < timers[next].at)) next = i
      if (next < 0) break
      const [timer] = timers.splice(next, 1)
      state.now = Math.max(state.now, timer.at)
      timer.fn()
    }
    state.now = end
  }

  return {
    state,
    tick,
    advance(ms, step = 50) { for (let t = 0; t < ms; t += step) tick(step) },
    drain() { const changed = new Set(dirty); dirty.clear(); return changed },
  }
}
