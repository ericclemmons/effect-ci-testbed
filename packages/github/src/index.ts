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
  readonly text?: string
  readonly status?: "queued" | "in_progress"
  readonly conclusion?: CheckConclusion
  readonly detailsUrl?: string
  readonly externalId?: string
}

export interface CheckRun {
  readonly id: number
  readonly htmlUrl: string
}

export interface UpdateCheckOptions {
  readonly token: string
  readonly repository: string
  readonly checkId: number
  readonly name?: string
  readonly title: string
  readonly summary: string
  readonly text?: string
  readonly status?: "queued" | "in_progress" | "completed"
  readonly conclusion?: CheckConclusion
}

const headers = (token: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "user-agent": "effect-ci-testbed",
  "x-github-api-version": "2026-03-10",
})

const responseError = async (operation: string, response: Response) => {
  const body = await response.text()
  return new Error(`GitHub ${operation} failed (${response.status}): ${body}`)
}

export const createCheck = async (
  options: CreateCheckOptions,
): Promise<CheckRun> => {
  const response = await fetch(
    `https://api.github.com/repos/${options.repository}/check-runs`,
    {
      method: "POST",
      headers: headers(options.token),
      body: JSON.stringify({
        name: options.name,
        head_sha: options.sha,
        status: options.conclusion ? "completed" : (options.status ?? "in_progress"),
        ...(options.conclusion ? { conclusion: options.conclusion } : {}),
        ...(options.detailsUrl ? { details_url: options.detailsUrl } : {}),
        ...(options.externalId ? { external_id: options.externalId } : {}),
        output: {
          title: options.title,
          summary: options.summary,
          ...(options.text ? { text: options.text } : {}),
        },
      }),
    },
  )

  if (!response.ok) {
    throw await responseError("create check", response)
  }

  const check = await response.json() as { id: number; html_url: string }
  return { id: check.id, htmlUrl: check.html_url }
}

export const updateCheck = async (
  options: UpdateCheckOptions,
): Promise<CheckRun> => {
  const response = await fetch(
    `https://api.github.com/repos/${options.repository}/check-runs/${options.checkId}`,
    {
      method: "PATCH",
      headers: headers(options.token),
      body: JSON.stringify({
        ...(options.name ? { name: options.name } : {}),
        status: options.conclusion ? "completed" : (options.status ?? "in_progress"),
        ...(options.conclusion ? { conclusion: options.conclusion } : {}),
        output: {
          title: options.title,
          summary: options.summary,
          ...(options.text ? { text: options.text } : {}),
        },
      }),
    },
  )

  if (!response.ok) {
    throw await responseError("update check", response)
  }

  const check = await response.json() as { id: number; html_url: string }
  return { id: check.id, htmlUrl: check.html_url }
}

export * from "./app.ts"
export * from "./check-cache.ts"
export * from "./reporter.ts"
