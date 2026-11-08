import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';
const gitlab = {
	REPOSITORY: 'https://gitlab.com/gitlab-org/gitlab-test.git',
	REVISION: 'ddd0f15ae83993f5cb66a927a28673882e99100b',
};

export class CI extends WorkflowEntrypoint<Env> {
	async run(event: WorkflowEvent<PushEvent>, workflowStep: WorkflowStep) {
		const step = workflowStep as InternalWorkflowStep;
		const { repoName } = event.payload.source;
		const commit = event.payload.payload.after;

		// The read token reaches the checkout through `env`, which step.runner() does not treat as secret.
		const repo = await step.do('get clone token', async () => {
			using artifactsRepo = await this.env.ARTIFACTS.get(repoName);
			const [info, token] = await Promise.all([artifactsRepo.info(), artifactsRepo.createToken('read', 3600)]);
			return { remote: info.remote, token: token.plaintext };
		});

		const checkout = await step.runner('checkout', {
			image,
			env: { GIT_TOKEN: repo.token, REMOTE: repo.remote, COMMIT: commit },
			command: [
				'git init -q repo && cd repo',
				'git -c http.extraHeader="Authorization: Bearer $GIT_TOKEN" fetch -q --depth 1 "$REMOTE" "$COMMIT"',
				'git checkout -q FETCH_HEAD',
			].join(' && '),
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
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: verify.exitCode === 0,
			checks: { 'verify GitLab source': { exitCode: verify.exitCode, log: verify.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/gitlab-source on pushes to its Artifacts repo.'),
};
