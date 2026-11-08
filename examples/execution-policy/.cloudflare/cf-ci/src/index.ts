import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

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

		// timeout-minutes: 1 becomes the step's native Workflows timeout.
		const result = await step.runner(
			'retry and timeout',
			{ timeout: '1 minute' },
			{ image, inputs: [repoCharm], command: `cd repo && ${retryLoop}`, allowFailure: true },
		);

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: result.exitCode === 0,
			checks: { 'retry-and-timeout': { exitCode: result.exitCode, log: result.logs.data } },
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/execution-policy on pushes to its Artifacts repo.'),
};
