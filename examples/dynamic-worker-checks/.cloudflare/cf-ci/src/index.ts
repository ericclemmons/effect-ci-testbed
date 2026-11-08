import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';

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

		// Unlike the Effect CI recipe, this formats inside a container, like the GitHub Actions comparison.
		const format = await step.runner('format', {
			image,
			inputs: [repoCharm],
			env: { NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
			command: 'cd repo && npm exec --yes --package=prettier@3.6.2 -- prettier --check app/src/index.ts --no-semi',
			allowFailure: true,
		});

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: format.exitCode === 0,
			checks: { format: { exitCode: format.exitCode, log: format.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/dynamic-worker-checks on pushes to its Artifacts repo.'),
};
