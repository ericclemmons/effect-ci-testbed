import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';
const shards = [0, 1];

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'test-splitting / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('test-splitting'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// fail-fast: false. Each shard writes its report before exiting, so the report saves even when a test fails.
		const results = await Promise.all(
			shards.map((shard) =>
				step.runner(`test shard ${shard}/${shards.length}`, {
					image,
					inputs: [repoCharm],
					command: `cd repo/app && node scripts/run-shard.mjs ${shard} ${shards.length}`,
					outputs: { report: `repo/app/reports/shard-${shard}.json` },
					allowFailure: true,
				}),
			),
		);
		const reports = results.map((result) => result.outputs.report);

		// Like downloading both uploaded reports: every test ran exactly once across the shards.
		const verify = reports.every((report) => report !== null)
			? await step.runner('verify shard reports', {
					image,
					inputs: [repoCharm, ...reports.filter((report) => report !== null)],
					command: `cd repo/app && node scripts/verify-reports.mjs "$(jq -s . reports/shard-*.json)"`,
					allowFailure: true,
				})
			: null;

		const checks = Object.fromEntries([
			...shards.map((shard, index) => [`shard ${shard}`, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			['verify', verify ? { exitCode: verify.exitCode, log: verify.logs.data } : { exitCode: null, log: 'a shard saved no report', skipped: true }],
		]);

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0) && verify?.exitCode === 0,
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/test-splitting on GitHub commits.'),
};
