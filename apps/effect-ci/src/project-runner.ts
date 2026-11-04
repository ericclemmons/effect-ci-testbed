import type { WorkflowParameters } from "@effect-ci-testbed/github-cloudflare";

interface ProjectSelection {
  readonly root: string;
  readonly workflow?: string;
}

export function projectSelection(parameters: WorkflowParameters): ProjectSelection | undefined {
  return parameters.trigger === "remote"
    ? (parameters as WorkflowParameters & { readonly project?: ProjectSelection }).project : undefined;
}

export async function projectCapabilities(request: Request, response: Response): Promise<Response> {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/capabilities" || response.status !== 200) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const capabilities = await response.json() as Record<string, unknown>;
  return Response.json({ ...capabilities, projectSelection: true }, { headers });
}
