import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';

// Same loop as the GitHub Actions comparison: two transient failures, then success.
const retryLoop = `attempt=0
until [ "$attempt" -ge 3 ]; do
  attempt=$((attempt + 1))
  echo "attempt $attempt"
  if [ "$attempt" -lt 3 ]; then
    sleep 0.01
    continue
  fi
  exit 0
done`;

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'execution-policy / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('execution-policy'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// timeout-minutes: 1 becomes the step's native Workflows timeout.
		const result = await step.runner(
			'retry and timeout',
			{ timeout: '1 minute' },
			{ image, inputs: [repoCharm], command: `cd repo && ${retryLoop}`, allowFailure: true },
		);

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: result.exitCode === 0,
			checks: { 'retry-and-timeout': { exitCode: result.exitCode, log: result.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/execution-policy on GitHub commits.'),
};
