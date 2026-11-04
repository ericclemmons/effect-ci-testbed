/** Repository-relative Effect globs, including dotfiles. */
export function pathPatterns(patterns: string | ReadonlyArray<string>): ReadonlyArray<string> {
  const values = typeof patterns === "string" ? [patterns] : [...patterns]

  if (!values.length || values.length > 64) throw Error("Provide between 1 and 64 path globs")
  for (const pattern of values) {

    if (!pattern || pattern.length > 4096 || pattern.startsWith("/") ||
        pattern.split("/").some(part => part === ".." || part === ".") || /[\\\x00-\x1f]/.test(pattern))
      throw Error("Expected a relative Effect glob")
  }

  return [...new Set(values)].sort()
}

/** Literal traversal roots; Effect owns all matching syntax. */
export function pathPrefixes(patterns: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(patterns.map(pattern => {
    const parts = pattern.split("/"), first = parts.findIndex(part => /[?*{\[]/.test(part))

    return (first < 0 ? parts : parts.slice(0, first)).join("/")
  }))]
}
