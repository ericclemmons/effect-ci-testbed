export const gitlabRepository = "https://gitlab.com/gitlab-org/gitlab-test.git"
export const gitlabRevision = "ddd0f15ae83993f5cb66a927a28673882e99100b"
export const isPinnedGitlabSource = (value: unknown): boolean =>
  Boolean(value && typeof value === "object" && "repository" in value && "revision" in value &&
    value.repository === gitlabRepository && value.revision === gitlabRevision)
