// Adapted from https://developers.cloudflare.com/ci/get-started/.
const GITHUB_HEADERS = { "user-agent": "cf-ci-github-node-npm" };

// Downloads SOURCE_URL into ./repo, without Git history. The guide serves the tarball from the
// pipeline's workers.dev URL instead, but this account's Cloudflare Access blocks unmatched
// workers.dev hosts (error 1050). This repository is public, so runners fetch it from GitHub.
export const DOWNLOAD_SOURCE = [
	`node -e 'fetch(process.env.SOURCE_URL).then(async (r) => { if (!r.ok) throw new Error("download failed: " + r.status + " " + (await r.text()).slice(0, 200)); require("fs").writeFileSync("source.tgz", Buffer.from(await r.arrayBuffer())); })'`,
	"mkdir repo",
	"tar xzf source.tgz -C repo --strip-components=1",
].join(" && ");

export const sourceUrl = (env: Env, sha: string) => `https://codeload.github.com/${env.GITHUB_REPO}/tar.gz/${sha}`;

// Get a new checkout in every step. Checkouts cannot be returned from a step.
export async function writeCheck(env: Env, sha: string, name: string, update: ScmCheckUpdate) {
	const commit = await env.REPO.checkout({ sha });
	try {
		return await commit.checks.write(name, update);
	} finally {
		commit[Symbol.dispose]();
	}
}

export async function commentOnPullRequest(env: Env, mr: number, body: string) {
	const pullRequest = await env.REPO.checkout({ mr });
	try {
		return await pullRequest.comments.write(body);
	} finally {
		pullRequest[Symbol.dispose]();
	}
}

// A pull request checkout does not include its commit SHA, so read it from GitHub.
export async function pullRequestHead(env: Env, mr: number) {
	const outbound = await env.REPO.outbound();
	const response = await outbound.fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/commits/refs/pull/${mr}/head`, {
		headers: GITHUB_HEADERS,
	});
	if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
	const { sha } = await response.json<{ sha: string }>();
	return sha;
}
