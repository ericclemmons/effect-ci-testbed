/** Host enrollment, not an incoming repository/module selector. */
export const demoGitHubRef = "refs/heads/main";
export const demoGitHubAllowed = (input: {
  readonly repository: string; readonly repositoryName: string; readonly revision: string;
  readonly installationId: number; readonly ref?: string;
}): boolean => demoRunAllowed(input) && input.repositoryName === "ericclemmons/effect-ci-testbed" &&
  input.installationId === 165265172 && typeof input.ref === "string" &&
  input.ref.startsWith("refs/heads/") && input.ref.length > "refs/heads/".length &&
  input.ref.length <= 1024 && !/[\x00-\x20\x7f]/.test(input.ref);

/** Only canonical authenticated main runs can obtain release authority. */
export const demoProductionAllowed = (input: Parameters<typeof demoGitHubAllowed>[0]): boolean =>
  demoGitHubAllowed(input) && input.ref === demoGitHubRef;

export const demoRouteAllowed = (pathname: string): boolean =>
  pathname === "/demo" ||
  pathname === "/demo/" ||
  pathname === "/demo/runs" ||
  /^\/demo\/runs\/[A-Za-z0-9_-]+(?:\/events)?$/.test(pathname);

export const demoRunAllowed = (input: {
  readonly repository: string;
  readonly revision: string;
  readonly target?: string;
}): boolean =>
  [
    "https://github.com/ericclemmons/effect-ci-testbed.git",
    "https://github.com/ericclemmons/effect-ci-testbed",
  ].includes(input.repository) &&
  /^[0-9a-f]{40}$/.test(input.revision) &&
  input.target === undefined;
