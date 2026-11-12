import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const CHECKS: Record<string, string> = {
	lint: 'npm run lint',
	test: 'npm test',
	build: 'npm run build',
};

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'node-npm / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('node-npm'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		const npm = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
		// node-npm has no dependencies, so npm ci creates no node_modules to hand to the checks.
		await step.runner('install', {
			image,
			inputs: [repoCharm],
			env: npm,
			command: 'cd repo && npm ci',
		});

		const names = Object.keys(CHECKS);
		const results = await Promise.all(
			names.map((name) =>
				step.runner(name, {
					image,
					inputs: [repoCharm],
					env: npm,
					command: `cd repo && ${CHECKS[name]}`,
					allowFailure: true,
				}),
			),
		);

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0),
			checks: Object.fromEntries(
				names.map((name, index) => [name, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/node-npm on GitHub commits.'),
};
