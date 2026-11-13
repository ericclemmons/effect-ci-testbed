import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

// Name -> whether a failure is advisory (continue-on-error in the GitHub Actions comparison).
const CHECKS: Record<string, boolean> = { lint: false, format: true };

const image = 'workflows/node';
const env = { NPM_CONFIG_UPDATE_NOTIFIER: 'false' };

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'optional-checks / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('optional-checks'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// optional-checks has no dependencies, so npm ci creates no node_modules to hand to the checks.
		await step.runner('install', { image, inputs: [repoCharm], env, command: 'cd repo && npm ci' });

		const names = Object.keys(CHECKS);
		const results = await Promise.all(
			names.map((name) =>
				step.runner(name, { image, inputs: [repoCharm], env, command: `cd repo && npm run ${name}`, allowFailure: true }),
			),
		);
		const checks = Object.fromEntries(
			names.map((name, index) => [
				name,
				{ exitCode: results[index].exitCode, log: results[index].logs.data, ...(CHECKS[name] ? { optional: true } : {}) },
			]),
		);

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: Object.values(checks).every((check) => check.optional || check.exitCode === 0),
			checks,
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/optional-checks on GitHub commits.'),
};
