interface Source {
  readonly repository: string
  readonly revision: string
}

export interface Manifest {
  readonly name?: string
  readonly scripts?: Readonly<Record<string, string>>
}

/** Hosted discovery reads the requested source, never the test host's manifest. */
export const readSourceManifest = async (
  source: Source,
  root: string,
  request: typeof fetch = fetch,
): Promise<Manifest> => {
  const repository = new URL(source.repository)
  if (repository.origin !== "https://github.com" || repository.username || repository.password ||
    repository.search || repository.hash || !/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(repository.pathname) ||
    !/^[a-f0-9]{40}$/.test(source.revision) || root.startsWith("/") || root.split("/").includes("..")) {
    throw new Error("Hosted discovery requires a GitHub repository, full commit SHA, and relative project path")
  }
  const project = repository.pathname.replace(/\/$/, "").replace(/\.git$/, "")
  const response = await request(`https://raw.githubusercontent.com${project}/${source.revision}/${root}/package.json`, {
    // Workers supports manual/follow, not Node's redirect:"error".
    redirect: "manual",
  })
  if (!response.ok) throw new Error(`Source manifest fetch failed: ${response.status}`)
  const manifest: unknown = await response.json()
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Invalid package manifest")
  const { name, scripts } = manifest as Record<string, unknown>
  if ((name !== undefined && typeof name !== "string") ||
    (scripts !== undefined && (!scripts || typeof scripts !== "object" || Array.isArray(scripts) ||
      Object.values(scripts).some((value) => typeof value !== "string")))) throw new Error("Invalid package scripts")
  return { ...(name === undefined ? {} : { name: name as string }),
    ...(scripts === undefined ? {} : { scripts: scripts as Record<string, string> }) }
}
