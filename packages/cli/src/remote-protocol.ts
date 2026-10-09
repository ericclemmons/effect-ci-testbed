/** Never forward execution or Access credentials to a URL supplied by another origin. */
export const remoteEventUrl = (origin: string, eventsUrl: string): string => {
  const base = new URL(origin)
  const events = new URL(eventsUrl, base)
  if (events.origin !== base.origin || events.username || events.password) {
    throw new Error("Remote event stream must use the configured service origin")
  }
  return events.href
}

/** NDJSON may split anywhere, and its final record need not have a newline. */
export async function* remoteRecords(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) if (line.trim()) yield JSON.parse(line)
      if (chunk.done) {
        if (buffer.trim()) yield JSON.parse(buffer)
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
}
