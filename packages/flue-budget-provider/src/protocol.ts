export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const LIMIT_CENTS = 200;
export const RESERVATION_CENTS = 10;
export const MAX_OUTPUT_TOKENS = 2048;

export interface InferenceInput {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  max_tokens: number;
  stream: false;
  temperature: 0;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const invalid = () => new Error("Inference budget request rejected");

export function inputFor(model: unknown, input: unknown): InferenceInput {
  if (
    model !== MODEL ||
    !object(input) ||
    !exactKeys(input, ["messages", "max_tokens", "stream", "temperature"])
  )
    throw invalid();
  if (
    !Array.isArray(input.messages) ||
    input.messages.length < 1 ||
    input.messages.length > 16 ||
    (input.stream !== undefined && input.stream !== false) ||
    (input.temperature !== undefined && input.temperature !== 0)
  )
    throw invalid();
  const max = input.max_tokens ?? MAX_OUTPUT_TOKENS;
  if (!Number.isSafeInteger(max) || (max as number) < 1 || (max as number) > MAX_OUTPUT_TOKENS)
    throw invalid();
  const messages = input.messages.map((message) => {
    if (
      !object(message) ||
      !exactKeys(message, ["role", "content"]) ||
      !["system", "user", "assistant"].includes(message.role as string) ||
      typeof message.content !== "string" ||
      !message.content.length
    )
      throw invalid();
    return {
      role: message.role as InferenceInput["messages"][number]["role"],
      content: message.content,
    };
  });
  // Bound transport, not a fabricated token estimate. Provider context limit bounds tokens.
  if (new TextEncoder().encode(JSON.stringify(messages)).length > 32_768) throw invalid();
  return { messages, max_tokens: max as number, stream: false, temperature: 0 };
}
