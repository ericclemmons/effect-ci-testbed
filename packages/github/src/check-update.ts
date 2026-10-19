/** An existing check's identical PATCH is safe to retry within a bounded window. */
export async function updateVisibleCheck(
  request: () => Promise<Response>,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response> {
  const delays = [250, 750, 1500]
  for (let attempt = 0; ; attempt++) {
    const response = await request()
    const milliseconds = delays[attempt]
    // Newly created checks may briefly return 404; GitHub may also return an
    // explicit transient server error. Never retry permission/validation/rate
    // limits, transport exceptions, or check creation. Persistent errors remain
    // errors: the final response is returned unchanged for the caller to report.
    const transient = [404, 500, 502, 503, 504].includes(response.status)
    if (!transient || milliseconds === undefined) return response
    await response.arrayBuffer()
    await delay(milliseconds)
  }
}
