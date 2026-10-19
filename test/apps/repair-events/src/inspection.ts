export function inspection(
  input: unknown,
): { mode: "inventory" } | { mode: "public-source" } | { mode: "read"; digest: string } {
  const invalid = () => new Error("Invalid notification inspection");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid();
  const keys = Reflect.ownKeys(input);
  const mode = Object.getOwnPropertyDescriptor(input, "mode");
  if (!mode || !("value" in mode)) throw invalid();
  if (mode.value === "inventory" && keys.length === 1 && keys[0] === "mode") return { mode: "inventory" };
  if (mode.value === "public-source" && keys.length === 1 && keys[0] === "mode") return { mode: "public-source" };
  const id = Object.getOwnPropertyDescriptor(input, "digest");
  if (
    mode.value !== "read" ||
    keys.length !== 2 ||
    keys.some((key) => key !== "mode" && key !== "digest") ||
    !id ||
    !("value" in id) ||
    typeof id.value !== "string" ||
    !/^[a-f0-9]{64}$/.test(id.value)
  )
    throw invalid();
  return { mode: "read", digest: id.value };
}
