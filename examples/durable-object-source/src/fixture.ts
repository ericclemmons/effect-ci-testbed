// Fixed owned fixture, never caller-supplied project code or arbitrary storage keys.
export const sourceId = "owned-source";
export const sourceText = "source from durable object\n";
export const manifest = (path = "source.txt") => new TextEncoder().encode(JSON.stringify({ version: 1,
  files: [{ path, base64: btoa(sourceText), executable: false }] }));
export const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("");

export function parameters(value: unknown) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error("Exact source parameters required");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("repository") || !keys.includes("revision")) throw Error("Exact source parameters required");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!Object.values(descriptors).every(d => Object.hasOwn(d, "value"))) throw Error("Exact source parameters required");
  const repository = descriptors.repository?.value, revision = descriptors.revision?.value;
  if (repository !== sourceId || typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw Error("Fixed immutable source reference required");
  return { repository, revision };
}
