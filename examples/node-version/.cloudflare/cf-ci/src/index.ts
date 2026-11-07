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

		// The managed image ships Node.js 24, so install the version from .node-version, like setup-node.
		const setup = await step.runner('setup node', {
			image,
			inputs: [repoCharm],
			command: [
				'version="$(tr -d "v[:space:]" < repo/.node-version)"',
				'case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "unsupported $(uname -m)"; exit 1 ;; esac',
				'mkdir -p node',
				'curl -fsSL "https://nodejs.org/dist/v$version/node-v$version-linux-$arch.tar.gz" | tar -xz -C node --strip-components 1',
				'node/bin/node --version',
			].join(' && '),
			outputs: { node: 'node' },
		});
		const node = setup.outputs.node;
		if (node === null) throw new Error('setup node saved no Node.js');

		const check = await step.runner('check version', {
			image,
			inputs: [repoCharm, node],
			command: `export PATH="/workspace/node/bin:$PATH" && cd repo && node -e "if (process.version !== 'v22.20.0') process.exit(1)" && node --version`,
			allowFailure: true,
		});

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: check.exitCode === 0,
			checks: { node: { exitCode: check.exitCode, log: check.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/node-version on pushes to its Artifacts repo.'),
};
