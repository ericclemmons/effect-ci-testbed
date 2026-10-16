/** Canonical event crossing the PRIVATE receiver -> CI host capability.
 * This is a routing key, never admission authority or raw model input. The host
 * must re-read the durable authenticated admission before selecting a Workflow.
 */
export interface PublicIncidentTrigger {
  readonly type: "observability_issue";
  readonly admissionId: string;
}

export function publicIncidentTrigger(input: unknown): PublicIncidentTrigger {
  const rejected = () => new Error("Unsupported or unadmitted CI event");
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw rejected();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || keys.some(key => key !== "type" && key !== "admissionId")) throw rejected();
  const type = Object.getOwnPropertyDescriptor(input, "type");
  const id = Object.getOwnPropertyDescriptor(input, "admissionId");
  if (!type || !("value" in type) || type.value !== "observability_issue" ||
      !id || !("value" in id) || typeof id.value !== "string" ||
      !/^public-incident-[a-f0-9]{64}$/.test(id.value)) throw rejected();
  return { type: "observability_issue", admissionId: id.value };
}
