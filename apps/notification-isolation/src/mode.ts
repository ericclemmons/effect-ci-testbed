export type Mode = "success" | "business-failure" | "provider-timeout" | "observer-success" | "observer-business-failure";
export function fixtureMode(input: unknown): Mode {
  if (!input || typeof input !== "object" || Array.isArray(input) || Reflect.ownKeys(input).length !== 1)
    throw Error("Exact owned notification fixture mode required");
  const mode = Object.getOwnPropertyDescriptor(input, "mode");
  if (!mode || !("value" in mode) || !["success", "business-failure", "provider-timeout", "observer-success", "observer-business-failure"].includes(mode.value))
    throw Error("Exact owned notification fixture mode required");
  return mode.value;
}
