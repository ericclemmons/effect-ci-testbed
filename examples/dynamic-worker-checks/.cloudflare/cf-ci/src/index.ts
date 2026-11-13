import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'dynamic-worker-checks / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('dynamic-worker-checks'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// Unlike the Effect CI recipe, this formats inside a container, like the GitHub Actions comparison.
		const format = await step.runner('format', {
			image,
			inputs: [repoCharm],
			env: { NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
			command: 'cd repo && npm exec --yes --package=prettier@3.6.2 -- prettier --check app/src/index.ts --no-semi',
			allowFailure: true,
		});

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: format.exitCode === 0,
			checks: { format: { exitCode: format.exitCode, log: format.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/dynamic-worker-checks on GitHub commits.'),
};
