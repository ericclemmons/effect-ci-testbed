import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';
const env = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'zero-config / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('zero-config'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// No workflow lists the checks: every package script becomes one. The Worker cannot read
		// the checkout, so the discovery step prints the script names as its last log line.
		const discover = await step.runner('discover', {
			image,
			inputs: [repoCharm],
			command: `cd repo && node -p "JSON.stringify(Object.keys(require('./package.json').scripts ?? {}))"`,
		});
		const names: string[] = JSON.parse(discover.logs.data.trim().split('\n').at(-1) ?? '[]');
		if (names.length === 0) throw new Error('discovered no package scripts');

		// zero-config has no dependencies, so npm ci creates no node_modules to hand to the checks.
		await step.runner('install', { image, inputs: [repoCharm], env, command: 'cd repo && npm ci' });

		const results = await Promise.all(
			names.map((name) =>
				step.runner(name, { image, inputs: [repoCharm], env, command: `cd repo && npm run ${name}`, allowFailure: true }),
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
	fetch: () => new Response('Runs cf ci for examples/zero-config on GitHub commits.'),
};
