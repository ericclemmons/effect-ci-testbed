export const repository = "https://gitlab.com/gitlab-org/gitlab-test.git";
export const revision = "ddd0f15ae83993f5cb66a927a28673882e99100b";
/** Exact host enrollment; reject actor capabilities before container lookup. */
export function isPinnedSource(input: unknown): boolean {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return false;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || !keys.includes("repository") || !keys.includes("revision")) return false;
  const d = Object.getOwnPropertyDescriptors(input);
  return Object.values(d).every(v => Object.hasOwn(v, "value")) && d.repository?.value === repository && d.revision?.value === revision;
}
