import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep, StepResult } from './workflows-internal';

type Check = { exitCode: number | null; log: string; skipped?: true };

const image = 'workflows/node';
// Stands in for the comparison's fail-deploy dispatch input; cf ci runs start from pushes, which carry no inputs.
const FAIL_DEPLOY = 'false';

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'rollback-compensation / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('rollback-compensation'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		const toCheck = (result: StepResult | null): Check =>
			result ? { exitCode: result.exitCode, log: result.logs.data } : { exitCode: null, log: '', skipped: true };

		// continue-on-error: the deploy result decides whether the rollback runs.
		const deploy = await step.runner('deploy', {
			image,
			inputs: [repoCharm],
			env: { FAIL_DEPLOY },
			command: 'cd repo && test "$FAIL_DEPLOY" != true',
			allowFailure: true,
		});
		const failed = deploy.exitCode !== 0;
		const rollback = failed
			? await step.runner('redeploy the previous version', { image, inputs: [repoCharm], command: 'echo rollback', allowFailure: true })
			: null;

		// The rollback does not erase the original failure.
		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: !failed,
			checks: { deploy: toCheck(deploy), rollback: toCheck(rollback) },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/rollback-compensation on GitHub commits.'),
};
