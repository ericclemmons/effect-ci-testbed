/** Clean cached source state without discarding the runner's declared cache paths. */
export const cleanCheckoutCommand = (
  directory: string,
  cachePaths: ReadonlyArray<string> = [],
): ReadonlyArray<string> => {
  for (const path of cachePaths) {
    if (!path || path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`Cache path must be relative to the repository: ${path}`)
    }
  }
  return ["git", "-C", directory, "clean", "-ffdx",
    ...cachePaths.map((path) => `--exclude=${path}`)]
}
