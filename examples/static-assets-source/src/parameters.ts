export function parameters(value: unknown): { revision: string; mode: "publish" | "reconcile" } {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== 2) throw Error("Exact static publication parameters required");
  const revision = Object.getOwnPropertyDescriptor(value, "revision"), mode = Object.getOwnPropertyDescriptor(value, "mode");
  if (!revision || !("value" in revision) || typeof revision.value !== "string" || !/^[a-f0-9]{40}$/.test(revision.value) ||
    !mode || !("value" in mode) || !["publish", "reconcile"].includes(mode.value)) throw Error("Invalid static publication parameters");
  return { revision: revision.value, mode: mode.value };
}
