import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'verification-evidence / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('verification-evidence'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// Like the GitHub Actions comparison, cf ci has no trusted proof store, so every run repeats the check.
		const lint = await step.runner('lint', {
			image,
			inputs: [repoCharm],
			command: 'cd repo && node --check app/index.js',
			allowFailure: true,
		});

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: lint.exitCode === 0,
			checks: { lint: { exitCode: lint.exitCode, log: lint.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/verification-evidence on GitHub commits.'),
};
