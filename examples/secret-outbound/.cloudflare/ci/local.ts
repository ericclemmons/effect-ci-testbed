import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { promisify } from "node:util"
import * as CI from "@effect-ci-testbed/ci"
import * as Effect from "effect/Effect"
import { credentialRequest } from "../../../../packages/cloudflare/src/credential-proxy.ts"
import { sourceIdentity } from "../../../coverage-receipt.ts"

const docker = promisify(execFile)
const listen = (server: Server, host: string): Promise<number> => new Promise((resolve, reject) => {
  server.once("error", reject)
  server.listen(0, host, () => {
    const address = server.address()
    if (!address || typeof address === "string") return reject(Error("Missing fixture port"))
    resolve(address.port)
  })
})
const close = (server: Server | undefined): Promise<void> => new Promise((resolve, reject) => {
  if (!server?.listening) return resolve()
  server.close(error => error ? reject(error) : resolve())
  server.closeAllConnections()
})

export const local = ({ root }: { readonly root: string }): CI.RunConfiguration => {
  const name = `effect-ci-outbound-${randomUUID()}`
  const token = randomUUID()
  let proxy: Server | undefined
  let upstream: Server | undefined
  let authenticated = 0
  let denied = 0
  let completed = false
  let attempted = false
  let imageIdentity: unknown
  let guestConfiguration: unknown
  return {
    env: "local-container",
    source: {
      checkout: () => Effect.succeed(CI.Workspace.remote(name, "/tmp")),
      reference: { kind: "local", path: "empty-container-workspace" },
    },
    executor: {
      execute: ({ command, stepId, onOutput }) => Effect.tryPromise({
        try: async () => {
          if (attempted) throw Error("This fixture permits one command only")
          attempted = true
          const image = process.env.EFFECT_CI_OUTBOUND_IMAGE ?? "node:24-alpine"
          const metadata = await docker("docker", ["image", "inspect", image, "--format", "{{json .}}"])
          const inspected = JSON.parse(metadata.stdout)
          imageIdentity = { id: inspected.Id, digests: inspected.RepoDigests }
          upstream = createServer((request, response) => {
            if (request.method !== "GET" || request.url !== "/verify" || request.headers.authorization !== `Bearer ${token}`) {
              response.writeHead(403).end()
              return
            }
            authenticated++
            response.writeHead(200, { "x-reflected-credential": token }).end(token)
          })
          const upstreamPort = await listen(upstream, "127.0.0.1")
          proxy = createServer(async (incoming, outgoing) => {
            try {
              const response = await credentialRequest(new Request(new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "invalid"}`), {
                method: incoming.method ?? "GET",
                headers: { authorization: incoming.headers.authorization ?? "" },
              }), async () => token, request => fetch(`http://127.0.0.1:${upstreamPort}/verify`, {
                method: request.method, headers: request.headers, redirect: "manual",
              }))
              if (response.status === 403) denied++
              outgoing.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text())
            } catch {
              outgoing.writeHead(502).end("Authentication failed")
            }
          })
          proxy.on("connect", (request, socket, head) => {
            if (request.url !== "credential.ci:80") {
              socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
              return
            }
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
            if (head.length) socket.unshift(head)
            proxy!.emit("connection", socket)
          })
          const proxyPort = await listen(proxy, "0.0.0.0")
          await docker("docker", [
            "create", "--pull=never", "--name", name, "--read-only", "--cap-drop=ALL",
            "--security-opt=no-new-privileges", "--user", "65534:65534", "--workdir", "/tmp",
            ...(process.platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : []),
            "--env", "NODE_USE_ENV_PROXY=1",
            "--env", `HTTP_PROXY=http://host.docker.internal:${proxyPort}`, "--env", "NO_PROXY=",
            inspected.Id, "sh", "-c", command,
          ])
          const result = await new Promise<CI.CommandExecutionResult>((resolve, reject) => {
            const child = spawn("docker", ["start", "--attach", name], { stdio: ["ignore", "pipe", "pipe"] })
            let stdout = "", stderr = ""
            child.stdout.on("data", (chunk: Buffer) => {
              stdout += chunk.toString()
            })
            child.stderr.on("data", (chunk: Buffer) => {
              stderr += chunk.toString()
            })
            child.once("error", reject)
            child.once("close", code => resolve({ exitCode: code ?? 1, stdout, stderr }))
          })
          const state = await docker("docker", ["inspect", name, "--format", "{{json .}}"])
          const container = JSON.parse(state.stdout)
          const guestEnvironment: string[] = container.Config.Env
          const credentialsExcluded = !guestEnvironment.some(value => value.includes(token)) && container.Mounts.length === 0
          guestConfiguration = {
            environmentNames: guestEnvironment.map(value => { const [name] = value.split("="); return name }),
            mounts: container.Mounts.length, hostCredentialPresent: !credentialsExcluded,
            credentialReturned: result.stdout.includes(token) || result.stderr.includes(token),
            exitCode: container.State.ExitCode,
          }
          if (!result.stdout.includes(token) && !result.stderr.includes(token)) {
            onOutput("stdout", result.stdout)
            onOutput("stderr", result.stderr)
          }
          completed = result.exitCode === 0 && container.State.ExitCode === 0 && authenticated === 1 && denied === 3 &&
            credentialsExcluded && !result.stdout.includes(token) && !result.stderr.includes(token)
          if (!completed) throw Error("Local outbound boundary verification failed")
          return result
        },
        catch: () => new CI.CommandError(stepId, command, "/tmp", 1, "Local outbound fixture failed; requires Docker and a preloaded Node 24.5+ image"),
      }),
    },
    dispose: async () => {
      let containerRemoved = !attempted
      try {
        if (attempted) {
          try { await docker("docker", ["rm", "--force", name]) }
          catch (error) {
            if (!(error instanceof Error) || !("stderr" in error) || !String(error.stderr).includes("No such container")) throw error
          }
          containerRemoved = true
        }
      } finally {
        try { await close(proxy) } finally { await close(upstream) }
        if (attempted && process.env.EFFECT_CI_OUTBOUND_RECEIPT) writeFileSync(process.env.EFFECT_CI_OUTBOUND_RECEIPT, JSON.stringify({
          schemaVersion: 1, recordedAt: new Date().toISOString(),
          recipe: "secret-outbound", environment: process.env.GITHUB_ACTIONS === "true" ? "effect-on-github" : "effect-local",
          source: sourceIdentity(root, [".cloudflare/ci/local.ts", ".cloudflare/ci/actions.ts", ".cloudflare/ci/workflow.ts", "../coverage-receipt.ts", "../../packages/cloudflare/src/credential-proxy.ts"]),
          runtime: { node: process.version, platform: process.platform, arch: process.arch }, image: imageIdentity,
          authenticated, denied, verified: completed && containerRemoved, containerRemoved, guestConfiguration,
          credential: "inert random fixture credential held only by the host",
          input: "empty read-only container; no host mounts or inherited host environment",
          upstream: "host loopback fixture, not an external authenticated API",
          boundary: "Fixed HTTP placeholder capability via opt-in Node proxy; not transparent VM interception or an egress firewall",
        }, null, 2) + "\n")
      }
    },
  }
}
