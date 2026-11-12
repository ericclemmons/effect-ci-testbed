import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { DOWNLOAD_SOURCE, commentOnPullRequest, pullRequestHead, sourceUrl, writeCheck } from "./github";
import type { InternalWorkflowStep } from "./workflows-internal";

// Started by `wrangler workflows trigger` or scripts/cf-ci-github.mjs. GitHub push and pull request triggers do not exist yet.
type Params = { sha?: string; mr?: number };

const CHECK = "node-npm / cf-ci-github";
const CHECKS: Record<string, string> = {
	lint: "npm run lint",
	test: "npm test",
	build: "npm run build",
};

const image = "workflows/node";
const npm = { NPM_CONFIG_UPDATE_NOTIFIER: "false" };

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, workflowStep: WorkflowStep) {
		const step = workflowStep as InternalWorkflowStep;
		const { mr } = event.payload;

		// Runs started soon after a deploy can execute the previous code, even when the instance reports
		// the new version. scripts/cf-ci-github.mjs reads this step and retries stale runs.
		await step.do("pipeline version", async () => this.env.PIPELINE_SHA);

		const sha = await step.do("resolve commit", async () => {
			if (event.payload.sha) return event.payload.sha;
			if (!mr) throw new Error("Pass a sha or an mr");
			return pullRequestHead(this.env, mr);
		});

		await step.do("start check", () => writeCheck(this.env, sha, CHECK, { status: "in_progress" }));

		// The tarball holds the whole repository; later steps only need this recipe.
		const checkout = await step.runner("checkout", {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, sha) },
			command: DOWNLOAD_SOURCE,
			outputs: { recipe: "repo/examples/node-npm" },
		});
		const recipe = checkout.outputs.recipe;
		if (recipe === null) throw new Error("checkout saved no recipe");

		// node-npm has no dependencies, so npm ci creates no node_modules to hand to the checks.
		await step.runner("install", {
			image,
			inputs: [recipe],
			env: npm,
			command: "cd repo/examples/node-npm && npm ci",
		});

		const names = Object.keys(CHECKS);
		const results = await Promise.all(
			names.map((name) =>
				step.runner(name, {
					image,
					inputs: [recipe],
					env: npm,
					command: `cd repo/examples/node-npm && ${CHECKS[name]}`,
					allowFailure: true,
				}),
			),
		);
		const checks = Object.fromEntries(
			names.map((name, index) => [name, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
		);
		const passed = results.every((result) => result.exitCode === 0);
		const summary = [
			"| Check | Exit |",
			"| --- | --- |",
			...names.map((name) => `| ${name} | ${checks[name].exitCode === 0 ? "✅" : "❌"} ${checks[name].exitCode} |`),
			"",
			`Pipeline \`${this.env.PIPELINE_SHA}\`, instance \`${event.instanceId}\`.`,
		].join("\n");

		const check = await step.do("complete check", () =>
			writeCheck(this.env, sha, CHECK, {
				status: "completed",
				conclusion: passed ? "success" : "failure",
				title: passed ? "All checks passed" : "One or more checks failed",
				summary,
			}),
		);

		if (mr) {
			await step.do("comment on pull request", () =>
				commentOnPullRequest(
					this.env,
					mr,
					[`${passed ? "✅" : "❌"} **${CHECK}** on \`${sha.slice(0, 7)}\` ([check](${check.url}))`, "", summary].join("\n"),
				),
			);
		}

		return { sha, mr, checkUrl: check.url, pipelineSha: this.env.PIPELINE_SHA, passed, checks };
	}
}

export default {
	fetch: () => new Response("Runs cf ci for examples/node-npm on GitHub commits and pull requests."),
} satisfies ExportedHandler<Env>;
