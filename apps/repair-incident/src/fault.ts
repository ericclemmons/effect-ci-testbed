/** Owned deterministic fixture, not an event-supplied message or repository module. */
export const EMISSION_ID = "friday-owned-health-500-v1";
export const ERROR_MESSAGE =
  "Effect CI owned health fixture returned 500 (friday-owned-health-500-v1)";
export function healthStatus() {
  return 500;
}
export function mode(input: unknown): "inspect" | "emit-once" {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid owned incident mode");
  const keys = Reflect.ownKeys(input);
  const property = Object.getOwnPropertyDescriptor(input, "mode");
  if (
    keys.length !== 1 ||
    keys[0] !== "mode" ||
    !property ||
    !("value" in property) ||
    (property.value !== "inspect" && property.value !== "emit-once")
  )
    throw new Error("Invalid owned incident mode");
  return property.value;
}
