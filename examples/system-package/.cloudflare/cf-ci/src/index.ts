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
		if (checkout.outputs.repo === null) throw new Error('checkout saved no repo');

		// Commands run as root, so apt-get needs no sudo.
		const imagemagick = await step.runner('imagemagick', {
			image,
			inputs: [checkout.outputs.repo],
			env: { DEBIAN_FRONTEND: 'noninteractive' },
			command: [
				'apt-get update -qq',
				'apt-get install --yes -qq --no-install-recommends imagemagick',
				'convert -version | grep --fixed-strings ImageMagick',
			].join(' && '),
			allowFailure: true,
		});

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: imagemagick.exitCode === 0,
			checks: { imagemagick: { exitCode: imagemagick.exitCode, log: imagemagick.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/system-package on pushes to its Artifacts repo.'),
};
