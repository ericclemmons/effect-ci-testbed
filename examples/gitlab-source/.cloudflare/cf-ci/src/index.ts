import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { checkoutRecipe, reportToGitHub, sourceUrl, type Params } from './github';
import type { InternalWorkflowStep } from './workflows-internal';

const image = 'workflows/node';
const gitlab = {
	REPOSITORY: 'https://gitlab.com/gitlab-org/gitlab-test.git',
	REVISION: 'ddd0f15ae83993f5cb66a927a28673882e99100b',
};

export class CI extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		return reportToGitHub(this.env, event, step, 'gitlab-source / cf-ci', () => this.pipeline(event, step as InternalWorkflowStep));
	}

	private async pipeline(event: WorkflowEvent<Params>, step: InternalWorkflowStep) {
		const commit = event.payload.sha;

		const checkout = await step.runner('checkout', {
			image,
			env: { SOURCE_URL: sourceUrl(this.env, commit) },
			command: checkoutRecipe('gitlab-source'),
			outputs: { repo: 'repo' },
		});
		const repoCharm = checkout.outputs.repo;
		if (repoCharm === null) throw new Error('checkout saved no repo');

		// Clones the pinned public GitLab fixture over HTTPS at a full commit SHA, then reads its VERSION.
		const verify = await step.runner('verify GitLab source', {
			image,
			env: gitlab,
			command: [
				'git init -q gitlab && cd gitlab',
				'git fetch -q --depth 1 "$REPOSITORY" "$REVISION"',
				'git checkout -q FETCH_HEAD',
				'test "$(git rev-parse HEAD)" = "$REVISION"',
				'test "$(cat VERSION)" = 6.7.0.pre',
				'echo "GitLab $REVISION VERSION $(cat VERSION)"',
			].join(' && '),
			allowFailure: true,
		});

		return {
			repo: this.env.GITHUB_REPO,
			ref: event.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: verify.exitCode === 0,
			checks: { 'verify GitLab source': { exitCode: verify.exitCode, log: verify.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/gitlab-source on GitHub commits.'),
};
