import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const image = 'workflows/node';
const changes = ['input', 'unchanged', 'missing', 'tampered', 'program', 'runtime', 'filesystem-loss'];

// One comparison job. Its steps share runner-local files, so they run in one container. The script writes
// its step outputs to GITHUB_OUTPUT, which this shell reads back to choose the affected steps.
const job = `set -e
cd repo
export GITHUB_OUTPUT="$(mktemp)"
node verification/conventional.mjs prepare "$CHANGE"
. "$GITHUB_OUTPUT"
export COMPARISON_ROOT="$root"
for name in left right bundle; do
  eval "selected=\\$$name"
  if [ "$selected" = true ]; then echo "run $name"; node verification/conventional.mjs run "$name"; else echo "reuse $name"; fi
done
node verification/conventional.mjs verify`;

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

		const results = await Promise.all(
			changes.map((change) =>
				step.runner(`compare ${change}`, { image, inputs: [repoCharm], env: { CHANGE: change }, command: job, allowFailure: true }),
			),
		);

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0),
			checks: Object.fromEntries(
				changes.map((change, index) => [change, { exitCode: results[index].exitCode, log: results[index].logs.data }]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/dependency-aware-reruns on pushes to its Artifacts repo.'),
};
