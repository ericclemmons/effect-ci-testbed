export function fixtureMode(input: unknown): "formatted" | "unformatted" {
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 1) throw Error("Exact fixture mode required");
  const mode = Object.getOwnPropertyDescriptor(input, "mode")?.value;
  if (mode !== "formatted" && mode !== "unformatted") throw Error("Exact fixture mode required");
  return mode;
}
