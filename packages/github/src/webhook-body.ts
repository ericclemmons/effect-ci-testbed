export const MAX_BODY = 256 * 1024;

/** Bound actual streamed bytes before HMAC/JSON handling; never trust Content-Length. */
export async function boundedBody(request: Request): Promise<string> {
  if (request.headers.has("content-encoding")) throw new Error("encoded-body");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing-body");
  let bytes = new Uint8Array();
  const timer = setTimeout(() => { void reader.cancel(); }, 5000);
  let expired = false;
  const deadline = setTimeout(() => { expired = true; }, 4900);
  try {
    for (;;) {
      const part = await reader.read();
      if (expired) throw new Error("body-timeout");
      if (part.done) break;
      if (bytes.length + part.value.length > MAX_BODY) throw new Error("body-limit");
      const next = new Uint8Array(bytes.length + part.value.length);
      next.set(bytes); next.set(part.value, bytes.length); bytes = next;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timer); clearTimeout(deadline); void reader.cancel();
  }
}
