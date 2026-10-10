export interface SourceFile {
  readonly path: string
  readonly base64: string
  readonly executable: boolean
}

/** Bounded, immutable export. Never creates or forwards a repository token. */
export async function readArtifactSource(repo: Pick<ArtifactsRepo, "readCommit" | "readTree" | "readBlob">, revision: string, directory: string): Promise<SourceFile[]> {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Source requires an immutable commit SHA")
  const segments = directory.split("/")
  const safeName = (name: string) => name !== "." && name !== ".." && /^[^/\\\x00]+$/.test(name) && new TextEncoder().encode(name).length <= 255
  if (!segments.every(safeName)) throw new Error("Invalid source directory")
  const commit = await repo.readCommit(revision)
  if (!commit || commit.hash !== revision) throw new Error("Source commit not found")
  let tree = commit.treeHash
  for (const name of segments) {
    const entry = (await repo.readTree(tree))?.find((entry) => entry.name === name)
    if (!entry || entry.type !== "tree") throw new Error("Source directory not found")
    tree = entry.hash
  }
  const files: SourceFile[] = []
  let bytes = 0
  let entries = 0
  async function visit(hash: string, prefix: string, depth: number): Promise<void> {
    if (depth > 32) throw new Error("Source directory depth exceeded")
    const children = await repo.readTree(hash)
    if (!children) throw new Error("Source tree not found")
    const names = new Set<string>()
    for (const entry of children) {
      if (++entries > 1000) throw new Error("Source entry limit exceeded")
      if (!safeName(entry.name) || names.has(entry.name)) throw new Error("Invalid source entry")
      names.add(entry.name)
      const path = prefix + entry.name
      if (entry.type === "tree") await visit(entry.hash, `${path}/`, depth + 1)
      else {
        if (entry.type !== "blob" && entry.type !== "exec") throw new Error("Symlinks and submodules are unsupported")
        const blob = await repo.readBlob(entry.hash)
        if (!blob) throw new Error("Source blob not found")
        bytes += blob.size
        if (bytes > 64 * 1024) throw new Error("Source byte limit exceeded")
        const data = new Uint8Array(await blob.arrayBuffer())
        let binary = ""
        for (const byte of data) binary += String.fromCharCode(byte)
        files.push({ path, base64: btoa(binary), executable: entry.type === "exec" })
      }
    }
  }
  await visit(tree, "", 0)
  if (new TextEncoder().encode(JSON.stringify(files)).length > 96 * 1024) throw new Error("Source manifest limit exceeded")
  return files
}
