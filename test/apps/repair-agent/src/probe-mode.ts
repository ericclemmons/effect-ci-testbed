/** Fixed administrative dispatch only; never evaluate a payload accessor. */
export function probeMode(instance: string, payload: unknown): "inspect" | "proposal" {
  const invalid = () => new Error("Fixed mode required");
  try {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(instance) ||
      typeof payload !== "object" ||
      !payload ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
      Reflect.ownKeys(payload).length !== 1
    )
      throw invalid();
    const mode = Object.getOwnPropertyDescriptor(payload, "mode");
    if (!mode || !("value" in mode) || !["inspect", "proposal"].includes(mode.value))
      throw invalid();
    return mode.value;
  } catch {
    throw invalid();
  }
}
