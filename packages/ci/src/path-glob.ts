/** Portable relative globs: *, **, ?, and literal alternatives such as (ts|tsx|json). */
export function pathGlob(pattern: string): RegExp {
  if (!pattern || pattern.length > 4096 || pattern.startsWith("/") || pattern.split("/").some(part => part === ".." || part === ".") ||
      /[\\\[\]{}!\x00-\x1f]/.test(pattern)) throw Error("Expected a relative glob using *, ** or ?")
  let expression = "^"
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === "*" && pattern[i + 1] === "*") {
      if ((i > 0 && pattern[i - 1] !== "/") || (i + 2 < pattern.length && pattern[i + 2] !== "/"))
        throw Error("** must occupy a complete path segment")
      i++
      if (pattern[i + 1] === "/") { expression += "(?:[^/]+/)*"; i++ }
      else expression += "[\\s\\S]*"
    } else if (c === "*") expression += "[^/]*"
    else if (c === "?") expression += "[^/]"
    else if (c === "(" && /^\([\w-]+(?:\|[\w-]+)+\)/.test(pattern.slice(i))) {
      const group = pattern.slice(i).match(/^\([\w-]+(?:\|[\w-]+)+\)/)![0]
      expression += `(?:${group.slice(1, -1)})`
      i += group.length - 1
    }
    else expression += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(expression + "$")
}

export function pathPatterns(patterns: string | ReadonlyArray<string>): ReadonlyArray<string> {
  const values = typeof patterns === "string" ? [patterns] : [...patterns]
  if (!values.length || values.length > 64) throw Error("Provide between 1 and 64 path globs")
  values.forEach(pathGlob)
  return [...new Set(values)].sort()
}
