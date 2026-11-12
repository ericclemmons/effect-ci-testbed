import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'conditional-deploy / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('conditional-deploy'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// Mirrors `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`. scripts/cf-ci.mjs passes
		// GITHUB_REF, so pull request runs skip the deploy.
		const ref = event.payload.ref;
		const deploy =
			ref === 'refs/heads/main'
				? await step.runner('deploy', { image, inputs: [repoCharm], command: 'cd repo && echo deploy', allowFailure: true })
				: null;

		return {
			repo: this.env.GITHUB_REPO,
			ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: deploy === null || deploy.exitCode === 0,
			checks: {
				deploy: deploy
					? { exitCode: deploy.exitCode, log: deploy.logs.data }
					: { exitCode: null, log: `skipped: ${ref} is not refs/heads/main`, skipped: true },
			},
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/conditional-deploy on GitHub commits.'),
};
