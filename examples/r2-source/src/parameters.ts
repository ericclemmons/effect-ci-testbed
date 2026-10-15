/** Account-authenticated source selection stays inside ONE host-owned bucket.
 * The "repository" is an R2 key, never a Git URL or a credential selector.
 */
export function sourceParameters(value: unknown): { repository: string; revision: string } {
  const invalid = () => new Error("An exact R2 key and SHA256 digest are required");
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || keys.some(k => k !== "repository" && k !== "revision")) throw invalid();
  const key = Object.getOwnPropertyDescriptor(value, "repository"), digest = Object.getOwnPropertyDescriptor(value, "revision");
  if (!key || !("value" in key) || !digest || !("value" in digest) ||
      typeof key.value !== "string" || !/^source\/[a-f0-9]{64}\.json$/.test(key.value) ||
      typeof digest.value !== "string" || !/^[a-f0-9]{64}$/.test(digest.value)) throw invalid();
  return { repository: key.value, revision: digest.value };
}
