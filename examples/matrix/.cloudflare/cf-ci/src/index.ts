import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { InternalWorkflowStep } from './workflows-internal';

type Env = { ARTIFACTS: Artifacts; PIPELINE_SHA: string };

type PushEvent = {
	source: { namespace: string; repoName: string };
	payload: { ref: string; after: string };
};

const locales = ['en-US', 'de-DE'];
const currencies = ['USD', 'EUR'];

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

		// Every combination runs in its own container; one failure does not stop the others (fail-fast: false).
		const combinations = locales.flatMap((locale) => currencies.map((currency) => ({ locale, currency })));
		const results = await Promise.all(
			combinations.map(({ locale, currency }) =>
				step.runner(`test ${locale} ${currency}`, {
					image,
					inputs: [repoCharm],
					command: `cd repo/app && node verify.mjs ${locale} ${currency}`,
					allowFailure: true,
				}),
			),
		);

		return {
			repo: repoName,
			ref: event.payload.payload.ref,
			commit,
			pipelineSha: this.env.PIPELINE_SHA,
			passed: results.every((result) => result.exitCode === 0),
			checks: Object.fromEntries(
				combinations.map(({ locale, currency }, index) => [
					`${locale} ${currency}`,
					{ exitCode: results[index].exitCode, log: results[index].logs.data },
				]),
			),
		};
	}
}

export default {
	fetch: () => new Response('Runs cf ci for examples/matrix on pushes to its Artifacts repo.'),
};
