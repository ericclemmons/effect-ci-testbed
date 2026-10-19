import { MODEL, reserve, type BudgetStore } from "./budget.ts";
import { flueBudgetInput } from "./flue-policy.ts";

export interface StreamBinding {
  run(
    model: string,
    input: unknown,
    options: { returnRawResponse: true; signal: AbortSignal },
  ): Promise<unknown>;
}

/** Buffer bounded ORIGINAL SSE bytes. No invented usage, deltas or finish reason. */
export async function inferStream(
  store: BudgetStore,
  binding: StreamBinding,
  run: unknown,
  id: unknown,
  model: unknown,
  payload: unknown,
  deadlineMs = 45_000,
) {
  const bounded = flueBudgetInput(model, payload, { returnRawResponse: true });
  const receipt = await reserve(store, run, id);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      reject(new Error("deadline"));
    }, deadlineMs);
  });
  const collect = async () => {
    const response = await binding.run(
      MODEL,
      { ...bounded, stream: true },
      { returnRawResponse: true, signal: controller.signal },
    );
    if (!(response instanceof Response)) throw new Error("transport");
    if (
      controller.signal.aborted ||
      !response.ok ||
      !response.body ||
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "text/event-stream"
    ) {
      void response.body?.cancel().catch(() => {});
      throw new Error("transport");
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const item = await reader.read();
      if (controller.signal.aborted) throw new Error("deadline");
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 65_536) throw new Error("bound");
      chunks.push(item.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ...receipt,
      body: new TextDecoder("utf-8", { fatal: true }).decode(joined),
      byteLength: bytes,
      contentType: "text/event-stream" as const,
    };
  };
  try {
    return await Promise.race([collect(), deadline]);
  } catch {
    throw new Error("Reserved streaming inference failed; reservation retained");
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

/** Protocol observation only, not Flue execution or a fabricated completion. */
export function streamSummary(body: string) {
  let events = 0,
    openAiChoices = false,
    workersAiResponse = false,
    finishReason = false,
    doneSentinel = false;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    events++;
    if (data === "[DONE]") {
      doneSentinel = true;
      continue;
    }
    try {
      const value = JSON.parse(data);
      if (typeof value?.response === "string") workersAiResponse = true;
      if (Array.isArray(value?.choices)) {
        openAiChoices = true;
        if (
          value.choices.some(
            (choice: unknown) =>
              typeof choice === "object" &&
              choice !== null &&
              "finish_reason" in choice &&
              typeof choice.finish_reason === "string" &&
              choice.finish_reason.length > 0,
          )
        )
          finishReason = true;
      }
    } catch {
      /* Preserve unknown protocol as unknown; never repair it. */
    }
  }
  return { events, openAiChoices, workersAiResponse, finishReason, doneSentinel };
}
