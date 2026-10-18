type Environment = Readonly<Record<string, string | undefined>>;

/** Deployment-time choices only. Existing installations retain the demo profile;
 * the new-account template explicitly chooses standalone. No credentials here. */
export function hostProfile(
  env: Environment,
): { profile: "demo" } | { profile: "standalone"; name: string; root: string } {
  const profile = env.EFFECT_CI_PROFILE ?? "demo";
  if (profile === "demo") return { profile };
  if (profile !== "standalone") throw Error("EFFECT_CI_PROFILE must be standalone or demo");
  const name = env.EFFECT_CI_WORKER_NAME ?? "effect-ci";
  const root = env.EFFECT_CI_PROJECT_ROOT ?? ".";
  if (!/^[a-z][a-z0-9-]{0,48}[a-z0-9]$/.test(name))
    throw Error("Use a lowercase Worker name of 2–50 letters, numbers or hyphens");
  if (
    root !== "." &&
    (root.startsWith("/") ||
      /[\\\x00-\x20\x7f]/.test(root) ||
      root.split("/").some((part) => !part || part === "." || part === ".."))
  )
    throw Error("Use a relative project root without traversal");
  return { profile, name, root };
}
