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

// Pinned 2.2.2's exact framework task declaration, captured from its actual
// start/init/dispatch lifecycle. This opt-in policy DISABLES delegation; it
// neither forwards the declaration nor grants the task any model capability.
const TASK_DECLARATION_SHA256 = "6e224c894c36ae6b72809e4b48162317f36640d3b07b3485ca33ded9c98db6ef";

function canonicalData(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (depth > 12 || ++budget.nodes > 2048) throw rejected();
  if (typeof value === "string") {
    if (value.length > 8192) throw rejected();
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      !Number.isSafeInteger(length) ||
      length > 64
    )
      throw rejected();
    const keys = ["length", ...Array.from({ length }, (_, i) => String(i))];
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key)))
      throw rejected();
    return Array.from({ length }, (_, i) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !("value" in descriptor)) throw rejected();
      return canonicalData(descriptor.value, depth + 1, budget);
    });
  }
  if (
    typeof value !== "object" ||
    !value ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw rejected();
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64 || keys.some((key) => typeof key !== "string")) throw rejected();
  const copied: Record<string, unknown> = Object.create(null);
  for (const key of (keys as string[]).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw rejected();
    copied[key] = canonicalData(descriptor.value, depth + 1, budget);
  }
  return copied;
}

/** Explicit text-proposal-only transport. The general guard stays unchanged. */
export async function flueProposalInput(model: unknown, payload: unknown, options: unknown) {
  try {
    const request = record(payload, [
      "messages",
      "stream",
      "stream_options",
      "max_completion_tokens",
      "temperature",
      "tools",
    ]);
    const transport = record(options, ["returnRawResponse", "signal", "extraHeaders"]);
    request.messages = messagesFor(request.messages).map((message) => {
      if (typeof message.content === "string") return message;
      const blocks = canonicalData(message.content);
      if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 16) throw rejected();
      const text = blocks
        .map((block) => {
          const data = record(block, ["type", "text"]);
          if (data.type !== "text" || typeof data.text !== "string" || !data.text.length)
            throw rejected();
          return data.text;
        })
        .join("\n");
      return { role: message.role, content: text };
    });
    if (request.tools !== undefined) {
      const text = JSON.stringify(canonicalData(request.tools));
      const bytes = new TextEncoder().encode(text);
      if (bytes.length > 8192) throw rejected();
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== TASK_DECLARATION_SHA256) throw rejected();
      delete request.tools;
    }
    if (transport.extraHeaders !== undefined) {
      const headers = record(transport.extraHeaders, ["x-session-affinity"]);
      if (
        typeof headers["x-session-affinity"] !== "string" ||
        !/^aff_[0-9A-HJKMNP-TV-Z]{26}$/.test(headers["x-session-affinity"])
      )
        throw rejected();
      // This is a routing hint, NEVER authorization. Proposal transport does
      // not use affinity caching and does not forward it to the broker/AI.
      delete transport.extraHeaders;
    }
    return flueBudgetInput(model, request, transport);
  } catch {
    throw rejected();
  }
}

/** Reject model-requested tools BEFORE the original stream reaches Flue. */
export function assertProposalStream(body: string) {
  const inspect = (value: unknown, depth = 0): void => {
    if (depth > 20) throw rejected();
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (
        ["tool_calls", "tool_call", "function_call"].includes(key) &&
        item !== null &&
        item !== undefined &&
        !(Array.isArray(item) && item.length === 0)
      )
        throw rejected();
      if (key === "finish_reason" && ["tool_calls", "function_call"].includes(item as string))
        throw rejected();
      inspect(item, depth + 1);
    }
  };
  try {
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") inspect(JSON.parse(data));
    }
  } catch {
    throw rejected();
  }
}
