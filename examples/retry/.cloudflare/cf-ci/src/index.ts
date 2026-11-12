import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';
const attempts = 2;

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'retry / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('retry'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// step.runner() can retry natively, but its command cannot see the attempt number, so each attempt
		// is its own step. The check fails on attempt 1 and passes on attempt 2, after a constant 1 second delay.
		const logs: string[] = [];
		let exitCode = -1;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			if (attempt > 1) await step.sleep(`retry delay ${attempt}`, '1 second');
			const result = await step.runner(`flaky test attempt ${attempt}`, {
				image,
				inputs: [repoCharm],
				env: { ATTEMPT: String(attempt) },
				command: 'if [ "$ATTEMPT" = 1 ]; then echo "Simulated transient failure on attempt 1"; exit 1; fi; echo "passed on attempt $ATTEMPT"',
				allowFailure: true,
			});
			exitCode = result.exitCode;
			logs.push(`attempt ${attempt}: exit ${exitCode}\n${result.logs.data}`);
			if (exitCode === 0) break;
		}

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: exitCode === 0,
			checks: { 'flaky test': { exitCode, log: logs.join('\n') } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/retry on GitHub commits.'),
};
