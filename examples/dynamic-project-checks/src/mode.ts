export function fixedMode(input: unknown, expected: "fixture" | "verify-boundaries") {
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 1 ||
    Object.getOwnPropertyDescriptor(input, "mode")?.value !== expected) throw Error("Exact owned project mode required");
}
