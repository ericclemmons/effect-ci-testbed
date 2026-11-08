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

		const build = await step.runner('build', {
			image,
			inputs: [repoCharm],
			command: 'cd repo && mkdir -p dist && echo worker > dist/worker.js',
			outputs: { worker: 'repo/dist/worker.js' },
			allowFailure: true,
		});

		// Like download-artifact, the deploy job restores only the saved file, not the checkout,
		// and chooses where it lands.
		const worker = build.outputs.worker;
		const deploy = worker
			? await step.runner('deploy', {
					image,
					inputs: [{ ...worker, path: 'dist/worker.js' }],
					command: 'test -f dist/worker.js && cat dist/worker.js',
					allowFailure: true,
				})
			: null;

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: build.exitCode === 0 && deploy?.exitCode === 0,
			checks: {
				build: { exitCode: build.exitCode, log: build.logs.data },
				deploy: deploy ? { exitCode: deploy.exitCode, log: deploy.logs.data } : { exitCode: null, log: '', skipped: true },
			},
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/portable-artifacts on pushes to its Artifacts repo.'),
};
