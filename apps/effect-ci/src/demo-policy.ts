/** Host enrollment, not an incoming repository/module selector. */
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
