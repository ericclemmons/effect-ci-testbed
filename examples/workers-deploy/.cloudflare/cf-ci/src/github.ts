// Adapted from https://developers.cloudflare.com/ci/get-started/.
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

// Started by scripts/cf-ci.mjs. GitHub push and pull request triggers do not exist yet.
export type Params = { sha: string; ref?: string; mr?: number };

type Result = { passed: boolean; checks: Record<string, { exitCode: number | null; skipped?: boolean; optional?: boolean }> };

export const sourceUrl = (env: Env, sha: string) => `https://codeload.github.com/${env.GITHUB_REPO}/tar.gz/${sha}`;

// Downloads SOURCE_URL and keeps examples/<recipe> as ./repo, without Git history. The guide serves the
// tarball from the pipeline's workers.dev URL instead, but this account's Cloudflare Access blocks
// unmatched workers.dev hosts (error 1050). This repository is public, so runners fetch it from GitHub.
export const checkoutRecipe = (recipe: string) =>
	[
		`node -e 'fetch(process.env.SOURCE_URL).then(async (r) => { if (!r.ok) throw new Error("download failed: " + r.status + " " + (await r.text()).slice(0, 200)); require("fs").writeFileSync("source.tgz", Buffer.from(await r.arrayBuffer())); })'`,
		"mkdir source",
		"tar xzf source.tgz -C source --strip-components=1",
		`mv source/examples/${recipe} repo`,
		"rm -rf source source.tgz",
	].join(" && ");

// Reports a pipeline as one GitHub check on the commit, and comments on the pull request when `mr` is set.
export async function reportToGitHub<R extends Result>(
	env: Env,
	event: WorkflowEvent<Params>,
	step: WorkflowStep,
	name: string,
	pipeline: () => Promise<R>,
) {
	const { sha, mr } = event.payload;
	// Runs started soon after a deploy can execute the previous code, even when the instance reports
	// the new version. scripts/cf-ci.mjs reads this step and retries stale runs.
	await step.do("pipeline version", async () => env.PIPELINE_SHA);
	await step.do("start check", () => writeCheck(env, sha, name, { status: "in_progress" }));

	let result: R;
	try {
		result = await pipeline();
	} catch (error) {
		await step.do("fail check", () =>
			writeCheck(env, sha, name, { status: "completed", conclusion: "failure", title: "Pipeline errored", summary: String(error) }),
		);
		throw error;
	}

	const summary = [
		"| Check | Exit |",
		"| --- | --- |",
		...Object.entries(result.checks).map(([check, { exitCode, skipped, optional }]) => {
			const status = skipped ? "⏭️ skipped" : `${exitCode === 0 ? "✅" : "❌"} ${exitCode}`;
			return `| ${check}${optional ? " (optional)" : ""} | ${status} |`;
		}),
		"",
		`Pipeline \`${env.PIPELINE_SHA}\`, instance \`${event.instanceId}\`.`,
	].join("\n");
	const check = await step.do("complete check", () =>
		writeCheck(env, sha, name, {
			status: "completed",
			conclusion: result.passed ? "success" : "failure",
			title: result.passed ? "All checks passed" : "One or more checks failed",
			summary,
		}),
	);
	if (mr) {
		await step.do("comment on pull request", () =>
			commentOnPullRequest(
				env,
				mr,
				[`${result.passed ? "✅" : "❌"} **${name}** on \`${sha.slice(0, 7)}\` ([check](${check.url}))`, "", summary].join("\n"),
			),
		);
	}
	return { ...result, checkUrl: check.url };
}

// Get a new checkout in every step. Checkouts cannot be returned from a step.
async function writeCheck(env: Env, sha: string, name: string, update: ScmCheckUpdate) {
	const commit = await env.REPO.checkout({ sha });
	try {
		return await commit.checks.write(name, update);
	} finally {
		commit[Symbol.dispose]();
	}
}

async function commentOnPullRequest(env: Env, mr: number, body: string) {
	const pullRequest = await env.REPO.checkout({ mr });
	try {
		return await pullRequest.comments.write(body);
	} finally {
		pullRequest[Symbol.dispose]();
	}
}
