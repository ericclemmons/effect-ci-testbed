export type CheckConclusion =
  | "action_required"
  | "cancelled"
  | "failure"
  | "neutral"
  | "skipped"
  | "success"
  | "timed_out"

export interface CreateCheckOptions {
  readonly token: string
  readonly repository: string
  readonly sha: string
  readonly name: string
  readonly title: string
  readonly summary: string
  readonly conclusion: CheckConclusion
  readonly detailsUrl?: string
  readonly externalId?: string
}

export interface CheckRun {
  readonly id: number
  readonly htmlUrl: string
}

export const createCheck = async (
  options: CreateCheckOptions,
): Promise<CheckRun> => {
  const response = await fetch(
    `https://api.github.com/repos/${options.repository}/check-runs`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        "user-agent": "effect-ci-testbed",
        "x-github-api-version": "2026-03-10",
      },
      body: JSON.stringify({
        name: options.name,
        head_sha: options.sha,
        status: "completed",
        conclusion: options.conclusion,
        ...(options.detailsUrl ? { details_url: options.detailsUrl } : {}),
        ...(options.externalId ? { external_id: options.externalId } : {}),
        output: {
          title: options.title,
          summary: options.summary,
        },
      }),
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub create check failed (${response.status}): ${body}`)
  }

  const check = await response.json() as { id: number; html_url: string }
  return { id: check.id, htmlUrl: check.html_url }
}
