/** Versioned cache identity: commits can share entries, but projects and inputs cannot. */
export const cacheIdentity = async (request: {
  readonly repository: string
  readonly key: string
  readonly paths: ReadonlyArray<string>
  readonly container: unknown
  readonly files: ReadonlyArray<readonly [string, string | undefined]>
}): Promise<string> => {
  const files = [...request.files].sort(([a], [b]) => a.localeCompare(b))
  for (const [path] of files) {
    if (!path || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Cache key file must be repository-relative: ${path}`)
    }
  }
  const input = JSON.stringify({
    version: 2,
    repository: request.repository,
    key: request.key,
    container: request.container,
    paths: [...request.paths].sort(),
    files: files.map(([path, content]) => [path, content ?? null]),
  })
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return `cache:v2:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}
