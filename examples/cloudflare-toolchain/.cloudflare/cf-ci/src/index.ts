import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';

// apt-get installs outside /workspace, where no output can save it, so the job's steps share one container.
// Commands run as root, so apt-get needs no sudo.
const build = [
	'apt-get update -qq',
	'apt-get install --yes -qq --no-install-recommends python3 python3-venv',
	'python3 -m venv .venv',
	'.venv/bin/pip install --no-cache-dir build==1.3.0 hatchling==1.27.0',
	'cd app && ../.venv/bin/python -m build --no-isolation',
	'ls dist',
].join(' && ');

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

		const result = await step.runner('build', {
			image,
			inputs: [repoCharm],
			env: { DEBIAN_FRONTEND: 'noninteractive' },
			command: `cd repo && ${build}`,
			allowFailure: true,
		});

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: result.exitCode === 0,
			checks: { build: { exitCode: result.exitCode, log: result.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/cloudflare-toolchain on pushes to its Artifacts repo.'),
};
