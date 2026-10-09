/** A newly created check can briefly return 404 from GitHub's update endpoint. */
export async function updateVisibleCheck(
  request: () => Promise<Response>,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response> {
  const delays = [250, 750, 1500]
  for (let attempt = 0; ; attempt++) {
    const response = await request()
    const milliseconds = delays[attempt]
    // Never retry permission errors, validation errors, or check creation.
    // A persistent 404 is returned unchanged for the caller to report.
    if (response.status !== 404 || milliseconds === undefined) return response
    await response.arrayBuffer()
    await delay(milliseconds)
  }
}
