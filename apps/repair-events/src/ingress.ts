export const MAX_BYTES = 32768;
export const MAX_CAPTURES = 4;
export const ALERT_TYPE = "workers_observability_real_time_issue";
export async function authenticated(header: string | null, secret: unknown) {
  if (
    typeof secret !== "string" ||
    !/^[a-f0-9]{64}$/.test(secret) ||
    header === null ||
    header.length !== 64
  )
    return false;
  const hash = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([hash(header), hash(secret)]);
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
export async function boundedBody(request: Request): Promise<string> {
  if (request.headers.has("content-encoding"))
    throw new Error("Invalid notification");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
    throw new Error("Invalid notification");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid notification");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Invalid notification")), 5000);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Invalid notification");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
/** Capture, not semantic incident authorization. No data field enters a model. */
export function notificationKind(
  raw: string,
): "non-issue-text" | "quarantine" | "unclassified" {
  const body = JSON.parse(raw);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid notification");
  // Wording is not a protocol identity. A bounded authenticated text-only
  // callback grants NO Issue, storage, model or repair authority.
  if (Object.keys(body).length === 1 && Object.hasOwn(body, "text")) {
    if (
      typeof body.text === "string" &&
      body.text.length > 0 &&
      new TextEncoder().encode(body.text).byteLength <= 1024
    )
      return "non-issue-text";
    throw new Error("Invalid notification");
  }
  // An authenticated object missing the alert tag is only diagnostic evidence.
  // Some platform callbacks omit envelope identity; never infer an Issue tag.
  if (!Object.hasOwn(body, "alert_type")) return "unclassified";
  if (
    body.alert_type !== ALERT_TYPE ||
    !body.data ||
    typeof body.data !== "object" ||
    Array.isArray(body.data)
  )
    throw new Error("Invalid notification");
  return "quarantine";
}
export async function digest(raw: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
