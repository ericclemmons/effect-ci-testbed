import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const name = `effect-ci-user-${randomUUID()}`
const image = `${name}:proof`
const deadline = Date.now() + 210_000
let configuration
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].includes(key)))
const execute = (args, timeout = 15_000, allowFailure = false) => {
  const result = spawnSync("docker", args, {
    encoding: "utf8", env: environment, timeout: allowFailure ? timeout : Math.max(1, Math.min(timeout, deadline - Date.now())),
    killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
  })
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw Error(`docker ${args.join(" ")} failed (${result.error?.code ?? result.status}):\n${(result.stderr || result.stdout || "No daemon output").slice(-16_384)}`)
  }
  return result
}

let failure
let receipt
try {
  const endpoint = execute(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).stdout.trim()
  if (!endpoint.startsWith("unix://")) throw Error("This fixture requires a local Unix Docker socket")
  const plugins = JSON.parse(execute(["info", "--format", "{{json .ClientInfo.Plugins}}"]).stdout)
  const buildxPlugin = plugins.find(plugin => plugin.Name === "buildx")
  if (!buildxPlugin) throw Error("This runner requires Docker buildx")
  configuration = mkdtempSync(join(tmpdir(), "effect-ci-docker-"))
  writeFileSync(join(configuration, "config.json"), JSON.stringify({ cliPluginsExtraDirs: [dirname(buildxPlugin.Path)] }), { mode: 0o600 })
  environment.DOCKER_CONFIG = configuration
  environment.DOCKER_HOST = endpoint
  delete environment.DOCKER_CONTEXT
  const daemon = execute(["version", "--format", "{{.Server.Version}}"])
  const buildx = execute(["buildx", "version"])
  execute(["build", "--tag", image, "app"], 180_000)
  const imageId = execute(["image", "inspect", "--format", "{{.Id}}", image]).stdout.trim()
  execute(["run", "--detach", "--name", name, "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--user", "65534:65534", "--memory", "128m",
    "--memory-swap", "128m", "--cpus", "0.25", "--pids-limit", "32", image], 30_000)
  const exitCode = execute(["wait", name], 30_000).stdout.trim()
  const output = execute(["logs", name])
  const [container] = JSON.parse(execute(["inspect", name]).stdout)
  const expected = "hello from a user-provided Dockerfile\n"
  if (exitCode !== "0" || output.stdout !== expected || output.stderr) {
    throw Error(`Inner process exited ${exitCode}:\n${(output.stderr || output.stdout).slice(-16_384)}`)
  }
  if (!container.HostConfig.ReadonlyRootfs || container.Mounts.length || container.Config.User !== "65534:65534" ||
    !container.HostConfig.CapDrop?.includes("ALL") || !container.HostConfig.SecurityOpt?.includes("no-new-privileges") ||
    container.HostConfig.Privileged || container.HostConfig.Memory !== 134_217_728 ||
    container.HostConfig.MemorySwap !== 134_217_728 || container.HostConfig.NanoCpus !== 250_000_000 ||
    container.HostConfig.PidsLimit !== 32 || container.Config.Env.some(value => !value.startsWith("PATH="))) {
    throw Error("Inner container isolation or resource policy did not match")
  }
  receipt = { name, image, imageId, daemon: daemon.stdout.trim(), buildx: buildx.stdout.trim(),
    exitCode: Number(exitCode), output: output.stdout, network: container.HostConfig.NetworkMode,
    memoryBytes: container.HostConfig.Memory, nanoCpus: container.HostConfig.NanoCpus,
    pids: container.HostConfig.PidsLimit, mounts: container.Mounts.length, readOnly: true, user: container.Config.User }
} catch (error) {
  failure = error
} finally {
  const removedContainer = execute(["container", "rm", "--force", name], 15_000, true)
  const removedImage = execute(["image", "rm", image], 15_000, true)
  const remainingContainer = execute(["container", "ls", "--all", "--quiet", "--filter", `name=^/${name}$`], 15_000, true)
  const remainingImage = execute(["image", "ls", "--quiet", "--filter", `reference=${image}`], 15_000, true)
  const cleanupFailed = remainingContainer.status !== 0 || remainingImage.status !== 0 ||
    remainingContainer.stdout.trim() || remainingImage.stdout.trim()
  if (cleanupFailed) {
    console.error(`Cleanup unconfirmed for ${name}:\n${[removedContainer.stderr, removedImage.stderr, remainingContainer.stderr, remainingImage.stderr].join("\n").slice(-16_384)}`)
    failure ??= Error("Docker cleanup could not be confirmed; inspect this run before retrying")
  } else if (receipt) {
    console.log(JSON.stringify({ ...receipt, cleanup: "container and image removed" }))
  } else {
    console.error(JSON.stringify({ name, image, cleanup: "container and image removed" }))
  }
  if (configuration) rmSync(configuration, { recursive: true, force: true })
}
if (failure) throw failure
