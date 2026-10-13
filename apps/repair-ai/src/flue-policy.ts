import { inputFor, MODEL, type InferenceInput } from "./budget.ts";

const rejected = () => new Error("Flue inference request rejected");

/** Read data properties only: a provider override must not execute accessors. */
function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw rejected();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw rejected();
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property)) throw rejected();
    result[key] = property.value;
  }
  return result;
}

function messagesFor(value: unknown) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw rejected();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > 16) throw rejected();
  const allowed = ["length", ...Array.from({ length }, (_, index) => String(index))];
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)))
    throw rejected();
  return Array.from({ length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !("value" in property)) throw rejected();
    return record(property.value, ["role", "content"]);
  });
}

/**
 * Pinned Flue 2.2.2's text-only Workers AI request -> existing reserved request.
 * This validates INPUT ONLY. It does not fabricate SSE, a finish reason, token
 * usage, streaming support or agent execution from a buffered text response.
 */
function checkedInput(model: unknown, payload: unknown, options: unknown): InferenceInput {
  if (model !== MODEL) throw rejected();
  const request = record(payload, [
    "messages",
    "stream",
    "stream_options",
    "max_completion_tokens",
    "temperature",
  ]);
  const transport = record(options, ["returnRawResponse", "signal"]);
  const stream = record(request.stream_options, ["include_usage"]);
  if (
    request.stream !== true ||
    stream.include_usage !== true ||
    transport.returnRawResponse !== true ||
    (transport.signal !== undefined && !(transport.signal instanceof AbortSignal))
  )
    throw rejected();
  if ((transport.signal as AbortSignal | undefined)?.aborted) throw rejected();
  const messages = messagesFor(request.messages);
  try {
    return inputFor(model, {
      messages,
      max_tokens: request.max_completion_tokens,
      stream: false,
      temperature: request.temperature,
    });
  } catch {
    throw rejected();
  }
}

export function flueBudgetInput(
  model: unknown,
  payload: unknown,
  options: unknown,
): InferenceInput {
  try {
    return checkedInput(model, payload, options);
  } catch {
    throw rejected();
  }
}
